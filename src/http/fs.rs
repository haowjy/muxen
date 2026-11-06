//! The `/fs/*` routes (fs.md "Routes"): thin handlers that parse the request, take
//! slots, call into `crate::fs` and build responses. They sit in the `devices` router,
//! behind both auth layers. A path rides in the URL path, percent-encoded per segment;
//! the daemon decodes it and prepends `/`, unless it starts with `~`.

use std::path::Path as FilePath;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use axum::body::Body;
use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse as _, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Deserializer, de};
use tracing::{debug, error, info, warn};

use super::{Ctx, Refusal};
use crate::files::Stamp;
use crate::fs::entry;
use crate::fs::list::{self, Filter};
use crate::fs::raw::{self, Span};
use crate::fs::search::{self, Pattern, Skip};
use crate::fs::upload::{self, MAX_UPLOAD, Naming};
use crate::fs::{FsError, Want, mime};
use crate::proto::HttpError;
use crate::proto::fs::{CreateRequest, DeleteRequest, RenameRequest};

/// `{*path}`, or nothing on a route without one; a rejection if it doesn't decode.
type WirePath = Result<Option<Path<String>>, PathRejection>;

pub(super) fn routes() -> Router<Arc<Ctx>> {
    Router::new()
        // `{*path}` doesn't match an empty path: `/` is its own route.
        .route("/fs/list/", get(listing))
        .route("/fs/list/{*path}", get(listing))
        .route("/fs/search/", get(searched))
        .route("/fs/search/{*path}", get(searched))
        .route("/fs/raw/{*path}", get(raw))
        // The handler checks the cap itself, up front and as the body arrives.
        .route(
            "/fs/upload",
            post(upload).layer(DefaultBodyLimit::disable()),
        )
        .merge(
            Router::new()
                .route("/fs/create", post(created))
                .route("/fs/rename", post(renamed))
                .route("/fs/delete", post(deleted))
                .layer(DefaultBodyLimit::max(ENTRY_BODY)),
        )
}

/// A folder's path and a name or two, in JSON.
const ENTRY_BODY: usize = 16 * 1024;

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    offset: u32,
    /// `0` or `1`.
    #[serde(default, deserialize_with = "flag")]
    hidden: bool,
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: String,
    /// `0` or `1`.
    #[serde(default, deserialize_with = "flag")]
    hidden: bool,
}

#[derive(Debug, Deserialize)]
struct UploadQuery {
    /// The client's file name: only its extension is used.
    #[serde(default)]
    name: String,
    /// The folder to upload into (`~`, `~/…` or absolute); absent: `uploads_dir`.
    dir: Option<String>,
    /// `1`: the body is pasted text, named `pasted-<time>.txt`; `name` is ignored.
    #[serde(default, deserialize_with = "flag")]
    text: bool,
}

/// A query flag: `0` or `1`; any other value is a rejected query.
fn flag<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    match u8::deserialize(deserializer)? {
        0 => Ok(false),
        1 => Ok(true),
        other => Err(de::Error::custom(format!("{other} is not 0 or 1"))),
    }
}

