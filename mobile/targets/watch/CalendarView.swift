import SwiftUI

struct CalendarView: View {
  @Environment(AppModel.self) private var model
  @State private var selected = Date()
  private var day: String { LocalDay.string(from: selected) }

  var body: some View {
    List {
      HStack {
        Button { move(-1) } label: { Image(systemName: "chevron.left") }
          .accessibilityLabel("Previous day")
        Spacer()
        Text(Display.monthDay(day)).font(.headline)
        Spacer()
        Button { move(1) } label: { Image(systemName: "chevron.right") }
          .accessibilityLabel("Next day")
      }
      .buttonStyle(.borderless)
      Button("Today") { selected = Date() }
      if model.calendarLoading {
        ProgressView("Loading your day")
      } else if let error = model.calendarError {
        Text(error).font(.footnote)
        Button("Try again") { Task { await model.refreshCalendar(date: day) } }
      } else if model.calendarEntries.isEmpty {
        Text("No meals or workouts logged. Add one on your phone or tell Coach.")
          .font(.footnote).foregroundStyle(.secondary)
      } else {
        ForEach(model.calendarEntries) { entry in
          VStack(alignment: .leading, spacing: 5) {
            Text(entry.timeEstimated && entry.source == "coach" ? "Time not specified" : entry.localTime + (entry.timeEstimated ? " · logged" : ""))
              .font(.caption2).foregroundStyle(.secondary)
            Label(entry.title, systemImage: entry.kind == "meal" ? "fork.knife" : "figure.run")
              .foregroundStyle(entry.kind == "meal" ? Color.green : Color.blue)
            if let minutes = entry.durationMinutes {
              Text("\(minutes) min").font(.caption2)
            }
            if entry.source == "demo" {
              Text("DEMO").font(.caption2).foregroundStyle(.purple)
            }
          }
          .padding(.vertical, 4)
        }
      }
    }
    .navigationTitle("Calendar")
    .task(id: day) { await model.refreshCalendar(date: day) }
    .refreshable { await model.refreshCalendar(date: day) }
  }

  private func move(_ amount: Int) {
    selected = Calendar.current.date(byAdding: .day, value: amount, to: selected) ?? selected
  }
}
