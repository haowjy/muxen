import Foundation
import MuxenKit
import UIKit
import WebKit

@MainActor
final class WebShellController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    private let model: MuxenAppModel
    private let schemeHandler: AppSchemeHandler
    private let haptics = Haptics()
    private lazy var media = MediaController(model: model, presenter: self) { [weak self] event in self?.send(event) }
    /// Covers the window while the app is not active (`coverSnapshot`).
    private var snapshotCover: UIView?
    private var webView: MuxenWebView!
    private var webViewConstraints: [NSLayoutConstraint] = []
    /// How much of the web view's bottom a docked keyboard covers, and how long it takes to get there.
    private var keyboardCover: (height: CGFloat, duration: Double) = (0, 0)
    /// WebKit's left-edge back swipe pops the page's history, which is every Back in the web app. The page turns it
    /// off on a bare terminal tab. It starts off, and a new document starts off again, until the page has rendered a screen.
    private var backSwipe = false { didSet { webView?.allowsBackForwardNavigationGestures = backSwipe } }
    private var lastViewport: Viewport?
    /// Keeps the page's scroll offset at zero, and answers WebKit's "may this focus raise the keyboard".
    private var scrollGuard: NSKeyValueObservation?
    private let inputPolicy = AllowFocusPolicy()
    private lazy var messageHandlerProxy = WeakScriptMessageHandler(target: self)

    init(model: MuxenAppModel) {
        self.model = model
        schemeHandler = AppSchemeHandler(model: model)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        view.insetsLayoutMarginsFromSafeArea = false

        webView = makeWebView()
        // A change of the effective appearance (the user's choice, or the system's under System) is a new scheme for the web.
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (self: Self, _) in self.publishViewportIfChanged() }

        webViewConstraints = constraints(for: webView)
        NSLayoutConstraint.activate(webViewConstraints)

        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        model.attach(self)
        loadUI()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        publishViewportIfChanged()
        lockZoom()
    }

    /// The page never zooms: WKWebView re-reads its scale limits from each page, so this is applied again
    /// after every load and layout, and a zoom already taken is undone.
    private func lockZoom() {
        guard let scrollView = webView?.scrollView else { return }
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 1
        scrollView.bouncesZoom = false
        scrollView.pinchGestureRecognizer?.isEnabled = false
        if scrollView.zoomScale != 1 { scrollView.setZoomScale(1, animated: false) }
        if scrollView.contentOffset != .zero { scrollView.setContentOffset(.zero, animated: false) }
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in self?.publishViewportIfChanged(force: true) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        lockZoom()
        WebKitAccessoryBar.hide(in: self.webView)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    func send(_ type: BridgeMessageType, fields: [String: JSONValue]) {
        send(type, fields: fields, completion: nil)
    }

    private func send(_ type: BridgeMessageType, fields: [String: JSONValue], completion: ((Bool) -> Void)?) {
        guard let message = try? BridgeMessage(type: type, fields: fields),
              let object = try? jsonObject(message) else {
            completion?(false)
            return
        }
        webView.callAsyncJavaScript(
            "window.__muxen?.receive([message]);",
            arguments: ["message": object],
            in: nil,
            in: .page,
            completionHandler: { result in
                if case .success = result { completion?(true) }
                else { completion?(false) }
            }
        )
    }

    func sendLifecycle(_ lifecycle: Lifecycle, completion: @escaping () -> Void) {
        do {
            send(.lifecycle, fields: ["lifecycle": try .encode(lifecycle)]) { _ in completion() }
        } catch {
            completion()
            assertionFailure("Native lifecycle is not JSON encodable: \(error)")
        }
    }

    /// A native screen over the page (lock, server list, Face ID) takes the keyboard down.
    func coverNativeScreen(_ covered: Bool) {
        guard covered else { return }
        view.endEditing(true)
        // The lock screen is a SwiftUI overlay, under any modal: nothing may stay up over it.
        if model.isLocked { media.lock() }
    }

    /// An opaque view over the whole window, native screens included, while the app isn't active: iOS takes the
    /// app-switcher snapshot, and keeps it on disk, from what is on screen as the app leaves `.active`. The lock screen
    /// is opaque already, and a cover over it would hide the Face ID prompt's button.
    func coverSnapshot(_ covered: Bool) {
        guard covered, !model.isLocked, let window = view.window else {
            snapshotCover?.removeFromSuperview()
            snapshotCover = nil
            return
        }
        guard snapshotCover == nil else { return }
        let cover = UIView(frame: window.bounds)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.backgroundColor = .systemBackground
        window.addSubview(cover)
        snapshotCover = cover
    }

    func send(_ event: NativeEvent) {
        do {
            switch event {
            case .viewport(let viewport):
                send(.viewport, fields: ["viewport": try .encode(viewport)])
            case .lifecycle(let lifecycle):
                send(.lifecycle, fields: ["lifecycle": try .encode(lifecycle)])
            case .hosts(let hosts):
                send(.hosts, fields: ["hosts": try .encode(hosts)])
            case .upload(let id, let progress, let path, let error, let code, let cancelled):
                var fields: [String: JSONValue] = ["id": .string(id), "progress": .number(progress)]
                if let path { fields["path"] = .string(path) }
                if let error { fields["error"] = .string(error) }
                if let code { fields["code"] = .string(code) }
                if cancelled { fields["cancelled"] = .bool(true) }
                send(.upload, fields: fields)
            }
        } catch {
            assertionFailure("Native bridge event is not JSON encodable: \(error)")
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        // A message queued by a web view `recreateWebView` already replaced must not change the new one's state.
        guard message.webView === webView else {
            replyHandler(nil, "this web view was replaced")
            return
        }
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "muxen-app",
              message.frameInfo.securityOrigin.host == "ui" else {
            replyHandler(nil, "bridge messages must come from the app's main frame")
            return
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: message.body, options: [.fragmentsAllowed])
            let request = try JSONDecoder().decode(BridgeMessage.self, from: data)
            guard request.type.direction == .webToNative else { throw BridgeError.malformed }
            route(request, reply: replyHandler)
        } catch {
            replyHandler(nil, "invalid bridge message")
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "muxen-app", url.host == "ui", url.path == "/index.html" {
            decisionHandler(.allow)
            return
        }
        if ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
        return nil
    }

    /// A new web view, not a reload of this one: a reload leaves the dead document's entries in the back list,
    /// and a back swipe from the new document's first entry would load that old document again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { recreateWebView() }

    private func loadUI(fragment: String? = nil) {
        var components = URLComponents()
        components.scheme = "muxen-app"
        components.host = "ui"
        components.path = "/index.html"
        components.fragment = fragment
        guard let url = components.url else { return }
        webView.load(URLRequest(url: url))
    }

    private func recreateWebView() {
        backSwipe = false
        let previous = webView!
        let fragment = previous.url?.fragment
        NSLayoutConstraint.deactivate(webViewConstraints)
        previous.configuration.userContentController.removeScriptMessageHandler(forName: "muxen", contentWorld: .page)
        previous.navigationDelegate = nil
        previous.uiDelegate = nil
        previous.removeFromSuperview()
        webView = makeWebView()
        webViewConstraints = constraints(for: webView)
        NSLayoutConstraint.activate(webViewConstraints)
        loadUI(fragment: fragment)
    }

    private func makeWebView() -> MuxenWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "muxen-app")
        configuration.allowsInlineMediaPlayback = true
        // Apple Intelligence put its Writing Tools button over muxen's Copy and Paste on a terminal selection.
        // muxen's text is a terminal and a few short fields, none of them prose.
        if #available(iOS 18.0, *) { configuration.writingToolsBehavior = .none }
        configuration.allowsInlinePredictions = false
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.addScriptMessageHandler(messageHandlerProxy, contentWorld: .page, name: "muxen")

        let result = MuxenWebView(frame: .zero, configuration: configuration)
        result.onMenuChoice = { [weak self] choice in self?.send(choice, fields: [:]) }
        // iOS's selection handles, and the page's own (they read `--color-accent`): --blue-7 in light, --blue-9 in dark.
        result.tintColor = UIColor { $0.userInterfaceStyle == .dark
            ? UIColor(red: 113 / 255, green: 193 / 255, blue: 247 / 255, alpha: 1)
            : UIColor(red: 0, green: 101 / 255, blue: 180 / 255, alpha: 1) }
        result.translatesAutoresizingMaskIntoConstraints = false
        result.navigationDelegate = self
        result.uiDelegate = self
        result.scrollView.contentInsetAdjustmentBehavior = .never
        result.scrollView.bounces = false
        result.scrollView.keyboardDismissMode = .none
        result.scrollView.isScrollEnabled = false
        result.scrollView.minimumZoomScale = 1
        result.scrollView.maximumZoomScale = 1
        result.scrollView.bouncesZoom = false
        result.allowsBackForwardNavigationGestures = backSwipe
        #if DEBUG
        result.isInspectable = true
        #endif
        view.addSubview(result)
        installKeyboardHooks(on: result)
        return result
    }

    /// The page's text boxes hold the keyboard, as in phone Safari; these hooks cover what only the host can.
    private func installKeyboardHooks(on result: MuxenWebView) {
        // WebKit raises the keyboard for a script's `focus()` only inside a tap; this lets the page do it
        // after unlock or a web view restart. Private API: if the property is gone, the keyboard stays down then.
        if result.responds(to: NSSelectorFromString("_setInputDelegate:")) {
            _ = result.perform(NSSelectorFromString("_setInputDelegate:"), with: inputPolicy)
        } else {
            print("muxen: WebKit input delegate is unavailable")
        }
        // WebKit scrolls the page to reveal a focused box even with scrolling off; the page lays out from a fixed root.
        scrollGuard = result.scrollView.observe(\.contentOffset) { scrollView, _ in
            MainActor.assumeIsolated {
                if scrollView.contentOffset != .zero { scrollView.setContentOffset(.zero, animated: false) }
            }
        }
        if !WebKitAccessoryBar.hide(in: result) { print("muxen: WebKit accessory-bar suppression failed") }
    }

    /// The web view always fills the screen; the keyboard covers its bottom (see `keyboardWillChange`).
    private func constraints(for webView: WKWebView) -> [NSLayoutConstraint] {
        [
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ]
    }

    private func route(_ request: BridgeMessage, reply: @escaping (Any?, String?) -> Void) {
        do {
            switch request.type {
            case .ready:
                reply(try jsonObject(model.boot(viewport: viewport())), nil)
            case .socket:
                let host: String = try request.field("host")
                reply(try jsonObject(model.socket(for: host)), nil)
            case .hostRejected:
                let host: String = try request.field("host")
                let token: String = try request.field("token")
                model.rejectedToken(for: host, token: token)
                reply(NSNull(), nil)
            case .recreateWebView:
                reply(NSNull(), nil)
                DispatchQueue.main.async { [weak self] in self?.recreateWebView() }
            case .saveWorkspace:
                model.saveWorkspace(try request.field("workspace"))
                reply(NSNull(), nil)
            case .backSwipe:
                backSwipe = try request.field("enabled")
                reply(NSNull(), nil)
            case .editMenu:
                let rect: JSONValue = try request.field("rect")
                if case .null = rect { webView.hideMarkMenu() }
                else {
                    let r = try rect.decode(MenuRect.self)
                    webView.toggleMarkMenu(over: CGRect(x: r.x, y: r.y, width: r.width, height: r.height))
                }
                reply(NSNull(), nil)
            case .manageHosts:
                model.showingServers = true
                reply(NSNull(), nil)
            case .setPreference:
                let name: String = try request.field("name")
                let value: JSONValue = try request.field("value")
                Task { @MainActor in
                    do { reply(try jsonObject(try await model.setPreference(name, to: value)), nil) } catch { reply(nil, "native request failed") }
                }
            case .draftGet:
                reply(try jsonObject(model.drafts.get(request.field("key"))), nil)
            case .draftPut:
                let record: DraftRecord = try request.field("record")
                let baseRevision: Int = try request.field("baseRevision")
                reply(try jsonObject(model.drafts.put(record, baseRevision: baseRevision)), nil)
            case .draftDelete:
                let key: TabKey = try request.field("key")
                model.drafts.delete(key)
                reply(NSNull(), nil)
            case .draftList:
                reply(try jsonObject(model.drafts.list()), nil)
            case .copy:
                let text: String = try request.field("text")
                UIPasteboard.general.string = text
                reply(try jsonObject("ok"), nil)
            case .readPasteboard:
                let tab: TabKey = try request.field("tab")
                let result = media.readPasteboard(host: tab.host, id: try request.field("id"))
                reply(try jsonObject(result), nil)
            case .pasteInto:
                let result = media.pasteInto(host: try request.field("host"), id: try request.field("id"), dir: try request.field("dir"))
                reply(try jsonObject(result), nil)
            case .haptic:
                haptics.send(try request.field("kind"))
                reply(NSNull(), nil)
            case .pickMedia:
                media.showMediaPicker(host: try request.field("host"), id: try request.field("id"))
                reply(NSNull(), nil)
            case .cancelUpload:
                media.cancelUpload(id: try request.field("id"))
                reply(NSNull(), nil)
            case .playVideo:
                let host: String = try request.field("host")
                let path: String = try request.field("path")
                media.playVideo(host: host, path: path)
                reply(NSNull(), nil)
            case .download:
                media.download(try request.field("url"), name: try request.field("name"), reply: reply)
            case .openURL:
                let value: String = try request.field("url")
                guard let url = URL(string: value), ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") else { throw BridgeError.malformed }
                UIApplication.shared.open(url)
                reply(NSNull(), nil)
            case .ack:
                reply(NSNull(), nil)
            case .viewport, .lifecycle, .hosts, .upload, .menuCopy, .menuPaste:
                throw BridgeError.malformed
            }
        } catch {
            reply(nil, "native request failed")
        }
    }

    private func publishViewportIfChanged(force: Bool = false) {
        guard isViewLoaded else { return }
        let next = viewport()
        // The duration belongs to one move: a later message that differs only by it says nothing new.
        var settled = next
        settled.keyboardDuration = nil
        guard force || settled != lastViewport else { return }
        lastViewport = settled
        send(.viewport(next))
    }

    private func viewport() -> Viewport {
        let stable = max(0, view.bounds.height)
        // The web view fills the screen and a docked keyboard covers its bottom, as in a browser: the
        // dock and sheets rise by `keyboardInset` (ios-shell.md, "Keyboard geometry"). Resizing the web
        // view instead made WebKit lay the page out at the final size at once, so the dock jumped ahead
        // of the keyboard opening and dropped out while it closed.
        let covered = min(stable, max(0, keyboardCover.height))
        let width = max(0, view.bounds.width)
        let safe = view.safeAreaInsets
        return Viewport(
            layout: min(width, stable) < 600 ? "phone" : "desktop",
            density: "touch",
            scheme: traitCollection.userInterfaceStyle == .dark ? "dark" : "light",
            width: width,
            stableHeight: stable,
            visibleHeight: stable - covered,
            keyboardInset: covered,
            safeArea: SafeArea(top: safe.top, right: safe.right, bottom: safe.bottom, left: safe.left),
            keyboard: covered >= 120,
            keyboardDuration: keyboardCover.duration > 0 ? keyboardCover.duration : nil
        )
    }

    /// The page hears where the keyboard is going as it starts, with its duration, so the dock moves with
    /// it instead of after it.
    @objc private func keyboardWillChange(_ notification: Notification) {
        guard let info = notification.userInfo,
              let screenFrame = info[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let frame = view.convert(screenFrame, from: nil)
        let docked = frame.maxY >= view.bounds.maxY - 1 && frame.minY < view.bounds.maxY
        let height = docked ? view.bounds.maxY - frame.minY : 0
        setKeyboardCover(height, duration: info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0)
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        setKeyboardCover(0, duration: notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0)
    }

    /// The page hears where the keyboard is going and how long it has left to get there.
    private func setKeyboardCover(_ height: CGFloat, duration: Double) {
        let posted = CACurrentMediaTime()
        guard height != keyboardCover.height else { return }
        keyboardCover = (height, max(0, duration - (CACurrentMediaTime() - posted)))
        publishViewportIfChanged()
        keyboardCover.duration = 0
    }

    private func jsonObject<T: Encodable>(_ value: T) throws -> Any {
        let data = try JSONEncoder().encode(value)
        return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }
}

