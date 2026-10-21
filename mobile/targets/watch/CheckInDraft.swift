import Foundation

// Foundation only, so scripts/check-watch-models.sh can compile and check it on a Mac. CheckInView edits it.

/// The check-in form. It starts from today's saved check-in and decides what the sleep page sends, so a check-in made
/// on the watch never clears sleep it didn't show (say, hours entered on the phone after Today was loaded).
struct CheckInDraft: Equatable, Sendable {
  /// Where the sleep on screen when the form opened came from.
  enum SleepSource: Equatable, Sendable {
    /// Nothing known: the page starts at "Not recorded".
    case none
    /// Today's saved check-in.
    case stored
    /// HealthKit's measurement for last night.
    case health
  }

  var energy = 3.0
  var mood = 3.0
  /// The sleep page's picker; sent only while `recordSleep` is on.
  var sleep = 7.0
  private(set) var recordSleep = false
  private(set) var sleepSource = SleepSource.none
  /// The user added or removed sleep on the sleep page.
  private(set) var sleepEdited = false
  /// Health sharing as Today reported it. A check-in's sleep reaches the Coach and connected assistants, so with
  /// sharing off HealthKit's measurement is never pre-filled; the user can still enter sleep themselves.
  let shareHealth: Bool

  init(today: WatchToday?, date: String) {
    shareHealth = today?.shareHealth == true
    guard let existing = today?.checkIn, existing.date == date else { return }
    energy = Double(existing.energy)
    mood = Double(existing.mood)
    if let hours = existing.sleepHours {
      sleep = hours
      recordSleep = true
      sleepSource = .stored
    }
  }

  /// Whether to ask HealthKit for last night: sharing is on and nothing is on the sleep page yet.
  var wantsHealthSleep: Bool {
    shareHealth && sleepSource == .none && !recordSleep && !sleepEdited
  }

  /// Never overwrites sleep the user added or removed while HealthKit was answering.
  mutating func prefillSleep(fromHealth hours: Double?) {
    guard let hours, wantsHealthSleep else { return }
    sleep = min(24, Self.halfHours(hours))
    recordSleep = true
    sleepSource = .health
  }

  /// "Add sleep" and "Don't record sleep".
  mutating func setRecordSleep(_ on: Bool) {
    recordSleep = on
    sleepEdited = true
  }

  /// Sleep on screen is sent. "Don't record sleep" on a saved value clears it; anything else leaves `sleepHours` out.
  /// A HealthKit pre-fill is only offered when nothing is saved, so removing it has nothing to clear.
  var sleepChange: SleepChange {
    if recordSleep { return .hours(Self.halfHours(sleep)) }
    return sleepSource == .stored ? .clear : .keep
  }

  var patch: CheckInPatch {
    CheckInPatch(energy: Int(energy.rounded()), mood: Int(mood.rounded()), sleep: sleepChange)
  }

  static func halfHours(_ hours: Double) -> Double {
    (hours * 2).rounded() / 2
  }
}
