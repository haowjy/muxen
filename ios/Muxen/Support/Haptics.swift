import UIKit

@MainActor
final class Haptics {
    private let impact = UIImpactFeedbackGenerator(style: .light)
    private let firm = UIImpactFeedbackGenerator(style: .medium)

    func send(_ kind: String) {
        switch kind {
        case "key": impact.impactOccurred()
        case "modifier": firm.impactOccurred()
        default: return
        }
    }
}
