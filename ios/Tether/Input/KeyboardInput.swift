import TetherKit
import UIKit

@MainActor
protocol KeyboardInputDelegate: AnyObject {
    func keyboardInput(_ event: InputEvent)
    func keyboardInputWarning()
    func keyboardInputLineEdit(gen: Int, text: String, tab: TabKey, selection: NSRange, marked: NSRange?)
    func keyboardInputLineReturn(gen: Int, text: String, tab: TabKey) -> Bool
}

@MainActor
final class KeyboardInput: UITextField, UITextFieldDelegate {
    weak var output: KeyboardInputDelegate?
    weak var focusController: FocusController?

    private(set) var mode: FocusController.Mode = .hidden
    private var generation = 0
    private var armedModifier: String?
    private let emptyInputView = UIView(frame: .zero)
    private var repeatTimers: [Int: Timer] = [:]
    private var repeatingTimers: [Int: Timer] = [:]
    private var handledCodes = Set<Int>()
    private var lineTab: TabKey?
    private var lastLineEdit: LineEdit?
    private var suppressLineEdit = false
    /// The line while another mode holds the field: outside `line` this is the line's only copy, and the
    /// field holds the sentinel alone. `line` moves it into the field and back out.
    private var storedLine = StoredLine(text: "", selection: NSRange(location: 0, length: 0))

    private struct StoredLine {
        var text: String
        var selection: NSRange

        var length: Int { (text as NSString).length }

        mutating func place(_ location: Int, length: Int = 0) {
            let start = min(max(location, 0), self.length)
            selection = NSRange(location: start, length: min(max(length, 0), self.length - start))
        }
    }

    private struct LineEdit: Equatable {
        let text: String
        let selection: NSRange
        let marked: NSRange?
    }

    override var canBecomeFirstResponder: Bool { true }
    override var canResignFirstResponder: Bool { focusController?.canResignInput ?? true }

