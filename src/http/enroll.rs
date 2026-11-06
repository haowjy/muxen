//! The two routes that skip the device check (auth.md "Enrolment"): `GET /auth/info`
//! and `POST /auth/enroll`. Both sit behind the Tailscale check.

use std::sync::Arc;
use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Extension, State};
use axum::http::header;
use axum::response::{IntoResponse as _, Response};
use tracing::{error, info, warn};

use super::{Ctx, Login, Refusal};
use crate::auth::store::EnrollError;
use crate::proto::auth::{AuthInfo, EnrollRequest, EnrollResponse, ProtocolRange};
use crate::proto::{HttpError, MIN_PROTOCOL, PROTOCOL_VERSION};

pub(super) async fn info(State(ctx): State<Arc<Ctx>>) -> Response {
    let (origin, browser_pending) = match ctx.app.auth.browser_origin().await {
        Ok(origin) => origin,
        Err(_) => return Refusal::from(HttpError::IdentityUnavailable).into_response(),
    };
    let (browser_origin, browser_refused) = match origin {
        Ok(origin) => (Some(origin.origin), None),
        Err(refusal) => (None, Some(refusal)),
    };
    let name = if ctx.app.host.name == "muxen" {
        ctx.app.auth.machine_name("muxen").await
    } else {
        ctx.app.host.name.clone()
    };
    Json(AuthInfo {
        host_id: ctx.app.host.id.clone(),
        name,
        daemon_version: env!("CARGO_PKG_VERSION").to_owned(),
        protocol: ProtocolRange {
            min: MIN_PROTOCOL,
            max: PROTOCOL_VERSION,
        },
        browser_origin,
        browser_refused,
        browser_pending,
    })
    .into_response()
}

/// Checks the code under the state file's lock, on the auth lane. `Json` refuses any
/// body that isn't `application/json`, so a page can't post one without a CORS
/// preflight, which the daemon never answers.
pub(super) async fn enroll(
    State(ctx): State<Arc<Ctx>>,
    Extension(Login(login)): Extension<Login>,
    headers: axum::http::HeaderMap,
    body: Result<Json<EnrollRequest>, JsonRejection>,
) -> Result<Response, Refusal> {
    if headers.contains_key(header::ORIGIN) || headers.contains_key("sec-fetch-site") {
        return Err(HttpError::BadOrigin.into());
    }
    let Json(request) = body?;
    let store = ctx.app.auth.store().clone();
    let by = login.clone();
    let enrolled = ctx
        .app
        .lanes
        .auth
        .run(move || store.enroll(&request.code, &request.device_name, &by, SystemTime::now()))
        .await
        .map_err(|busy| {
            warn!("no auth thread for an enrolment in time");
            Refusal::from(busy)
        })?;
    match enrolled {
        Ok(added) => {
            info!(device = %added.name, by = %login, "enrolled a device");
            Ok(Json(EnrollResponse {
                token: added.token,
                device_name: added.name,
            })
            .into_response())
        }
        Err(EnrollError::BadCode) => {
            warn!(by = %login, "refused an enrolment code");
            Err(HttpError::BadCode.into())
        }
        Err(EnrollError::Store(cause)) => {
            error!(%cause, "can't enrol a device");
            Err(HttpError::Internal.into())
        }
    }
}
