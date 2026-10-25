import Charts
import SwiftUI

struct SleepView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    List {
      if model.healthAccess == .notRequested {
        Section {
          Text("See sleep recorded by Apple Watch in Apple Health.").font(.footnote)
          Button("Allow sleep access") {
            Task {
              await model.requestHealthAccess()
              await model.refreshSleep()
              await model.syncHealth(manual: false)
            }
          }
        }
      } else if model.healthAccess == .unavailable {
        Text("Health isn't available on this watch.").font(.footnote)
      } else {
        Section("Last night") {
          if let night = model.nights.last, let minutes = night.minutes {
            Text(SleepNight.display(minutes: minutes)).font(.title2).monospacedDigit()
            if let start = night.startedAt, let end = night.endedAt {
              Text("\(start, style: .time) – \(end, style: .time)")
                .font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(SleepStage.allCases, id: \.self) { stage in
              if let value = night.stages[stage] {
                HStack {
                  Text(stage.rawValue).foregroundStyle(.secondary)
                  Spacer()
                  Text(SleepNight.display(minutes: value)).monospacedDigit()
                }.font(.footnote)
              }
            }
          } else {
            Text("No sleep recorded for last night.").font(.footnote)
          }
        }

        if model.nights.contains(where: { $0.minutes != nil }) {
          Section("Last 7 nights") {
            Chart(model.nights) { night in
              if let minutes = night.minutes {
                BarMark(x: .value("Night", night.day, unit: .day), y: .value("Hours asleep", Double(minutes) / 60))
                  .foregroundStyle(.indigo)
                  .accessibilityLabel(night.day.formatted(date: .abbreviated, time: .omitted))
                  .accessibilityValue(SleepNight.display(minutes: minutes))
              }
            }
            .chartXScale(domain: chartDates)
            .chartXAxis { AxisMarks(values: .stride(by: .day, count: 2)) { _ in AxisValueLabel(format: .dateTime.weekday(.narrow)) } }
            .chartYAxisLabel("Hours")
            .frame(height: 100)
            ForEach(model.nights.reversed()) { night in
              HStack {
                Text(night.day, format: .dateTime.weekday(.abbreviated))
                Spacer()
                Text(night.minutes.map { SleepNight.display(minutes: $0) } ?? "—")
              }.font(.caption2).monospacedDigit()
            }
          }
        }

        Section {
          Text("Wear your watch to bed and turn on Track Sleep with Apple Watch in the iPhone Watch app → Sleep. Results appear after Apple Health records them.")
            .font(.caption2).foregroundStyle(.secondary)
          Text("Missing sleep? Check BuildNorth's access in Settings → Health → Apps.")
            .font(.caption2).foregroundStyle(.secondary)
        }
      }
      if model.isLoadingSleep { ProgressView("Loading sleep…") }
      if let error = model.sleepError {
        Text(error).font(.footnote).foregroundStyle(.orange)
      }
      Button("Refresh") {
        Task {
          await model.refreshSleep()
          await model.syncHealth(manual: true)
        }
      }.disabled(model.isLoadingSleep || model.isSyncingHealth || model.healthAccess == .unavailable)
      if let status = model.lastUpload {
        Text(status.message).font(.caption2)
          .foregroundStyle(status.outcome == .failed ? Color.orange : Color.secondary)
      }
      #if DEBUG && targetEnvironment(simulator)
        Button("Add sample sleep") {
          Task {
            await model.addSampleHealthData()
            await model.refreshSleep()
          }
        }
      #endif
    }
    .navigationTitle("Sleep")
    .task { await model.refreshSleep() }
  }

  private var chartDates: ClosedRange<Date> {
    let first = model.nights.first?.day ?? Date()
    let last = model.nights.last?.day ?? first
    return first.addingTimeInterval(-12 * 3600)...last.addingTimeInterval(12 * 3600)
  }
}
