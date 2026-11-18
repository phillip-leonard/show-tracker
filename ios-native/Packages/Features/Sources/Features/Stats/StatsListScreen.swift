import Core
import DesignSystem
import SwiftUI

/// One of the period's full lists (Stage 4, 4-8): every band or venue with
/// its shows, average show rating and a detail, or the ten best-rated
/// shows. Built from the shows on this phone with the server's keys
/// (`StatsLists`), so a row here is the band or venue the headline counts
/// count. Songs are the song list for the year (`SongListView`).
struct StatsListScreen: View {
    let kind: StatsLists.Kind
    let year: String?

    var body: some View {
        if kind == .songs {
            SongListView(year: year)
        } else {
            StatsRowsList(kind: kind, year: year)
        }
    }
}

private struct StatsRowsList: View {
    @Environment(ShowsStore.self) private var store
    let kind: StatsLists.Kind
    let year: String?
    @State private var query = ""

    var body: some View {
        let shows = StatsLists.shows(store.shows, in: year.map(StatsPeriod.year) ?? .allTime)
        List {
            if kind == .topShows {
                let today = ShowDate.today()
                Section {
                    ForEach(Array(StatsLists.topRated(shows).enumerated()), id: \.element.id) { i, show in
                        NavigationLink(value: AppRoute.show(id: show.id)) {
                            HStack(spacing: Space.x3) {
                                Text("\(i + 1)")
                                    .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
                                    .monospacedDigit()
                                    .foregroundStyle(Color.textMuted)
                                    .frame(minWidth: 20, alignment: .trailing)
                                ShowRow(show: show, today: today)
                            }
                        }
                    }
                } footer: {
                    Text("Your best-rated shows, then the newest.")
                }
                .brandRow()
            } else {
                let all = kind == .bands ? StatsLists.bands(shows) : StatsLists.venues(shows)
                let rows = filtered(all)
                Section {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                        NavigationLink(value: AppRoute.myShows(row.filter)) {
                            StatsListRow(place: i + 1, row: row)
                        }
                    }
                } footer: {
                    if query.isEmpty {
                        Text("\(all.count.formatted()) \(kind == .bands ? (all.count == 1 ? "band" : "bands") : (all.count == 1 ? "venue" : "venues")), from the shows on this iPhone.")
                    }
                }
                .brandRow()
            }
        }
        .overlay { emptyState(shows) }
        .modifier(SearchIf(enabled: kind != .topShows, query: $query, prompt: kind == .bands ? "Bands" : "Venues or cities"))
        .navigationTitle(year.map { "\(kind.title) · \($0)" } ?? kind.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func filtered(_ rows: [StatsLists.Row]) -> [StatsLists.Row] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return rows }
        return rows.filter { $0.name.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
    }

    @ViewBuilder private func emptyState(_ shows: [Show]) -> some View {
        if !store.showsLoaded {
            ProgressView("Loading your shows")
        } else if kind == .topShows, StatsLists.topRated(shows).isEmpty {
            ContentUnavailableView("No rated shows yet", systemImage: "star",
                                   description: Text("Rate a show out of 10 on its page, and your best ones land here."))
        } else if kind != .topShows, shows.isEmpty {
            ContentUnavailableView("No shows here yet", systemImage: "music.note.list",
                                   description: Text(year.map { "You haven't logged a show in \($0)." } ?? "Add a show and it counts here."))
        } else if kind != .topShows, !query.isEmpty,
                  filtered(kind == .bands ? StatsLists.bands(shows) : StatsLists.venues(shows)).isEmpty {
            ContentUnavailableView.search(text: query)
        }
    }
}

/// Searchable only where there's something to search.
private struct SearchIf: ViewModifier {
    let enabled: Bool
    @Binding var query: String
    let prompt: String

    func body(content: Content) -> some View {
        if enabled {
            content.searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: prompt)
        } else {
            content
        }
    }
}

/// A band or venue: its place, name, detail, shows and average rating.
struct StatsListRow: View {
    let place: Int
    let row: StatsLists.Row

    var body: some View {
        HStack(spacing: Space.x3) {
            Text("\(place)")
                .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
                .monospacedDigit()
                .foregroundStyle(Color.textMuted)
                .frame(minWidth: 24, alignment: .trailing)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name)
                    .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(2)
                if let detail = row.detail {
                    Text(detail)
                        .font(.jakarta(size: 13, relativeTo: .footnote))
                        .foregroundStyle(Color.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: Space.x2)
            VStack(alignment: .trailing, spacing: 2) {
                Text(row.count == 1 ? "1 show" : "\(row.count.formatted()) shows")
                    .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
                    .monospacedDigit()
                    .foregroundStyle(Color.textPrimary)
                if let average = row.averageRating {
                    Text("★ \(average)")
                        .font(.jakarta(size: 12, weight: .bold, relativeTo: .caption))
                        .monospacedDigit()
                        .foregroundStyle(Color.amber)
                        .accessibilityLabel("average rating \(average) out of 10")
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
