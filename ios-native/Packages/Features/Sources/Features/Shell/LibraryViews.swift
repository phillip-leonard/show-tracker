import Core
import DesignSystem
import SwiftUI

// The secondary screens (Stage 4, F-1; DECISIONS.md "Parity before
// launch"): no drawer. Library is a section at the top of Me, Community is
// on Stats, and a wide iPad window lists them all in its sidebar
// (AppShell). Every item opens its web page until its native screen ships
// (`LibraryDestination.native`; Stage 4 call B for Festivals and Setlist Photos).

/// Library, at the top of Me. Guests don't get Festivals or Setlist Photos.
struct LibrarySection: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        Section("Library") {
            ForEach(LibraryDestination.meItems(isGuest: session.user?.isAnonymous == true)) { item in
                LibraryRow(item: item)
            }
        }
        .brandRow()
    }
}

/// Community, on Stats.
struct CommunitySection: View {
    var body: some View {
        Section {
            LibraryRow(item: .community)
        }
        .brandRow()
    }
}

/// One row: the item's screen, or its web page until that's built.
struct LibraryRow: View {
    @Environment(AppRouter.self) private var router
    let item: LibraryDestination

    var body: some View {
        Button { router.show(item.webURL) } label: {
            HStack(spacing: Space.x3) {
                Image(systemName: item.systemImage)
                    .foregroundStyle(Color.brand)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.jakarta(size: 16, weight: .semibold, relativeTo: .body))
                        .foregroundStyle(Color.textPrimary)
                    Text(item.detail)
                        .font(.jakarta(size: 13, relativeTo: .footnote))
                        .foregroundStyle(Color.textSecondary)
                }
                Spacer(minLength: Space.x2)
                // Until its native screen ships, the row says it leaves the app.
                Image(systemName: "arrow.up.forward.square")
                    .font(.footnote)
                    .foregroundStyle(Color.textSecondary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, Space.x1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens on mysetlists.net")
    }
}

/// A Library item's root in the wide-iPad sidebar, until its native screen
/// replaces it.
struct LibraryTabRoot: View {
    @Environment(AppRouter.self) private var router
    let item: LibraryDestination

    var body: some View {
        ContentUnavailableView {
            Label(item.title, systemImage: item.systemImage)
        } description: {
            Text("\(item.detail). Coming to the app; for now it opens on mysetlists.net.")
        } actions: {
            Button("Open on mysetlists.net") { router.show(item.webURL) }
                .buttonStyle(.borderedProminent)
                .tint(.brand)
        }
        .navigationTitle(item.title)
    }
}

/// A guest's first show (DECISIONS.md "Parity before launch": "a guest's
/// first show opens the account prompt, as on the web"). Shown by the add
/// flow in place of going straight to the show (`AddOutcomeHandling`).
struct FirstShowPrompt: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var upgrading = false

    var body: some View {
        VStack(spacing: Space.x5) {
            VStack(spacing: Space.x3) {
                Image(systemName: "sparkles")
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(Color.amber)
                    .frame(width: 64, height: 64)
                    .background(Color.brand.opacity(0.18), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                Text("Great start!")
                    .font(.jakarta(size: 24, weight: .bold, relativeTo: .title2))
                    .foregroundStyle(Color.textPrimary)
                Text("Your first show is in. Create a free account to:")
                    .font(.jakarta(size: 15, relativeTo: .body))
                    .foregroundStyle(Color.textSecondary)
                    .multilineTextAlignment(.center)
            }

            VStack(alignment: .leading, spacing: Space.x3) {
                benefit("Keep your shows if you change phones or sign out")
                benefit("Add friends and see the shows you've been to together")
                benefit("Join the community leaderboards")
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: Space.x2) {
                Button { upgrading = true } label: {
                    Text("Create free account").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(.brand)
                Button("Maybe later") { dismiss() }
                    .controlSize(.large)
                    .tint(Color.textSecondary)
            }
        }
        .padding(Space.x6)
        .frame(maxWidth: 480)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .brandScreen()
        .sheet(isPresented: $upgrading) { GuestUpgradeView() }
        // An account now: nothing left to ask.
        .onChange(of: session.user?.isAnonymous) { _, isGuest in if isGuest == false { dismiss() } }
    }

    private func benefit(_ text: String) -> some View {
        Label {
            Text(text)
                .font(.jakarta(size: 15, relativeTo: .body))
                .foregroundStyle(Color.textPrimary)
        } icon: {
            Image(systemName: "checkmark").foregroundStyle(Color.brand)
        }
    }
}