    override init(frame: CGRect) {
        super.init(frame: frame)
        inputView = emptyInputView
        isAccessibilityElement = false
        alpha = 0.01
        isUserInteractionEnabled = false
        autocorrectionType = .no
        autocapitalizationType = .none
        spellCheckingType = .no
        smartQuotesType = .no
        if #available(iOS 18.0, *) { writingToolsBehavior = .none }
        smartDashesType = .no
        smartInsertDeleteType = .no
        inlinePredictionType = .no
        // Keep the locale's IME and dictation keyboards available; the explicit text traits
        // above suppress corrections and predictions without restricting the input layout.
        keyboardType = .default
        returnKeyType = .default
        textContentType = .none
        delegate = self
        addTarget(self, action: #selector(editingChanged), for: .editingChanged)
        resetToSentinel()
        NotificationCenter.default.addObserver(self, selector: #selector(stopAllRepeats), name: UIApplication.willResignActiveNotification, object: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    deinit { NotificationCenter.default.removeObserver(self) }

    override func resignFirstResponder() -> Bool {
        stopAllRepeats()
        return super.resignFirstResponder()
    }

    func setMode(_ mode: FocusController.Mode) {
        guard self.mode != mode else { return }
        // A held hardware key was routed for the old mode (Esc in the line returns to the terminal): repeats must not go on under the new one.
        stopAllRepeats()
        let previous = self.mode
        // Only `line` keeps the line in the field. It is stored on the way out and put back, caret and all,
        // on the way in: left in the field, it went to tmux with the next terminal key.
        if previous == .line {
            let edit = lineEdit
            storedLine = StoredLine(text: edit.text, selection: edit.selection)
        }
        self.mode = mode
        if mode == .line { showStoredLine() } else { resetToSentinel() }
        inputView = mode == .hidden ? emptyInputView : nil
        returnKeyType = mode == .line ? .send : .default
        reloadInputViews()
    }

    func setLine(text: String, caret: Int, tab: TabKey) -> NativeLineSnapshot {
        generation += 1
        lineTab = tab
        storedLine.text = text
        storedLine.place(caret)
        if mode == .line { showStoredLine() } else { lastLineEdit = lineEdit }
        return snapshot(tab: tab)
    }

    func lineSnapshot() -> NativeLineSnapshot? {
        guard let tab = lineTab else { return nil }
        return snapshot(tab: tab)
    }

    private func snapshot(tab: TabKey) -> NativeLineSnapshot {
        let edit = lineEdit
        let range = { (value: NSRange) in
            TextRange(start: value.location, end: NSMaxRange(value))
        }
        return NativeLineSnapshot(tab: tab, gen: generation, text: edit.text, selection: range(edit.selection), marked: edit.marked.map(range))
    }

    func setLineCaret(_ index: Int) {
        guard mode == .line else {
            storedLine.place(index)
            return
        }
        let length = ((text ?? "") as NSString).length
        let offset = min(max(index, 0), length)
        guard let caret = position(from: beginningOfDocument, offset: offset) else { return }
        selectedTextRange = textRange(from: caret, to: caret)
    }

    /// The key row's ← and →: one step with UIKit's own text positions, as a hardware arrow takes. A
    /// selection collapses toward the arrow. While the keyboard composes (marked text) the step is
    /// dropped, because the composition is the keyboard's until it commits.
    func stepLineCaret(_ step: Int) {
        guard mode == .line, markedTextRange == nil, let selection = selectedTextRange else { return }
        let target: UITextPosition?
        if selection.isEmpty {
            target = position(from: selection.start, in: step < 0 ? .left : .right, offset: 1)
        } else {
            target = step < 0 ? selection.start : selection.end
        }
        guard let target else { return }
        selectedTextRange = textRange(from: target, to: target)
    }

    func selectAllLine() {
        guard mode == .line else {
            storedLine.place(0, length: storedLine.length)
            return
        }
        selectedTextRange = textRange(from: beginningOfDocument, to: endOfDocument)
    }

    func insertLine(_ text: String) {
        guard !text.contains(where: { $0.isNewline }) else { return }
        armedModifier = nil
        guard mode == .line else {
            storedLine.text = (storedLine.text as NSString).replacingCharacters(in: storedLine.selection, with: text)
            storedLine.place(storedLine.selection.location + (text as NSString).length)
            if let lineTab {
                let edit = lineEdit
                lastLineEdit = edit
                output?.keyboardInputLineEdit(gen: generation, text: edit.text, tab: lineTab, selection: edit.selection, marked: nil)
            }
            return
        }
        guard let range = selectedTextRange ?? textRange(from: endOfDocument, to: endOfDocument) else { return }
        replace(range, withText: text)
    }

    func setArmedModifier(_ armed: String?) { armedModifier = armed }

    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        guard mode == .line, armedModifier != nil else { return true }
        armedModifier = nil
        guard !string.isEmpty, markedTextRange == nil, range.length == 0, string.count == 1 else { return true }
        output?.keyboardInput(.text(string))
        return false
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        guard markedTextRange == nil else { return false }
        if mode == .line {
            submitLine()
        } else if mode == .terminal || mode == .hidden {
            output?.keyboardInput(.key("Enter"))
        }
        return false
    }

    /// The line's Return: the whole line goes to the tab, then Enter, and the box empties. The web's Send
    /// button asks for the same (`lineSubmit`). Dropped while the keyboard composes, as Return is.
    func submitLine() {
        guard mode == .line, markedTextRange == nil, let tab = lineTab else { return }
        let returnedText = text ?? ""
        let returnedGeneration = generation
        guard output?.keyboardInputLineReturn(gen: returnedGeneration, text: returnedText, tab: tab) == true else {
            output?.keyboardInputWarning()
            return
        }
        generation += 1
        suppressLineEdit = true
        text = ""
        if let caret = position(from: beginningOfDocument, offset: 0) {
            selectedTextRange = textRange(from: caret, to: caret)
        }
        suppressLineEdit = false
        lastLineEdit = lineEdit
    }

    func textFieldDidChangeSelection(_ textField: UITextField) { publishLineEdit() }

    override func deleteBackward() {
        guard markedTextRange == nil else {
            super.deleteBackward()
            return
        }
        guard mode == .line else {
            output?.keyboardInput(.key("BSpace"))
            // After a long hold iOS deletes by word: it selects the word before the caret, here the
            // sentinel, and asks for a delete. The field must come back as the sentinel with the caret
            // after it, or the next step finds nothing it can delete and the repeat stops.
            resetToSentinel()
            return
        }
        super.deleteBackward()
    }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var unhandled = Set<UIPress>()
        for press in presses {
            guard let key = press.key else { unhandled.insert(press); continue }
            if mode == .line {
                if key.modifierFlags.contains(.command), key.charactersIgnoringModifiers.lowercased() == "v" {
                    pasteFromHardwareKeyboard()
                    handledCodes.insert(key.keyCode.rawValue)
                    continue
                }
                let terminalControl = key.modifierFlags.contains(.control) ||
                    [.keyboardEscape, .keyboardTab, .keyboardUpArrow, .keyboardDownArrow].contains(key.keyCode)
                guard terminalControl, let hardwareKey = Self.hardwareKey(key),
                      let mapped = KeyMapper.event(for: hardwareKey) else {
                    unhandled.insert(press)
                    continue
                }
                handle(mapped, key: key)
                continue
            }

            guard let hardwareKey = Self.hardwareKey(key),
                  let mapped = KeyMapper.event(for: hardwareKey) else {
                unhandled.insert(press)
                continue
            }
            handle(mapped, key: key)
        }
        if !unhandled.isEmpty { super.pressesBegan(unhandled, with: event) }
    }

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var unhandled = Set<UIPress>()
        for press in presses {
            guard let key = press.key, handledCodes.contains(key.keyCode.rawValue) else {
                unhandled.insert(press)
                continue
            }
            stopRepeat(key.keyCode.rawValue)
        }
        if !unhandled.isEmpty { super.pressesEnded(unhandled, with: event) }
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        for press in presses {
            if let key = press.key { stopRepeat(key.keyCode.rawValue) }
        }
        super.pressesCancelled(presses, with: event)
    }

