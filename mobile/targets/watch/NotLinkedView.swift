import SwiftUI

struct NotLinkedView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        Image(systemName: "applewatch.radiowaves.left.and.right")
          .font(.title2)
          .foregroundStyle(.tint)
        Text("Sign in on iPhone")
          .font(.headline)
        if let reason = model.linkError ?? model.unlinkReason {
          Text(reason)
            .font(.footnote)
            .foregroundStyle(.orange)
        }
        Text("Sign in to BuildNorth on your iPhone. Open Profile → Apple Watch → Sign in Apple Watch.")
          .font(.footnote)
        Text("Your watch signs in automatically, ready for Sleep and Workout.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle("BuildNorth")
  }
}
