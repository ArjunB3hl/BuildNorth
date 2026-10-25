import Foundation
import Observation
import WatchKit

/// Result of the last HealthKit upload, kept across launches for the monitoring screens.
struct HealthUploadStatus: Codable, Equatable {
  enum Outcome: String, Codable {
    case sent, noData, failed
  }

  let at: Date
  let outcome: Outcome
  let message: String
}

@MainActor
@Observable
final class AppModel {
  private(set) var link: WatchLinkInfo?
  /// Why the watch is not linked any more (the server rejected the token), shown on NotLinkedView.
  private(set) var unlinkReason: String?
  /// A link from the phone that couldn't be saved on this watch. Its message stays unhandled and is tried again.
  private(set) var linkError: String?

  private(set) var nights: [SleepSummary] = []
  private(set) var isLoadingSleep = false
  private(set) var sleepError: String?
  let workout = WorkoutMonitor()

  private(set) var healthAccess: HealthAccess = .notRequested
  private(set) var isSyncingHealth = false
  private(set) var lastUpload: HealthUploadStatus?

  @ObservationIgnored private let health = HealthSync()
  @ObservationIgnored private var watchLink: WatchLink?
  @ObservationIgnored private var lastAutoSync: Date?
  @ObservationIgnored private var pendingHealthSync = false
  @ObservationIgnored private var isValidatingLink = false
  @ObservationIgnored private var lastLinkValidation: Date?

  private enum Keys {
    static let todayCache = "bn.todayCache"
    static let lastUpload = "bn.lastHealthUpload"
    static let lastCompleteDay = "bn.lastCompleteHealthDay"
    static let handledStamp = "bn.handledLinkStamp"
  }

  /// Loads the stored link and starts listening to the phone. Safe to call more than once.
  func start() {
    guard watchLink == nil else { return }
    link = TokenStore.load()
    UserDefaults.standard.removeObject(forKey: Keys.todayCache)
    lastUpload = Self.decode(HealthUploadStatus.self, forKey: Keys.lastUpload)

    #if DEBUG
      // Simulator testing without a paired phone:
      // SIMCTL_CHILD_BN_API_URL=… SIMCTL_CHILD_BN_WATCH_TOKEN=… xcrun simctl launch <watch> <bundle id>
      let env = ProcessInfo.processInfo.environment
      if let raw = env["BN_API_URL"], let url = URL(string: raw), let token = env["BN_WATCH_TOKEN"], !token.isEmpty {
        setLink(WatchLinkInfo(apiURL: url, token: token))
      }
    #endif

    let watchLink = WatchLink { [weak self] message in
      Task { @MainActor in self?.receive(message) }
    }
    self.watchLink = watchLink
    watchLink.activate()
  }

  /// Refresh locally recorded sleep and upload summaries without interrupting a running workout.
  func becameActive() {
    start()
    if linkError != nil { watchLink?.redeliver() }
    guard link != nil else { return }
    Task {
      await refreshSleep()
      await validateLink()
      await syncHealth(manual: false)
    }
  }

  // MARK: Linking

  private func receive(_ message: LinkMessage) {
    guard message.isNewer(than: UserDefaults.standard.object(forKey: Keys.handledStamp) as? Double) else { return }
    switch message {
    case .link(let info, _):
      // Left unhandled when the token can't be saved, so the next activation (or foreground) tries it again.
      guard setLink(info) else { return }
    case .unlink:
      linkError = nil
      clearLink(reason: nil)
    }
    UserDefaults.standard.set(message.stamp, forKey: Keys.handledStamp)
  }

  /// Saves `info` and switches to it. Returns false, keeping the current link, when the Keychain write fails: a link
  /// that only lives in memory would be gone at the next launch while its message counts as handled.
  @discardableResult
  private func setLink(_ info: WatchLinkInfo) -> Bool {
    guard info != link else {
      linkError = nil
      return true
    }
    guard TokenStore.save(info) else {
      linkError = "Couldn't save the link from your iPhone. Unlock your watch and reopen Rhythm to try again."
      return false
    }
    clearLocalData()
    link = info
    unlinkReason = nil
    linkError = nil
    Task {
      await refreshSleep()
      await validateLink()
      await syncHealth(manual: false)
    }
    return true
  }

  private func clearLink(reason: String?) {
    TokenStore.clear()
    clearLocalData()
    link = nil
    unlinkReason = reason
  }

  private func clearLocalData() {
    nights = []
    sleepError = nil
    workout.reset()
    lastUpload = nil
    lastAutoSync = nil
    pendingHealthSync = false
    lastLinkValidation = nil
    UserDefaults.standard.removeObject(forKey: Keys.todayCache)
    UserDefaults.standard.removeObject(forKey: Keys.lastUpload)
    UserDefaults.standard.removeObject(forKey: Keys.lastCompleteDay)
    // APIClient no longer writes to it; this drops responses an earlier build left in the shared on-disk cache.
    URLCache.shared.removeAllCachedResponses()
  }

  /// A user-facing message for `error`, or nil when there is nothing to show. A 401 for the current link
  /// unlinks the watch (a request made with an older token says nothing about the new one).
  private func message(for error: Error, using used: WatchLinkInfo) -> String? {
    if error is CancellationError { return nil }
    if let api = error as? APIError {
      if api == .unauthorized {
        if used == link { clearLink(reason: api.errorDescription) }
        return nil
      }
      return api.errorDescription
    }
    return HealthSync.message(for: error) ?? "Something went wrong. Try again."
  }

