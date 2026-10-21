import Foundation

// Foundation only, so scripts/check-watch-models.sh can compile and check it on a Mac. HealthSync reads the days.

/// Which local days a Health sync uploads. The watch only syncs while the app is open, so a day whose last upload
/// was "so far" (`complete: false`) is sent again, complete, at the next sync, however many days later.
enum HealthBackfill {
  /// At most this many finished days per sync, well inside the backend's 31-day window.
  static let maxDays = 7

  struct Day: Equatable, Sendable {
    /// Local `YYYY-MM-DD`.
    let date: String
    /// Local start of that day.
    let start: Date
    /// 0 is today.
    let daysAgo: Int

    /// Finished days are sent with `complete: true`, today with `complete: false`.
    var complete: Bool { daysAgo > 0 }
  }

  /// Oldest first: every finished day after `lastComplete` up to yesterday (the newest `maxDays` of them), then today.
  /// Yesterday is always included, which is all a first sync sends, so samples that reach HealthKit late (an
  /// iPhone's steps, a resting heart rate written after midnight) still land.
  static func days(after lastComplete: String?, now: Date = Date(), calendar: Calendar = .current) -> [Day] {
    let today = calendar.startOfDay(for: now)
    let last = lastComplete.flatMap { LocalDay.date(from: $0, calendar: calendar) }
    var days: [Day] = []
    for daysAgo in 0...maxDays {
      guard let shifted = calendar.date(byAdding: .day, value: -daysAgo, to: today) else { break }
      // Where DST skips midnight a day starts at 01:00, so take each day's own start.
      let start = calendar.startOfDay(for: shifted)
      if daysAgo > 1 {
        guard let last, start > last else { break }
      }
      days.append(Day(date: LocalDay.string(from: start, calendar: calendar), start: start, daysAgo: daysAgo))
    }
    return days.reversed()
  }

  /// The newest finished day sent complete, once `day` was accepted. Today doesn't count, and it never goes back.
  static func lastComplete(_ last: String?, afterSending day: Day) -> String? {
    guard day.complete else { return last }
    guard let last else { return day.date }
    return max(last, day.date)  // YYYY-MM-DD sorts by date
  }

  /// "Sent yesterday and today.", "Sent 3 past days and today."…
  static func sentMessage(_ sent: [Day]) -> String {
    let finished = sent.filter(\.complete)
    var names: [String] = []
    if finished.count == 1 {
      names.append(finished[0].daysAgo == 1 ? "yesterday" : "1 past day")
    } else if finished.count > 1 {
      names.append("\(finished.count) past days")
    }
    if sent.contains(where: { !$0.complete }) { names.append("today") }
    return "Sent \(names.joined(separator: " and "))."
  }
}
