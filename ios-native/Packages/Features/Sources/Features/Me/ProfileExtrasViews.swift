import Core
import DesignSystem
import SwiftUI

// Profile extras (Stage 6, 6-11; the web's Profile page): achievements from
// the server's counts, Your notes ("My Comments" on the web), the public
// profile preview, and the guest rescue banner.

/// Up to four achievement tiles (accounts, as on the web).
struct AchievementsSection: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @Environment(FriendsStore.self) private var friends

    var body: some View {
        let stats = store.stats
        let earned = Achievements.earned(
            shows: stats?.showCount ?? 0, bands: stats?.bandCount ?? 0, venues: stats?.venueCount ?? 0,
            friends: friends.friends.count, follows: session.profile?.favoriteArtists.count ?? 0
        )
        if !earned.isEmpty {
            Section("Achievements") {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: Space.x2), GridItem(.flexible(), spacing: Space.x2)], spacing: Space.x2) {
                    ForEach(earned) { AchievementTile(achievement: $0) }
                }
                .padding(.vertical, Space.x1)
            }
            .brandRow()
        }
    }
}

private struct AchievementTile: View {
    let achievement: Achievement

    var body: some View {
        VStack(spacing: Space.x1) {
            Image(systemName: achievement.symbol)
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(achievement.name)
                .font(.jakarta(size: 13, weight: .heavy, relativeTo: .footnote))
                .foregroundStyle(Color.textPrimary)
            Text(achievement.description)
                .font(.caption2).foregroundStyle(Color.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 96)
        .padding(Space.x2)
        .background(Color.surfaceHover, in: RoundedRectangle.brand(Radius.lg))
        .accessibilityElement(children: .combine)
    }

    private var tint: Color {
        switch achievement.tone {
        case .green: .brand
        case .amber: .amber
        case .purple: .purple
        case .blue: .blue
        }
    }
}

/// Me → Your notes: every note on a show or a song, newest first, each
/// opening its show.
struct YourNotesLink: View {
    @Environment(ShowsStore.self) private var store

    var body: some View {
        let count = MyNotes.list(store.shows).count
        NavigationLink { YourNotesScreen().brandScreen() } label: {
            LabeledContent("Your notes", value: count == 0 ? "" : "\(count)")
        }
    }
}

struct YourNotesScreen: View {
    @Environment(ShowsStore.self) private var store

    var body: some View {
        let notes = MyNotes.list(store.shows)
        Group {
            if notes.isEmpty {
                ContentUnavailableView("No notes yet", systemImage: "text.bubble",
                                       description: Text("Notes you write on a show or a song appear here."))
            } else {
                List(notes) { note in
                    NavigationLink(value: AppRoute.show(id: note.showId)) {
                        VStack(alignment: .leading, spacing: Space.x1) {
                            Text(note.songName.map { "\(note.artist) · \($0)" } ?? note.artist)
                                .font(.brand(.sm, weight: .semibold)).foregroundStyle(Color.textPrimary)
                            Text(note.text)
                                .italic()
                                .font(.brand(.base)).foregroundStyle(Color.textSecondary)
                                .lineLimit(4)
                            Text([note.venue, ShowDateText.display(note.date)].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Color.textMuted)
                        }
                        .padding(.vertical, Space.x1)
                    }
                    .listRowBackground(Color.surface)
                }
            }
        }
        .navigationTitle("Your notes")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// What strangers would see at mysetlists.net/u/<handle>: the counts and the
/// five most recent shows, never notes, photos, wishlists or friends.
struct PublicProfilePreviewSheet: View {
    @Environment(ShowsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let handle: String
    let name: String

    var body: some View {
        let preview = PublicProfilePreview(stats: store.stats, shows: store.shows)
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name).font(.jakarta(size: 20, weight: .bold, relativeTo: .title3))
                        Text("mysetlists.net/u/\(handle.lowercased())").font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                    FigureGrid(figures: [
                        ("\(preview.shows)", "Shows", nil), ("\(preview.bands)", "Artists", nil),
                        ("\(preview.venues)", "Venues", nil), ("\(preview.years)", "Years", nil),
                    ])
                }
                .brandRow()
                Section("Recent shows") {
                    if preview.recent.isEmpty {
                        Text("No shows logged yet.").foregroundStyle(.secondary)
                    }
                    ForEach(preview.recent) { show in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(show.artist).font(.brand(.base, weight: .medium))
                            Text([show.venue, ShowDateText.display(show.date)].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .brandRow()
                Section {
                } footer: {
                    Text("Your notes, photos, wishlists and friends are never on your public page.")
                }
            }
            .navigationTitle("What strangers would see")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .brandScreen()
        }
    }
}

/// "Create a free account to keep your shows" above the shows, for a guest
/// with a show; dismissed for seven days (GuestRescueBanner.jsx). A native
/// guest's shows are on a guest account tied to this phone, so the wording
/// says that, not "only on this device".
struct GuestRescueBanner: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @AppStorage(GuestRescue.dismissedKey) private var dismissedAt: Double = 0
    /// The owner presents the upgrade, so the sheet outlives the banner
    /// (which goes away the moment the account exists).
    let createAccount: () -> Void

    var body: some View {
        let dismissed = dismissedAt > 0 ? Date(timeIntervalSince1970: dismissedAt) : nil
        if GuestRescue.shows(isGuest: session.user?.isAnonymous == true, showCount: store.shows.count, dismissedAt: dismissed) {
            HStack(alignment: .top, spacing: Space.x3) {
                Image(systemName: "icloud.and.arrow.up").foregroundStyle(Color.brand).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Space.x1) {
                    Text("Create a free account to keep your shows. Right now they're on a guest account on this phone.")
                        .font(.brand(.sm)).foregroundStyle(Color.textPrimary)
                    Button("Create free account", action: createAccount)
                        .font(.brand(.sm, weight: .semibold))
                        .tint(.brand)
                        .frame(minHeight: TouchTarget.minimum)
                }
                Spacer(minLength: 0)
                Button {
                    dismissedAt = Date().timeIntervalSince1970
                } label: {
                    Image(systemName: "xmark").font(.caption)
                        .frame(width: TouchTarget.minimum, height: TouchTarget.minimum)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Dismiss for now")
            }
            .padding(Space.x3)
            .background(Color.brand.opacity(0.12), in: RoundedRectangle.brand(Radius.xl))
            .overlay(RoundedRectangle.brand(Radius.xl).strokeBorder(Color.brand.opacity(0.3)))
        }
    }
}
