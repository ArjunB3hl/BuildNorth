import SwiftUI
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
struct NorthAssistantApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

  var body: some Scene {
    Window("Rhythm · Demo version", id: "main") {
      ReactNativeView(factory: appDelegate.reactNativeFactory)
        // Room for the sidebar plus a readable content column.
        .frame(minWidth: 900, minHeight: 600)
    }
    .defaultSize(width: 1200, height: 800)
  }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
  private let reactNativeDelegate: ReactNativeDelegate
  let reactNativeFactory: RCTReactNativeFactory

  override init() {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    // Stored `let` properties must be set before super.init().
    reactNativeDelegate = delegate
    reactNativeFactory = factory

    super.init()
  }
}

// MARK: - React Native Delegate

/// Metro (started by `expo start`) runs on 8090 instead of the default 8081 so it doesn't
/// clash with the BuildNorth Expo dev server. Keep in sync with the `start` script in package.json.
private let metroPort = 8090

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    let settings = RCTBundleURLProvider.sharedSettings()
    settings.jsLocation = "localhost:\(metroPort)"
    // Expo CLI's entry point; it resolves to index.js.
    return settings.jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

// MARK: - React Native SwiftUI View

struct ReactNativeView: NSViewRepresentable {
  let factory: RCTReactNativeFactory

  func makeNSView(context: Context) -> NSView {
    factory.rootViewFactory.view(withModuleName: "NorthAssistant")
  }

  func updateNSView(_ nsView: NSView, context: Context) {}
}
