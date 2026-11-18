import Charts
import Core
import DesignSystem
import SwiftUI

// Songs (Stage 4, 4-4): every song you've seen, and one song's history,
// both from the shows on this phone (`ShowsStore.songIndex`, the Swift copy
// of `lib/songIndex.js`). Guests too: it's their own data.

/// Every song you've seen: times seen and the average of your ratings,
/// searchable and sortable. Each row is one song page (the strict artist
/// slug and the title, Stage 4 call C), so the same title by two bands is
/// two rows.
struct SongListView: View {
    @Environment(ShowsStore.self) private var store
    @State private var query = ""
    @State private var sort: SongList.Sort = .timesSeen

    var body: some View {
        let all = SongList.rows(store.songIndex)
        let rows = SongList.sorted(SongList.filtered(all, query: query), by: sort)
        List {
            Section {
                ForEach(rows) { row in
                    NavigationLink(value: AppRoute.song(artist: row.artistSlug, song: row.songSlug)) {
                        SongListRow(row: row, sort: sort)
                    }
                }
            } footer: {
                if !all.isEmpty, query.isEmpty {
                    Text(all.count == 1 ? "1 song" : "\(all.count.formatted()) songs")
                }
            }
            .brandRow()
        }
        .overlay {
            if !store.showsLoaded {
                ProgressView("Loading your songs")
            } else if all.isEmpty {
                ContentUnavailableView("No songs yet", systemImage: "music.note",
                                       description: Text("Add a show with a setlist, and every song you heard lands here."))
            } else if rows.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Songs or bands")
        .navigationTitle("Songs")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Sort by", selection: $sort) {
                        ForEach(SongList.Sort.allCases) { Text($0.label).tag($0) }
                    }
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
            }
        }
    }
}

struct SongListRow: View {
    let row: SongList.Row
    let sort: SongList.Sort

