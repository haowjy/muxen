import Foundation

/// Files' Download (ios-shell.md "Files and sharing"): one `/fs/raw` fetch at a time, streamed by
/// `URLSessionDownloadTask` into a file under `tmp/Downloads/`, never into memory.
final class Downloader: NSObject, URLSessionDownloadDelegate {
    /// The daemon's raw stall deadline (fs.md "Constants"): a request that waits longer between bytes fails.
    private static let stallTimeout: TimeInterval = 30
    /// A refusal body larger than this is not the daemon's `{"error": code}`, so it isn't read.
    private static let maxErrorBody = 4096

    static let folder = FileManager.default.temporaryDirectory.appending(path: "Downloads", directoryHint: .isDirectory)

    private final class Job {
        let task: URLSessionDownloadTask
        let name: String
        let token: String
        let rejectedToken: (String) -> Void
        let progress: (Int64, Int64?) -> Void
        let completion: (Result<URL, Error>) -> Void
        var saved: Result<URL, Error>?

        init(task: URLSessionDownloadTask, name: String, token: String, rejectedToken: @escaping (String) -> Void, progress: @escaping (Int64, Int64?) -> Void, completion: @escaping (Result<URL, Error>) -> Void) {
            self.task = task
            self.name = name
            self.token = token
            self.rejectedToken = rejectedToken
            self.progress = progress
            self.completion = completion
        }
    }

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = Self.stallTimeout
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()
    private var job: Job?

    var isBusy: Bool { job != nil }

    /// Starts `request` (a host's `/fs/raw/…`, carrying `token`), saving the file as `name`. `progress` gets the bytes so
    /// far and the size when the server sent one; `completion` gets the saved file, which the caller deletes with
    /// `discard()`. Returns false while another runs.
    func download(_ request: URLRequest, name: String, token: String, rejectedToken: @escaping (String) -> Void, progress: @escaping (Int64, Int64?) -> Void, completion: @escaping (Result<URL, Error>) -> Void) -> Bool {
        guard job == nil else { return false }
        Self.discard()
        let task = session.downloadTask(with: request)
        job = Job(task: task, name: name, token: token, rejectedToken: rejectedToken, progress: progress, completion: completion)
        task.resume()
        return true
    }

    /// Ends the running fetch; its completion reports `DownloadFailure.cancelled`.
    func cancel() { job?.task.cancel() }

    /// Empties `tmp/Downloads/`, and deletes the partial file URLSession keeps in `tmp/` after a failure (for a resume
    /// muxen never makes): after the share sheet closes, after a failure, and before each download, so a crash's file goes
    /// too. Only this class makes download tasks, and it calls this only while none runs.
    static func discard() {
        let files = FileManager.default
        try? files.removeItem(at: folder)
        let partials = (try? files.contentsOfDirectory(at: files.temporaryDirectory, includingPropertiesForKeys: nil)) ?? []
        for partial in partials where partial.lastPathComponent.hasPrefix("CFNetworkDownload_") { try? files.removeItem(at: partial) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(HostRequest.redirect(task, to: request, within: "/fs/raw/"))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let job, job.task === downloadTask else { return }
        job.progress(totalBytesWritten, totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : nil)
    }

    /// The file at `location` is gone when this returns, so it is moved (or its refusal read) here.
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let job, job.task === downloadTask else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            if status == 401 { job.rejectedToken(job.token) }
            job.saved = .failure(DownloadFailure.server(status, code: Self.refusalCode(at: location)))
            return
        }
        do {
            let file = Self.folder.appending(path: Self.fileName(job.name), directoryHint: .notDirectory)
            try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: location, to: file)
            job.saved = .success(file)
        } catch {
            job.saved = .failure(DownloadFailure.notSaved)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let job, job.task === task else { return }
        self.job = nil
        if let error {
            Self.discard()
            job.completion(.failure(DownloadFailure(error)))
        } else {
            if case .failure = job.saved { Self.discard() }
            job.completion(job.saved ?? .failure(DownloadFailure.notSaved))
        }
    }

    private static func refusalCode(at location: URL) -> String? {
        guard let size = try? location.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= maxErrorBody,
              let data = try? Data(contentsOf: location) else { return nil }
        return (try? JSONDecoder().decode(DaemonRefusal.self, from: data))?.error
    }

    /// One path component: the share sheet's name for the file, and never a way out of the folder.
    private static func fileName(_ name: String) -> String {
        let flat = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "\0", with: "")
        return flat.isEmpty || flat == "." || flat == ".." ? "download" : flat
    }
}

/// The daemon's refusal body, `{"error": code}` (fs.md "Errors").
private struct DaemonRefusal: Decodable { let error: String }

enum DownloadFailure: LocalizedError {
    case cancelled
    case stalled
    case offline
    case notSaved
    /// The HTTP status and the daemon's error code, if the body had one. The page words the code.
    case server(Int, code: String?)

    init(_ error: Error) {
        switch (error as? URLError)?.code {
        case .cancelled?: self = .cancelled
        case .timedOut?: self = .stalled
        default: self = .offline
        }
    }

    /// The daemon's code, or `http_<status>` when the body had none, as the browser names it: the page words either.
    var code: String? {
        if case .server(let status, let code) = self { code ?? "http_\(status)" } else { nil }
    }

    var errorDescription: String? {
        switch self {
        case .cancelled: "The download was cancelled."
        case .stalled: "Nothing arrived for 30 seconds, so the download stopped."
        case .offline: "The connection to the server was lost."
        case .notSaved: "This iPhone couldn't store it."
        case .server(let status, _): "The server answered HTTP \(status)."
        }
    }
}
