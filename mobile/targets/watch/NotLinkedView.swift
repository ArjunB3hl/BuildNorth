import SwiftUI

struct NotLinkedView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        Text("Demo version")
          .font(.caption2)
          .foregroundStyle(.secondary)
        Image(systemName: "applewatch.radiowaves.left.and.right")
          .font(.title2)
          .foregroundStyle(.tint)
        Text("Link your watch")
          .font(.headline)
        if let reason = model.linkError ?? model.unlinkReason {
          Text(reason)
            .font(.footnote)
            .foregroundStyle(.orange)
        }
        Text("Open Rhythm on your iPhone → Profile → Apple Watch")
          .font(.footnote)
        Text("This screen updates by itself once your iPhone sends the link.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle("Rhythm")
  }
}
