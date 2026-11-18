import Charts
import Core
import DesignSystem
import SwiftUI

/// The Stats tab (Stage 2): every number is the server's `userStats/{uid}`
/// (DECISIONS.md "Stage 2", C-2): totals, rank as "#N" (C-5), shows by year,
/// and the top 10 bands, songs and venues, all time. Tapping one lists your
/// shows for it. Nothing here is computed on the phone.
struct StatsHome: View {
    @Environment(ShowsStore.self) private var store
    @Environment(SessionStore.self) private var session
    @Environment(AppRouter.self) private var router
    @State private var upgrading = false
    @State private var adding = false

    private var isGuest: Bool { session.user?.isAnonymous == true }
    private var hasShows: Bool { !store.shows.isEmpty || !store.waitingShows.isEmpty }

    var body: some View {
        content
            .navigationTitle("Stats")
            .sheet(isPresented: $upgrading) { GuestUpgradeView() }
            .sheet(isPresented: $adding) { AddShowSheet() }
    }

    @ViewBuilder private var content: some View {
        if let stats = store.stats, stats.showCount > 0 || hasShows {
            list(stats)
        } else if !store.showsLoaded || !store.statsLoaded {
            ProgressView("Loading your stats")
        } else if !hasShows {
            ContentUnavailableView {
                Label("No stats yet", systemImage: "chart.bar")
            } description: {
                Text("Add the shows you've been to, and your bands, songs and venues add up here.")
            } actions: {
                Button { adding = true } label: { Label("Add a show", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
                    .tint(.brand)
                Button("See the community") { router.show(LibraryDestination.community.webURL) }
                    .tint(.brand)
            }
        } else {
            // Shows, but no numbers yet: the server hasn't counted them (a
            // new account), or this phone has never been online with them.
            ContentUnavailableView {
                Label(Connectivity.shared.isOnline ? "Counting your shows" : "You're offline",
                      systemImage: Connectivity.shared.isOnline ? "hourglass" : "wifi.slash")
            } description: {
                Text(Connectivity.shared.isOnline
                     ? "Your stats appear here in a moment."
                     : "Your stats load the next time you're online, and stay on this iPhone after that.")
            }
        }
    }

    // MARK: The numbers

    private func list(_ stats: UserStats) -> some View {
        List {
            Section {
                TotalsGrid(stats: stats)
            } footer: {
                statusNote(stats)
            }
            .brandRow()

            rankSection(stats)

            // Community (Stage 4, F-1): next to where you rank.
            CommunitySection()

            if RecapWindow.shown(isAccount: !isGuest) {
                Section {
                    Button { router.show(RecapWindow.url) } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Your \(String(RecapWindow.year)) in review")
                                    .font(.jakarta(size: 16, weight: .semibold, relativeTo: .body))
                                    .foregroundStyle(Color.textPrimary)
                                Text("Opens on mysetlists.net. Sign in there the first time.")
                                    .font(.jakarta(size: 13, relativeTo: .footnote))
                                    .foregroundStyle(Color.textSecondary)
                            }
                        } icon: {
                            Image(systemName: "sparkles").foregroundStyle(Color.amber)
                        }
                    }
                }
                .brandRow()
            }

            if !stats.showsByYear.isEmpty {
                Section("Shows by year") {
                    ShowsByYearChart(byYear: stats.showsByYear)
                        .padding(.vertical, Space.x2)
                }
                .brandRow()
            }

            topSection("Top bands", stats.topBands.map { TopEntry(filter: ShowsFilter(kind: .band, title: $0.name), detail: nil, count: $0.count) })
            topSection("Top songs", stats.topSongs.map {
                TopEntry(filter: ShowsFilter(kind: .song, title: $0.name, artist: $0.artist), detail: $0.artist.isEmpty ? nil : $0.artist, count: $0.count)
            })
            // Every song (Stage 4, 4-4), from the shows on this phone.
            if !stats.topSongs.isEmpty || store.shows.contains(where: { !$0.setlist.isEmpty }) {
                Section {
                    NavigationLink(value: AppRoute.songs) {
                        Label("All your songs", systemImage: "music.note.list")
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                    }
                }
                .brandRow()
            }
            topSection("Top venues", stats.topVenues.map { TopEntry(filter: ShowsFilter(kind: .venue, title: $0.name), detail: nil, count: $0.count) })
        }
        .refreshable { await store.refresh() }
    }

    @ViewBuilder private func rankSection(_ stats: UserStats) -> some View {
        if isGuest {
            Section {
                Notice(title: "Create an account to see your rank",
                       text: "Your stats stay as they are. An account also lets you add friends and scan tickets.",
                       symbol: "trophy", tint: .amber,
                       action: ("Create your account", { upgrading = true }))
            }
            .brandRow()
        } else if stats.ranked, let rank = stats.rank {
            // "#N" only: never how many people are ranked (C-5, the
            // 1,000-user rule).
            Section {
                LabeledContent {
                    Text("#\(rank)")
                        .font(.jakarta(size: 20, weight: .bold, relativeTo: .title3))
                        .monospacedDigit()
                        .foregroundStyle(Color.amber)
                } label: {
                    Label("Rank by shows", systemImage: "trophy")
                        .font(.jakarta(size: 15, relativeTo: .body))
                        .foregroundStyle(Color.textPrimary)
                }
            }
            .brandRow()
        }
    }

    @ViewBuilder private func topSection(_ title: String, _ entries: [TopEntry]) -> some View {
        if !entries.isEmpty {
            Section(title) {
                ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
                    NavigationLink(value: AppRoute.myShows(entry.filter)) {
                        TopRow(place: index + 1, entry: entry)
                    }
                }
            }
            .brandRow()
        }
    }

    /// Why the numbers might not match the list yet.
    @ViewBuilder private func statusNote(_ stats: UserStats) -> some View {
        if store.statsFromCache && !Connectivity.shared.isOnline {
            Text("Offline: these are the numbers saved on this iPhone.")
        } else if stats.showCount != store.shows.count || !store.waitingShows.isEmpty {
            Text("Updating: recent changes are still being counted.")
        }
    }
}

