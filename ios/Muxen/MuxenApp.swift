import SwiftUI

@main
@MainActor
struct MuxenApp: App {
    @StateObject private var model = MuxenAppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            MuxenRootView(model: model)
                .onChange(of: scenePhase, initial: true) { _, phase in model.sceneChanged(phase) }
                .onOpenURL { model.openAddServerURL($0) }
        }
    }
}
