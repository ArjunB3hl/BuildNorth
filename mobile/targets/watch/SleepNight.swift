import Foundation

enum SleepStage: String, CaseIterable, Sendable {
  case core = "Core", deep = "Deep", rem = "REM", unspecified = "Asleep", awake = "Awake"
}

struct SleepSample: Sendable {
  let stage: SleepStage
  let start: Date
  let end: Date
}

struct SleepSummary: Identifiable, Sendable {
  let day: Date
  let minutes: Int?
  let startedAt: Date?
  let endedAt: Date?
  let stages: [SleepStage: Int]
  var id: Date { day }

  init(day: Date, samples: [SleepSample], window: DateInterval) {
    self.day = day
    let asleep = samples.filter {
      $0.stage != .awake && $0.start < $0.end && $0.start < window.end && $0.end > window.start
    }
    minutes = SleepNight.asleepMinutes(asleep.map { ($0.start, $0.end) }, in: window)
    startedAt = asleep.map { max($0.start, window.start) }.min()
    endedAt = asleep.map { min($0.end, window.end) }.max()
    // Each stage merges duplicate sources independently. Stage totals can overlap between sources,
    // so the UI presents durations separately rather than a misleading stacked percentage.
    stages = Dictionary(uniqueKeysWithValues: SleepStage.allCases.compactMap { stage in
      SleepNight.asleepMinutes(samples.filter { $0.stage == stage }.map { ($0.start, $0.end) }, in: window)
        .map { (stage, $0) }
    })
  }
}

// Foundation only, so scripts/check-watch-models.sh can compile and check it on a Mac. HealthSync reads the samples.

/// Asleep time for the night that ended on a given local day.
enum SleepNight {
  static func display(minutes: Int) -> String {
    let hours = minutes / 60
    let remainder = minutes % 60
    return hours > 0 ? "\(hours) h \(remainder) min" : "\(remainder) min"
  }

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
