import Foundation

struct HeartRatePoint: Identifiable, Sendable {
  let at: Date
  let bpm: Double
  var id: Date { at }
}

/// A bounded recent trend; full workout samples are saved by HealthKit, not uploaded as raw readings.
struct HeartRateSeries: Sendable {
  private(set) var points: [HeartRatePoint] = []

  mutating func append(bpm: Double, at: Date) {
    guard bpm.isFinite, bpm > 0, points.last.map({ at > $0.at }) ?? true else { return }
    points.append(HeartRatePoint(at: at, bpm: bpm))
    if points.count > 300 { points.removeFirst(points.count - 300) }
  }

  func current(at now: Date) -> Double? {
    guard let last = points.last, now.timeIntervalSince(last.at) <= 30 else { return nil }
    return last.bpm
  }
}