enum NativeEvent {
    case viewport(Viewport)
    case lifecycle(Lifecycle)
    case hosts([PlatformHost])
    case upload(id: String, progress: Double, path: String?, error: String?, code: String?, cancelled: Bool)
}

@MainActor
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: WebShellController?

    init(target: WebShellController) { self.target = target }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let target else {
            replyHandler(nil, "native bridge is unavailable")
            return
        }
        target.userContentController(userContentController, didReceive: message, replyHandler: replyHandler)
    }
}


/// Native's edit menu over the terminal's mark. The mark is no selection, so WebKit offers nothing there and the
/// page asks for `editMenu`; native knows whether the menu is up, since iOS can dismiss it itself.
final class MuxenWebView: WKWebView, UIEditMenuInteractionDelegate {
    var onMenuChoice: (BridgeMessageType) -> Void = { _ in }
    private lazy var markMenu = UIEditMenuInteraction(delegate: self)
    private var markRect = CGRect.zero
    private var markMenuUp = false

    /// Shows the menu over `rect`, or hides it if it is up.
    func toggleMarkMenu(over rect: CGRect) {
        if markMenuUp { hideMarkMenu(); return }
        if markMenu.view == nil { addInteraction(markMenu) }
        markRect = rect
        markMenu.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: CGPoint(x: rect.midX, y: rect.midY)))
    }

    func hideMarkMenu() { markMenu.dismissMenu() }

    func editMenuInteraction(_ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration, suggestedActions: [UIMenuElement]) -> UIMenu? {
        UIMenu(children: [
            UIAction(title: "Copy") { [weak self] _ in self?.onMenuChoice(.menuCopy) },
            UIAction(title: "Paste") { [weak self] _ in self?.onMenuChoice(.menuPaste) },
        ])
    }

    func editMenuInteraction(_ interaction: UIEditMenuInteraction, willPresentMenuFor configuration: UIEditMenuConfiguration, animator: any UIEditMenuInteractionAnimating) { markMenuUp = true }

    func editMenuInteraction(_ interaction: UIEditMenuInteraction, willDismissMenuFor configuration: UIEditMenuConfiguration, animator: any UIEditMenuInteractionAnimating) { markMenuUp = false }

    func editMenuInteraction(_ interaction: UIEditMenuInteraction, targetRectFor configuration: UIEditMenuConfiguration) -> CGRect { markRect }
}

/// WebKit's input delegate (private `_WKInputDelegate`), asked whether a focused page element may start an input
/// session. Always yes, so a script's `focus()` raises the keyboard without a tap. WebKit holds the delegate weakly.
final class AllowFocusPolicy: NSObject {
    /// `_WKFocusStartsInputSessionPolicyAllow`
    @objc(_webView:decidePolicyForFocusedElement:)
    func webView(_ webView: WKWebView, decidePolicyFor info: AnyObject) -> Int { 1 }
}
