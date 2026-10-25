import SwiftUI

/// HealthKit access, manual sync, the last upload and whether the summaries are shared with agents.
struct HealthView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    List {
      Section {
        accessRow
      }

      Section {
        Button {
          Task { await model.syncHealth(manual: true) }
        } label: {
          HStack {
            Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
            if model.isSyncingHealth {
              Spacer()
              ProgressView()
                .frame(width: 20)
            }
          }
        }
        .disabled(model.isSyncingHealth || model.healthAccess == .unavailable)

        if let status = model.lastUpload {
          VStack(alignment: .leading, spacing: 2) {
            Label(status.message, systemImage: Self.icon(status.outcome))
              .font(.footnote)
              .foregroundStyle(status.outcome == .failed ? Color.orange : Color.primary)
            Text(status.at, style: .relative)
              .font(.caption2)
              .foregroundStyle(.secondary)
          }
        } else {
          Text("Sends each day's summary to Rhythm, with days missed while the app was closed (up to a week).")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }

      if let health = model.today?.health {
        Section {
          metrics(health)
        } header: {
          Text("Today so far")
        }
      }

      if let share = model.today?.shareHealth {
        Section {
          Label(share ? "Sharing on" : "Sharing off", systemImage: share ? "person.2.fill" : "lock.fill")
            .font(.headline)
          Text(
            share
              ? "Daily summaries, including today so far, go to the Coach's AI service, Rhythm's hosted "
                + "long-term memory and AI assistants you connect."
              : "Summaries are saved for you only. The Coach's AI service, Rhythm's long-term memory and "
                + "AI assistants you connect don't see them."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
          Text("Change it on iPhone → Profile → Apple Watch.")
            .font(.caption2)
            .foregroundStyle(.secondary)
        } header: {
          Text("Sharing")
        }
      }

      #if DEBUG && targetEnvironment(simulator)
        Section {
          Button("Add sample data") {
            Task { await model.addSampleHealthData() }
          }
          .disabled(model.isSyncingHealth)
        } header: {
          Text("Simulator")
        }
      #endif
    }
    .navigationTitle("Health")
    .task { await model.refreshHealthAccess() }
  }

  @ViewBuilder private var accessRow: some View {
    switch model.healthAccess {
    case .unavailable:
      Label("Health isn't available on this watch.", systemImage: "heart.slash")
        .font(.footnote)
    case .notRequested:
      VStack(alignment: .leading, spacing: 6) {
        Text("Rhythm reads sleep, heart rate, HRV, steps, active energy and workouts.")
          .font(.footnote)
        Button("Allow Health access") {
          Task { await model.requestHealthAccess() }
        }
        .buttonStyle(.borderedProminent)
      }
    case .requested:
      VStack(alignment: .leading, spacing: 2) {
        Label("Health access requested", systemImage: "heart.fill")
          .font(.footnote)
        Text("Change what's shared in Settings → Health → Apps.")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
  }

  @ViewBuilder private func metrics(_ day: HealthDay) -> some View {
    metric("Sleep", day.sleepMinutes.map { Display.sleep(minutes: $0) })
    metric("Resting HR", day.restingHeartRateBpm.map { "\($0) bpm" })
    metric("HRV", day.hrvSdnnMs.map { "\(Int($0.rounded())) ms" })
    metric("Steps", day.steps.map { $0.formatted() })
    metric("Active", day.activeEnergyKcal.map { "\(Int($0.rounded())) kcal" })
    if !day.workouts.isEmpty {
      metric("Workouts", "\(day.workouts.count)")
    }
  }

  private static func icon(_ outcome: HealthUploadStatus.Outcome) -> String {
    switch outcome {
    case .sent: return "checkmark.circle"
    case .noData: return "questionmark.circle"
    case .failed: return "exclamationmark.triangle"
    }
  }

  private func metric(_ name: String, _ value: String?) -> some View {
    HStack {
      Text(name)
        .foregroundStyle(.secondary)
      Spacer()
      // Missing data stays missing, never 0.
      Text(value ?? "—")
        .monospacedDigit()
    }
    .font(.footnote)
  }
}