    @objc private func editingChanged() {
        if mode == .line {
            publishLineEdit()
            return
        }
        guard markedTextRange == nil, let text, text != Self.sentinel else { return }
        let typed = text.replacingOccurrences(of: Self.sentinel, with: "")
        if !typed.isEmpty { output?.keyboardInput(.text(typed)) }
        resetToSentinel()
    }

    /// Outside the line the field holds one invisible character and never anything else. iOS repeats a held
    /// delete only while the field has text before the caret; `deleteBackward` sends BSpace and keeps it.
    private static let sentinel = "\u{200B}"

    /// Puts the stored line in the field for `line`, without reporting it: the web already has it.
    private func showStoredLine() {
        suppressLineEdit = true
        text = storedLine.text
        if let start = position(from: beginningOfDocument, offset: storedLine.selection.location),
           let end = position(from: start, offset: storedLine.selection.length) {
            selectedTextRange = textRange(from: start, to: end)
        }
        suppressLineEdit = false
        lastLineEdit = lineEdit
    }

    private func resetToSentinel() {
        text = Self.sentinel
        let end = endOfDocument
        selectedTextRange = textRange(from: end, to: end)
    }

    /// The line as it stands: the field's in `line`, the stored copy otherwise.
    private var lineEdit: LineEdit {
        guard mode == .line else { return LineEdit(text: storedLine.text, selection: storedLine.selection, marked: nil) }
        let start = selectedTextRange?.start ?? beginningOfDocument
        let end = selectedTextRange?.end ?? start
        let selection = NSRange(location: offset(from: beginningOfDocument, to: start), length: offset(from: start, to: end))
        let marked: NSRange?
        if let range = markedTextRange {
            let location = offset(from: beginningOfDocument, to: range.start)
            marked = NSRange(location: location, length: offset(from: range.start, to: range.end))
        } else {
            marked = nil
        }
        return LineEdit(text: text ?? "", selection: selection, marked: marked)
    }

