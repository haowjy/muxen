//! The `/fs/*` routes (fs.md "Routes"): thin handlers that parse the request, take
//! slots, call into `crate::fs` and build responses. They sit in the `devices` router,
//! behind both auth layers. A path rides in the URL path, percent-encoded per segment;
//! the daemon decodes it and prepends `/`, unless it starts with `~`.

use std::path::Path as FilePath;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse as _, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tracing::{debug, error, info, warn};

use super::{Ctx, Refusal};
use crate::files::Stamp;
use crate::fs::list::{self, Filter};
use crate::fs::raw::{self, Span};
use crate::fs::upload::{self, MAX_UPLOAD, Naming};
use crate::fs::{FsError, Want, mime};
use crate::proto::HttpError;

/// `{*path}`, or nothing on a route without one; a rejection if it doesn't decode.
type WirePath = Result<Option<Path<String>>, PathRejection>;

pub(super) fn routes() -> Router<Arc<Ctx>> {
    Router::new()
        // `{*path}` doesn't match an empty path: `/` is its own route.
        .route("/fs/list/", get(listing))
        .route("/fs/list/{*path}", get(listing))
        .route("/fs/raw/{*path}", get(raw))
        // The handler checks the cap itself, up front and as the body arrives.
        .route(
            "/fs/upload",
            post(upload).layer(DefaultBodyLimit::disable()),
        )
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    offset: u32,
    /// `0` or `1`.
    #[serde(default)]
    hidden: u8,
}

#[derive(Debug, Deserialize)]
struct UploadQuery {
    /// The client's file name: only its extension is used.
    #[serde(default)]
    name: String,
    /// The folder to upload into (`~`, `~/…` or absolute); absent: `uploads_dir`.
    dir: Option<String>,
    /// `1`: the body is pasted text, named `pasted-<time>.txt`; `name` is ignored.
    #[serde(default)]
    text: u8,
}

/// A page of any directory, holding the scan slot.
async fn listing(
    State(ctx): State<Arc<Ctx>>,
    path: WirePath,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    let (Some(path), Ok(Query(query))) = (wire_path(path), query) else {
        return respond("", Err(FsError::BadRequest));
    };
    if query.hidden > 1 {
        return respond(&path, Err(FsError::BadRequest));
    }
    let filter = Filter {
        hidden: query.hidden == 1,
    };
    let listed = async {
        let _scan = ctx.fs.scan().await?;
        let (asked, home) = (path.clone(), ctx.app.home.clone());
        ctx.fs
            .lane
            .run(move || {
                let dir = crate::fs::open(&asked, &home, Want::Dir)?;
                list::list(&dir, filter, query.offset).map_err(FsError::io)
            })
            .await?
    }
    .await;
    debug!(%path, offset = query.offset, ok = listed.is_ok(), "listed");
    respond(&path, listed.map(|listing| Json(listing).into_response()))
}