  // MARK: Sleep

  private func validateLink() async {
    guard !isValidatingLink else { return }
    if let lastLinkValidation, Date().timeIntervalSince(lastLinkValidation) < 60 { return }
    isValidatingLink = true
    defer { isValidatingLink = false }
    while let used = link {
      do {
        try await APIClient(link: used).validateLink()
        guard used == link else { continue }
        lastLinkValidation = Date()
      } catch {
        guard used == link else { continue }
        // Offline monitoring remains available; only an explicit 401 signs the watch out.
        _ = message(for: error, using: used)
      }
      return
    }
  }

  func refreshSleep() async {
    guard link != nil, !isLoadingSleep else { return }
    isLoadingSleep = true
    defer { isLoadingSleep = false }
    // A new phone account can arrive while HealthKit is answering. Never keep the old request's results.
    while let used = link {
      await refreshHealthAccess()
      guard healthAccess == .requested else { return }
      do {
        let fresh = try await health.sleepHistory()
        guard used == link else { continue }
        nights = fresh
        sleepError = nil
      } catch {
        guard used == link else { continue }
        sleepError = HealthSync.message(for: error) ?? "Couldn't load sleep. Try again."
      }
      return
    }
  }

  // MARK: Health

  func refreshHealthAccess() async {
    healthAccess = await health.access()
  }

  func requestHealthAccess() async {
    do {
      try await health.requestAccess()
    } catch {
      record(.failed, HealthSync.message(for: error) ?? "Couldn't ask for Health access.")
    }
    await refreshHealthAccess()
  }

  /// The newest finished day the server accepted with `complete: true`; the next sync catches up from the day after.
  private var lastCompleteDay: String? {
    get { UserDefaults.standard.string(forKey: Keys.lastCompleteDay) }
    set { UserDefaults.standard.set(newValue, forKey: Keys.lastCompleteDay) }
  }

  /// Uploads the finished days not yet sent complete (see HealthBackfill) and today so far. Automatic syncs never
  /// show the HealthKit prompt.
  /// One sync at a time; like `refreshSleep()`, a link that changes mid-sync is synced again by the same call.
  func syncHealth(manual: Bool, force: Bool = false) async {
    guard link != nil else { return }
    if force { pendingHealthSync = true }
    guard !isSyncingHealth else { return }
    if !manual, !force, let last = lastAutoSync, Date().timeIntervalSince(last) < 10 * 60 { return }
    await refreshHealthAccess()
    switch healthAccess {
    case .unavailable:
      if manual { record(.failed, "Health data isn't available on this device.") }
      return
    case .notRequested:
      guard manual else { return }
      await requestHealthAccess()
      guard healthAccess == .requested else { return }
    case .requested:
      break
    }

    // The access checks above can suspend, so another sync may have started meanwhile.
    guard !isSyncingHealth else { return }
    isSyncingHealth = true
    defer { isSyncingHealth = false }
    while let link {
      pendingHealthSync = false
      lastAutoSync = Date()
      await upload(using: link, manual: manual)
      if link == self.link && !pendingHealthSync { return }
    }
  }

  private func upload(using link: WatchLinkInfo, manual: Bool) async {
    do {
      let days = try await health.summaries(for: HealthBackfill.days(after: lastCompleteDay))
        .filter { !$0.summary.isEmpty }
      guard link == self.link else { return }
      guard !days.isEmpty else {
        // HealthKit hides denied reads, so denied access looks the same as no data.
        record(.noData, "No sleep or workout data yet. Check Health access in Settings.")
        return
      }
      let client = APIClient(link: link)
      // Oldest first, and progress is kept per day, so a failed upload resumes from the first day it didn't send.
      for (day, summary) in days {
        _ = try await client.uploadHealth(date: day.date, day: summary)
        guard link == self.link else { return }
        lastCompleteDay = HealthBackfill.lastComplete(lastCompleteDay, afterSending: day)
      }
      record(.sent, HealthBackfill.sentMessage(days.map(\.day)))
      if manual { WKInterfaceDevice.current().play(.success) }
    } catch {
      guard link == self.link, let text = message(for: error, using: link) else { return }
      record(.failed, text)
      if manual { WKInterfaceDevice.current().play(.failure) }
    }
  }

  #if DEBUG && targetEnvironment(simulator)
    func addSampleHealthData() async {
      // Debug sample writes need separate permission even if read access was already requested.
      await requestHealthAccess()
      do {
        try await health.saveSampleData()
        await syncHealth(manual: true)
      } catch {
        record(.failed, "Couldn't save sample data: \(error.localizedDescription)")
      }
    }
  #endif

  private func record(_ outcome: HealthUploadStatus.Outcome, _ message: String) {
    let status = HealthUploadStatus(at: Date(), outcome: outcome, message: message)
    lastUpload = status
    Self.encode(status, forKey: Keys.lastUpload)
  }

  private static func encode(_ value: some Encodable, forKey key: String) {
    if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: key) }
  }

  private static func decode<T: Decodable>(_ type: T.Type, forKey key: String) -> T? {
    UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(type, from: $0) }
  }
}
