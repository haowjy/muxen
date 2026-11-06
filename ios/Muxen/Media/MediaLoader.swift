import AVKit
import Foundation
import UniformTypeIdentifiers

/// Feeds the video player one `/fs/raw` file without AVFoundation ever holding the token (ios-shell.md "Video").
/// The asset's URL is `muxen-media://file{path}`; AVFoundation asks this delegate for the bytes, and each fetch is
/// built here by `MuxenAppModel.request`. A media file can name other URLs (a reference movie, a playlist); the asset
/// is made with all references forbidden, and this refuses any URL but the one file as well.
@MainActor
final class MediaLoader: NSObject, @preconcurrency AVAssetResourceLoaderDelegate, @preconcurrency URLSessionDataDelegate {
    private static let scheme = "muxen-media"
    /// The most one fetch asks for. AVFoundation's main read is "everything to the end", and it cancels once it has
    /// enough (checked on iOS 26.5): unbounded, the fetch pulls the rest of the file in the meantime.
    private static let window: Int64 = 1 << 20

    private struct Job {
        let request: AVAssetResourceLoadingRequest
        let token: String
        let task: URLSessionDataTask
    }

    private let model: MuxenAppModel
    private let hostID: String
    private let path: String
    private var jobs: [Int: Job] = [:]
    /// Nil once `stop()` has invalidated it: a session can't make tasks after that.
    private var session: URLSession?

    /// `path` is the percent-encoded `/fs/raw/…` path of the file to play.
    init(model: MuxenAppModel, host hostID: String, path: String) {
        self.model = model
        self.hostID = hostID
        self.path = path
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }

    /// The asset for the file. The loader isn't retained by it: the player screen keeps the loader, and `stop()`s it.
    func asset() -> AVURLAsset {
        var components = URLComponents()
        components.scheme = Self.scheme
        components.host = "file"
        components.percentEncodedPath = path
        // The raw value as an NSNumber: the Swift option set crashes AVFoundation's options parsing.
        let asset = AVURLAsset(url: components.url!, options: [
            AVURLAssetReferenceRestrictionsKey: NSNumber(value: AVAssetReferenceRestrictions.forbidAll.rawValue),
        ])
        asset.resourceLoader.setDelegate(self, queue: .main)
        return asset
    }

    /// Ends every fetch and the session: the player screen calls it as it goes.
    func stop() {
        jobs.removeAll()
        session?.invalidateAndCancel()
        session = nil
    }

    func resourceLoader(_ loader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource loading: AVAssetResourceLoadingRequest) -> Bool {
        guard let session, let url = loading.request.url, url.scheme == Self.scheme, url.host == "file",
              URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath == path else { return false }
        guard case .ready(var request, let token) = model.request(on: hostID, path: path) else { return false }
        var from: Int64 = 0, length: Int64 = 2  // content information alone: the daemon's answer carries the size
        if let data = loading.dataRequest {
            from = data.requestedOffset
            length = min(Self.window, Int64(data.requestedLength))
        }
        request.setValue("bytes=\(from)-\(from + length - 1)", forHTTPHeaderField: "Range")
        let task = session.dataTask(with: request)
        jobs[task.taskIdentifier] = Job(request: loading, token: token, task: task)
        task.resume()
        return true
    }

    func resourceLoader(_ loader: AVAssetResourceLoader, didCancel loading: AVAssetResourceLoadingRequest) {
        guard let id = jobs.first(where: { $0.value.request === loading })?.key, let job = jobs.removeValue(forKey: id) else { return }
        job.task.cancel()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let job = jobs[dataTask.taskIdentifier], let http = response as? HTTPURLResponse else { completionHandler(.cancel); return }
        // Every fetch is a range, and the daemon answers a range with 206 or 416, never the whole file.
        guard http.statusCode == 206,
              let total = http.value(forHTTPHeaderField: "Content-Range")?.split(separator: "/").last.flatMap({ Int64($0) }) else {
            if http.statusCode == 401 { model.rejectedToken(for: hostID, token: job.token) }
            completionHandler(.cancel)
            finish(dataTask, with: URLError(.badServerResponse))
            return
        }
        if let info = job.request.contentInformationRequest {
            info.isByteRangeAccessSupported = true
            info.contentType = http.mimeType.flatMap { UTType(mimeType: $0)?.identifier }
            info.contentLength = total
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        jobs[dataTask.taskIdentifier]?.request.dataRequest?.respond(with: data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(task, with: error)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(HostRequest.redirect(task, to: request, within: path))
    }

    /// Ends the loading request of `task` once: with `error`, or complete. A rejected response ends it here with its
    /// own error, and the cancelled task's completion then finds nothing.
    private func finish(_ task: URLSessionTask, with error: Error?) {
        guard let job = jobs.removeValue(forKey: task.taskIdentifier) else { return }
        if let error { job.request.finishLoading(with: error) } else { job.request.finishLoading() }
    }
}

/// The player screen. It owns the loader that feeds it, and ends the fetches when it goes however it went (Done, a
/// swipe down, a lock).
final class MediaPlayerViewController: AVPlayerViewController {
    private let loader: MediaLoader

    init(loader: MediaLoader) {
        self.loader = loader
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Called once the screen is up: a refused one fetches nothing.
    func play() {
        player = AVPlayer(playerItem: AVPlayerItem(asset: loader.asset()))
        player?.play()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard isBeingDismissed else { return }
        player?.pause()
        loader.stop()
    }
}
