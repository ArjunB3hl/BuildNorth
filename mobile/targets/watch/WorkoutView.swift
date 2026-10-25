import Charts
import SwiftUI

struct WorkoutView: View {
  @Environment(AppModel.self) private var model
  @State private var confirmsEnd = false
  private var workout: WorkoutMonitor { model.workout }

  var body: some View {
    ScrollView {
      VStack(spacing: 12) {
        if workout.state == .idle {
          Image(systemName: "waveform.path.ecg").font(.largeTitle).foregroundStyle(.pink)
          Text("Follow your heart rate while you exercise.").font(.footnote)
          Text("Start here to record a workout in Apple Health. Keep Rhythm running for this workout.")
            .font(.caption2).foregroundStyle(.secondary)
        } else {
          TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(spacing: 4) {
              Text(status).font(.caption).foregroundStyle(.secondary)
              HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(currentBpm(at: context.date)).font(.system(size: 44, weight: .semibold, design: .rounded))
                Text("BPM").font(.caption).foregroundStyle(.pink)
              }.monospacedDigit()
              Text(Duration.seconds(workout.duration(at: context.date)).formatted(.time(pattern: .minuteSecond)))
                .font(.headline).monospacedDigit()
              if workout.state == .running && workout.heartRate.current(at: context.date) == nil {
                Text("Waiting for heart rate. Wear your watch snugly and allow Heart Rate access in Health settings.")
                  .font(.caption2).foregroundStyle(.secondary)
              }
            }
          }
          if !workout.heartRate.points.isEmpty {
            Chart(workout.heartRate.points) { point in
              LineMark(x: .value("Time", point.at), y: .value("BPM", point.bpm))
                .foregroundStyle(.pink)
            }
            .chartXAxis(.hidden)
            .chartYScale(domain: .automatic(includesZero: false))
            .frame(height: 70)
            .accessibilityLabel("Recent workout heart rate, in beats per minute")
          }
          HStack {
            metric("Average", workout.averageBpm)
            Spacer()
            metric("Peak", workout.maximumBpm)
          }
        }

        if let error = workout.error {
          Text(error).font(.footnote).foregroundStyle(.orange)
        }
        if workout.saved {
          Label("Saved to Apple Health", systemImage: "checkmark.circle").font(.footnote).foregroundStyle(.green)
        }

        switch workout.state {
        case .idle, .finished:
          Button(workout.state == .finished ? "New workout" : "Start workout") {
            Task { await workout.start() }
          }.buttonStyle(.borderedProminent).tint(.pink)
        case .starting:
          ProgressView("Starting…")
        case .running, .paused:
          Button(workout.state == .paused ? "Resume" : "Pause") { workout.pauseOrResume() }
            .buttonStyle(.bordered)
          Button("End workout", role: .destructive) { confirmsEnd = true }
            .buttonStyle(.bordered)
        case .ending:
          ProgressView("Saving workout…")
        }
      }.padding(.horizontal, 6)
    }
    .navigationTitle("Workout")
    .confirmationDialog("End and save workout?", isPresented: $confirmsEnd, titleVisibility: .visible) {
      Button("End and save") { workout.end() }
      Button("Keep going", role: .cancel) {}
    }
  }

  private var status: String {
    switch workout.state {
    case .idle: return "Ready"
    case .starting: return "Starting"
    case .running: return "Heart rate"
    case .paused: return "Paused"
    case .ending: return "Saving"
    case .finished: return "Workout ended"
    }
  }

  private func currentBpm(at now: Date) -> String {
    guard workout.state == .running, let value = workout.heartRate.current(at: now) else { return "—" }
    return "\(Int(value.rounded()))"
  }

  private func metric(_ label: String, _ value: Double?) -> some View {
    VStack(spacing: 2) {
      Text(label).font(.caption2).foregroundStyle(.secondary)
      Text(value.map { "\(Int($0.rounded())) bpm" } ?? "—").font(.footnote).monospacedDigit()
    }
  }
}
