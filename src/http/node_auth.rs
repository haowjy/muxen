//! Node-lane enrolment and removal. The router's node check has already resolved and
//! admitted the request node before these handlers touch `auth.toml`.

use std::sync::Arc;
use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Extension, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse as _, Response};
use serde::Serialize;
use tracing::{error, info, warn};

use super::{Ctx, Login, Refusal};
use crate::auth::store::EnrollError;
use crate::auth::{AuthError, Session};
use crate::proto::HttpError;
use crate::proto::auth::{EnrollRequest, EnrollResponse};

/// `session`'s answer, and an enrolment's: the name the node's device has.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Named {
    device_name: String,
}

pub(super) async fn session(Extension(session): Extension<Session>) -> Result<Response, Refusal> {
    let Session::Node { device, .. } = session else {
        return Err(HttpError::AuthRequired.into());
    };
    Ok(Json(Named {
        device_name: device.name,
    })
    .into_response())
}

pub(super) async fn enroll(
    State(ctx): State<Arc<Ctx>>,
    Extension(session): Extension<Session>,
    Extension(Login(login)): Extension<Login>,
    headers: HeaderMap,
    body: Result<Json<EnrollRequest>, JsonRejection>,
) -> Result<Response, Refusal> {
    let (node_id, name, enrolled) = match session {
        Session::Node { node, .. } => (node.id, node.name, true),
        Session::NodeUnenrolled { node, .. } => (node.id, node.name, false),
        Session::Native(_) => return Err(HttpError::BadRequest.into()),
    };
    let Json(request) = body?;
    let store = ctx.app.auth.store().clone();
    let requested_name = if request.device_name.trim().is_empty() {
        name.clone()
    } else {
        request.device_name
    };
    let not_enrolled = |node_name| Refusal::from(&AuthError::NotEnrolled { node_name });
    if request.code.is_empty() {
        if ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]
            .iter()
            .any(|header| headers.contains_key(*header))
        {
            warn!(by = %login, "refused a native token mint with browser fetch metadata");
            return Err(HttpError::BadOrigin.into());
        }
        if !enrolled {
            return Err(not_enrolled(name));
        }
        let by = login.clone();
        let minted = ctx
            .app
            .lanes
            .auth
            .run(move || {
                store.add_native_for_node(&requested_name, &node_id, &by, SystemTime::now())
            })
            .await?;
        return match minted {
            Ok(Some(added)) => {
                info!(device = %added.name, by = %login, "minted a native token for an enrolled node");
                Ok(Json(EnrollResponse {
                    token: added.token,
                    device_name: added.name,
                })
                .into_response())
            }
            Ok(None) => Err(not_enrolled(name)),
            Err(cause) => {
                error!(%cause, "can't mint a native token for a node");
                Err(HttpError::Internal.into())
            }
        };
    }
    let by = login.clone();
    let enrolled = ctx
        .app
        .lanes
        .auth
        .run(move || {
            store.enroll_node(
                &request.code,
                &requested_name,
                &node_id,
                &by,
                &by,
                SystemTime::now(),
            )
        })
        .await?;
    match enrolled {
        Ok(device_name) => {
            info!(device = %device_name, by = %login, "enrolled a node");
            Ok(Json(Named { device_name }).into_response())
        }
        Err(EnrollError::BadCode) => {
            warn!(by = %login, "refused a node enrolment code");
            Err(HttpError::BadCode.into())
        }
        Err(EnrollError::Store(cause)) => {
            error!(%cause, "can't enrol a node");
            Err(HttpError::Internal.into())
        }
    }
}

pub(super) async fn remove(
    State(ctx): State<Arc<Ctx>>,
    Extension(session): Extension<Session>,
) -> Result<StatusCode, Refusal> {
    let node_id = match session {
        Session::Node { node, .. } | Session::NodeUnenrolled { node, .. } => node.id,
        Session::Native(_) => return Err(HttpError::BadRequest.into()),
    };
    let store = ctx.app.auth.store().clone();
    match ctx
        .app
        .lanes
        .auth
        .run(move || store.remove_node(&node_id))
        .await?
    {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(cause) => {
            error!(%cause, "can't remove a node");
            Err(HttpError::Internal.into())
        }
    }
}
