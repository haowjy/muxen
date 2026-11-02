import GameController
import MuxenKit
import UIKit

@MainActor
final class FocusController {
    typealias Mode = MuxenKit.FocusMode

    /// The keyboard's target.
    private(set) var mode: Mode = .hidden
    private var isCovered = false
    private var stateBeforeCover: Mode?
    private let input: KeyboardInput
    /// The web keyboard switch: a page text box holds the keyboard, so the field rests in `webText` whatever
    /// is asked, and the web's `focus` requests change nothing.
    private(set) var webKeyboard = false

    var canResignInput: Bool { mode == .webText }
    var covered: Bool { isCovered }
    var modeForWeb: Mode { isCovered ? (stateBeforeCover ?? mode) : mode }

    init(input: KeyboardInput) {
        self.input = input
        input.focusController = self
    }

    /// The web's request for the keyboard's target.
    func set(_ next: Mode) {
        guard !webKeyboard else { return }
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