    var body: some View {
        HStack(spacing: Space.x3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(2)
                Text(row.artistName)
                    .font(.jakarta(size: 13, relativeTo: .footnote))
                    .foregroundStyle(Color.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: Space.x2)
            VStack(alignment: .trailing, spacing: 2) {
                Text(sort == .gap ? gapText : "\(row.timesSeen)×")
                    .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                    .monospacedDigit()
                    .foregroundStyle(Color.textPrimary)
                if let rating = row.averageRating {
                    Text("★ \(rating.formatted(.number.precision(.fractionLength(1))))")
                        .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                        .monospacedDigit()
                        .foregroundStyle(Color.amber)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var gapText: String { row.currentGap == 0 ? "Last show" : "\(row.currentGap) since" }

    private var accessibilityText: String {
        var parts = [row.title, row.artistName, row.timesSeen == 1 ? "seen once" : "seen \(row.timesSeen) times"]
        if let rating = row.averageRating { parts.append("average rating \(rating.formatted(.number.precision(.fractionLength(1))))") }
        if sort == .gap { parts.append(row.currentGap == 0 ? "at your last show" : "\(row.currentGap) shows since") }
        return parts.joined(separator: ", ")
    }
}

/// Where `/songs/?artist=&song=` leads: the song page, or "not found".
struct SongScreen: View {
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    let artist: String?
    let song: String

    var body: some View {
        Group {
            if let entry = store.song(key: SongIndex.key(artistSlug: artist, songSlug: song)) {
                SongPage(song: entry)
            } else if !store.showsLoaded {
                ProgressView("Loading the song")
            } else {
                ContentUnavailableView {
                    Label("Song not found", systemImage: "music.note")
                } description: {
                    Text("None of your shows has this song in its setlist.")
                } actions: {
                    Button("Open on mysetlists.net") { router.show(AppRoute.song(artist: artist, song: song).webURL) }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One song's history (`SongDetailView`): times seen, first and last seen,
/// the current gap, the longest gap, every time you've seen it, by year,
/// where it lands in the set, and your best versions.
struct SongPage: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    let song: SongIndex.Entry

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x5) {
                header
                StatGrid(song: song)
                gapText
                if horizontalSizeClass == .regular {
                    // Side by side on a wide window, as the web's sidebar.
                    HStack(alignment: .top, spacing: Space.x5) {
                        performances
                        VStack(alignment: .leading, spacing: Space.x5) { sideCards }
                            .frame(width: 280)
                    }
                } else {
                    sideCards
                    performances
                }
            }
            .padding(.horizontal, Space.x5)
            .padding(.top, Space.x2)
            .padding(.bottom, Space.x8)
            .frame(maxWidth: 900, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(song.title)
        .toolbar {
            // The header carries the title; this one stays for VoiceOver and the back stack.
            ToolbarItem(placement: .principal) { Text("").accessibilityHidden(true) }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Space.x1) {
            Text(song.title)
                .font(.jakarta(size: 26, weight: .bold, relativeTo: .title))
                .foregroundStyle(Color.textPrimary)
                .accessibilityAddTraits(.isHeader)
            NavigationLink(value: AppRoute.band(slug: song.artistSlug)) {
                Text(song.artistName)
                    .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                    .foregroundStyle(Color.brandLight)
            }
            .buttonStyle(.plain)
        }
    }

    private var gapText: some View {
        VStack(alignment: .leading, spacing: Space.x1) {
            Text(SongHistory.gapSentence(song, date: ShowDateText.display))
                .font(.jakarta(size: 15, relativeTo: .body))
                .foregroundStyle(Color.textSecondary)
            if let longest = song.longestGap {
                Text(SongHistory.longestGapLine(longest, date: ShowDateText.display))
                    .font(.jakarta(size: 12, relativeTo: .caption))
                    .foregroundStyle(Color.textMuted)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var performances: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            SectionTitle("Every time you've seen it")
            VStack(spacing: 0) {
                ForEach(Array(song.performances.enumerated()), id: \.offset) { index, perf in
                    NavigationLink(value: AppRoute.show(id: perf.showId)) { PerformanceRow(perf: perf) }
                        .buttonStyle(.plain)
                    if index < song.performances.count - 1 { Divider().overlay(Color.borderSubtle) }
                }
            }
            .padding(.horizontal, Space.x3)
            .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var sideCards: some View {
        let years = SongHistory.byYear(song.performances)
        if !years.isEmpty {
            VStack(alignment: .leading, spacing: Space.x2) {
                SectionTitle("By year")
                SongByYearChart(years: years)
                    .padding(Space.x3)
                    .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
            }
        }
        if let lands = SongHistory.whereItLands(song.performances) {
            VStack(alignment: .leading, spacing: Space.x2) {
                SectionTitle("Where it lands")
                Text(lands)
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Space.x3)
                    .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
            }
        }
        let best = SongHistory.bestVersions(song.performances)
        if !best.isEmpty {
            VStack(alignment: .leading, spacing: Space.x2) {
                SectionTitle("Your best versions")
                VStack(spacing: 0) {
                    ForEach(Array(best.enumerated()), id: \.offset) { index, perf in
                        NavigationLink(value: AppRoute.show(id: perf.showId)) {
                            HStack {
                                Text("\(ShowDateText.display(perf.date)) · \(perf.venue)")
                                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                                    .foregroundStyle(Color.textPrimary)
                                    .lineLimit(1)
                                Spacer(minLength: Space.x2)
                                Text("\(perf.rating ?? 0)/10")
                                    .font(.jakarta(size: 14, weight: .bold, relativeTo: .subheadline))
                                    .monospacedDigit()
                                    .foregroundStyle(Color.amber)
                            }
                            .frame(minHeight: TouchTarget.minimum)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if index < best.count - 1 { Divider().overlay(Color.borderSubtle) }
                    }
                }
                .padding(.horizontal, Space.x3)
                .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
            }
        }
    }
}

private struct SectionTitle: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.jakarta(size: 13, weight: .bold, relativeTo: .footnote))
            .tracking(0.8)
            .foregroundStyle(Color.brandLight)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Times seen, first seen, last seen, current gap.
private struct StatGrid: View {
    let song: SongIndex.Entry

    var body: some View {
        Grid(horizontalSpacing: Space.x2, verticalSpacing: Space.x2) {
            GridRow {
                figure("\(song.timesSeen)", "Times seen", nil)
                figure(song.currentGap.shows == 1 ? "1 show" : "\(song.currentGap.shows) shows", "Current gap", nil)
            }
            GridRow {
                figure(ShowDateText.display(song.firstSeen.date), "First seen", song.firstSeen.venue)
                figure(ShowDateText.display(song.lastSeen.date), "Last seen", song.lastSeen.venue)
            }
        }
    }

    private func figure(_ value: String, _ label: String, _ detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.jakarta(size: 18, weight: .bold, relativeTo: .title3))
                .monospacedDigit()
                .foregroundStyle(Color.textPrimary)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Text(label)
                .font(.jakarta(size: 12, relativeTo: .caption))
                .foregroundStyle(Color.textMuted)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.jakarta(size: 12, relativeTo: .caption))
                    .foregroundStyle(Color.textSecondary)
                    .lineLimit(1)
            }
        }
        // Each row's cards the same height.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(Space.x3)
        .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
        .accessibilityElement(children: .combine)
    }
}

/// One performance (`SongPerformanceRow`): date, venue, set and place,
/// segues, "added by you", your rating.
struct PerformanceRow: View {
    let perf: SongIndex.Performance

    var body: some View {
        HStack(alignment: .top, spacing: Space.x3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(ShowDateText.display(perf.date))
                    .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                    .foregroundStyle(Color.textPrimary)
                let place = venueLine(perf.venue, perf.city)
                if !place.isEmpty {
                    Text(place)
                        .font(.jakarta(size: 13, relativeTo: .footnote))
                        .foregroundStyle(Color.textSecondary)
                        .lineLimit(1)
                }
                let marks = self.marks
                if !marks.isEmpty {
                    Text(marks.joined(separator: " · "))
                        .font(.jakarta(size: 12, relativeTo: .caption))
                        .foregroundStyle(Color.textMuted)
                }
            }
            Spacer(minLength: Space.x2)
            if let rating = perf.rating, rating > 0 {
                Text("★ \(rating)/10")
                    .font(.jakarta(size: 13, weight: .bold, relativeTo: .footnote))
                    .monospacedDigit()
                    .foregroundStyle(Color.amber)
            }
        }
        .padding(.vertical, Space.x3)
        .frame(minHeight: TouchTarget.minimum)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var marks: [String] {
        var out: [String] = []
        if let label = perf.setLabel { out.append(perf.position.map { "\(label) · #\($0)" } ?? label) }
        // The show page's "> segue" vocabulary.
        if perf.segueIn { out.append("> segue in") }
        if perf.segueOut { out.append("segue out >") }
        if perf.manuallyAdded { out.append("Added by you") }
        return out
    }
}

/// Performances per year, as bars.
struct SongByYearChart: View {
    let years: [(year: String, count: Int)]

    var body: some View {
        Chart(years, id: \.year) { item in
            BarMark(x: .value("Year", item.year), y: .value("Times", item.count), width: years.count < 6 ? .fixed(28) : .automatic)
                .foregroundStyle(Color.brand.gradient)
                .cornerRadius(4)
                .annotation(position: .top, spacing: 2) {
                    Text("\(item.count)")
                        .font(.jakarta(size: 11, relativeTo: .caption2))
                        .foregroundStyle(Color.textSecondary)
                }
        }
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6)) { _ in
                AxisValueLabel().font(.jakarta(size: 11, relativeTo: .caption2)).foregroundStyle(Color.textMuted)
            }
        }
        .frame(height: 120)
        .accessibilityLabel("Times seen by year")
        .accessibilityValue(years.map { "\($0.year): \($0.count)" }.joined(separator: ", "))
    }
}
