import Foundation

// JSON shapes of the backend's /watch/* routes (camelCase keys). Dates and datetimes stay strings: calendar days
// are the user's local YYYY-MM-DD and the server never guesses a timezone.

enum PlanStatus: String, Codable, Sendable {
  case planned, done, skipped
}

struct PlanItem: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let date: String
  let kind: String  // "meal" | "activity"
  let title: String
  let timeSlot: String?  // "morning" | "midday" | "evening"
  let recipeId: String?
  let routineId: String?
  var status: PlanStatus
  var completedAt: String?
  let minutes: Int?
  let note: String?
  let source: String?
}

struct CheckIn: Codable, Equatable, Sendable {
  let date: String
  let energy: Int
  let mood: Int
  let sleepHours: Double?
  let note: String?
}

struct HealthWorkout: Codable, Equatable, Sendable {
  let externalId: String
  let activityType: String
  let startedAt: String  // ISO-8601, UTC
  let durationMinutes: Double
  let energyKcal: Double?
  let distanceMeters: Double?
  let averageHeartRateBpm: Double?
  var minHeartRateBpm: Double? = nil
  var maxHeartRateBpm: Double? = nil

  // Missing metrics are sent as null, never left out or replaced by 0.
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(externalId, forKey: .externalId)
    try c.encode(activityType, forKey: .activityType)
    try c.encode(startedAt, forKey: .startedAt)
    try c.encode(durationMinutes, forKey: .durationMinutes)
    try c.encode(energyKcal, forKey: .energyKcal)
    try c.encode(distanceMeters, forKey: .distanceMeters)
    try c.encode(averageHeartRateBpm, forKey: .averageHeartRateBpm)
    try c.encode(minHeartRateBpm, forKey: .minHeartRateBpm)
    try c.encode(maxHeartRateBpm, forKey: .maxHeartRateBpm)
  }
}

struct SleepPattern: Codable, Equatable, Sendable {
  var startedAt: String?
  var endedAt: String?
  var coreMinutes: Int?
  var deepMinutes: Int?
  var remMinutes: Int?
  var awakeMinutes: Int?
  var unspecifiedMinutes: Int?
}

/// Body of `PUT /watch/health/{date}`.
struct HealthDayIn: Encodable, Equatable, Sendable {
  var sleepMinutes: Int?
  var sleepPattern: SleepPattern? = nil
  var restingHeartRateBpm: Int?
  var hrvSdnnMs: Double?
  var steps: Int?
  var activeEnergyKcal: Double?
  var workouts: [HealthWorkout]
  var complete: Bool

  var isEmpty: Bool {
    sleepMinutes == nil && restingHeartRateBpm == nil && hrvSdnnMs == nil && steps == nil
      && activeEnergyKcal == nil && workouts.isEmpty
  }

  private enum CodingKeys: String, CodingKey {
    case sleepMinutes, sleepPattern, restingHeartRateBpm, hrvSdnnMs, steps, activeEnergyKcal, workouts, complete
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(sleepMinutes, forKey: .sleepMinutes)
    try c.encode(sleepPattern, forKey: .sleepPattern)
    try c.encode(restingHeartRateBpm, forKey: .restingHeartRateBpm)
    try c.encode(hrvSdnnMs, forKey: .hrvSdnnMs)
    try c.encode(steps, forKey: .steps)
    try c.encode(activeEnergyKcal, forKey: .activeEnergyKcal)
    try c.encode(workouts, forKey: .workouts)
    try c.encode(complete, forKey: .complete)
  }
}

/// `HealthDayOut`: what the server stored for one day.
struct HealthDay: Codable, Equatable, Sendable {
  let date: String
  let sleepMinutes: Int?
  let restingHeartRateBpm: Int?
  let hrvSdnnMs: Double?
  let steps: Int?
  let activeEnergyKcal: Double?
  let workouts: [HealthWorkout]
  let complete: Bool
  let source: String
  let memoryStatus: String  // "synced" | "pending" | "not_mirrored"
  let updatedAt: String
}

/// `GET /watch/today?date=`.
struct WatchToday: Codable, Equatable, Sendable {
  let date: String
  var items: [PlanItem]
  var checkIn: CheckIn?
  var health: HealthDay?
  let shareHealth: Bool
}

/// Body of `PATCH /watch/plan/{id}`.
struct PlanStatusPatch: Encodable, Sendable {
  let status: PlanStatus
}

/// What a check-in does to the stored sleep hours.
enum SleepChange: Equatable, Sendable {
  /// `sleepHours` is left out, so the stored value (perhaps entered on the phone) stays.
  case keep
  case hours(Double)
  /// An explicit null: the user removed sleep the form showed.
  case clear
}

/// Body of `PATCH /watch/checkins/{date}`. Omitted keys keep the stored values, so the watch never sends `note`.
struct CheckInPatch: Encodable, Sendable {
  let energy: Int
  let mood: Int
  let sleep: SleepChange

  private enum CodingKeys: String, CodingKey {
    case energy, mood, sleepHours
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(energy, forKey: .energy)
    try c.encode(mood, forKey: .mood)
    switch sleep {
    case .keep: break
    case .hours(let hours): try c.encode(hours, forKey: .sleepHours)
    case .clear: try c.encodeNil(forKey: .sleepHours)
    }
  }
}

enum LocalDay {
  /// Local calendar date `YYYY-MM-DD`, matching the phone's `localDate()`.
  static func string(from date: Date = Date(), calendar: Calendar = .current) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  static func date(from day: String, calendar: Calendar = .current) -> Date? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.date(from: day).map { calendar.startOfDay(for: $0) }
  }
}

/// Unified meals and movement journal, returned by GET /watch/calendar.
struct CalendarEntry: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let kind: String
  let title: String
  let localDate: String
  let localTime: String
  let durationMinutes: Int?
  let source: String
  let timeEstimated: Bool
}
