//! The file routes over a real socket (fs.md "Routes", "Errors"): ranges and their
//! headers as the native player sees them, uploads one at a time with their part file
//! cleaned up, Settings writes that keep a hand-written `config.toml`, and a broken
//! config failing the config routes closed.

use std::time::Duration;

use tokio::io::AsyncWriteExt as _;
use tokio::net::TcpStream;

#[path = "support/daemon.rs"]
mod daemon;

use daemon::{Daemon, Reply, send, start, url};

async fn get(daemon: &Daemon, path: &str, extra: &[(&str, &str)]) -> Reply {
    let device = daemon.device();
    let mut headers: Vec<(&str, &str)> = device
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    headers.extend_from_slice(extra);
    send(daemon.port, "GET", path, &headers, b"").await
}

async fn post(daemon: &Daemon, path: &str, body: &[u8], json: bool) -> Reply {
    let device = daemon.device();
    let mut headers: Vec<(&str, &str)> = device
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    if json {
        headers.push(("Content-Type", "application/json"));
    }
    send(daemon.port, "POST", path, &headers, body).await
}

#[tokio::test]
async fn a_video_streams_by_range_with_a_stable_etag() {
    let daemon = start("fs-raw").await;
    std::fs::create_dir_all(daemon.home("videos")).expect("a dir");
    let clip = daemon.home("videos/clip one.MOV");
    let bytes: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(&clip, &bytes).expect("written");
    let raw = url("/fs/raw/", &clip);

    // AVFoundation's probe.
    let probe = get(&daemon, &raw, &[("Range", "bytes=0-1")]).await;
    assert_eq!(probe.status, 206);
    assert_eq!(probe.body, &bytes[..2]);
    assert_eq!(probe.header("content-range"), Some("bytes 0-1/300000"));
    assert_eq!(probe.header("content-length"), Some("2"));
    assert_eq!(probe.header("content-type"), Some("video/quicktime"));
    assert_eq!(probe.header("accept-ranges"), Some("bytes"));
    assert_eq!(probe.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(probe.header("content-security-policy"), Some("sandbox"));
    assert_eq!(probe.header("cache-control"), Some("no-store"));
    assert_eq!(
        probe.header("cross-origin-resource-policy"),
        Some("same-origin")
    );
    let etag = probe.header("etag").expect("an ETag").to_owned();

    // A range across chunk boundaries, with a matching If-Range.
    let middle = get(
        &daemon,
        &raw,
        &[("Range", "bytes=60000-200000"), ("If-Range", &etag)],
    )
    .await;
    assert_eq!(middle.status, 206);
    assert_eq!(middle.body, &bytes[60_000..=200_000]);
    assert_eq!(middle.header("etag"), Some(etag.as_str()));
    let whole = get(&daemon, &raw, &[]).await;
    assert_eq!((whole.status, whole.body == bytes), (200, true));

    let past = get(&daemon, &raw, &[("Range", "bytes=300000-")]).await;
    assert_eq!(
        (past.status, past.text()),
        (416, r#"{"error":"bad_range"}"#)
    );
    assert_eq!(past.header("content-range"), Some("bytes */300000"));

    // The file changes: a new ETag, and an If-Range on the old one gets the whole file.
    std::fs::write(&clip, &bytes[..1000]).expect("rewritten");
    let stale = get(
        &daemon,
        &raw,
        &[("Range", "bytes=0-1"), ("If-Range", &etag)],
    )
    .await;
    assert_eq!((stale.status, stale.body.len()), (200, 1000));
    assert_ne!(stale.header("etag"), Some(etag.as_str()));

    // Paths that don't decode are refused in the JSON shape.
    let undecodable = get(&daemon, "/fs/raw/tmp/%FF", &[]).await;
    assert_eq!(
        (undecodable.status, undecodable.text()),
        (400, r#"{"error":"bad_request"}"#)
    );
    let nul = get(&daemon, "/fs/raw/tmp/a%00b", &[]).await;
    assert_eq!(nul.status, 400);

    // A file outside `$HOME` is as readable as any other.
    let outside = get(&daemon, &url("/fs/raw/", &daemon.config), &[]).await;
    assert_eq!(outside.status, 200, "{}", outside.text());
}

#[tokio::test]
async fn uploads_land_one_at_a_time_and_leave_no_part_file() {
    let daemon = start("fs-upload").await;
    let jpeg = b"\xff\xd8\xff\xe0 not really a JPEG";
    let uploaded = post(&daemon, "/fs/upload?name=IMG_0001.JPEG", jpeg, false).await;
    assert_eq!(uploaded.status, 201, "{}", uploaded.text());
    let body = uploaded.json();
    let path = body["path"].as_str().expect("a path");
    assert_eq!(body["size"], jpeg.len());
    let uploads = daemon.home("muxen-uploads");
    assert!(
        path.starts_with(uploads.to_str().expect("UTF-8")) && path.ends_with(".jpeg"),
        "{path}"
    );
    assert_eq!(std::fs::read(path).expect("the upload"), jpeg);

    // Over the cap by Content-Length: refused before the body.
    let device = daemon.device();
    let auth: Vec<String> = device
        .iter()
        .map(|(k, v)| format!("{k}: {v}\r\n"))
        .collect();
    let too_large = format!(
        "POST /fs/upload?name=a.mov HTTP/1.1\r\nHost: x\r\n{}Content-Length: {}\r\n\r\n",
        auth.concat(),
        128 * 1024 * 1024 + 1
    );
    let reply = raw_exchange(daemon.port, too_large.as_bytes()).await;
    assert!(reply.starts_with("HTTP/1.1 413"), "{reply}");
    assert!(reply.contains(r#"{"error":"too_large"}"#), "{reply}");

    // One upload at a time: a second gets busy at once.
    let mut first = TcpStream::connect(("127.0.0.1", daemon.port))
        .await
        .expect("connected");
    let head = format!(
        "POST /fs/upload?name=b.png HTTP/1.1\r\nHost: x\r\n{}Content-Length: 1000\r\n\r\n",
        auth.concat()
    );
    first.write_all(head.as_bytes()).await.expect("sent");
    first.write_all(&[0; 10]).await.expect("sent");
    let part = || {
        std::fs::read_dir(&uploads)
            .expect("the uploads folder")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().ends_with(".part"))
    };
    wait_for(part).await;
    let second = post(&daemon, "/fs/upload?name=c.png", b"x", false).await;
    assert_eq!((second.status, second.text()), (503, r#"{"error":"busy"}"#));
    assert_eq!(second.header("retry-after"), Some("1"));
    // The client goes away mid-body: its part file goes too, and the slot frees.
    drop(first);
    wait_for(|| !part()).await;
    let third = post(&daemon, "/fs/upload?name=c.png", b"x", false).await;
    assert_eq!(third.status, 201, "{}", third.text());
    assert_eq!(std::fs::read_dir(&uploads).expect("the folder").count(), 2);
}

#[tokio::test]
async fn a_broken_config_fails_uploads_closed() {
    let daemon = start("fs-broken").await;
    std::fs::create_dir_all(daemon.home("code")).expect("a dir");
    std::fs::write(&daemon.config, "uploads_dir = \"~/up\n").expect("written");
    let code = url("/fs/list/", &daemon.home("code"));
    // Listing and reading don't consult the config.
    assert_eq!(get(&daemon, &code, &[]).await.status, 200);
    let upload = post(&daemon, "/fs/upload?name=a.png", b"x", false).await;
    assert_eq!(
        (upload.status, upload.text()),
        (503, r#"{"error":"config_unavailable"}"#)
    );
    // A fixed file applies to the next request.
    std::fs::write(&daemon.config, "uploads_dir = \"~/up\"\n").expect("fixed");
    let upload = post(&daemon, "/fs/upload?name=a.png", b"x", false).await;
    assert_eq!(upload.status, 201, "{}", upload.text());
}

/// Writes `request` and reads until the server closes or a second passes.
async fn raw_exchange(port: u16, request: &[u8]) -> String {
    use tokio::io::AsyncReadExt as _;
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("connected");
    stream.write_all(request).await.expect("sent");
    let mut reply = vec![0; 4096];
    let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut reply))
        .await
        .expect("an answer in time")
        .expect("read");
    String::from_utf8_lossy(&reply[..n]).into_owned()
}

async fn wait_for(condition: impl Fn() -> bool) {
    let waited = tokio::time::timeout(Duration::from_secs(5), async {
        while !condition() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    });
    waited.await.expect("in time");
}
