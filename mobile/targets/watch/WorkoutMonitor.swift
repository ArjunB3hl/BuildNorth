import Foundation
import HealthKit
import Observation

@MainActor
@Observable
final class WorkoutMonitor: NSObject {
  enum State { case idle, starting, running, paused, ending, finished }

  private(set) var state: State = .idle
  private(set) var heartRate = HeartRateSeries()
  private(set) var averageBpm: Double?
  private(set) var maximumBpm: Double?
  private(set) var error: String?
  private(set) var saved = false
  private(set) var savedCount = 0
  private(set) var finalDuration: TimeInterval = 0

  @ObservationIgnored private let store = HKHealthStore()
  @ObservationIgnored private var session: HKWorkoutSession?
  @ObservationIgnored private var builder: HKLiveWorkoutBuilder?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var isFinishing = false

  var isActive: Bool { state == .starting || state == .running || state == .paused || state == .ending }
  private static var bpm: HKUnit { .count().unitDivided(by: .minute()) }

  func duration(at date: Date) -> TimeInterval {
    builder?.elapsedTime(at: date) ?? finalDuration
  }

  func start() async {
    guard !isActive else { return }
    reset()
    state = .starting
    let request = generation
    guard HKHealthStore.isHealthDataAvailable() else {
      fail("Health isn't available on this watch.")
      return
    }
    do {
      let heart = HKQuantityType(.heartRate)
      let workout = HKObjectType.workoutType()
      try await store.requestAuthorization(toShare: [workout, heart], read: HealthSync.readTypes)
      guard request == generation else { return }
      guard store.authorizationStatus(for: workout) == .sharingAuthorized else {
        fail("Allow Rhythm to save workouts in Settings → Health → Apps, then try again.")
        return
      }
      let config = HKWorkoutConfiguration()
      config.activityType = .other
      config.locationType = .unknown
      let session = try HKWorkoutSession(healthStore: store, configuration: config)
      let builder = session.associatedWorkoutBuilder()
      let source = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
      // This session is for heart monitoring. Do not collect unrelated calorie estimates.
      source.disableCollection(for: HKQuantityType(.activeEnergyBurned))
      source.disableCollection(for: HKQuantityType(.basalEnergyBurned))
      source.enableCollection(for: heart, predicate: nil)
      builder.dataSource = source
      session.delegate = self
      builder.delegate = self
      self.session = session
      self.builder = builder
      let start = Date()
      session.startActivity(with: start)
      try await builder.beginCollection(at: start)
      guard request == generation, self.session === session else { return }
      if state == .starting { state = .running }
    } catch {
      guard request == generation else { return }
      fail(HealthSync.message(for: error) ?? "Couldn't start the workout. Try again.")
    }
  }

  func pauseOrResume() {
    if state == .running { session?.pause() }
    else if state == .paused { session?.resume() }
  }

  func end() {
    guard state == .running || state == .paused else { return }
    state = .ending
    session?.end()
    // Finish only after HealthKit reports .ended, so all remaining samples can arrive first.
  }

  /// Account changes cancel pending permissions and discard an in-progress workout.
  func reset() {
    generation = UUID()
    release(discard: true)
    heartRate = HeartRateSeries()
    averageBpm = nil
    maximumBpm = nil
    finalDuration = 0
    error = nil
    saved = false
    state = .idle
  }

  private func release(discard: Bool) {
    session?.delegate = nil
    builder?.delegate = nil
    session?.end()
    if discard { builder?.discardWorkout() }
    session = nil
    builder = nil
    isFinishing = false
  }

  private func fail(_ message: String) {
    finalDuration = duration(at: Date())
    release(discard: true)
    error = message
    state = .finished
  }

  private func updateHeartRate(from builder: HKLiveWorkoutBuilder) {
    guard self.builder === builder,
      let stats = builder.statistics(for: HKQuantityType(.heartRate)) else { return }
    averageBpm = stats.averageQuantity()?.doubleValue(for: Self.bpm)
    maximumBpm = stats.maximumQuantity()?.doubleValue(for: Self.bpm)
    if let value = stats.mostRecentQuantity()?.doubleValue(for: Self.bpm),
      let date = stats.mostRecentQuantityDateInterval()?.end {
      heartRate.append(bpm: value, at: date)
    }
  }

  private func finish(at date: Date) async {
    guard let builder, !isFinishing else { return }
    isFinishing = true
    state = .ending
    let request = generation
    do {
      try await builder.endCollection(at: date)
      guard request == generation else { return }
      updateHeartRate(from: builder)
      finalDuration = builder.elapsedTime(at: date)
      _ = try await builder.finishWorkout()
      guard request == generation else { return }
      saved = true
      savedCount += 1
      release(discard: false)
      state = .finished
    } catch {
      guard request == generation else { return }
      fail("Couldn't save this workout to Apple Health. \(HealthSync.message(for: error) ?? "Please try again with a new workout.")")
    }
  }
}

extension WorkoutMonitor: HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
  nonisolated func workoutSession(
    _ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
    from fromState: HKWorkoutSessionState, date: Date
  ) {
    Task { @MainActor [weak self] in
      guard let self, self.session === workoutSession else { return }
      switch toState {
      case .running: if state == .paused { state = .running }
      case .paused: if state != .ending { state = .paused }
      case .ended: await finish(at: date)
      default: break
      }
    }
  }

  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    Task { @MainActor [weak self] in
      guard let self, self.session === workoutSession else { return }
      fail("Workout stopped. \(HealthSync.message(for: error) ?? "Please try again.")")
    }
  }

  nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
    guard collectedTypes.contains(HKQuantityType(.heartRate)) else { return }
    Task { @MainActor [weak self] in self?.updateHeartRate(from: workoutBuilder) }
  }

  nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}
