//! `/settings` (fs.md "Server settings"): the running config's live keys, a save that
//! writes `config.toml` and applies at once, and a reload. Each runs on the fs lane under
//! the settings permit; the work is in `crate::config`.

use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::extract::{DefaultBodyLimit, State};
use axum::response::{IntoResponse as _, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use tracing::{error, warn};

use super::{Ctx, Refusal};
use crate::blocking::Busy;
use crate::config::{
    self, DEFAULT_SEARCH_SKIP, DEFAULT_UPLOADS_DIR, LiveConfig, SaveError,
};
use crate::proto::settings::{ServerSettings, SettingsChange, SettingsDefaults};

/// 64 patterns of 255 bytes, escaped, and an `uploadsDir`.
const BODY: usize = 64 * 1024;

pub(super) fn routes() -> Router<Arc<Ctx>> {
    Router::new()
        .route(
            "/settings",
            get(read).post(save).layer(DefaultBodyLimit::max(BODY)),
        )
        .route("/settings/reload", post(reload))
}

async fn read(State(ctx): State<Arc<Ctx>>) -> Response {
    let app = ctx.clone();
    match ctx
        .fs
        .settings
        .run(move || Ok::<_, Busy>(settings(&app.app.config)))
        .await
    {
        Ok(settings) => Json(settings).into_response(),
        Err(busy) => Refusal::from(busy).into_response(),
    }
}

async fn save(
    State(ctx): State<Arc<Ctx>>,
    body: Result<Json<SettingsChange>, JsonRejection>,
) -> Response {
    let change = match body.map(|Json(change)| config::validated(change)) {
        Ok(Ok(change)) => change,
        Ok(Err(refused)) => return Refusal::from(&refused).into_response(),
        Err(rejection) => return Refusal::from(rejection).into_response(),
    };
    let app = ctx.clone();
    let saved = ctx
        .fs
        .settings
        .run(move || {
            app.app.config.save(&change)?;
            Ok(settings(&app.app.config))
        })
        .await;
    match saved {
        Ok(settings) => Json(settings).into_response(),
        Err(refused) => {
            match &refused {
                SaveError::ReadOnly(cause) => warn!(%cause, "config.toml can't be written"),
                SaveError::Unavailable(cause) => warn!(%cause, "config.toml not written"),
                SaveError::Internal(cause) => error!(%cause, "config.toml not written"),
                SaveError::BadRequest | SaveError::Busy => {}
            }
            Refusal::from(&refused).into_response()
        }
    }
}

async fn reload(State(ctx): State<Arc<Ctx>>) -> Response {
    let app = ctx.clone();
    let reloaded = ctx
        .fs
        .settings
        .run(move || {
            let config = &app.app.config;
            // `reload` logs a failure.
            config.reload().map_err(|error| Refusal::from(&error))?;
            Ok::<_, Refusal>(settings(config))
        })
        .await;
    match reloaded {
        Ok(reloaded) => Json(reloaded).into_response(),
        Err(refused) => refused.into_response(),
    }
}

/// The running config's live keys, and whether the file has changed since. Blocks.
fn settings(config: &LiveConfig) -> ServerSettings {
    let keys = config.keys();
    ServerSettings {
        search_skip: keys.search_skip,
        uploads_dir: keys.uploads_dir,
        file_changed: config.file_changed(),
        restart_needed: config
            .restart_needed()
            .into_iter()
            .map(str::to_owned)
            .collect(),
        defaults: SettingsDefaults {
            search_skip: DEFAULT_SEARCH_SKIP.map(str::to_owned).to_vec(),
            uploads_dir: DEFAULT_UPLOADS_DIR.to_owned(),
        },
    }
}