/// A file's bytes, or one range of them, holding a raw-response slot until the body
/// is sent or aborted.
async fn raw(State(ctx): State<Arc<Ctx>>, path: WirePath, headers: HeaderMap) -> Response {
    let Some(path) = wire_path(path) else {
        return respond("", Err(FsError::BadRequest));
    };
    let sent = async {
        let slot = ctx.fs.raw().await?;
        let (asked, home) = (path.clone(), ctx.app.home.clone());
        let opened = ctx
            .fs
            .lane
            .run(move || crate::fs::open(&asked, &home, Want::File))
            .await??;
        let size = opened.meta.len();
        let etag = Stamp::of(&opened.meta).etag();
        let header = |name| headers.get(name).and_then(|value| value.to_str().ok());
        let range = header(header::RANGE);
        let (status, start, len) = match raw::span(range, header(header::IF_RANGE), &etag, size) {
            Span::Whole => (StatusCode::OK, 0, size),
            Span::Part { start, end } => (StatusCode::PARTIAL_CONTENT, start, end - start + 1),
            Span::Unsatisfiable => return Err(FsError::BadRange { size }),
        };
        debug!(%path, ?range, status = status.as_u16(), "raw");
        let name = FilePath::new(&path).file_name().unwrap_or_default();
        let mime = mime::for_name(&name.to_string_lossy());
        let mut chunks = raw::stream(ctx.fs.lane.clone(), opened, start, len, slot);
        let body = futures_util::stream::poll_fn(move |cx| chunks.poll_recv(cx));
        let mut response = Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, mime)
            // Exactly this many bytes, or the response is aborted.
            .header(header::CONTENT_LENGTH, len)
            .header(header::ETAG, etag)
            .header(header::ACCEPT_RANGES, "bytes")
            // The native player fetches without the scheme handler, which adds these too.
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CONTENT_SECURITY_POLICY, "sandbox");
        if status == StatusCode::PARTIAL_CONTENT {
            let end = start + len - 1;
            response =
                response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
        }
        response
            .body(Body::from_stream(body))
            .map_err(|cause| FsError::Internal(std::io::Error::other(cause)))
    }
    .await;
    respond(&path, sent)
}

/// `201 { path, size }`: the body, as is, into `dir` (default `uploads_dir`) under a name the daemon
/// picks. One upload at a time; a second is `busy` at once.
async fn upload(
    State(ctx): State<Arc<Ctx>>,
    query: Result<Query<UploadQuery>, QueryRejection>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let Ok(Query(query)) = query else {
        return respond("", Err(FsError::BadRequest));
    };
    let declared = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if declared.is_some_and(|len| len > MAX_UPLOAD) {
        return respond("", Err(FsError::TooLarge));
    }
    let uploaded = async {
        let slot = ctx.fs.upload()?;
        let app = ctx.clone();
        let dest = query.dir.clone();
        let dir = ctx
            .fs
            .lane
            .run(move || upload::open_dir(&app.app.config, &app.app.home, dest.as_deref()))
            .await??;
        let naming = if query.text == 1 {
            Naming::PastedText
        } else {
            Naming::Upload(&query.name)
        };
        let body = body.into_data_stream();
        upload::receive(
            &ctx.fs.lane,
            slot,
            dir,
            &ctx.app.upload_record,
            naming,
            MAX_UPLOAD,
            body,
        )
        .await
    }
    .await;
    match uploaded {
        Ok(uploaded) => {
            info!(path = %uploaded.path, size = uploaded.size, "uploaded a file");
            (StatusCode::CREATED, Json(uploaded)).into_response()
        }
        Err(refused) => respond(query.dir.as_deref().unwrap_or(""), Err(refused)),
    }
}

/// `{*path}` decoded, with its `/` (just `/` without one); `None` if it doesn't decode.
fn wire_path(path: WirePath) -> Option<String> {
    let path = path.ok()?.map_or_else(String::new, |Path(path)| path);
    // `~` and `~/…` ride bare: `fs::open` expands them to the daemon user's home.
    Some(if path.starts_with('~') {
        path
    } else {
        format!("/{path}")
    })
}

/// The response, or the refusal in the JSON error shape, logged by fs.md's rules.
/// `asked` is the path the client sent, if any.
fn respond(asked: &str, result: Result<Response, FsError>) -> Response {
    let refused = match result {
        Ok(response) => return response,
        Err(refused) => refused,
    };
    let code = HttpError::from(&refused);
    match &refused {
        FsError::Denied => {
            warn!(path = asked, %code, "refused a file request");
        }
        FsError::ConfigUnavailable(cause) => {
            error!(%cause, "can't read config.toml: every file request fails");
        }
        FsError::Internal(cause) => error!(%cause, path = asked, "a file request failed"),
        _ => debug!(path = asked, %code, "refused a file request"),
    }
    Refusal::from(refused).into_response()
}
