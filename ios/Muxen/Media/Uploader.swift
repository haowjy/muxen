import Foundation

/// A folder to upload into instead of `uploads_dir`. `text`: the body is pasted text (fs.md "POST /fs/upload").
struct UploadDestination {
    let dir: String
    let text: Bool
}

final class Uploader: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private static let maxQueuedUploads = 4

    private final class Job {
        let id: String
        let request: URLRequest
        let data: Data
        let token: String
        let rejectedToken: (String) -> Void
        let progress: (Double) -> Void
        let completion: (Result<String, Error>) -> Void
        var responseData = Data()
        var statusCode: Int?
        var retry = 0
        /// Its request, while one is out.
        var task: URLSessionTask?

        init(id: String, request: URLRequest, data: Data, token: String, rejectedToken: @escaping (String) -> Void, progress: @escaping (Double) -> Void, completion: @escaping (Result<String, Error>) -> Void) {
            self.id = id
            self.request = request
            self.data = data
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
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()
    private var jobs: [Int: Job] = [:]
    private var activeJob: Job?
    private var queuedJobs: [Job] = []

    /// The query `POST /fs/upload` takes for a file named `name`, into `destination` or `uploads_dir`.
    static func query(name: String, destination: UploadDestination?) -> String {
        // Encoded by hand: URLComponents leaves `+` bare in a value, and the daemon reads it as a space.
        let unreserved = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let encode = { (value: String) in value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? "" }
        var query = "name=\(encode(name))"
        if let destination {
            query += "&dir=\(encode(destination.dir))"
            if destination.text { query += "&text=1" }
        }
        return query
    }

    /// Posts `data` with `request`, the host's `/fs/upload` with `query(name:destination:)`, carrying `token`.
    func upload(id: String, request: URLRequest, data: Data, text: Bool, token: String, rejectedToken: @escaping (String) -> Void, progress: @escaping (Double) -> Void, completion: @escaping (Result<String, Error>) -> Void) -> Bool {
        guard activeJob == nil || queuedJobs.count < Self.maxQueuedUploads else { return false }
        var request = request
        request.httpMethod = "POST"
        request.setValue(text ? "text/plain; charset=utf-8" : "image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue(String(data.count), forHTTPHeaderField: "Content-Length")
        let job = Job(id: id, request: request, data: data, token: token, rejectedToken: rejectedToken, progress: progress, completion: completion)
        if activeJob == nil {
            activeJob = job
            attempt(job)
        } else {
            queuedJobs.append(job)
        }
        return true
    }

    /// Stops the job `id`, queued or running. The page has already stopped listening.
    func cancel(id: String) {
        queuedJobs.removeAll { $0.id == id }
        guard let job = activeJob, job.id == id else { return }
        if let task = job.task {
            jobs[task.taskIdentifier] = nil
            task.cancel()
        }
        finish(job)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        jobs[dataTask.taskIdentifier]?.statusCode = (response as? HTTPURLResponse)?.statusCode
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        jobs[dataTask.taskIdentifier]?.responseData.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(HostRequest.redirect(task, to: request, within: "/fs/upload"))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let job = jobs[task.taskIdentifier], totalBytesExpectedToSend > 0 else { return }
        job.progress(min(0.99, Double(totalBytesSent) / Double(totalBytesExpectedToSend)))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let job = jobs.removeValue(forKey: task.taskIdentifier) else { return }
        if let error {
            job.completion(.failure(error))
            finish(job)
            return
        }
        if job.statusCode == 503, job.retry < 3 {
            let retryAfter = (task.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init) ?? 1
            job.retry += 1
            job.task = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + max(0, min(retryAfter, 60))) { [weak self] in
                if self?.activeJob === job { self?.attempt(job) } // cancelled while it waited, if not
            }
            return
        }
        if job.statusCode == 401 { job.rejectedToken(job.token) }
        guard job.statusCode == 201,
              let uploaded = try? JSONDecoder().decode(UploadedPath.self, from: job.responseData) else {
            job.completion(.failure(UploadFailure.server(job.statusCode ?? 0, code: (try? JSONDecoder().decode(DaemonError.self, from: job.responseData))?.error)))
            finish(job)
            return
        }
        job.progress(1)
        job.completion(.success(uploaded.path))
        finish(job)
    }

    private func attempt(_ job: Job) {
        job.responseData.removeAll(keepingCapacity: true)
        job.statusCode = nil
        let task = session.uploadTask(with: job.request, from: job.data)
        jobs[task.taskIdentifier] = job
        job.task = task
        task.resume()
    }

    private func finish(_ job: Job) {
        guard activeJob?.id == job.id else { return }
        activeJob = queuedJobs.isEmpty ? nil : queuedJobs.removeFirst()
        if let activeJob { attempt(activeJob) }
    }
}

private struct UploadedPath: Decodable { let path: String }

/// The daemon's refusal body, `{"error": code}` (fs.md "Errors").
private struct DaemonError: Decodable { let error: String }

enum UploadFailure: LocalizedError {
    /// The HTTP status and the daemon's error code, if the body had one. The page words the code.
    case server(Int, code: String?)

    /// The daemon's code, or `http_<status>` when the body had none, as the browser names it: the page words either.
    var code: String? {
        if case .server(let status, let code) = self { code ?? "http_\(status)" } else { nil }
    }

    var errorDescription: String? {
        switch self {
        case .server(let status, _): "The server answered HTTP \(status)."
        }
    }
}
