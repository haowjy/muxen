//! `/settings` over a real socket (fs.md "Server settings"): the running values with the
//! daemon's defaults, a save that writes `config.toml` and applies at once, refusals that
//! write nothing, and a reload that reports what waits for a restart.

#[path = "support/daemon.rs"]
mod daemon;

use daemon::{Daemon, Reply, start};
use serde_json::{Value, json};

async fn request(daemon: &Daemon, method: &str, path: &str, body: &str) -> Reply {
    let headers = [("Content-Type", "application/json")];
    daemon.call(method, path, &headers, body.as_bytes()).await
}

fn json(reply: &Reply) -> Value {
    serde_json::from_slice(&reply.body).expect("JSON")
}

#[tokio::test]
async fn settings_save_at_once_and_a_reload_reports_what_waits() {
    let daemon = start("settings").await;
    let read = request(&daemon, "GET", "/settings", "").await;
    assert_eq!(read.status, 200, "{}", read.text());
    assert_eq!(
        json(&read),
        json!({
            "searchSkip": null,
            "uploadsDir": null,
            "fileChanged": false,
            "restartNeeded": [],
            "defaults": { "searchSkip": ["node_modules"], "uploadsDir": "~/.muxen-uploads" }
        })
    );

    let saved = request(
        &daemon,
        "POST",
        "/settings",
        r#"{"searchSkip":["dist","dist","*.egg-info"]}"#,
    )
    .await;
    assert_eq!(saved.status, 200, "{}", saved.text());
    assert_eq!(json(&saved)["searchSkip"], json!(["dist", "*.egg-info"]));
    assert_eq!(json(&saved)["uploadsDir"], Value::Null);
    let text = std::fs::read_to_string(&daemon.config).expect("written");
    assert_eq!(text, "search_skip = [\"dist\", \"*.egg-info\"]\n");

    // An unknown or mistyped field is JSON axum refuses: `bad_request` with its 422.
    for (body, status) in [
        (r#"{"searchSkip":["a/b"]}"#, 400),
        (r#"{"searchSkip":["*"]}"#, 400),
        (r#"{"uploadsDir":"relative"}"#, 400),
        (r#"{"favorites":[]}"#, 422),
        (r#"{"searchSkip":"dist"}"#, 422),
    ] {
        let refused = request(&daemon, "POST", "/settings", body).await;
        assert_eq!(refused.status, status, "{body}");
        assert_eq!(refused.text(), r#"{"error":"bad_request"}"#, "{body}");
    }
    assert_eq!(std::fs::read_to_string(&daemon.config).expect("read"), text);

    // A hand edit shows as changed until a reload, which reports a restart-only key.
    std::fs::write(
        &daemon.config,
        "search_skip = []\nmemory_budget_mib = 60\n[tmux]\nsocket_name = \"x\"\n",
    )
    .expect("edited");
    let read = request(&daemon, "GET", "/settings", "").await;
    assert_eq!(json(&read)["fileChanged"], json!(true));
    assert_eq!(json(&read)["searchSkip"], json!(["dist", "*.egg-info"]));
    let reloaded = request(&daemon, "POST", "/settings/reload", "").await;
    assert_eq!(reloaded.status, 200, "{}", reloaded.text());
    let reloaded = json(&reloaded);
    let restart = json!(["memory_budget_mib", "tmux.socket_name"]);
    assert_eq!(reloaded["restartNeeded"], restart);
    assert_eq!(reloaded["searchSkip"], json!([]));
    assert_eq!(reloaded["fileChanged"], json!(false));

    // A save that adopts a hand edit reports its restart-only keys too, as GET does after.
    std::fs::write(&daemon.config, "name = \"elsewhere\"\n").expect("edited");
    let saved = request(&daemon, "POST", "/settings", r#"{"searchSkip":["x"]}"#).await;
    assert_eq!(saved.status, 200, "{}", saved.text());
    assert_eq!(json(&saved)["restartNeeded"], json!(["name"]));
    let read = request(&daemon, "GET", "/settings", "").await;
    assert_eq!(json(&read)["restartNeeded"], json!(["name"]));

    // A file that doesn't parse is never written, and says where.
    std::fs::write(&daemon.config, "search_skip = [\"a\"\n").expect("broken");
    let refused = request(&daemon, "POST", "/settings", r#"{"uploadsDir":"~/up"}"#).await;
    assert_eq!(
        (refused.status, refused.text()),
        (
            503,
            r#"{"error":"config_unavailable","detail":"line 1, column 19"}"#
        )
    );
    assert_eq!(
        std::fs::read_to_string(&daemon.config).expect("read"),
        "search_skip = [\"a\"\n"
    );
}
