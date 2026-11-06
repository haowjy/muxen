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
    /// The most one fetch asks for when AVFoundation wants "everything to the end": it cancels once it has enough, but
    /// this app can't tell how soon, and an unbounded fetch pulls the rest of the file over the phone's connection.
    private static let window: Int64 = 1 << 20

    private struct Job {
        let request: AVAssetResourceLoadingRequest
        let token: String
        let from: Int64
        let wanted: Int64
        var received: Int64 = 0
    }

    private let model: MuxenAppModel
    private let hostID: String
    private let path: String
    private var jobs: [Int: Job] = [:]
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()

    /// `path` is the percent-encoded `/fs/raw/…` path of the file to play.
    init(model: MuxenAppModel, host hostID: String, path: String) {
        self.model = model
        self.hostID = hostID
        self.path = path
    }

    /// The asset for the file. The loader isn't retained by it: the caller keeps the loader, and `stop()`s it.
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

    /// Ends every fetch and the session: a dismissed player and a lock both end here.
    func stop() {
        jobs.removeAll()
        session.invalidateAndCancel()
    }

    func resourceLoader(_ loader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource loading: AVAssetResourceLoadingRequest) -> Bool {
        guard let url = loading.request.url, url.scheme == Self.scheme, url.host == "file",
              URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath == path else { return false }
        guard case .ready(var request, let token) = model.request(on: hostID, path: path) else { return false }
        var from: Int64 = 0, wanted: Int64 = 2  // content information alone: the daemon's answer carries the size
        if let data = loading.dataRequest {
            from = data.requestedOffset
            wanted = data.requestsAllDataToEndOfResource ? Self.window : Int64(data.requestedLength)
        }
        request.setValue("bytes=\(from)-\(from + wanted - 1)", forHTTPHeaderField: "Range")
        let task = session.dataTask(with: request)
        jobs[task.taskIdentifier] = Job(request: loading, token: token, from: from, wanted: wanted)
        task.resume()
        return true
    }

    func resourceLoader(_ loader: AVAssetResourceLoader, didCancel loading: AVAssetResourceLoadingRequest) {
        guard let id = jobs.first(where: { $0.value.request === loading })?.key else { return }
        jobs[id] = nil
        session.getAllTasks { tasks in tasks.first { $0.taskIdentifier == id }?.cancel() }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let job = jobs[dataTask.taskIdentifier], let http = response as? HTTPURLResponse else { completionHandler(.cancel); return }
        // A range answered in full would put the wrong bytes at `from`.
        guard http.statusCode == 206 || (http.statusCode == 200 && job.from == 0) else {
            if http.statusCode == 401 { model.rejectedToken(for: hostID, token: job.token) }
            completionHandler(.cancel)
            finish(dataTask, with: URLError(.badServerResponse))
            return
        }
        if let info = job.request.contentInformationRequest {
            let total = http.value(forHTTPHeaderField: "Content-Range")?.split(separator: "/").last.flatMap { Int64($0) }
            info.isByteRangeAccessSupported = http.statusCode == 206
            info.contentType = http.mimeType.flatMap { UTType(mimeType: $0)?.identifier }
            info.contentLength = total ?? http.expectedContentLength
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard var job = jobs[dataTask.taskIdentifier] else { return }
        // A 200 for a range sends the whole file: keep only what was asked for.
        let kept = data.prefix(Int(min(Int64(data.count), job.wanted - job.received)))
        job.request.dataRequest?.respond(with: kept)
        job.received += Int64(kept.count)
        jobs[dataTask.taskIdentifier] = job
        if job.received >= job.wanted {
            dataTask.cancel()
            finish(dataTask, with: nil)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(task, with: error)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(HostRequest.redirect(task, to: request, within: path))
    }

    /// Ends the loading request of `task` once: with `error`, or complete. A cancelled task's late completion finds
    /// nothing.
    private func finish(_ task: URLSessionTask, with error: Error?) {
        guard let job = jobs.removeValue(forKey: task.taskIdentifier) else { return }
        if let error { job.request.finishLoading(with: error) } else { job.request.finishLoading() }
    }
}

/// The player screen, which tells `MediaController` when it has gone however it went (Done, a swipe down, a lock).
final class MediaPlayerViewController: AVPlayerViewController {
    var gone: () -> Void = {}

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed { gone() }
    }
}
