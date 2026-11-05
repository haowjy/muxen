import AVKit
import Foundation
import MuxenKit
import PhotosUI
import UIKit

/// Media over the page (ios-shell.md "Files and sharing"): picking and uploading images, the video player, and Files'
/// Download with its progress alert and share sheet. `presenter` is the web shell, which these screens cover; every
/// screen goes up through `show`, and a lock takes it down (`lock`).
@MainActor
final class MediaController: NSObject, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private let model: MuxenAppModel
    private weak var presenter: UIViewController?
    /// Sends an `upload` event to the page.
    private let send: (NativeEvent) -> Void
    private let uploader = Uploader()
    private let downloader = Downloader()
    /// The screen `show` put over the page, and what ends it when a lock takes it down: a dismiss in code runs none
    /// of the screen's own handlers.
    private weak var screen: UIViewController?
    private var screenEnded: () -> Void = {}
    private var pendingPick: PendingPick?

    init(model: MuxenAppModel, presenter: UIViewController, send: @escaping (NativeEvent) -> Void) {
        self.model = model
        self.presenter = presenter
        self.send = send
    }

    func readPasteboard(host: String, id: String) -> JSONValue {
        if let image = UIPasteboard.general.image {
            upload(image, id: id, host: host)
            return .object(["uploading": .string(id)])
        }
        if let text = UIPasteboard.general.string { return .object(["text": .string(text)]) }
        return .string("empty")
    }

    /// Files' Paste: an image (as JPEG) or the text on the pasteboard becomes a new file in `dir`.
    func pasteInto(host: String, id: String, dir: String) -> JSONValue {
        if let image = UIPasteboard.general.image {
            upload(image, id: id, host: host, destination: UploadDestination(dir: dir, text: false))
            return .object(["uploading": .string(id)])
        }
        if let text = UIPasteboard.general.string, !text.isEmpty {
            upload(Data(text.utf8), id: id, host: host, fileName: "pasted.txt", destination: UploadDestination(dir: dir, text: true))
            return .object(["uploading": .string(id)])
        }
        return .string("empty")
    }

    /// Puts `screen` over the page once any transition there has finished: UIKit drops a present made while another
    /// screen is up or moving, and the page would wait forever on a screen that never came. If another screen is up or
    /// the app is locked, `refused` runs instead. `ended` runs if a lock takes the screen down.
    private func show(_ screen: UIViewController, ended: @escaping () -> Void = {}, refused: @escaping () -> Void = {}, then: (() -> Void)? = nil) {
        afterTransition { [weak self] in
            guard let self, let presenter = self.presenter, presenter.presentedViewController == nil, !self.model.isLocked else {
                refused()
                return
            }
            screen.popoverPresentationController?.sourceView = presenter.view
            screen.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            self.screen = screen
            self.screenEnded = ended
            presenter.present(screen, animated: true, completion: then)
        }
    }

    /// Takes `screen` down if it is still up, once any transition has finished (a dismiss during a present is dropped).
    /// `next` runs when it has gone.
    private func takeDown(_ screen: UIViewController, animated: Bool = true, then next: @escaping () -> Void = {}) {
        afterTransition { [weak self] in
            guard screen.presentingViewController != nil else { next(); return }
            // Already going (a lock's dismiss): a second dismiss would be dropped with its completion, so wait for it.
            guard !screen.isBeingDismissed else {
                DispatchQueue.main.async { self?.takeDown(screen, animated: animated, then: next) }
                return
            }
            screen.dismiss(animated: animated, completion: next)
        }
    }

    /// Runs `next` once the screen over the page, if any, has finished appearing or going.
    private func afterTransition(_ next: @escaping () -> Void) {
        guard let shown = presenter?.presentedViewController, shown.isBeingPresented || shown.isBeingDismissed,
              let coordinator = shown.transitionCoordinator else { next(); return }
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            // UIKit settles the presentation after the coordinator's completion; the next turn sees it settled.
            DispatchQueue.main.async { self?.afterTransition(next) }
        }
    }

    /// A lock's end to media (ios-shell.md "Files and sharing"): a download stops, and the screen over the page goes, so
    /// nothing stays up over the lock screen. A screen already going on its own runs its own handler instead.
    func lock() {
        downloader.cancel()
        guard let screen else { return }
        let ended = screenEnded
        afterTransition {
            // Gone, or already going on its own: that close runs its own handler.
            guard screen.presentingViewController != nil, !screen.isBeingDismissed else { return }
            screen.dismiss(animated: false, completion: ended)
        }
    }

    func showMediaPicker(host: String, id: String) {
        let target = PendingPick(host: host, id: id)
        let alert = UIAlertController(title: "Add image", message: nil, preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "Photo Library", style: .default) { [weak self] _ in self?.presentPhotoLibrary(target) })
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            alert.addAction(UIAlertAction(title: "Camera", style: .default) { [weak self] _ in self?.presentCamera(target) })
        }
        alert.addAction(UIAlertAction(title: "Paste Image", style: .default) { [weak self] _ in
            guard let image = UIPasteboard.general.image else { self?.cancel(target); return }
            self?.upload(image, id: id, host: host)
        })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.cancel(target) })
        // A refused menu (a double tap on Upload) ends the stream instead of leaving it open.
        show(alert, ended: { [weak self] in self?.cancel(target) }, refused: { [weak self] in self?.cancel(target) })
    }

    private func presentPhotoLibrary(_ target: PendingPick) {
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        showPicker(picker, for: target)
    }

    private func presentCamera(_ target: PendingPick) {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = ["public.image"]
        picker.delegate = self
        showPicker(picker, for: target)
    }

    private func showPicker(_ picker: UIViewController, for target: PendingPick) {
        pendingPick = target
        show(picker, ended: { [weak self] in self?.endPick() }, refused: { [weak self] in self?.endPick() })
    }

    /// The pick in progress ends with nothing picked: its stream ends.
    private func endPick() {
        guard let pick = pendingPick else { return }
        pendingPick = nil
        cancel(pick)
    }

    /// Every `upload` event is deferred one turn: a paste's reply to the page goes out first, so its
    /// stream exists before the first event arrives.
    private func sendUpload(id: String, progress: Double, path: String? = nil, error: String? = nil, code: String? = nil, cancelled: Bool = false) {
        Task { @MainActor [weak self] in
            self?.send(.upload(id: id, progress: progress, path: path, error: error, code: code, cancelled: cancelled))
        }
    }

    private func cancel(_ pick: PendingPick) { sendUpload(id: pick.id, progress: 1, cancelled: true) }

    private func upload(_ image: UIImage, id: String, host hostID: String, destination: UploadDestination? = nil) {
        guard let data = Self.jpegData(image) else {
            sendUpload(id: id, progress: 1, error: "Couldn't prepare this image.")
            return
        }
        upload(data, id: id, host: hostID, fileName: "image.jpg", destination: destination)
    }

    private func upload(_ data: Data, id: String, host hostID: String, fileName: String, destination: UploadDestination?) {
        let request: URLRequest, token: String
        switch model.request(on: hostID, path: "/fs/upload", query: Uploader.query(name: fileName, destination: destination)) {
        case .ready(let ready, let readyToken): (request, token) = (ready, readyToken)
        case .noHost: sendUpload(id: id, progress: 1, error: "This server isn't saved in the app."); return
        case .locked, .notEnrolled: sendUpload(id: id, progress: 1, error: "Unlock muxen to upload."); return
        }
        let accepted = uploader.upload(id: id, request: request, data: data, text: destination?.text == true, token: token, rejectedToken: { [weak model = self.model] rejectedToken in
            model?.rejectedToken(for: hostID, token: rejectedToken)
        }, progress: { [weak self] progress in
            self?.sendUpload(id: id, progress: progress)
        }, completion: { [weak self] result in
            switch result {
            case .success(let path): self?.sendUpload(id: id, progress: 1, path: path)
            case .failure(let error): self?.sendUpload(id: id, progress: 1, error: error.localizedDescription, code: (error as? UploadFailure)?.code)
            }
        })
        if accepted { sendUpload(id: id, progress: 0) }
        else { sendUpload(id: id, progress: 1, error: "Wait for the current uploads to finish.") }
    }

    func playVideo(host: String, path: String) {
        let segments = path.split(separator: "/").map { segment in
            segment.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? String(segment)
        }
        guard case .ready(let request, _) = model.request(on: host, path: "/fs/raw/" + segments.joined(separator: "/")),
              let url = request.url else { return }
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": request.allHTTPHeaderFields ?? [:]])
        let controller = AVPlayerViewController()
        // The player is made once the screen is up: a refused one fetches nothing.
        show(controller, ended: { [weak controller] in controller?.player?.pause() }, then: {
            controller.player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            controller.player?.play()
        })
    }

    /// Files' Download: `url` is the page's own `muxen-app://h-{host}/fs/raw/…`, resolved as the scheme handler
    /// resolves it. `reply` waits for the share sheet to close; the web says an `error` in its notice.
    func download(_ value: String, name: String, reply: @escaping (Any?, String?) -> Void) {
        let fail = { (error: String, code: String?) in
            var failure: [String: Any] = ["error": error]
            if let code { failure["code"] = code }
            reply(failure, nil)
        }
        guard let page = URLComponents(string: value), page.scheme == "muxen-app",
              let pageHost = page.host, pageHost.hasPrefix("h-"),
              page.percentEncodedPath.hasPrefix("/fs/raw/"), page.query == nil, page.fragment == nil else {
            fail("This file's server isn't saved in the app.", nil)
            return
        }
        let hostID = String(pageHost.dropFirst(2))
        let request: URLRequest, token: String
        switch model.request(on: hostID, path: page.percentEncodedPath) {
        case .ready(let ready, let readyToken): (request, token) = (ready, readyToken)
        case .noHost: fail("This file's server isn't saved in the app.", nil); return
        case .locked: fail("muxen is locked.", nil); return
        case .notEnrolled: fail("This iPhone has no token for that server.", "not_enrolled"); return
        }
        // One download runs at a time, and its sheet can't go up over another screen.
        guard presenter?.presentedViewController == nil, !downloader.isBusy else {
            fail("Close what's open, then download again.", nil)
            return
        }
        let progress = UIAlertController(title: "Downloading \(name)", message: "Starting", preferredStyle: .alert)
        progress.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.downloader.cancel() })
        let bytes = { (count: Int64) in ByteCountFormatter.string(fromByteCount: count, countStyle: .file) }
        _ = downloader.download(request, name: name, token: token, rejectedToken: { [weak model = self.model] rejected in
            model?.rejectedToken(for: hostID, token: rejected)
        }, progress: { written, total in
            let text = total.map { "\(bytes(written)) of \(bytes($0))" } ?? bytes(written)
            if progress.message != text { progress.message = text }
        }, completion: { [weak self] result in
            guard let self else { Downloader.discard(); reply(NSNull(), nil); return }
            // However it ended (Cancel, a lock, the last byte), the alert goes before anything else goes up.
            self.takeDown(progress) {
                switch result {
                case .success(let file): self.share(file, reply: reply, fail: fail)
                case .failure(DownloadFailure.cancelled): reply(NSNull(), nil)
                case .failure(let error): fail(error.localizedDescription, (error as? DownloadFailure)?.code)
                }
            }
        })
        // A small file goes straight to the sheet: the alert shows only for a download still running after 0.5 s, and
        // only over a still page, since nothing waits for it.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self, self.downloader.isBusy, self.presenter?.presentedViewController == nil else { return }
            self.show(progress)
        }
    }

    /// Offers the downloaded `file`; `reply` runs once, when the sheet closes however it closes, or at once if the
    /// sheet can't go up (the file goes then too).
    private func share(_ file: URL, reply: @escaping (Any?, String?) -> Void, fail: @escaping (String, String?) -> Void) {
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        // Cleared on its first call: the lock calls it too.
        sheet.completionWithItemsHandler = { [weak sheet] _, _, _, _ in
            sheet?.completionWithItemsHandler = nil
            Downloader.discard()
            reply(NSNull(), nil)
        }
        show(sheet, ended: { [weak sheet] in sheet?.completionWithItemsHandler?(nil, false, nil, nil) }, refused: { [weak self] in
            Downloader.discard()
            if self?.model.isLocked != false { reply(NSNull(), nil) } else { fail("Close what's open, then download again.", nil) }
        })
    }

    private static func jpegData(_ image: UIImage) -> Data? {
        let pixelWidth = image.size.width * image.scale
        let pixelHeight = image.size.height * image.scale
        guard pixelWidth > 0, pixelHeight > 0 else { return nil }
        let factor = min(1, 2048 / max(pixelWidth, pixelHeight))
        let size = CGSize(
            width: max(1, floor(image.size.width * factor)),
            height: max(1, floor(image.size.height * factor))
        )
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let thumbnail = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return thumbnail.jpegData(compressionQuality: 0.9)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        let pick = pendingPick
        pendingPick = nil
        takeDown(picker)
        guard let pick else { return }
        guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
            cancel(pick)
            return
        }
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            Task { @MainActor in
                guard let image = object as? UIImage else {
                    self?.sendUpload(id: pick.id, progress: 1, error: "Couldn't read this image.")
                    return
                }
                self?.upload(image, id: pick.id, host: pick.host)
            }
        }
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        let pick = pendingPick
        pendingPick = nil
        takeDown(picker)
        guard let pick else { return }
        if let image = info[.originalImage] as? UIImage { upload(image, id: pick.id, host: pick.host) }
        else { cancel(pick) }
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        let pick = pendingPick
        pendingPick = nil
        takeDown(picker)
        if let pick { cancel(pick) }
    }
}

/// A pick the page asked for: where to upload it, and the id its `upload` events carry.
private struct PendingPick {
    let host: String
    let id: String
}
