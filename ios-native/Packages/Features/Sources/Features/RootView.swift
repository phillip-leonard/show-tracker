import DesignSystem
import SwiftUI

/// The app's first screen until the tab shell lands (Part 6).
public struct RootView: View {
    public init() {}

    public var body: some View {
        VStack(spacing: 12) {
            Text("MySetlists")
                .font(.jakarta(size: 34, weight: .bold, relativeTo: .largeTitle))
            Text("Native foundation")
                .font(.jakarta(size: 15, weight: .medium, relativeTo: .subheadline))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    RootView()
}
