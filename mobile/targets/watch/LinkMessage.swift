import Foundation

// Foundation only, so scripts/check-watch-models.sh can compile and check it on a Mac.

/// The phone's hand-off: which backend to call and the revocable `bnw_` watch token for it.
struct WatchLinkInfo: Equatable, Sendable {
  let apiURL: URL
  let token: String
}

/// What the phone sent through WatchConnectivity `applicationContext`.
enum LinkMessage: Equatable, Sendable {
  /// `{"apiUrl": String, "token": String, "linkedAt": Double}`
  case link(WatchLinkInfo, stamp: Double)
  /// `{"unlink": true, "at": Double}`
  case unlink(stamp: Double)

  init?(context: [String: Any]) {
    if context["unlink"] as? Bool == true {
      self = .unlink(stamp: Self.number(context["at"]))
      return
    }
    guard let raw = context["apiUrl"] as? String, let url = URL(string: raw),
      let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
      let token = context["token"] as? String, !token.isEmpty
    else { return nil }
    self = .link(WatchLinkInfo(apiURL: url, token: token), stamp: Self.number(context["linkedAt"]))
  }

  var stamp: Double {
    switch self {
    case .link(_, let stamp), .unlink(let stamp): return stamp
    }
  }

  /// receivedApplicationContext is redelivered at every activation, including a link the server has since rejected,
  /// so only messages newer than the last one handled count. A missing stamp (0) cannot be ordered and always counts.
  func isNewer(than handled: Double?) -> Bool {
    guard stamp != 0, let handled else { return true }
    return stamp > handled
  }

  private static func number(_ value: Any?) -> Double {
    (value as? NSNumber)?.doubleValue ?? 0
  }
}