struct TopEntry: Hashable {
    let filter: ShowsFilter
    let detail: String?
    let count: Int
}

/// Shows, bands, songs, unique songs, venues and years, as the server counts them.
struct TotalsGrid: View {
    let stats: UserStats

    var body: some View {
        Grid(horizontalSpacing: Space.x2, verticalSpacing: Space.x4) {
            GridRow {
                figure(stats.showCount, stats.showCount == 1 ? "Show" : "Shows")
                figure(stats.bandCount, stats.bandCount == 1 ? "Band" : "Bands")
                figure(stats.venueCount, stats.venueCount == 1 ? "Venue" : "Venues")
            }
            GridRow {
                figure(stats.songCount, "Songs heard")
                figure(stats.uniqueSongCount, "Different songs")
                figure(stats.yearsActive, stats.yearsActive == 1 ? "Year" : "Years")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Space.x2)
    }

    private func figure(_ value: Int, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value.formatted())
                .font(.jakarta(size: 22, weight: .bold, relativeTo: .title2))
                .monospacedDigit()
                .foregroundStyle(Color.textPrimary)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Text(label)
                .font(.jakarta(size: 12, relativeTo: .caption))
                .foregroundStyle(Color.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// `userStats.showsByYear` as bars, oldest year first.
struct ShowsByYearChart: View {
    let byYear: [String: Int]

    private var years: [(year: String, count: Int)] {
        byYear.map { ($0.key, $0.value) }.sorted { $0.year < $1.year }
    }

    var body: some View {
        Chart(years, id: \.year) { item in
            // A few years draw slim bars rather than one bar across the card.
            BarMark(x: .value("Year", item.year), y: .value("Shows", item.count), width: years.count < 6 ? .fixed(36) : .automatic)
                .foregroundStyle(Color.brand.gradient)
                .cornerRadius(4)
                .annotation(position: .top, spacing: 2) {
                    if years.count <= 12 {
                        Text("\(item.count)")
                            .font(.jakarta(size: 11, relativeTo: .caption2))
                            .foregroundStyle(Color.textSecondary)
                    }
                }
        }
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 8)) { _ in
                AxisValueLabel().font(.jakarta(size: 11, relativeTo: .caption2)).foregroundStyle(Color.textMuted)
            }
        }
        .frame(height: 170)
        .accessibilityLabel("Shows by year")
        .accessibilityValue(years.map { "\($0.year): \($0.count)" }.joined(separator: ", "))
    }
}

struct TopRow: View {
    let place: Int
    let entry: TopEntry

    var body: some View {
        HStack(spacing: Space.x3) {
            Text("\(place)")
                .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
                .monospacedDigit()
                .foregroundStyle(Color.textMuted)
                .frame(minWidth: 20, alignment: .trailing)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.filter.title)
                    .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(2)
                if let detail = entry.detail {
                    Text(detail)
                        .font(.jakarta(size: 13, relativeTo: .footnote))
                        .foregroundStyle(Color.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: Space.x2)
            Text(entry.count == 1 ? "1 show" : "\(entry.count) shows")
                .font(.jakarta(size: 13, relativeTo: .footnote))
                .monospacedDigit()
                .foregroundStyle(Color.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Your shows for one band, song or venue, newest first, from the shows
/// already on this phone. Full band, song and venue pages are Stage 4.
struct MyShowsList: View {
    @Environment(ShowsStore.self) private var store
    let filter: ShowsFilter

    var body: some View {
        let shows = filter.shows(in: store.shows)
        let today = ShowDate.today()
        List {
            Section {
                ForEach(shows) { show in
                    NavigationLink(value: AppRoute.show(id: show.id)) { ShowRow(show: show, today: today) }
                }
            } header: {
                if let artist = filter.artist, !artist.isEmpty { Text(artist) }
            } footer: {
                Text(shows.count == 1 ? "1 show" : "\(shows.count) shows")
            }
            .brandRow()
        }
        .overlay {
            if shows.isEmpty {
                ContentUnavailableView("No shows here yet", systemImage: "music.note.list",
                                       description: Text("This list fills in once your shows have loaded."))
            }
        }
        .navigationTitle(filter.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
