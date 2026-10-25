import SwiftUI

/// Keep the watch focused: account and sharing controls live on the phone.
struct MonitorView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    List {
      Section {
        NavigationLink {
          SleepView()
        } label: {
          choice("Sleep", subtitle: "Your nightly patterns", icon: "moon.zzz.fill", color: .indigo)
        }
        NavigationLink {
          WorkoutView()
        } label: {
          choice("Workout", subtitle: model.workout.isActive ? "Workout in progress" : "Live heart rate",
                 icon: "waveform.path.ecg", color: .pink)
        }
      } footer: {
        Text("Demo version").font(.caption2).foregroundStyle(.secondary)
      }
      if let error = model.linkError {
        Text(error).font(.footnote).foregroundStyle(.orange)
      }
    }
    .navigationTitle("Rhythm")
  }

  private func choice(_ title: String, subtitle: String, icon: String, color: Color) -> some View {
    HStack(spacing: 10) {
      Image(systemName: icon).font(.title3).foregroundStyle(color).frame(width: 28)
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.headline)
        Text(subtitle).font(.caption2).foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 10)
  }
}
