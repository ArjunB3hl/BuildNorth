import SwiftUI

/// Energy, mood and sleep, one per page so the Digital Crown always drives the value on screen (the page never
/// scrolls). Sends `PATCH /watch/checkins/{date}`; the phone's note is left as it is.
struct CheckInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  private enum Step: Int, CaseIterable {
    case energy, mood, sleep
  }

  @State private var step = Step.energy
  @State private var draft = CheckInDraft(today: nil, date: LocalDay.string())
  @State private var prefilled = false
  @State private var saving = false
  @State private var error: String?

  var body: some View {
    VStack(spacing: 6) {
      Group {
        switch step {
        case .energy:
          CrownPicker(
            title: "Energy · 1/3", value: $draft.energy, range: 1...5, step: 1, low: "Drained", high: "Energised",
            format: { "\(Int($0.rounded()))" })
        case .mood:
          CrownPicker(
            title: "Mood · 2/3", value: $draft.mood, range: 1...5, step: 1, low: "Low", high: "Great",
            format: { "\(Int($0.rounded()))" })
        case .sleep:
          sleepPage
        }
      }
      .id(step)

      if let error {
        Text(error)
          .font(.caption2)
          .foregroundStyle(.orange)
          .lineLimit(2)
          .minimumScaleFactor(0.8)
      }

      HStack(spacing: 6) {
        if let previous = Step(rawValue: step.rawValue - 1) {
          Button {
            step = previous
          } label: {
            Image(systemName: "chevron.backward")
          }
          .buttonStyle(.bordered)
          .buttonBorderShape(.circle)
          .accessibilityLabel("Back")
        }
        Button {
          if let next = Step(rawValue: step.rawValue + 1) {
            step = next
          } else {
            save()
          }
        } label: {
          if saving {
            ProgressView()
          } else {
            Text(step == .sleep ? "Save" : "Next")
          }
        }
        .buttonStyle(.borderedProminent)
        .disabled(saving)
      }
    }
    .navigationTitle("Check-in")
    .task { await prefill() }
  }

  @ViewBuilder private var sleepPage: some View {
    if draft.recordSleep {
      VStack(spacing: 2) {
        CrownPicker(
          title: draft.sleepSource == .health ? "Sleep · from Health" : "Sleep · 3/3", value: $draft.sleep,
          range: 0...24, step: 0.5, format: { Display.hours(CheckInDraft.halfHours($0)) })
        Button("Don't record sleep") {
          draft.setRecordSleep(false)
        }
        .buttonStyle(.borderless)
        .font(.caption2)
        .foregroundStyle(.secondary)
      }
    } else {
      VStack(spacing: 6) {
        Text("Sleep · 3/3")
          .font(.footnote)
          .foregroundStyle(.secondary)
        Text("Not recorded")
          .font(.headline)
        Button("Add sleep") {
          draft.setRecordSleep(true)
        }
        .buttonStyle(.bordered)
      }
    }
  }

  /// Starts from today's saved check-in; with health sharing on, sleep falls back to what HealthKit measured for
  /// last night.
  private func prefill() async {
    guard !prefilled else { return }
    prefilled = true
    draft = CheckInDraft(today: model.today, date: LocalDay.string())
    guard draft.wantsHealthSleep else { return }
    let hours = await model.sleepHoursFromHealth()
    draft.prefillSleep(fromHealth: hours)
  }

  private func save() {
    saving = true
    error = nil
    Task {
      let failure = await model.saveCheckIn(draft.patch)
      saving = false
      if let failure {
        error = failure
      } else {
        dismiss()
      }
    }
  }
}

/// A number set with the Digital Crown, with − and + buttons as the fallback.
struct CrownPicker: View {
  let title: String
  @Binding var value: Double
  let range: ClosedRange<Double>
  let step: Double
  var low: String?
  var high: String?
  let format: (Double) -> String

  @FocusState private var focused: Bool

  var body: some View {
    VStack(spacing: 4) {
      Text(title)
        .font(.footnote)
        .foregroundStyle(.secondary)
      HStack(spacing: 4) {
        Button {
          change(by: -step)
        } label: {
          Image(systemName: "minus")
        }
        .disabled(value <= range.lowerBound)
        .accessibilityLabel("Less")
        Text(format(value))
          .font(.system(size: 32, weight: .semibold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .frame(maxWidth: .infinity)
          .contentTransition(.numericText())
        Button {
          change(by: step)
        } label: {
          Image(systemName: "plus")
        }
        .disabled(value >= range.upperBound)
        .accessibilityLabel("More")
      }
      .buttonStyle(.bordered)
      .buttonBorderShape(.circle)
      if let low, let high {
        HStack {
          Text(low)
          Spacer()
          Text(high)
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
      }
    }
    .focusable()
    .focused($focused)
    .digitalCrownRotation(
      $value, from: range.lowerBound, through: range.upperBound, by: step, sensitivity: .low, isContinuous: false,
      isHapticFeedbackEnabled: true
    )
    .onAppear { focused = true }
  }

  private func change(by delta: Double) {
    let next = ((value + delta) / step).rounded() * step
    withAnimation { value = min(range.upperBound, max(range.lowerBound, next)) }
  }
}
