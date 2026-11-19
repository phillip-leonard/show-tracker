import Core
import DesignSystem
import SwiftUI

// Community (Stage 4, 4-11), as the web's /community
// (components/CommunityStatsView.jsx): top show-goers, top raters, top
// rated songs and top venues from `communityStats/global`, then the totals.
// The user count shows only from 1,000 users (`UserCount.shouldShow`); below
// that it isn't there at all. Guests can look; their "Add" asks them to make
// an account, as on the web.

/// `/community`, from Stats.
struct CommunityScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(FriendsStore.self) private var friends
    @State private var stats: CommunityStats? = CommunityService.last
    @State private var loaded = CommunityService.last != nil
    @State private var missing = false
    @State private var problem: String?
    @State private var person: PersonRef?
    @State private var upgrading = false
    @State private var notice: String?

    private var isGuest: Bool { session.user?.isAnonymous == true }
    private var me: String? { session.user?.uid }

    var body: some View {
        content
            .navigationTitle("Community")
            .task { await load() }
            .refreshable { await load() }
            .sheet(item: $person) { PersonSheet(person: $0) }
            .sheet(isPresented: $upgrading) { GuestUpgradeView() }
            .notice($notice)
    }

    @ViewBuilder private var content: some View {
        if let stats {
            boards(stats)
        } else if !loaded {
            ProgressView("Loading community stats")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if missing {
            ContentUnavailableView {
                Label("No boards yet", systemImage: "person.3")
            } description: {
                Text("The community boards are rebuilt every six hours. Check back soon.")
            }
        } else {
            ContentUnavailableView {
                Label(Connectivity.shared.isOnline ? "Couldn't load the community" : "You're offline",
                      systemImage: Connectivity.shared.isOnline ? "exclamationmark.triangle" : "wifi.slash")
            } description: {
                Text(problem ?? "Try again in a moment.")
            } actions: {
                Button("Try again") { Task { await load() } }
                    .buttonStyle(.borderedProminent)
                    .tint(.brand)
            }
        }
    }

    private func load() async {
        do {
            let fresh = try await CommunityService.load()
            stats = fresh ?? stats
            missing = fresh == nil && stats == nil
            problem = nil
        } catch {
            problem = "The community boards didn't load. Pull to try again."
        }
        loaded = true
    }

    // MARK: The boards

    private func boards(_ stats: CommunityStats) -> some View {
        let blocked = Set(friends.blockedUids)
        let friendUids = Set(friends.friends.map(\.friendUid))
        return List {
            Section {
                people(Community.showGoers(stats, blocked: blocked), friends: friendUids, one: "show", many: "shows", tint: .brand)
            } header: {
                header("Top Show-Goers", systemImage: "trophy.fill", tint: .brand)
            }
            .brandRow()

            Section {
                people(Community.raters(stats, blocked: blocked), friends: friendUids, one: "rating", many: "ratings", tint: .amber)
            } header: {
                header("Top Raters", systemImage: "star.fill", tint: .danger)
            }
            .brandRow()

            Section {
                let songs = Community.songs(stats)
                if songs.isEmpty {
                    empty("Not enough ratings yet. Songs need at least 2 ratings to appear.")
                }
                ForEach(songs.indices, id: \.self) { i in
                    let song = songs[i]
                    HStack(spacing: Space.x3) {
                        BoardRank(rank: i + 1)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(song.songName)
                                .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                                .foregroundStyle(Color.textPrimary)
                                .lineLimit(1)
                            if !song.artists.isEmpty {
                                Text(song.artists.joined(separator: ", "))
                                    .font(.jakarta(size: 12, relativeTo: .caption))
                                    .foregroundStyle(Color.textSecondary)
                                    .lineLimit(1)
                            }
                        }
                        Spacer(minLength: Space.x2)
                        VStack(alignment: .trailing, spacing: 2) {
                            CountChip(text: Community.rating(song.avgRating), tint: .amber)
                            Text(Community.count(song.ratingCount, "rating", "ratings"))
                                .font(.jakarta(size: 12, relativeTo: .caption))
                                .foregroundStyle(Color.textSecondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            } header: {
                header("Top Rated Songs", systemImage: "chart.line.uptrend.xyaxis", tint: .amber)
            }
            .brandRow()

            Section {
                let venues = Community.venues(stats)
                if venues.isEmpty { empty("No venues on the board yet.") }
                ForEach(venues.indices, id: \.self) { i in
                    let venue = venues[i]
                    HStack(spacing: Space.x3) {
                        BoardRank(rank: i + 1)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(venue.venueName)
                                .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                                .foregroundStyle(Color.textPrimary)
                                .lineLimit(1)
                            Text(Community.count(venue.artistCount, "artist", "artists"))
                                .font(.jakarta(size: 12, relativeTo: .caption))
                                .foregroundStyle(Color.textSecondary)
                        }
                        Spacer(minLength: Space.x2)
                        CountChip(text: Community.count(venue.showCount, "show", "shows"), tint: .amber)
                    }
                    .accessibilityElement(children: .combine)
                }
            } header: {
                header("Top Venues", systemImage: "building.2.fill", tint: .amber)
            }
            .brandRow()

            Section {
                ForEach(Community.totals(stats)) { total in
                    LabeledContent(total.label) {
                        Text(total.value.formatted())
                            .font(.jakarta(size: 17, weight: .bold, relativeTo: .body))
                            .monospacedDigit()
                            .foregroundStyle(Color.textPrimary)
                    }
                }
            } header: {
                Text("Everyone on MySetlists")
            } footer: {
                if let updated = Community.updatedLabel(stats.updatedAt) {
                    Text("\(updated). Your own numbers update as you log shows.")
                }
            }
            .brandRow()
        }
        .brandScreen()
    }

    @ViewBuilder
    private func people(_ entries: [CommunityStats.LeaderboardEntry], friends friendUids: Set<String>,
                        one: String, many: String, tint: Color) -> some View {
        if entries.isEmpty {
            empty("No one on the board yet. Log your shows to be the first.")
        }
        ForEach(entries.indices, id: \.self) { i in
            let entry = entries[i]
            let name = entry.firstName ?? "Someone"
            HStack(spacing: Space.x3) {
                BoardRank(rank: i + 1)
                PersonAvatar(name: name, photoURL: entry.photoURL, size: 32)
                // A name opens their card, with Report and Block (Guideline
                // 1.2), as on comments and photos. Plain text for guests and
                // for your own name.
                if !isGuest, entry.userId != me {
                    Button { person = PersonRef(uid: entry.userId, name: name) } label: {
                        Text(name)
                            .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Shows their profile")
                } else {
                    Text(entry.userId == me ? "\(name) (you)" : name)
                        .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                        .foregroundStyle(Color.textPrimary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if Community.offersAdd(entry.userId, me: me, friends: friendUids) {
                    addButton(entry, name: name)
                }
                CountChip(text: Community.count(entry.count, one, many), tint: tint)
            }
        }
    }

    @ViewBuilder
    private func addButton(_ entry: CommunityStats.LeaderboardEntry, name: String) -> some View {
        if !isGuest, friends.hasSentRequest(to: entry.userId) {
            Text("Sent")
                .font(.jakarta(size: 12, weight: .medium, relativeTo: .caption))
                .foregroundStyle(Color.textSecondary)
        } else {
            Button {
                if isGuest {
                    upgrading = true
                } else {
                    Task { notice = await friends.sendRequest(to: entry.userId, name: name) }
                }
            } label: {
                Label("Add", systemImage: "person.badge.plus")
                    .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
            }
            .buttonStyle(.bordered)
            .tint(.brand)
            .controlSize(.small)
            .disabled(friends.busy.contains(entry.userId))
            .accessibilityLabel("Add \(name) as a friend")
        }
    }

    private func header(_ title: String, systemImage: String, tint: Color) -> some View {
        Label {
            Text(title)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(tint)
        }
    }

    private func empty(_ text: String) -> some View {
        Text(text)
            .font(.jakarta(size: 14, relativeTo: .subheadline))
            .foregroundStyle(Color.textSecondary)
    }
}

/// 1, 2, 3 stand out; the rest are muted.
private struct BoardRank: View {
    let rank: Int

    var body: some View {
        Text("\(rank)")
            .font(.jakarta(size: 17, weight: .bold, relativeTo: .body))
            .monospacedDigit()
            .foregroundStyle(rank == 1 ? Color.brand : rank <= 3 ? Color.textPrimary : Color.textSecondary)
            .frame(minWidth: 22, alignment: .leading)
            .accessibilityLabel("Number \(rank)")
    }
}

/// The count on the right of a row.
private struct CountChip: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, Space.x2)
            .padding(.vertical, 3)
            .background(tint.opacity(0.15), in: Capsule())
            .foregroundStyle(tint)
    }
}