    private func publishLineEdit() {
        guard mode == .line, !suppressLineEdit, let lineTab else { return }
        let edit = lineEdit
        guard edit != lastLineEdit else { return }
        lastLineEdit = edit
        output?.keyboardInputLineEdit(gen: generation, text: edit.text, tab: lineTab, selection: edit.selection, marked: edit.marked)
    }

    private func handle(_ event: InputEvent, key: UIKey) {
        let code = key.keyCode.rawValue
        guard !handledCodes.contains(code) else { return }
        handledCodes.insert(code)
        if case .key(let name) = event, name == "C-c" || name == "C-d" { output?.keyboardInputWarning() }
        output?.keyboardInput(event)
        startRepeat(event, code: code)
    }

    private func pasteFromHardwareKeyboard() {
        guard let pasted = UIPasteboard.general.string, !pasted.isEmpty else { return }
        if pasted.contains(where: { $0.isNewline }) {
            output?.keyboardInput(.paste(pasted))
        } else {
            insertLine(pasted)
        }
    }

    private func startRepeat(_ input: InputEvent, code: Int) {
        let initial = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.handledCodes.contains(code) else { return }
                self.output?.keyboardInput(input)
                let repeating = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self, self.handledCodes.contains(code) else { return }
                        self.output?.keyboardInput(input)
                    }
                }
                self.repeatingTimers[code] = repeating
            }
        }
        repeatTimers[code] = initial
    }

    private func stopRepeat(_ code: Int) {
        handledCodes.remove(code)
        repeatTimers.removeValue(forKey: code)?.invalidate()
        repeatingTimers.removeValue(forKey: code)?.invalidate()
    }

    @objc private func stopAllRepeats() {
        for timer in repeatTimers.values { timer.invalidate() }
        for timer in repeatingTimers.values { timer.invalidate() }
        repeatTimers.removeAll()
        repeatingTimers.removeAll()
        handledCodes.removeAll()
    }

    private static func hardwareKey(_ key: UIKey) -> HardwareKey? {
        let code: String
        switch key.keyCode {
        case .keyboardEscape: code = "escape"
        case .keyboardTab: code = "tab"
        case .keyboardReturnOrEnter: code = "return"
        case .keyboardDeleteOrBackspace: code = "delete"
        case .keyboardUpArrow: code = "up"
        case .keyboardDownArrow: code = "down"
        case .keyboardLeftArrow: code = "left"
        case .keyboardRightArrow: code = "right"
        case .keyboardHome: code = "home"
        case .keyboardEnd: code = "end"
        case .keyboardPageUp: code = "pageUp"
        case .keyboardPageDown: code = "pageDown"
        case .keyboardF1: code = "f1"
        case .keyboardF2: code = "f2"
        case .keyboardF3: code = "f3"
        case .keyboardF4: code = "f4"
        case .keyboardF5: code = "f5"
        case .keyboardF6: code = "f6"
        case .keyboardF7: code = "f7"
        case .keyboardF8: code = "f8"
        case .keyboardF9: code = "f9"
        case .keyboardF10: code = "f10"
        case .keyboardF11: code = "f11"
        case .keyboardF12: code = "f12"
        default:
            guard key.charactersIgnoringModifiers.count == 1 else { return nil }
            code = key.charactersIgnoringModifiers.lowercased()
        }
        var modifiers: KeyModifiers = []
        if key.modifierFlags.contains(.control) { modifiers.insert(.control) }
        if key.modifierFlags.contains(.alternate) { modifiers.insert(.option) }
        if key.modifierFlags.contains(.shift) { modifiers.insert(.shift) }
        if key.modifierFlags.contains(.command) { modifiers.insert(.command) }
        return HardwareKey(code: code, charactersIgnoringModifiers: key.charactersIgnoringModifiers, modifiers: modifiers)
    }
}
