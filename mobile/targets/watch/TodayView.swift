import SwiftUI

struct TodayView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var model = model
    List {
      header
        .listRowBackground(Color.clear)

      if let error = model.loadError {
        Section {
          VStack(alignment: .leading, spacing: 4) {
            Label(error, systemImage: "wifi.exclamationmark")
              .font(.footnote)
            if model.today != nil, let at = model.todayLoadedAt {
              Text("Showing \(at, style: .time) update")
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
            Button("Try again") { Task { await model.refresh() } }
              .buttonStyle(.bordered)
              .disabled(model.isLoading)
          }
        }
      }

      if let error = model.linkError {
        Section {
          Label(error, systemImage: "exclamationmark.triangle")
            .font(.footnote)
        }
      }

      if let today = model.today {
        Section {
          NavigationLink {
            CheckInView()
          } label: {
            CheckInSummary(checkIn: today.checkIn)
          }
        }

        Section {
          if today.items.isEmpty {
            Text("Nothing planned today.")
              .foregroundStyle(.secondary)
          }
          ForEach(today.items) { item in
            PlanItemRow(item: item)
          }
        } header: {
          Text("Plan")
        }

        Section {
          NavigationLink {
            HealthView()
          } label: {
            HealthSummaryRow(status: model.lastUpload, isSyncing: model.isSyncingHealth)
          }
        }
      } else if model.isLoading {
        ProgressView()
          .frame(maxWidth: .infinity)
          .listRowBackground(Color.clear)
      }
    }
    .navigationTitle("BuildNorth")
    .refreshable { await model.refresh() }
    .alert("Couldn't update", isPresented: $model.showsActionError) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(model.actionError ?? "")
    }
  }

  private var header: some View {
    let day = model.today?.date ?? LocalDay.string()
    let items = model.today?.items ?? []
    let left = items.filter { $0.status == .planned }.count
    return VStack(alignment: .leading, spacing: 2) {
      Text(Display.weekday(day))
        .font(.headline)
      Text(model.today == nil ? Display.monthDay(day) : "\(Display.monthDay(day)) · \(left) of \(items.count) left")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
  }
}

private struct CheckInSummary: View {
  let checkIn: CheckIn?

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: checkIn == nil ? "heart.text.square" : "checkmark.circle.fill")
        .foregroundStyle(checkIn == nil ? Color.accentColor : Color.green)
      VStack(alignment: .leading, spacing: 2) {
        Text(checkIn == nil ? "Check in" : "Checked in")
          .font(.headline)
        if let checkIn {
          Text(summary(checkIn))
            .font(.caption2)
            .foregroundStyle(.secondary)
        } else {
          Text("How are you today?")
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
    }
  }

  private func summary(_ checkIn: CheckIn) -> String {
    var parts = ["Energy \(checkIn.energy)/5", "Mood \(checkIn.mood)/5"]
    if let sleep = checkIn.sleepHours { parts.append("Sleep \(Display.hours(sleep))") }
    return parts.joined(separator: " · ")
  }
}

private struct HealthSummaryRow: View {
  let status: HealthUploadStatus?
  let isSyncing: Bool

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "heart.fill")
        .foregroundStyle(.pink)
      VStack(alignment: .leading, spacing: 2) {
        Text("Health")
          .font(.headline)
        Group {
          switch (isSyncing, status?.outcome) {
          case (true, _):
            Text("Syncing…")
          case (false, .sent?):
            Text("Synced \(status?.at ?? Date(), style: .time)")
          case (false, .noData?):
            Text("No Health data yet")
          case (false, .failed?):
            Text("Last sync failed")
              .foregroundStyle(.orange)
          case (false, nil):
            Text("Not synced yet")
          }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
      }
    }
  }
}

struct PlanItemRow: View {
  let item: PlanItem
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Image(systemName: item.kind == "meal" ? "fork.knife" : "figure.run")
          .foregroundStyle(item.status == .planned ? Color.accentColor : Color.secondary)
        Text(item.title)
          .font(.headline)
          .lineLimit(3)
          .strikethrough(item.status == .done)
          .foregroundStyle(item.status == .planned ? .primary : .secondary)
      }
      if !detail.isEmpty {
        Text(detail)
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      actions
    }
    .padding(.vertical, 2)
  }

  private var detail: String {
    var parts: [String] = []
    if let slot = item.timeSlot { parts.append(Display.slot(slot)) }
    if let minutes = item.minutes { parts.append("\(minutes) min") }
    switch item.status {
    case .done: parts.append("Done")
    case .skipped: parts.append("Skipped")
    case .planned: break
    }
    return parts.joined(separator: " · ")
  }

  @ViewBuilder private var actions: some View {
    if model.busyItemIDs.contains(item.id) {
      ProgressView()
        .frame(maxWidth: .infinity)
    } else if item.status == .planned {
      // Explicit button styles keep each button its own tap target inside the list row.
      HStack(spacing: 6) {
        Button {
          Task { await model.setStatus(item, to: .done) }
        } label: {
          Label("Done", systemImage: "checkmark")
        }
        .tint(.green)
        .accessibilityLabel("Mark \(item.title) done")
        Button {
          Task { await model.setStatus(item, to: .skipped) }
        } label: {
          Label("Skip", systemImage: "forward.end")
        }
        .accessibilityLabel("Skip \(item.title)")
      }
      .buttonStyle(.bordered)
      .labelStyle(.titleOnly)
    } else {
      Button {
        Task { await model.setStatus(item, to: .planned) }
      } label: {
        Label("Undo", systemImage: "arrow.uturn.backward")
      }
      .buttonStyle(.bordered)
      .accessibilityLabel("Undo \(item.title)")
    }
  }
}

/// Small formatting helpers shared by the screens.
enum Display {
  static func weekday(_ day: String) -> String {
    format(day, template: "EEEE")
  }

  static func monthDay(_ day: String) -> String {
    format(day, template: "MMMMd")
  }

  static func slot(_ slot: String) -> String {
    switch slot {
    case "morning": return "Morning"
    case "midday": return "Midday"
    case "evening": return "Evening"
    default: return slot.capitalized
    }
  }

  /// 7 → "7 h", 7.5 → "7.5 h".
  static func hours(_ hours: Double) -> String {
    hours.formatted(.number.precision(.fractionLength(0...2))) + " h"
  }

  /// 412 → "6 h 52 min".
  static func sleep(minutes: Int) -> String {
    let h = minutes / 60
    let m = minutes % 60
    if h == 0 { return "\(m) min" }
    return m == 0 ? "\(h) h" : "\(h) h \(m) min"
  }

  private static func format(_ day: String, template: String) -> String {
    guard let date = LocalDay.date(from: day) else { return day }
    let formatter = DateFormatter()
    formatter.setLocalizedDateFormatFromTemplate(template)
    return formatter.string(from: date)
  }
}
