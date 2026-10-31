import GameController
import TetherKit
import UIKit

@MainActor
final class FocusController {
    typealias Mode = TetherKit.FocusMode

    /// The keyboard's target. Never `.select`: the terminal's selection is `selecting`, on top of it.
    private(set) var mode: Mode = .hidden
    /// The terminal's selection is up. The keyboard and typing stay with `mode` (resigning the field dropped
    /// the keyboard, and on the phone WebKit cleared the page's selection with it); only the system edit
    /// menus are emptied, since tether draws Copy and Paste.
    private(set) var selecting = false
    private var isCovered = false
    private var stateBeforeCover: Mode?
    private let input: KeyboardInput
    /// The web keyboard switch: a page text box holds the keyboard, so the field rests in `webText` whatever
    /// is asked, and the web's `focus` requests change nothing.
    private(set) var webKeyboard = false

    var canResignInput: Bool { mode == .webText }
    var covered: Bool { isCovered }
    /// A page that loads fresh has no selection, so it gets the target alone.
    var modeForWeb: Mode { isCovered ? (stateBeforeCover ?? mode) : mode }

    init(input: KeyboardInput) {
        self.input = input
        input.focusController = self
    }

    /// The web's request: `select` turns the selection on; any target turns it off and takes the keyboard.
    func set(_ next: Mode) {
        guard !webKeyboard else { return }
        selecting = next == .select
        guard next != .select else { return }
        target(next)
    }

    private func target(_ next: Mode) {
        guard !isCovered else {
            stateBeforeCover = next
            return
        }
        apply(next)
    }

    func setWebKeyboard(_ on: Bool) {
        guard on != webKeyboard else { return }
        webKeyboard = on
        selecting = false
        target(on ? .webText : .hidden)
    }

    private func apply(_ requested: Mode) {
        let next = webKeyboard ? Mode.webText : requested
        mode = next
        input.setMode(next)
        if next == .webText {
            if input.isFirstResponder { _ = input.resignFirstResponder() }
        } else if !input.isFirstResponder {
            input.becomeFirstResponder()
        }
    }

    func systemKeyboardDidHide() {
        guard mode == .terminal || mode == .line, GCKeyboard.coalesced == nil else { return }
        target(.hidden)
    }

    func restoreAfterInterruption() {
        guard !isCovered else { return }
        apply(mode)
    }

    func coverNativeScreen(_ covered: Bool) {
        guard isCovered != covered else { return }
        if covered {
            stateBeforeCover = mode
            isCovered = true
            apply(.webText)
        } else if let previous = stateBeforeCover {
            isCovered = false
            stateBeforeCover = nil
            apply(previous)
        } else {
            isCovered = false
        }
    }
}
