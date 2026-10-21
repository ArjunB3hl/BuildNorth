import SwiftUI

@main
struct BuildNorthWatchApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
    }
  }
}

struct RootView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    Group {
      // Separate stacks, so unlinking drops whatever screen was pushed.
      if model.link == nil {
        NavigationStack {
          NotLinkedView()
        }
      } else {
        NavigationStack {
          TodayView()
        }
      }
    }
    .onChange(of: scenePhase, initial: true) { _, phase in
      if phase == .active { model.becameActive() }
    }
  }
}
