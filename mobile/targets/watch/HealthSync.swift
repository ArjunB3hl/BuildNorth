import Foundation
import HealthKit

enum HealthAccess: Equatable, Sendable {
  /// No HealthKit on this device.
  case unavailable
  case notRequested
  /// The user was asked. HealthKit never reveals whether reads were allowed: denied types just return no data.
  case requested
}

/// Daily summaries read from HealthKit on the watch. Only aggregates leave the device (`PUT /watch/health/{date}`);
/// missing metrics are null, never 0.
struct HealthSync: Sendable {
  private let store = HKHealthStore()

  static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

  static var readTypes: Set<HKObjectType> {
    [
      HKCategoryType(.sleepAnalysis),
      HKQuantityType(.heartRate),
      HKObjectType.workoutType(),
    ]
  }

  private static var shareTypes: Set<HKSampleType> {
    #if DEBUG && targetEnvironment(simulator)
      // Only for saveSampleData(): the simulator has no sensors.
      return [
        HKCategoryType(.sleepAnalysis),
      ]
    #else
      return []
    #endif
  }

  private static var bpm: HKUnit { .count().unitDivided(by: .minute()) }

  func access() async -> HealthAccess {
    guard Self.isAvailable else { return .unavailable }
    let status = try? await store.statusForAuthorizationRequest(toShare: [], read: Self.readTypes)
    return status == .unnecessary ? .requested : .notRequested
  }

  func requestAccess() async throws {
    try await store.requestAuthorization(toShare: Self.shareTypes, read: Self.readTypes)
  }

  /// The summaries for `days` (finished days `complete: true`, today `complete: false`), in the same order.
  func summaries(for days: [HealthBackfill.Day]) async throws -> [(day: HealthBackfill.Day, summary: HealthDayIn)] {
    var result: [(day: HealthBackfill.Day, summary: HealthDayIn)] = []
    // One day at a time: each summary already runs its sleep and workout queries together.
    for day in days {
      result.append((day, try await summary(for: day.start, complete: day.complete)))
    }
    return result
  }

  func summary(for day: Date, complete: Bool) async throws -> HealthDayIn {
    let calendar = Calendar.current
    let start = calendar.startOfDay(for: day)
    guard let end = calendar.date(byAdding: .day, value: 1, to: start) else {
      return HealthDayIn(workouts: [], complete: complete)
    }
    let inDay = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)

    async let sleep = sleepMinutes(nightEndingOn: start)
    async let workouts = workouts(matching: inDay)

