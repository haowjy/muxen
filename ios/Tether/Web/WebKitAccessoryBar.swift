import ObjectiveC.runtime
import UIKit
import WebKit

/// Takes the form accessory bar (⌃ ⌄ ✓) off the keyboard for web fields.
/// Used only while the web keyboard switch is on (`TetherAppModel.webKeyboard`).
///
/// The bar belongs to the web view's content view, and UIKit has no public switch for it. If
/// WebKit changes its internal view, the system's own chrome stays: nothing here is load-bearing
/// for input, so a missing class only leaves the bar visible. The predictive strip is not this
/// hook's: the page's `autocorrect="off"` attributes remove it.
enum WebKitAccessoryBar {
    private static let prefix = "Tether_NoFormChrome_"

    @discardableResult
    static func hide(in webView: WKWebView) -> Bool {
        guard let contentView = webView.scrollView.subviews.first(where: {
            NSStringFromClass(type(of: $0)).contains("WKContentView")
        }), let contentClass = object_getClass(contentView) else { return false }

        let original = NSStringFromClass(contentClass)
        if original.hasPrefix(prefix) { return true }

        let className = "\(prefix)\(original.replacingOccurrences(of: ".", with: "_"))"
        if let existing = NSClassFromString(className) {
            object_setClass(contentView, existing)
            return true
        }

        guard let subclass = objc_allocateClassPair(contentClass, className, 0) else { return false }
        let noAccessory: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        let added = [
            (#selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(noAccessory), "@@:"),
        ].allSatisfy { class_addMethod(subclass, $0.0, $0.1, $0.2) }
        guard added else {
            objc_disposeClassPair(subclass)
            return false
        }
        objc_registerClassPair(subclass)
        object_setClass(contentView, subclass)
        return true
    }
}
