import Foundation
import MuxenKit

/// A folder to upload into instead of `uploads_dir`. `text`: the body is pasted text (fs.md "POST /fs/upload").
struct UploadDestination {
    let dir: String
    let text: Bool
}

final class Uploader: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private static let maxQueuedUploads = 4

    private final class Job {
        let id: String
        let host: HostEntry
        let data: Data
        let fileName: String
        let destination: UploadDestination?
        let token: String
        let rejectedToken: (String) -> Void
        let progress: (Double) -> Void
        let completion: (Result<String, Error>) -> Void
        var responseData = Data()
        var statusCode: Int?
        var retry = 0

        init(id: String, host: HostEntry, data: Data, fileName: String, destination: UploadDestination?, token: String, rejectedToken: @escaping (String) -> Void, progress: @escaping (Double) -> Void, completion: @escaping (Result<String, Error>) -> Void) {
            self.id = id
            self.host = host
            self.data = data
            self.fileName = fileName
            self.destination = destination
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

    func upload(id: String, host: HostEntry, data: Data, fileName: String, destination: UploadDestination? = nil, token: String, rejectedToken: @escaping (String) -> Void, progress: @escaping (Double) -> Void, completion: @escaping (Result<String, Error>) -> Void) -> Bool {
        guard activeJob == nil || queuedJobs.count < Self.maxQueuedUploads else { return false }
        let job = Job(id: id, host: host, data: data, fileName: fileName, destination: destination, token: token, rejectedToken: rejectedToken, progress: progress, completion: completion)
        if activeJob == nil {
            activeJob = job
            attempt(job)
        } else {
            queuedJobs.append(job)
        }
        return true
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        jobs[dataTask.taskIdentifier]?.statusCode = (response as? HTTPURLResponse)?.statusCode
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        jobs[dataTask.taskIdentifier]?.responseData.append(data)
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
            DispatchQueue.main.asyncAfter(deadline: .now() + max(0, min(retryAfter, 60))) { [weak self] in self?.attempt(job) }
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
        guard var components = URLComponents(string: job.host.baseURL) else {
            fail(job, with: UploadFailure.invalidHost)
            return
        }
        components.path = "/fs/upload"
        // Encoded by hand: URLComponents leaves `+` bare in a value, and the daemon reads it as a space.
        let unreserved = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let encode = { (value: String) in value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? "" }
        var query = [URLQueryItem(name: "name", value: encode(job.fileName))]
        if let destination = job.destination {
            query.append(URLQueryItem(name: "dir", value: encode(destination.dir)))
            if destination.text { query.append(URLQueryItem(name: "text", value: "1")) }
        }
        components.percentEncodedQueryItems = query
        guard let url = components.url else { fail(job, with: UploadFailure.invalidHost); return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(job.token)", forHTTPHeaderField: "Authorization")
        request.setValue(job.destination?.text == true ? "text/plain; charset=utf-8" : "image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue(String(job.data.count), forHTTPHeaderField: "Content-Length")
        job.responseData.removeAll(keepingCapacity: true)
        job.statusCode = nil
        let task = session.uploadTask(with: request, from: job.data)
        jobs[task.taskIdentifier] = job
        task.resume()
    }

    private func finish(_ job: Job) {
        guard activeJob?.id == job.id else { return }
        activeJob = queuedJobs.isEmpty ? nil : queuedJobs.removeFirst()
        if let activeJob { attempt(activeJob) }
    }

    private func fail(_ job: Job, with error: Error) {
        DispatchQueue.main.async { [weak self] in
            job.completion(.failure(error))
            self?.finish(job)
        }
    }
}

private struct UploadedPath: Decodable { let path: String }

/// The daemon's refusal body, `{"error": code}` (fs.md "Errors").
private struct DaemonError: Decodable { let error: String }

enum UploadFailure: LocalizedError {
    case invalidHost
    /// The HTTP status and the daemon's error code, if the body had one. The page words the code.
    case server(Int, code: String?)

    var code: String? {
        if case .server(_, let code) = self { code } else { nil }
    }

    var errorDescription: String? {
        switch self {
        case .invalidHost: "The server address is invalid."
        case .server(let status, _): "The upload failed (HTTP \(status))."
        }
    }
}
