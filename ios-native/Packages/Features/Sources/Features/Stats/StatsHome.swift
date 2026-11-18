import Charts
import Core
import DesignSystem
import SwiftUI

/// The Stats tab (Stage 2; by period since Stage 4, 4-8): the server's
/// `userStats/{uid}` for all time or one year (`years`, F-15): totals, the
/// average show rating, shows by month, and the top 10 bands, songs and
/// venues, with rank as "#N" (C-5) and shows by year for all time. The full
/// lists and top-rated shows, which the server doesn't store, come from the
/// shows on this phone with the server's keys (`StatsLists`).
struct StatsHome: View {
    @Environment(ShowsStore.self) private var store
    @Environment(SessionStore.self) private var session
    @Environment(AppRouter.self) private var router
    @State private var upgrading = false
    @State private var adding = false
    @State private var period: StatsPeriod = .allTime

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

    /// The picked period, or all time when that year has gone (its shows deleted).
    private func current(_ stats: UserStats) -> StatsPeriod {
        if let year = period.year, stats.years[year] == nil { return .allTime }
        return period
    }

    private func list(_ stats: UserStats) -> some View {
        let period = current(stats)
        let numbers = stats.numbers(for: period) ?? stats.numbers(for: .allTime)!
        let periodShows = StatsLists.shows(store.shows, in: period)
        let year = period.year
        return List {
            if !stats.pickerYears.isEmpty {
                Section {
                    PeriodPicker(years: stats.pickerYears, period: self.$period)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            Section {
                TotalsGrid(numbers: numbers, yearsActive: year == nil ? stats.yearsActive : nil)
            } header: {
                Text(year.map { "Your \($0)" } ?? "All time")
            } footer: {
                statusNote(stats, numbers: numbers, period: period)
            }
            .brandRow()

            averageSection(numbers)

            if year == nil {
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
            }

            if !stats.showsByYear.isEmpty {
                Section {
                    ShowsByYearChart(byYear: stats.showsByYear, pickedYear: year.flatMap(Int.init)) { picked in
                        let y = String(picked)
                        if stats.years[y] != nil { self.period = .year(y) }
                    }
                    .padding(.vertical, Space.x2)
                } header: {
                    Text("Shows by year")
                } footer: {
                    Text("Touch and drag to read a year. Tap a bar to see that year.")
                }
                .brandRow()
            }

            if numbers.showsByMonth.contains(where: { $0 > 0 }) {
                Section {
                    MonthHeatmap(counts: numbers.showsByMonth)
                        .padding(.vertical, Space.x2)
                } header: {
                    Text("Shows by month")
                } footer: {
                    Text(year == nil ? "Every year added up." : "\(numbers.showCount.formatted()) show\(numbers.showCount == 1 ? "" : "s") in \(year!).")
                }
                .brandRow()
            }

            topSection("Top bands", numbers.topBands.map { TopEntry(filter: ShowsFilter(kind: .band, title: $0.name), detail: nil, count: $0.count) },
                       all: numbers.bandCount > numbers.topBands.count ? (AppRoute.statsList(.bands, year: year), "All \(numbers.bandCount.formatted()) bands") : nil)
            topSection("Top songs", numbers.topSongs.map {
                TopEntry(filter: ShowsFilter(kind: .song, title: $0.name, artist: $0.artist), detail: $0.artist.isEmpty ? nil : $0.artist, count: $0.count)
            }, all: nil)
            // Every song (Stage 4, 4-4), from the shows on this phone.
            if !numbers.topSongs.isEmpty || periodShows.contains(where: { !$0.setlist.isEmpty }) {
                Section {
                    NavigationLink(value: year == nil ? AppRoute.songs : AppRoute.statsList(.songs, year: year)) {
                        Label(year.map { "All your songs in \($0)" } ?? "All your songs", systemImage: "music.note.list")
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                    }
                }
                .brandRow()
            }
            topSection("Top venues", numbers.topVenues.map { TopEntry(filter: ShowsFilter(kind: .venue, title: $0.name), detail: nil, count: $0.count) },
                       all: numbers.venueCount > numbers.topVenues.count ? (AppRoute.statsList(.venues, year: year), "All \(numbers.venueCount.formatted()) venues") : nil)

            topRatedSection(periodShows, year: year)

            // Your runs (Stage 4, 4-6), all time: `/stats/runs`.
            if year == nil, !store.runs.isEmpty {
                Section {
                    NavigationLink(value: AppRoute.runs) {
                        Label("Your runs · \(store.runs.count.formatted())", systemImage: "calendar.day.timeline.left")
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                    }
                } footer: {
                    Text("Two or more nights of one band at one venue.")
                }
                .brandRow()
            }
        }
        .refreshable { await store.refresh() }
    }

    /// The period's average show rating (the server's), and how many shows it's from.
    @ViewBuilder private func averageSection(_ numbers: PeriodStats) -> some View {
        if let average = NumberText.rating(numbers.avgShowRating), numbers.ratedShowCount > 0 {
            Section {
                LabeledContent {
                    Text("\(average)/10")
                        .font(.jakarta(size: 20, weight: .bold, relativeTo: .title3))
                        .monospacedDigit()
                        .foregroundStyle(Color.amber)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Average show rating", systemImage: "star")
                            .font(.jakarta(size: 15, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                        Text("From \(numbers.ratedShowCount.formatted()) rated show\(numbers.ratedShowCount == 1 ? "" : "s")")
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textSecondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            .brandRow()
        }
    }

    /// The three best-rated shows of the period, then all ten (the web's "Top Shows").
    @ViewBuilder private func topRatedSection(_ shows: [Show], year: String?) -> some View {
        let top = StatsLists.topRated(shows)
        if !top.isEmpty {
            let today = ShowDate.today()
            Section {
                ForEach(top.prefix(3)) { show in
                    NavigationLink(value: AppRoute.show(id: show.id)) { ShowRow(show: show, today: today) }
                }
                if top.count > 3 {
                    NavigationLink(value: AppRoute.statsList(.topShows, year: year)) {
                        Text("Top \(top.count) rated shows")
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.brand)
                    }
                }
            } header: {
                Text("Top-rated shows")
            }
            .brandRow()
        }
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

    @ViewBuilder private func topSection(_ title: String, _ entries: [TopEntry], all: (AppRoute, String)?) -> some View {
        if !entries.isEmpty {
            Section(title) {
                ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
                    NavigationLink(value: AppRoute.myShows(entry.filter)) {
                        TopRow(place: index + 1, entry: entry)
                    }
                }
                if let all {
                    NavigationLink(value: all.0) {
                        Text(all.1)
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.brand)
                    }
                }
            }
            .brandRow()
        }
    }

    /// Why the numbers might not match the list yet.
    @ViewBuilder private func statusNote(_ stats: UserStats, numbers: PeriodStats, period: StatsPeriod) -> some View {
        if store.statsFromCache && !Connectivity.shared.isOnline {
            Text("Offline: these are the numbers saved on this iPhone.")
        } else if stats.showCount != store.shows.count || !store.waitingShows.isEmpty
                    || numbers.showCount != StatsLists.shows(store.shows, in: period).count {
            Text("Updating: recent changes are still being counted.")
        } else if period == .allTime, stats.years.isEmpty, stats.showCount > 0 {
            // A document from before the per-year block: years appear at the next recompute.
            Text("Your years appear here once your stats next update.")
        }
    }
}

struct TopEntry: Hashable {
    let filter: ShowsFilter
    let detail: String?
    let count: Int
}

/// Shows, bands, venues, songs heard, song titles and (all time) years, as
/// the server counts them for the period.
struct TotalsGrid: View {
    let numbers: PeriodStats
    /// All time only: a year is one year.
    let yearsActive: Int?

    var body: some View {
        Grid(horizontalSpacing: Space.x2, verticalSpacing: Space.x4) {
            GridRow {
                figure(numbers.showCount, numbers.showCount == 1 ? "Show" : "Shows")
                figure(numbers.bandCount, numbers.bandCount == 1 ? "Band" : "Bands")
                figure(numbers.venueCount, numbers.venueCount == 1 ? "Venue" : "Venues")
            }
            GridRow {
                figure(numbers.songCount, "Songs heard")
                // Song titles, whatever the band (lib/stats): "Arcadia" by two
                // bands is one. The song list has a row per band, so it shows
                // no total of its own (Stage 4, 4-4).
                figure(numbers.uniqueSongCount, "Different song titles")
                if let yearsActive {
                    figure(yearsActive, yearsActive == 1 ? "Year" : "Years")
                } else {
                    figure(numbers.ratedShowCount, numbers.ratedShowCount == 1 ? "Rated show" : "Rated shows")
                }
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

/// "All time" and each year with shows, newest first, as chips in one
/// scrolling row. The picked chip scrolls into view, so tapping a bar in
/// the shows-by-year chart shows its chip.
struct PeriodPicker: View {
    let years: [String]
    @Binding var period: StatsPeriod

    var body: some View {
        ScrollViewReader { reader in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Space.x2) {
                    chip(.allTime)
                    ForEach(years, id: \.self) { chip(.year($0)) }
                }
                .padding(.horizontal, Space.x4)
                .padding(.vertical, Space.x2)
            }
            .onChange(of: period, initial: true) {
                withAnimation { reader.scrollTo(period.label, anchor: .center) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Period")
    }

    private func chip(_ value: StatsPeriod) -> some View {
        let picked = value == period
        return Button { period = value } label: {
            Text(value.label)
                .font(.jakarta(size: 14, weight: picked ? .bold : .medium, relativeTo: .subheadline))
                .monospacedDigit()
                .foregroundStyle(picked ? Color.bgBase : Color.textPrimary)
                .padding(.horizontal, Space.x3)
                .frame(minHeight: TouchTarget.minimum)
                .background(picked ? Color.brand : Color.surface, in: Capsule())
                .overlay(Capsule().stroke(picked ? Color.clear : Color.borderSubtle))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .id(value.label)
        .accessibilityAddTraits(picked ? .isSelected : [])
    }
}

/// `showsByYear` as bars, every year from the first, zeros included. Labels
/// every five years plus the first and last (`StatsYears.labeledYears`);
/// touch and drag reads "2024 · 12 shows"; a tap picks that year. The
/// current year is amber, and the busiest year carries its count.
struct ShowsByYearChart: View {
    let byYear: [String: Int]
    /// The year the picker shows, drawn at full strength while others fade.
    let pickedYear: Int?
    let pick: (Int) -> Void
    @State private var scrubbed: String?
    @State private var plot: CGRect = .zero

    private var currentYear: Int { Int(ShowDate.year(ShowDate.today())) ?? Calendar.current.component(.year, from: Date()) }

    var body: some View {
        let bars = StatsYears.timeline(byYear, currentYear: currentYear)
        let labeled = StatsYears.labeledYears(bars)
        let peak = StatsYears.peak(bars)
        let top = max(peak?.count ?? 1, 1)
        Chart(bars) { bar in
            BarMark(x: .value("Year", String(bar.year)), y: .value("Shows", bar.count),
                    width: bars.count < 6 ? .fixed(36) : .automatic)
                .foregroundStyle(bar.year == currentYear ? Color.amber : Color.brand)
                .opacity(pickedYear == nil || pickedYear == bar.year ? 1 : 0.4)
                .cornerRadius(3)
                .annotation(position: .top, spacing: 3,
                            overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                    if scrubbed == String(bar.year) {
                        Text(StatsYears.caption(bar))
                            .font(.jakarta(size: 12, weight: .bold, relativeTo: .caption))
                            .monospacedDigit()
                            .foregroundStyle(Color.textPrimary)
                            .padding(.horizontal, Space.x2)
                            .padding(.vertical, 3)
                            .background(Color.surfaceHover, in: Capsule())
                            .fixedSize()
                    } else if scrubbed == nil, peak?.year == bar.year {
                        Text(bar.count.formatted())
                            .font(.jakarta(size: 11, weight: .semibold, relativeTo: .caption2))
                            .monospacedDigit()
                            .foregroundStyle(Color.textSecondary)
                    }
                }
        }
        .chartYScale(domain: 0...(Double(top) * 1.35))
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: bars.map { String($0.year) }) { value in
                if let year = value.as(String.self), let y = Int(year), labeled.contains(y) {
                    AxisValueLabel(collisionResolution: .disabled) {
                        Text(year)
                            .font(.jakarta(size: 11, weight: y == currentYear ? .bold : .regular, relativeTo: .caption2))
                            .foregroundStyle(y == currentYear ? Color.amber : Color.textMuted)
                            .fixedSize()
                    }
                }
            }
        }
        .chartXSelection(value: $scrubbed)
        .chartOverlay { proxy in
            // Where the bars are drawn, for turning a tap into a year.
            GeometryReader { geo in
                Color.clear
                    .onChange(of: geo.size, initial: true) {
                        if let anchor = proxy.plotFrame { plot = geo[anchor] }
                    }
            }
            .allowsHitTesting(false)
        }
        .onTapGesture(coordinateSpace: .local) { location in
            guard plot.width > 0, !bars.isEmpty, plot.minX...plot.maxX ~= location.x else { return }
            let index = min(bars.count - 1, max(0, Int((location.x - plot.minX) / plot.width * CGFloat(bars.count))))
            if bars[index].count > 0 { pick(bars[index].year) }
        }
        .frame(height: 180)
        .accessibilityElement()
        .accessibilityLabel("Shows by year")
        .accessibilityValue(bars.filter { $0.count > 0 }.map(StatsYears.caption).joined(separator: ", "))
        .accessibilityHint("Pick a year above to see its stats.")
    }
}

/// Shows per month for the period, shaded as the web's `YearHeatmap`: a
/// month against the busiest month shown, from none to the busiest (gold).
struct MonthHeatmap: View {
    let counts: [Int]

    var body: some View {
        let busiest = max(1, counts.max() ?? 0)
        VStack(alignment: .leading, spacing: Space.x2) {
            HStack(spacing: 3) {
                ForEach(0..<12, id: \.self) { i in
                    let n = i < counts.count ? counts[i] : 0
                    let level = StatsHeatmap.level(n, max: busiest)
                    VStack(spacing: 4) {
                        Text("\(n)")
                            .font(.jakarta(size: 11, weight: .heavy, relativeTo: .caption2))
                            .monospacedDigit()
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                            .foregroundStyle(Self.text(level))
                            .frame(maxWidth: .infinity)
                            .aspectRatio(1, contentMode: .fit)
                            .background(Self.fill(level), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                        Text(StatsHeatmap.months[i].prefix(1))
                            .font(.jakarta(size: 10, weight: .bold, relativeTo: .caption2))
                            .foregroundStyle(Color.textMuted)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(StatsHeatmap.months[i]): \(n) show\(n == 1 ? "" : "s")")
                }
            }
            HStack(spacing: 4) {
                Spacer()
                Text("Fewer")
                ForEach(0..<5, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 2).fill(Self.fill(level)).frame(width: 10, height: 10)
                }
                Text("More")
            }
            .font(.jakarta(size: 11, weight: .semibold, relativeTo: .caption2))
            .foregroundStyle(Color.textMuted)
            .accessibilityHidden(true)
        }
    }

    static func fill(_ level: Int) -> Color {
        switch level {
        case 0: Color.surfaceHover
        case 1: Color.brandSubtle
        case 2: Color.brandLight
        case 3: Color.brand
        default: Color(red: 0x8A / 255, green: 0x6D / 255, blue: 0)
        }
    }

    static func text(_ level: Int) -> Color {
        switch level {
        case 0: Color.textMuted
        case 1: Color.brand
        case 2, 3: Color.bgBase
        default: Color(white: 0.96)
        }
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
            if filter.kind == .band, !filter.title.isEmpty {
                // The band's page (Stage 4, 4-5): the web's "Band stats" link.
                Section {
                    NavigationLink(value: AppRoute.band(slug: BandDirectory.slug(forArtist: filter.title))) {
                        Label("\(filter.title)'s page", systemImage: "guitars")
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                    }
                }
                .brandRow()
            }
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