/// A page of any directory, holding the scan slot.
async fn listing(
    State(ctx): State<Arc<Ctx>>,
    path: WirePath,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Result<Response, Refusal> {
    let (path, Query(query)) = (wire_path(path)?, query?);
    let filter = Filter {
        hidden: query.hidden,
    };
    let (asked, app) = (path.clone(), ctx.clone());
    let listed = ctx
        .fs
        .scan
        .run(move || {
            let dir = crate::fs::open(&asked, &app.app.home, Want::Dir)?;
            list::list(&dir, filter, query.offset).map_err(FsError::io)
        })
        .await;
    debug!(%path, offset = query.offset, ok = listed.is_ok(), "listed");
    Ok(Json(listed.map_err(refuse(&path))?).into_response())
}

/// The best matches below a folder, holding the search slot until the walk ends.
async fn searched(
    State(ctx): State<Arc<Ctx>>,
    path: WirePath,
    query: Result<Query<SearchQuery>, QueryRejection>,
) -> Result<Response, Refusal> {
    let (path, Query(query)) = (wire_path(path)?, query?);
    let pattern = Pattern::parse(&query.q).ok_or_else(|| refuse(&path)(FsError::BadRequest))?;
    let filter = Filter {
        hidden: query.hidden,
    };
    // Dropped with this future when the client aborts: the walk stops at its next check.
    let cancel = Cancel(Arc::new(AtomicBool::new(false)));
    let (asked, app, stop) = (path.clone(), ctx.clone(), cancel.0.clone());
    let skip = Skip::new(&ctx.app.config.keys().search_skip());
    let found = ctx
        .fs
        .search
        .run(move || {
            let root = crate::fs::open(&asked, &app.app.home, Want::Dir)?;
            search::search(&root, &pattern, filter, &skip, &search::CAPS, &stop)
                .map_err(FsError::io)
        })
        .await;
    if let Ok(found) = &found {
        debug!(root = %found.path, read = found.read, stopped = ?found.stopped, "searched");
    }
    Ok(Json(found.map_err(refuse(&path))?).into_response())
}

/// Sets its flag when dropped.
struct Cancel(Arc<AtomicBool>);

impl Drop for Cancel {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// A file's bytes, or one range of them, holding a raw-response slot until the body
/// is sent or aborted.
async fn raw(
    State(ctx): State<Arc<Ctx>>,
    path: WirePath,
    headers: HeaderMap,
) -> Result<Response, Refusal> {
    let path = wire_path(path)?;
    let sent = async {
        let slot = ctx.fs.raw.acquire().await?;
        let (asked, app) = (path.clone(), ctx.clone());
        let opened = ctx
            .fs
            .lane
            .try_run(move || crate::fs::open(&asked, &app.app.home, Want::File))
            .await?;
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
            // The native player fetches without the scheme handler, which adds this too.
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
    sent.map_err(refuse(&path))
}

/// `201 { path, size }`: the body, as is, into `dir` (default `uploads_dir`) under a name the daemon
/// picks. One upload at a time; a second is `busy` at once.
async fn upload(
    State(ctx): State<Arc<Ctx>>,
    query: Result<Query<UploadQuery>, QueryRejection>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, Refusal> {
    let Query(query) = query?;
    let refuse = refuse(query.dir.as_deref().unwrap_or(""));
    let declared = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if declared.is_some_and(|len| len > MAX_UPLOAD) {
        return Err(refuse(FsError::TooLarge));
    }
    let uploaded = async {
        let slot = ctx.fs.upload()?;
        let (app, dest) = (ctx.clone(), query.dir.clone());
        let dir = ctx
            .fs
            .lane
            .try_run(move || {
                let uploads_dir = app.app.config.keys().uploads_dir().to_owned();
                upload::open_dir(&uploads_dir, &app.app.home, dest.as_deref())
            })
            .await?;
        let naming = if query.text {
            Naming::PastedText
        } else {
            Naming::Upload(&query.name)
        };
        upload::receive(
            &ctx.fs.lane,
            slot,
            dir,
            &ctx.app.upload_record,
            naming,
            MAX_UPLOAD,
            body.into_data_stream(),
        )
        .await
    }
    .await
    .map_err(refuse)?;
    info!(path = %uploaded.path, size = uploaded.size, "uploaded a file");
    Ok((StatusCode::CREATED, Json(uploaded)).into_response())
}

/// `204`: an empty file or a new folder. It never replaces anything: a taken name is `exists`.
async fn created(
    State(ctx): State<Arc<Ctx>>,
    body: Result<Json<CreateRequest>, JsonRejection>,
) -> Result<StatusCode, Refusal> {
    let Json(request) = body?;
    let dir = request.dir.clone();
    let app = ctx.clone();
    ctx.fs
        .lane
        .try_run(move || entry::create(&request, &app.app.home))
        .await
        .map_err(refuse(&dir))?;
    Ok(StatusCode::NO_CONTENT)
}

/// `204`: renamed in its folder. It never replaces anything: a taken name is `exists`.
async fn renamed(
    State(ctx): State<Arc<Ctx>>,
    body: Result<Json<RenameRequest>, JsonRejection>,
) -> Result<StatusCode, Refusal> {
    let Json(request) = body?;
    let dir = request.dir.clone();
    let app = ctx.clone();
    ctx.fs
        .lane
        .try_run(move || entry::rename(&request, &app.app.home, &app.app.state_dir))
        .await
        .map_err(refuse(&dir))?;
    Ok(StatusCode::NO_CONTENT)
}

/// `204`: deleted for good, a folder with all it holds.
async fn deleted(
    State(ctx): State<Arc<Ctx>>,
    body: Result<Json<DeleteRequest>, JsonRejection>,
) -> Result<StatusCode, Refusal> {
    let Json(request) = body?;
    let dir = request.dir.clone();
    let app = ctx.clone();
    ctx.fs
        .delete
        .run(move || entry::delete(&request, &app.app.home, &app.app.state_dir))
        .await
        .map_err(refuse(&dir))?;
    Ok(StatusCode::NO_CONTENT)
}

/// `{*path}` decoded, with its `/` (just `/` without one); a rejection if it doesn't decode.
fn wire_path(path: WirePath) -> Result<String, Refusal> {
    let path = path?.map_or_else(String::new, |Path(path)| path);
    // `~` and `~/…` ride bare: `fs::open` expands them to the daemon user's home.
    Ok(if path.starts_with('~') {
        path
    } else {
        format!("/{path}")
    })
}

/// The refusal in the JSON error shape, logged by fs.md's rules. `asked` is the path the
/// client sent, if any.
fn refuse(asked: &str) -> impl FnOnce(FsError) -> Refusal + '_ {
    move |refused| {
        let code = HttpError::from(&refused);
        match &refused {
            FsError::Denied => warn!(path = asked, %code, "refused a file request"),
            FsError::Internal(cause) => error!(%cause, path = asked, "a file request failed"),
            _ => debug!(path = asked, %code, "refused a file request"),
        }
        Refusal::from(refused)
    }
}
