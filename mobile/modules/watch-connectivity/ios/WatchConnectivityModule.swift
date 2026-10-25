import ExpoModulesCore
import WatchConnectivity

let onStateChange = "onStateChange"

/// Links the BuildNorth watch app: hands it the API address and a revocable watch token through
/// `updateApplicationContext` (the latest value wins and arrives even while the watch app is closed).
/// BuildNorth doesn't store the token on the phone; the watch keeps it in its own Keychain. WCSession itself
/// keeps the last application context, token included, on the phone until the next link or unlink replaces it.
public class WatchConnectivityModule: Module {
  // WCSession holds its delegate weakly, so the module keeps it alive.
  private var sessionDelegate: SessionDelegate?

  public func definition() -> ModuleDefinition {
    Name("BuildNorthWatch")

    Events(onStateChange)

    OnCreate {
      guard WCSession.isSupported() else {
        return
      }
      let delegate = SessionDelegate { [weak module = self] session in
        module?.sendEvent(onStateChange, sessionState(session))
      }
      sessionDelegate = delegate
      WCSession.default.delegate = delegate
      WCSession.default.activate()
    }

    OnDestroy {
      // After a reload the new module may already have installed its own delegate; leave that one alone.
      if WCSession.isSupported() && WCSession.default.delegate === sessionDelegate {
        WCSession.default.delegate = nil
      }
      sessionDelegate = nil
    }

    Function("getState") { () -> [String: Bool] in
      sessionState(WCSession.isSupported() ? WCSession.default : nil)
    }

    AsyncFunction("sendLink") { (apiUrl: String, token: String) in
      try updateContext(["apiUrl": apiUrl, "token": token, "linkedAt": Date().timeIntervalSince1970])
    }

    AsyncFunction("unlink") {
      try updateContext(["unlink": true, "at": Date().timeIntervalSince1970])
    }
  }
}

// MARK: - Session

private func sessionState(_ session: WCSession?) -> [String: Bool] {
  guard let session else {
    return ["supported": false, "activated": false, "paired": false, "watchAppInstalled": false, "reachable": false]
  }
  // The other properties only hold real values once the session is activated.
  let activated = session.activationState == .activated
  return [
    "supported": true,
    "activated": activated,
    "paired": activated && session.isPaired,
    "watchAppInstalled": activated && session.isWatchAppInstalled,
    "reachable": activated && session.isReachable,
  ]
}

private func updateContext(_ context: [String: Any]) throws {
  guard WCSession.isSupported() else {
    throw WatchUnsupportedException()
  }
  let session = WCSession.default
  guard session.activationState == .activated else {
    throw WatchSessionInactiveException()
  }
  guard session.isPaired else {
    throw WatchNotPairedException()
  }
  guard session.isWatchAppInstalled else {
    throw WatchAppNotInstalledException()
  }
  do {
    try session.updateApplicationContext(context)
  } catch {
    throw WatchContextUpdateException().causedBy(error)
  }
}

/// Reports every state change. WCSession calls it on its own serial background queue.
private final class SessionDelegate: NSObject, WCSessionDelegate {
  private let onChange: (WCSession) -> Void

  init(onChange: @escaping (WCSession) -> Void) {
    self.onChange = onChange
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    onChange(session)
  }

  func sessionDidBecomeInactive(_ session: WCSession) {
    onChange(session)
  }

  func sessionDidDeactivate(_ session: WCSession) {
    // The user switched to another Apple Watch: activate again so the newly selected one can be linked.
    session.activate()
    onChange(session)
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    onChange(session)
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    onChange(session)
  }
}

// MARK: - Exceptions (JS sees them as `code`, e.g. ERR_WATCH_NOT_PAIRED)

internal final class WatchUnsupportedException: Exception, @unchecked Sendable {
  override var reason: String {
    "This device can't pair with an Apple Watch"
  }
}

internal final class WatchSessionInactiveException: Exception, @unchecked Sendable {
  override var reason: String {
    "The connection to Apple Watch isn't ready yet"
  }
}

internal final class WatchNotPairedException: Exception, @unchecked Sendable {
  override var reason: String {
    "No Apple Watch is paired with this iPhone"
  }
}

internal final class WatchAppNotInstalledException: Exception, @unchecked Sendable {
  override var reason: String {
    "The Rhythm watch app isn't installed on the paired Apple Watch"
  }
}

internal final class WatchContextUpdateException: Exception, @unchecked Sendable {
  override var reason: String {
    "Couldn't send the update to Apple Watch"
  }
}
