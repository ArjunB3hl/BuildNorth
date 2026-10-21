import AppKit
import ExpoModulesCore

/// Mac features the Expo SDK doesn't cover, written with the same Expo Modules API
/// used for iOS modules.
public class NorthMacModule: Module {
  /// Held while "keep awake" is on; ending it lets the display sleep again.
  private var awakeActivity: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("NorthMac")

    /// file:// URL of ~/Library/Application Support/<bundle id>, created if needed. The app keeps its
    /// data here rather than in Expo's document directory, which for an unsandboxed Mac app is
    /// ~/Documents (often synced to iCloud). It's a URL, not a path, because expo-sqlite runs the
    /// directory through URL(string:): a plain path with a space ("Application Support") would come
    /// back percent-encoded and create a folder literally named "Application%20Support".
    Constant("appDataDirectoryUri") { () -> String? in
      guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
        return nil
      }
      let dir = base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "BuildNorth", isDirectory: true)
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      return dir.absoluteString
    }

    /// Text on the app's Dock icon, or nil to clear it.
    AsyncFunction("setDockBadge") { (label: String?) in
      NSApplication.shared.dockTile.badgeLabel = label
    }
    .runOnQueue(.main)

    /// Stops the display sleeping (e.g. while cooking). expo-keep-awake compiles for macOS
    /// but is a no-op there, so this does the Mac version with ProcessInfo activities.
    AsyncFunction("setKeepAwake") { (enabled: Bool, reason: String?) in
      if enabled, self.awakeActivity == nil {
        self.awakeActivity = ProcessInfo.processInfo.beginActivity(
          options: [.idleDisplaySleepDisabled, .userInitiated],
          reason: reason ?? "Keeping the display on"
        )
      } else if !enabled, let activity = self.awakeActivity {
        ProcessInfo.processInfo.endActivity(activity)
        self.awakeActivity = nil
      }
    }
    .runOnQueue(.main)

    OnDestroy {
      if let activity = self.awakeActivity {
        ProcessInfo.processInfo.endActivity(activity)
      }
    }

    /// SF Symbols rendered by AppKit, the Mac counterpart of expo-symbols (which is iOS-only).
    View(NorthSymbolView.self) {
      Prop("name") { (view: NorthSymbolView, name: String) in
        view.symbolName = name
      }
      Prop("color") { (view: NorthSymbolView, color: NSColor?) in
        view.tint = color
      }
      Prop("size") { (view: NorthSymbolView, size: Double?) in
        view.pointSize = size ?? 15
      }
      Prop("weight") { (view: NorthSymbolView, weight: String?) in
        view.weight = weight ?? "regular"
      }
    }
  }
}

final class NorthSymbolView: ExpoView {
  private let imageView = NSImageView()

  var symbolName = "questionmark" { didSet { updateImage() } }
  var tint: NSColor? { didSet { imageView.contentTintColor = tint } }
  var pointSize: Double = 15 { didSet { updateImage() } }
  var weight = "regular" { didSet { updateImage() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    imageView.imageScaling = .scaleProportionallyDown
    imageView.imageAlignment = .alignCenter
    imageView.frame = bounds
    imageView.autoresizingMask = [.width, .height]
    addSubview(imageView)
    updateImage()
  }

  private func updateImage() {
    let config = NSImage.SymbolConfiguration(
      pointSize: CGFloat(pointSize),
      weight: Self.weights[weight] ?? .regular
    )
    imageView.image = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil)?
      .withSymbolConfiguration(config)
  }

  private static let weights: [String: NSFont.Weight] = [
    "light": .light,
    "regular": .regular,
    "medium": .medium,
    "semibold": .semibold,
    "bold": .bold,
  ]
}