    return HealthDayIn(
      sleepMinutes: try await sleep,
      workouts: try await workouts,
      complete: complete
    )
  }

  // MARK: Queries

  /// Asleep time (core, deep, REM, unspecified) between 18:00 the previous day and 12:00 on `day`. Overlapping samples
  /// from several sources are merged so time is never counted twice.
  func sleepMinutes(nightEndingOn day: Date) async throws -> Int? {
    guard let window = SleepNight.window(endingOn: day) else { return nil }
    let overlapping = HKQuery.predicateForSamples(withStart: window.start, end: window.end, options: [])
    let descriptor = HKSampleQueryDescriptor(
      predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: overlapping)],
      sortDescriptors: [SortDescriptor(\.startDate)]
    )
    let asleep = Set(HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue))
    let samples = try await descriptor.result(for: store).filter { asleep.contains($0.value) }
    return SleepNight.asleepMinutes(samples.map { (start: $0.startDate, end: $0.endDate) }, in: window)
  }

  /// Seven local nights, including missing nights, for an honest trend with gaps.
  func sleepHistory(now: Date = Date(), calendar: Calendar = .current) async throws -> [SleepSummary] {
    var result: [SleepSummary] = []
    for offset in -6...0 {
      guard let day = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now)),
        let window = SleepNight.window(endingOn: day, calendar: calendar) else { continue }
      let predicate = HKQuery.predicateForSamples(withStart: window.start, end: min(window.end, now), options: [])
      let descriptor = HKSampleQueryDescriptor(
        predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: predicate)],
        sortDescriptors: [SortDescriptor(\.startDate)]
      )
      let samples = try await descriptor.result(for: store).compactMap { sample -> SleepSample? in
        let stage: SleepStage
        switch HKCategoryValueSleepAnalysis(rawValue: sample.value) {
        case .asleepCore: stage = .core
        case .asleepDeep: stage = .deep
        case .asleepREM: stage = .rem
        case .asleepUnspecified: stage = .unspecified
        case .awake: stage = .awake
        default: return nil
        }
        return SleepSample(stage: stage, start: sample.startDate, end: min(sample.endDate, now))
      }
      result.append(SleepSummary(day: day, samples: samples, window: window))
    }
    return result
  }

  private func workouts(matching predicate: NSPredicate) async throws -> [HealthWorkout] {
    let descriptor = HKSampleQueryDescriptor(
      predicates: [.workout(predicate)],
      sortDescriptors: [SortDescriptor(\.startDate)],
      limit: 20
    )
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime]
    return try await descriptor.result(for: store).map { workout in
      let heartRate = workout.statistics(for: HKQuantityType(.heartRate))?.averageQuantity()
      return HealthWorkout(
        externalId: workout.uuid.uuidString,
        activityType: Self.activityName(workout.workoutActivityType),
        startedAt: iso.string(from: workout.startDate),
        durationMinutes: Self.rounded(min(max(workout.duration / 60, 0), 1440)),
        energyKcal: nil,
        distanceMeters: nil,
        averageHeartRateBpm: heartRate.map { Self.rounded($0.doubleValue(for: Self.bpm)) }.flatMap(Self.nonNegative)
      )
    }
  }

  /// A user-facing message for HealthKit failures; nil for anything else.
  static func message(for error: Error) -> String? {
    guard let error = error as? HKError else { return nil }
    switch error.code {
    case .errorDatabaseInaccessible: return "Health data is locked. Unlock your watch and try again."
    case .errorHealthDataUnavailable, .errorHealthDataRestricted: return "Health data isn't available on this watch."
    case .errorAuthorizationDenied, .errorAuthorizationNotDetermined: return "Allow Health access first."
    default: return "Couldn't read Health data. Try again."
    }
  }

  private static func rounded(_ value: Double) -> Double {
    (value * 10).rounded() / 10
  }

  private static func nonNegative(_ value: Double) -> Double? {
    value.isFinite && value >= 0 ? value : nil
  }

  /// Lowercase snake_case names, as the backend and agents expect (`running`, `traditional_strength_training`…).
  static func activityName(_ type: HKWorkoutActivityType) -> String {
    switch type {
    case .running: return "running"
    case .walking: return "walking"
    case .cycling: return "cycling"
    case .swimming: return "swimming"
    case .hiking: return "hiking"
    case .yoga: return "yoga"
    case .pilates: return "pilates"
    case .barre: return "barre"
    case .traditionalStrengthTraining: return "traditional_strength_training"
    case .functionalStrengthTraining: return "functional_strength_training"
    case .highIntensityIntervalTraining: return "high_intensity_interval_training"
    case .coreTraining: return "core_training"
    case .crossTraining: return "cross_training"
    case .mixedCardio: return "mixed_cardio"
    case .elliptical: return "elliptical"
    case .rowing: return "rowing"
    case .stairClimbing: return "stair_climbing"
    case .stairs: return "stairs"
    case .stepTraining: return "step_training"
    case .jumpRope: return "jump_rope"
    case .flexibility: return "flexibility"
    case .cooldown: return "cooldown"
    case .mindAndBody: return "mind_and_body"
    case .taiChi: return "tai_chi"
    case .cardioDance: return "cardio_dance"
    case .socialDance: return "social_dance"
    case .boxing: return "boxing"
    case .kickboxing: return "kickboxing"
    case .martialArts: return "martial_arts"
    case .climbing: return "climbing"
    case .soccer: return "soccer"
    case .basketball: return "basketball"
    case .tennis: return "tennis"
    case .pickleball: return "pickleball"
    case .badminton: return "badminton"
    case .golf: return "golf"
    case .paddleSports: return "paddle_sports"
    case .crossCountrySkiing: return "cross_country_skiing"
    case .downhillSkiing: return "downhill_skiing"
    case .snowboarding: return "snowboarding"
    case .wheelchairWalkPace: return "wheelchair_walk_pace"
    case .wheelchairRunPace: return "wheelchair_run_pace"
    case .handCycling: return "hand_cycling"
    case .swimBikeRun: return "swim_bike_run"
    default: return "other"
    }
  }

  // MARK: Simulator test data

  #if DEBUG && targetEnvironment(simulator)
    /// Saves sleep for yesterday and today, so the simulator has nights to display and sync.
    /// Sync identifiers make it idempotent: saving again replaces the earlier samples instead of adding more.
    func saveSampleData(now: Date = Date()) async throws {
      let calendar = Calendar.current
      let today = calendar.startOfDay(for: now)
      let cutoff = now.addingTimeInterval(-60)  // HealthKit samples must not end in the future
      let version = Int(now.timeIntervalSince1970)
      var samples: [HKSample] = []

      for (offset, jitter) in [(-1, 0.0), (0, 1.0)] {
        guard let day = calendar.date(byAdding: .day, value: offset, to: today),
          var cursor = calendar.date(byAdding: .minute, value: -45, to: day)  // in bed at 23:15
        else { continue }
        func metadata(_ key: String) -> [String: Any] {
          [
            HKMetadataKeySyncIdentifier: "buildnorth-debug-\(LocalDay.string(from: day))-\(key)",
            HKMetadataKeySyncVersion: version,
          ]
        }
        let stages: [(HKCategoryValueSleepAnalysis, Double)] = [
          (.asleepCore, 80), (.asleepDeep, 55), (.asleepREM, 25), (.awake, 10),
          (.asleepCore, 110), (.asleepREM, 40), (.asleepCore, 95 - jitter * 20),
        ]
        for (index, (stage, minutes)) in stages.enumerated() {
          let end = min(cursor.addingTimeInterval(minutes * 60), cutoff)
          if cursor < end {
            samples.append(
              HKCategorySample(
                type: HKCategoryType(.sleepAnalysis), value: stage.rawValue, start: cursor, end: end,
                metadata: metadata("sleep-\(index)")))
          }
          cursor = cursor.addingTimeInterval(minutes * 60)
        }
      }
      guard !samples.isEmpty else { return }
      try await store.save(samples)
    }
  #endif
}
