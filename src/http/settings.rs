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
use crate::config::{
    self, ConfigError, DEFAULT_SEARCH_SKIP, DEFAULT_UPLOADS_DIR, LiveConfig, SaveError,
};
use crate::proto::HttpError;
use crate::proto::settings::{Reloaded, ServerSettings, SettingsChange, SettingsDefaults};

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
    let read = async {
        let _permit = ctx.fs.settings().await?;
        let app = ctx.clone();
        Ok::<_, HttpError>(ctx.fs.lane.run(move || settings(&app.app.config)).await?)
    };
    match read.await {
        Ok(settings) => Json(settings).into_response(),
        Err(refused) => Refusal::from(refused).into_response(),
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
    let saved = async {
        let _permit = ctx.fs.settings().await.map_err(|_| SaveError::Busy)?;
        let app = ctx.clone();
        ctx.fs
            .lane
            .run(move || {
                let state_dir = app.app.auth.store().dir();
                config::save(&app.app.config, state_dir, &change)?;
                Ok(settings(&app.app.config))
            })
            .await
            .map_err(|_| SaveError::Busy)?
    };
    match saved.await {
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
    let reloaded = async {
        let _permit = ctx.fs.settings().await?;
        let app = ctx.clone();
        Ok::<_, HttpError>(
            ctx.fs
                .lane
                .run(move || {
                    let config = &app.app.config;
                    // `reload` logs a failure.
                    let restart_needed = config.reload()?;
                    Ok::<_, ConfigError>(Reloaded {
                        settings: settings(config),
                        restart_needed: restart_needed.into_iter().map(str::to_owned).collect(),
                    })
                })
                .await?,
        )
    };
    match reloaded.await {
        Ok(Ok(reloaded)) => Json(reloaded).into_response(),
        Ok(Err(error)) => Refusal::from(&error).into_response(),
        Err(refused) => Refusal::from(refused).into_response(),
    }
}

/// The running config's live keys, and whether the file has changed since. Blocks.
fn settings(config: &LiveConfig) -> ServerSettings {
    let keys = config.keys();
    ServerSettings {
        search_skip: keys.search_skip,
        uploads_dir: keys.uploads_dir,
        file_changed: config.file_changed(),
        defaults: SettingsDefaults {
            search_skip: DEFAULT_SEARCH_SKIP.map(str::to_owned).to_vec(),
            uploads_dir: DEFAULT_UPLOADS_DIR.to_owned(),
        },
    }
}
