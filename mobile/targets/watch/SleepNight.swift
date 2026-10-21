import Foundation

// Foundation only, so scripts/check-watch-models.sh can compile and check it on a Mac. HealthSync reads the samples.

/// Asleep time for the night that ended on a given local day.
enum SleepNight {
  /// 18:00 the previous day to 12:00 on `day`, in `calendar`'s time zone.
  static func window(endingOn day: Date, calendar: Calendar = .current) -> DateInterval? {
    let start = calendar.startOfDay(for: day)
    guard let previous = calendar.date(byAdding: .day, value: -1, to: start),
      let windowStart = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: previous),
      let windowEnd = calendar.date(bySettingHour: 12, minute: 0, second: 0, of: start),
      windowStart < windowEnd
    else { return nil }
    return DateInterval(start: windowStart, end: windowEnd)
  }

  /// Whole minutes covered by `intervals` inside `window`. Overlapping samples from several sources are merged so time
  /// is never counted twice. Nil when nothing falls inside the window; at most 1440, like the backend accepts.
  static func asleepMinutes(_ intervals: [(start: Date, end: Date)], in window: DateInterval) -> Int? {
    let clipped =
      intervals
      .map { (start: max($0.start, window.start), end: min($0.end, window.end)) }
      .filter { $0.start < $0.end }
      .sorted { $0.start < $1.start }
    guard var current = clipped.first else { return nil }

    var total: TimeInterval = 0
    for next in clipped.dropFirst() {
      if next.start <= current.end {
        current.end = max(current.end, next.end)
      } else {
        total += current.end.timeIntervalSince(current.start)
        current = next
      }
    }
    total += current.end.timeIntervalSince(current.start)
    return min(Int((total / 60).rounded()), 1440)
  }
}
