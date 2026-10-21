import Foundation
import WatchConnectivity

/// Receives the phone's link hand-off. The latest applicationContext is delivered even when the watch app was not
/// running, and `receivedApplicationContext` still holds it at the next activation, so both are checked.
final class WatchLink: NSObject, WCSessionDelegate, @unchecked Sendable {
  // Immutable after init; WCSession calls the delegate on a background queue.
  private let onMessage: @Sendable (LinkMessage) -> Void

  init(onMessage: @escaping @Sendable (LinkMessage) -> Void) {
    self.onMessage = onMessage
    super.init()
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  /// Hands the phone's latest context over again, so a link that couldn't be saved is retried without a relaunch.
  func redeliver() {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
    deliver(WCSession.default.receivedApplicationContext)
  }

  func session(
    _ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?
  ) {
    guard activationState == .activated else { return }
    deliver(session.receivedApplicationContext)
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    deliver(applicationContext)
  }

  private func deliver(_ context: [String: Any]) {
    guard !context.isEmpty, let message = LinkMessage(context: context) else { return }
    onMessage(message)
  }
}
