import Foundation
import Observation
import WatchKit

/// Result of the last HealthKit upload, kept across launches for the Today and Health screens.
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

  private(set) var calendarEntries: [CalendarEntry] = []
  private(set) var calendarError: String?
  private(set) var calendarLoading = false
  @ObservationIgnored private var calendarRequest = UUID()

  private(set) var today: WatchToday?
  private(set) var todayLoadedAt: Date?
  private(set) var isLoading = false
  /// Last load failure; the previous `today` (possibly cached) stays on screen.
  private(set) var loadError: String?
  private(set) var busyItemIDs: Set<String> = []
  /// Failure of a plan action, shown as an alert on Today.
  var actionError: String?
  var showsActionError: Bool {
    get { actionError != nil }
    set { if !newValue { actionError = nil } }
  }

  private(set) var healthAccess: HealthAccess = .notRequested
  private(set) var isSyncingHealth = false
  private(set) var lastUpload: HealthUploadStatus?

  @ObservationIgnored private let health = HealthSync()
  @ObservationIgnored private var watchLink: WatchLink?
  @ObservationIgnored private var lastAutoSync: Date?

  private enum Keys {
    static let todayCache = "bn.todayCache"
    static let lastUpload = "bn.lastHealthUpload"
    static let lastCompleteDay = "bn.lastCompleteHealthDay"
    static let handledStamp = "bn.handledLinkStamp"
  }

  private struct TodayCache: Codable {
    let today: WatchToday
    let loadedAt: Date
  }

  /// Loads the stored link and starts listening to the phone. Safe to call more than once.
  func start() {
    guard watchLink == nil else { return }
    link = TokenStore.load()
    if link != nil { restoreCache() }
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

  /// Launch and every return to the foreground: refresh Today (at most once a minute) and upload Health summaries
  /// (at most every 10 minutes).
  func becameActive() {
    start()
    if linkError != nil { watchLink?.redeliver() }
    guard link != nil else { return }
    Task {
      if todayLoadedAt.map({ Date().timeIntervalSince($0) > 60 }) ?? true || today?.date != LocalDay.string() {
        await refresh()
      }
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
      linkError = "Couldn't save the link from your iPhone. Unlock your watch and reopen BuildNorth to try again."
      return false
    }
    clearLocalData()
    link = info
    unlinkReason = nil
    linkError = nil
    Task {
      await refresh()
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
    calendarRequest = UUID()
    calendarEntries = []
    calendarError = nil
    calendarLoading = false
    today = nil
    todayLoadedAt = nil
    loadError = nil
    actionError = nil
    busyItemIDs = []
    lastUpload = nil
    lastAutoSync = nil
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

  func refreshCalendar(date: String) async {
    let request = UUID()
    calendarRequest = request
    calendarEntries = []
    calendarError = nil
    guard let link else { return }
    calendarLoading = true
    defer { if calendarRequest == request { calendarLoading = false } }
    do {
      let entries = try await APIClient(link: link).calendar(date: date)
      guard link == self.link, calendarRequest == request else { return }
      calendarEntries = entries
    } catch {
      guard link == self.link, calendarRequest == request else { return }
      calendarError = message(for: error, using: link)
    }
  }

  // MARK: Today

  /// One load at a time. When the link changes while a load is in flight (the phone re-linked), this same call
  /// loads again with the new link, since the refresh started for that link returned at the `isLoading` guard.
  func refresh() async {
    guard !isLoading else { return }
    isLoading = true
    defer { isLoading = false }
    while let link {
      await load(using: link)
      if link == self.link { return }
    }
  }

  private func load(using link: WatchLinkInfo) async {
    do {
      let fresh = try await APIClient(link: link).today(date: LocalDay.string())
      guard link == self.link else { return }
      today = fresh
      todayLoadedAt = Date()
      loadError = nil
      saveCache()
    } catch {
      guard link == self.link else { return }
      loadError = message(for: error, using: link)
    }
  }

  func setStatus(_ item: PlanItem, to status: PlanStatus) async {
    guard let link, !busyItemIDs.contains(item.id) else { return }
    busyItemIDs.insert(item.id)
    defer { busyItemIDs.remove(item.id) }
    do {
      let updated = try await APIClient(link: link).setStatus(itemID: item.id, status: status)
      guard link == self.link else { return }
      if let index = today?.items.firstIndex(where: { $0.id == updated.id }) { today?.items[index] = updated }
      saveCache()
      WKInterfaceDevice.current().play(status == .planned ? .click : .success)
    } catch {
      guard link == self.link else { return }
      if error as? APIError == .notFound { today?.items.removeAll { $0.id == item.id } }
      if let text = message(for: error, using: link) {
        actionError = text
        WKInterfaceDevice.current().play(.failure)
      }
    }
  }

  /// Saves today's check-in. Returns an error message, or nil once it is saved (or the watch was unlinked).
  func saveCheckIn(_ patch: CheckInPatch) async -> String? {
    guard let link else { return nil }
    let date = LocalDay.string()
    do {
      let saved = try await APIClient(link: link).saveCheckIn(date: date, patch: patch)
      guard link == self.link else { return nil }
      if today?.date == saved.date { today?.checkIn = saved }
      saveCache()
      WKInterfaceDevice.current().play(.success)
      return nil
    } catch {
      let text = message(for: error, using: link)
      if text != nil { WKInterfaceDevice.current().play(.failure) }
      return text
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

  /// Sleep for the night that ended today, read on the watch; pre-fills the check-in. Nil while health sharing is
  /// off: a check-in's sleep reaches the Coach and connected assistants, which must not see HealthKit data then.
  func sleepHoursFromHealth() async -> Double? {
    guard today?.shareHealth == true else { return nil }
    if healthAccess != .requested { await refreshHealthAccess() }
    var minutes = today?.health?.sleepMinutes
    if healthAccess == .requested, let measured = try? await health.sleepMinutes(nightEndingOn: Date()) {
      minutes = measured
    }
    // A refresh may have landed while HealthKit was answering.
    guard today?.shareHealth == true, let minutes else { return nil }
    return Double(minutes) / 60
  }

  /// The newest finished day the server accepted with `complete: true`; the next sync catches up from the day after.
  private var lastCompleteDay: String? {
    get { UserDefaults.standard.string(forKey: Keys.lastCompleteDay) }
    set { UserDefaults.standard.set(newValue, forKey: Keys.lastCompleteDay) }
  }

  /// Uploads the finished days not yet sent complete (see HealthBackfill) and today so far. Automatic syncs never
  /// show the HealthKit prompt.
  /// One sync at a time; like `refresh()`, a link that changes mid-sync is synced again by the same call.
  func syncHealth(manual: Bool) async {
    guard link != nil, !isSyncingHealth else { return }
    if !manual, let last = lastAutoSync, Date().timeIntervalSince(last) < 10 * 60 { return }
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
      lastAutoSync = Date()
      await upload(using: link, manual: manual)
      if link == self.link { return }
    }
  }

  private func upload(using link: WatchLinkInfo, manual: Bool) async {
    do {
      let days = try await health.summaries(for: HealthBackfill.days(after: lastCompleteDay))
        .filter { !$0.summary.isEmpty }
      guard link == self.link else { return }
      guard !days.isEmpty else {
        // HealthKit hides denied reads, so denied access looks the same as no data.
        record(.noData, "No Health data for yesterday or today. Check Health access in Settings.")
        return
      }
      let client = APIClient(link: link)
      // Oldest first, and progress is kept per day, so a failed upload resumes from the first day it didn't send.
      for (day, summary) in days {
        let saved = try await client.uploadHealth(date: day.date, day: summary)
        guard link == self.link else { return }
        lastCompleteDay = HealthBackfill.lastComplete(lastCompleteDay, afterSending: day)
        if today?.date == saved.date { today?.health = saved }
      }
      saveCache()
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
      if healthAccess != .requested { await requestHealthAccess() }
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

  // MARK: Cache

  private func saveCache() {
    guard let today, let todayLoadedAt else { return }
    Self.encode(TodayCache(today: today, loadedAt: todayLoadedAt), forKey: Keys.todayCache)
  }

  /// Shows the last Today from this same local day while offline.
  private func restoreCache() {
    guard let cache = Self.decode(TodayCache.self, forKey: Keys.todayCache), cache.today.date == LocalDay.string()
    else { return }
    today = cache.today
    todayLoadedAt = cache.loadedAt
  }

  private static func encode(_ value: some Encodable, forKey key: String) {
    if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: key) }
  }

  private static func decode<T: Decodable>(_ type: T.Type, forKey key: String) -> T? {
    UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(type, from: $0) }
  }
}
