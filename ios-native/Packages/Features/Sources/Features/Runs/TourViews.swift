import Core
import DesignSystem
import SwiftUI

// Tours (Stage 4, 4-6): your shows grouped by band and setlist.fm tour name
// (`ShowsStore.tours`, lib/runIndex.js buildTourIndex), favorites on the
// web's `favoriteTours/{uid}` document, tour info from setlist.fm, and
// adding the nights of a tour you caught.

/// Library → Tours, and `/tours`.
struct ToursListView: View {
    @Environment(ShowsStore.self) private var store
    @Environment(FavoriteToursStore.self) private var favorites
    @State private var query = ""
    @State private var sort: TourSort = .stops
    @State private var artist: String?
    @State private var favoritesOnly = false
    @State private var browsing = false

    var body: some View {
        let all = Array(store.tours.values)
        let artists = Array(Set(all.map(\.artistName))).sorted { $0.localizedCompare($1) == .orderedAscending }
        let visible = sort.sorted(all.filter { tour in
            (!favoritesOnly || favorites.isFavorite(tour.key))
                && (artist == nil || tour.artistName == artist)
                && (query.isEmpty || tour.tourName.localizedStandardContains(query) || tour.artistName.localizedStandardContains(query))
        })
        List {
            Section {
                ForEach(visible) { tour in
                    NavigationLink(value: AppRoute.tour(key: tour.key)) { TourRow(tour: tour) }
                }
            }
            .brandRow()
        }
        .overlay {
            if !store.showsLoaded {
                ProgressView("Loading your tours")
            } else if all.isEmpty {
                ContentUnavailableView {
                    Label("No tours yet", systemImage: "map")
                } description: {
                    Text("Tours come from the setlist.fm tour names on your shows. Add shows from a tour to see every stop you caught.")
                } actions: {
                    Button { browsing = true } label: { Label("Add shows from a tour", systemImage: "plus") }
                        .buttonStyle(.borderedProminent)
                        .tint(.brand)
                }
            } else if visible.isEmpty {
                ContentUnavailableView {
                    Label("No tours match", systemImage: "map")
                } description: {
                    Text(favoritesOnly ? "You haven't starred any tours yet. Tap the star on a tour to add it here." : "Try clearing a filter to see more of your tours.")
                } actions: {
                    Button("Clear filters") { query = ""; artist = nil; favoritesOnly = false }
                }
            }
        }
        .searchable(text: $query, prompt: "Tours or bands")
        .navigationTitle("Tours")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Sort by", selection: $sort) {
                        ForEach(TourSort.allCases) { Text($0.label).tag($0) }
                    }
                    if artists.count > 1 {
                        Picker("Band", selection: $artist) {
                            Text("All bands").tag(String?.none)
                            ForEach(artists, id: \.self) { Text($0).tag(Optional($0)) }
                        }
                    }
                    Toggle(isOn: $favoritesOnly) { Label("Favorites only", systemImage: "star") }
                } label: {
                    Label("Sort and filter", systemImage: favoritesOnly || artist != nil ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button { browsing = true } label: { Label("Add shows from a tour", systemImage: "plus") }
            }
        }
        .sheet(isPresented: $browsing) { TourBrowseSheet(start: .search) }
        .favoriteTourNotice(favorites)
    }
}

/// The Tours page's sorts (most stops first by default: the tours you
/// followed hardest).
enum TourSort: String, CaseIterable, Identifiable {
    case stops, recent, artist, rating
    var id: String { rawValue }
    var label: String {
        switch self {
        case .stops: "Stops"
        case .recent: "Recent"
        case .artist: "Band"
        case .rating: "Rating"
        }
    }

    func sorted(_ tours: [TourIndex.Tour]) -> [TourIndex.Tour] {
        let day = { (t: TourIndex.Tour) in RunIndex.dayNumber(t.start) }
        return tours.sorted { a, b in
            switch self {
            case .stops: return a.stopCount != b.stopCount ? a.stopCount > b.stopCount : day(a) > day(b)
            case .recent: return day(a) != day(b) ? day(a) > day(b) : a.tourName < b.tourName
            case .artist:
                let c = a.artistName.localizedCompare(b.artistName)
                return c != .orderedSame ? c == .orderedAscending : a.tourName.localizedCompare(b.tourName) == .orderedAscending
            case .rating:
                let x = a.avgRating ?? -1, y = b.avgRating ?? -1
                return x != y ? x > y : a.stopCount > b.stopCount
            }
        }
    }
}

private struct TourRow: View {
    @Environment(FavoriteToursStore.self) private var favorites
    let tour: TourIndex.Tour

    var body: some View {
        HStack(spacing: Space.x3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(tour.tourName)
                    .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(2)
                Text("\(tour.artistName) · \(RunText.range(tour.start, tour.end)) · \(tour.stopCount) stop\(tour.stopCount == 1 ? "" : "s")")
                    .font(.jakarta(size: 13, relativeTo: .footnote))
                    .foregroundStyle(Color.textSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: Space.x2)
            if let avg = tour.avgRating {
                Text("★ \(avg.formatted(.number.precision(.fractionLength(1))))")
                    .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
                    .monospacedDigit()
                    .foregroundStyle(Color.amber)
            }
            FavoriteTourButton(tour: tour, compact: true)
        }
        .padding(.vertical, 2)
    }
}

/// The star (`TourFavoriteButton`): filled amber when on, disabled while its write is in flight.
struct FavoriteTourButton: View {
    @Environment(FavoriteToursStore.self) private var favorites
    let tour: TourIndex.Tour
    var compact = false

    var body: some View {
        let on = favorites.isFavorite(tour.key)
        Button { favorites.toggle(tour) } label: {
            Image(systemName: on ? "star.fill" : "star")
                .font(.system(size: compact ? 16 : 20, weight: .semibold))
                .foregroundStyle(on ? Color.amber : Color.textMuted)
                .frame(minWidth: TouchTarget.minimum, minHeight: TouchTarget.minimum)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .disabled(favorites.pending.contains(tour.key))
        .accessibilityLabel(on ? "Remove \(tour.tourName) from favorite tours" : "Add \(tour.tourName) to favorite tours")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

extension View {
    func favoriteTourNotice(_ favorites: FavoriteToursStore) -> some View {
        alert("Not saved", isPresented: Binding(get: { favorites.problem != nil }, set: { if !$0 { favorites.problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(favorites.problem ?? "")
        }
    }
}

/// Where `/tours/?tour=` leads.
struct TourScreen: View {
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    let key: String

    var body: some View {
        Group {
            if let tour = store.tours[key] {
                TourPage(tour: tour)
            } else if !store.showsLoaded {
                ProgressView("Loading the tour")
            } else {
                ContentUnavailableView {
                    Label("Tour not found", systemImage: "map")
                } description: {
                    Text("None of your shows are on this tour.")
                } actions: {
                    Button("Open on mysetlists.net") { router.show(AppRoute.tour(key: key).webURL) }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One tour (`TourDetailView`): the stops you caught, first stop, venues,
/// countries, songs, rating, the songs you first heard on it, and adding more.
struct TourPage: View {
    @Environment(ShowsStore.self) private var store
    @Environment(FavoriteToursStore.self) private var favorites
    @Environment(AppRouter.self) private var router
    let tour: TourIndex.Tour
    @State private var adding = false
    @State private var info = false

    var body: some View {
        let newSongs = TourIndex.newSongs(on: tour, songIndex: store.songIndex)
        let mbid = TourLookups.mbid(forArtist: tour.artistName, in: store.shows)
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x6) {
                VStack(alignment: .leading, spacing: Space.x2) {
                    HStack(alignment: .top) {
                        Text(tour.tourName)
                            .font(.jakarta(size: 24, weight: .bold, relativeTo: .title2))
                            .foregroundStyle(Color.textPrimary)
                            .accessibilityAddTraits(.isHeader)
                        Spacer(minLength: Space.x2)
                        FavoriteTourButton(tour: tour)
                    }
                    NavigationLink(value: AppRoute.band(slug: tour.artistSlug)) {
                        Text(tour.artistName)
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.brandLight)
                    }
                    .buttonStyle(.plain)
                    HStack(spacing: Space.x2) {
                        Button { adding = true } label: { Label("Add more shows", systemImage: "plus") }
                            .buttonStyle(.bordered)
                            .tint(.brand)
                        Button { info = true } label: { Label("Tour info", systemImage: "info.circle") }
                            .buttonStyle(.bordered)
                            .tint(.brand)
                    }
                    .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                    .padding(.top, Space.x1)
                }
                StatCards(cards: [
                    ("\(tour.stopCount)", "Stops you caught", nil),
                    (ShowDateText.display(tour.start), "First stop", nil),
                    ("\(tour.venuesCount)", "Venues", nil),
                    ("\(tour.countriesVisited)", "Countries", nil),
                    ("\(tour.uniqueSongs)", "Unique songs", nil),
                    (tour.avgRating.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "–", "Avg rating", nil),
                ])
                stops
                newSongsSection(newSongs)
            }
            .padding(.horizontal, Space.x5)
            .padding(.top, Space.x2)
            .padding(.bottom, Space.x8)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(tour.tourName)
        .toolbar { ToolbarItem(placement: .principal) { Text("").accessibilityHidden(true) } }
        .sheet(isPresented: $adding) { TourBrowseSheet(start: .tour(artist: tour.artistName, tourName: tour.tourName, mbid: mbid)) }
        .sheet(isPresented: $info) { TourInfoSheet(artistName: tour.artistName, mbid: mbid) }
        .favoriteTourNotice(favorites)
    }

    private var stops: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            SectionTitle("Stops")
            VStack(spacing: 0) {
                ForEach(Array(tour.stops.enumerated()), id: \.element.id) { i, stop in
                    HStack(spacing: Space.x2) {
                        NavigationLink(value: AppRoute.show(id: stop.showId)) {
                            HStack(spacing: Space.x2) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Stop \(i + 1) · \(ShowDateText.display(stop.date))")
                                        .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                                        .foregroundStyle(Color.textPrimary)
                                    Text(stop.city.isEmpty ? "–" : stop.city)
                                        .font(.jakarta(size: 12, relativeTo: .caption))
                                        .foregroundStyle(Color.textSecondary)
                                }
                                Spacer(minLength: Space.x1)
                                if let rating = stop.rating, rating > 0 {
                                    Text("★ \(rating)/10")
                                        .font(.jakarta(size: 13, weight: .bold, relativeTo: .footnote))
                                        .monospacedDigit()
                                        .foregroundStyle(Color.amber)
                                }
                            }
                            .frame(minHeight: TouchTarget.minimum)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        // The venue is its own control: its venue page (4-7).
                        if !stop.venue.isEmpty, let key = VenueNames.venueKey(name: stop.venue, city: stop.city) {
                            NavigationLink(value: AppRoute.venue(key: key)) {
                                Text(stop.venue)
                                    .font(.jakarta(size: 12, relativeTo: .caption))
                                    .foregroundStyle(Color.brandLight)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.trailing)
                                    .frame(maxWidth: 140, alignment: .trailing)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityHint("Opens the venue's page")
                        }
                    }
                    if i < tour.stops.count - 1 { Divider().overlay(Color.borderSubtle) }
                }
            }
            .padding(.horizontal, Space.x3)
            .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
        }
    }

    @ViewBuilder
    private func newSongsSection(_ songs: [SongIndex.Entry]) -> some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Label { SectionTitle("New songs on this tour") } icon: { Image(systemName: "sparkles").foregroundStyle(Color.brand) }
            if songs.isEmpty {
                Text("No first-timers here: you'd already caught every song \(tour.artistName) played on this tour before it started.")
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .brandCard(radius: Radius.xl2)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(songs.enumerated()), id: \.element.key) { i, song in
                        NavigationLink(value: AppRoute.song(artist: song.artistSlug, song: SongIndex.songSlug(song.title))) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(song.title)
                                        .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                                        .foregroundStyle(Color.textPrimary)
                                    Text("First heard \(ShowDateText.display(song.firstSeen.date))\(song.firstSeen.venue.isEmpty ? "" : " · \(venueLine(song.firstSeen.venue, song.firstSeen.city))")")
                                        .font(.jakarta(size: 12, relativeTo: .caption))
                                        .foregroundStyle(Color.textSecondary)
                                        .lineLimit(1)
                                }
                                Spacer(minLength: Space.x2)
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.textMuted)
                            }
                            .frame(minHeight: TouchTarget.minimum)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if i < songs.count - 1 { Divider().overlay(Color.borderSubtle) }
                    }
                }
                .padding(.horizontal, Space.x3)
                .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
            }
        }
    }
}

// MARK: - Tour info

/// "Tour info" (`TourInfoModal`): setlist.fm's current tour, recent tours,
/// all-time totals and song analysis for one band.
struct TourInfoSheet: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    let artistName: String
    @State var mbid: String?
    @State private var tab: Tab = .current
    @State private var tours: ArtistTours?
    @State private var songs: ArtistSongStats?
    @State private var problem: String?
    @State private var songProblem: String?
    @State private var songQuery = ""

    enum Tab: String, CaseIterable, Identifiable {
        case current, recent, all, songs
        var id: String { rawValue }
        var label: String {
            switch self {
            case .current: "Current"
            case .recent: "Recent"
            case .all: "All time"
            case .songs: "Songs"
            }
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if mbid == nil {
                    ArtistPicker(name: artistName) { mbid = $0.mbid }
                } else {
                    content
                }
            }
            .navigationTitle("\(artistName) tours")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .brandScreen()
        }
        .task(id: mbid) { await loadTours() }
        .task(id: tab == .songs ? mbid : nil) { if tab == .songs { await loadSongs() } }
    }

    @ViewBuilder private var content: some View {
        List {
            Section {
                Picker("Show", selection: $tab) {
                    ForEach(Tab.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Color.clear)
            switch tab {
            case .songs: songsSection
            default: toursSection
            }
        }
    }

    @ViewBuilder private var toursSection: some View {
        if let problem {
            Section { Text(problem).foregroundStyle(Color.danger) }.brandRow()
        } else if let tours {
            switch tab {
            case .current:
                Section {
                    if let active = tours.activeTour() {
                        TourInfoRow(tour: active, active: true)
                    } else {
                        Text("No tour going right now. Recent has the latest.").foregroundStyle(Color.textSecondary)
                    }
                }
                .brandRow()
            case .recent:
                Section {
                    if tours.recentTours.isEmpty { Text("No recent tours found.").foregroundStyle(Color.textSecondary) }
                    ForEach(tours.recentTours) { TourInfoRow(tour: $0, active: false) }
                }
                .brandRow()
            default:
                Section {
                    LabeledContent("Shows tracked", value: tours.totalShows.formatted())
                    LabeledContent("Tours found", value: tours.tours.count.formatted())
                } footer: {
                    if tours.truncated { Text("From setlist.fm's most recent setlists.") }
                }
                .brandRow()
                Section("All tours") {
                    ForEach(tours.tours) { tour in
                        LabeledContent(tour.name) {
                            Text("\(tour.showCount) show\(tour.showCount == 1 ? "" : "s")\(tour.startDate.map { " · \(ShowDateText.display($0))" } ?? "")")
                        }
                    }
                }
                .brandRow()
            }
        } else {
            Section { ProgressView("Loading tours").frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
        }
    }

    @ViewBuilder private var songsSection: some View {
        if let songProblem {
            Section { Text(songProblem).foregroundStyle(Color.danger) }.brandRow()
        } else if let songs {
            let shown = songQuery.isEmpty ? songs.songs : songs.songs.filter { $0.name.localizedStandardContains(songQuery) }
            let top = max(songs.songs.first?.count ?? 1, 1)
            Section {
                TextField("Search songs", text: $songQuery)
            } footer: {
                Text("\(songs.songs.count) songs, from \(songs.totalSetlistsFetched) of \(songs.totalSetlistsAvailable) setlists")
            }
            .brandRow()
            Section {
                ForEach(shown) { song in
                    DisclosureGroup {
                        ForEach(Array(song.plays.prefix(20).enumerated()), id: \.offset) { _, play in
                            Text("\(ShowDateText.display(play.date)) · \(venueLine(play.venue, play.city))")
                                .font(.jakarta(size: 12, relativeTo: .caption))
                                .foregroundStyle(Color.textSecondary)
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(song.name).foregroundStyle(Color.textPrimary)
                                Spacer()
                                Text("\(song.count)").monospacedDigit().foregroundStyle(Color.textSecondary)
                            }
                            .font(.jakarta(size: 14, relativeTo: .subheadline))
                            GeometryReader { geo in
                                Capsule().fill(Color.brand.opacity(0.7))
                                    .frame(width: max(4, geo.size.width * CGFloat(song.count) / CGFloat(top)))
                            }
                            .frame(height: 4)
                            .accessibilityHidden(true)
                        }
                    }
                }
            }
            .brandRow()
        } else {
            Section { ProgressView("Loading songs").frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
        }
    }

    private func loadTours() async {
        guard let mbid, tours == nil else { return }
        problem = nil
        do { tours = try await TourLookups.tours(mbid: mbid, api: session.api) } catch { problem = TourLookups.message(error) }
    }

    private func loadSongs() async {
        guard let mbid, songs == nil else { return }
        songProblem = nil
        do { songs = try await TourLookups.songStats(mbid: mbid, api: session.api) } catch { songProblem = TourLookups.message(error) }
    }
}

private struct TourInfoRow: View {
    let tour: ArtistTours.Tour
    let active: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x1) {
            HStack {
                Text(tour.name)
                    .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                    .foregroundStyle(Color.textPrimary)
                if active { Pill(text: "Active", tint: .brand) }
            }
            Text("\(RunText.range(tour.startDate ?? "", tour.endDate ?? tour.startDate ?? "")) · \(tour.showCount) show\(tour.showCount == 1 ? "" : "s") · ~\(tour.avgSongCount) songs a show")
                .font(.jakarta(size: 12, relativeTo: .caption))
                .foregroundStyle(Color.textSecondary)
            ForEach(Array(tour.shows.prefix(5).enumerated()), id: \.offset) { _, night in
                Text("\(ShowDateText.display(night.date)) · \(venueLine(night.venue, night.city))")
                    .font(.jakarta(size: 12, relativeTo: .caption))
                    .foregroundStyle(Color.textMuted)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Which setlist.fm artist a name means, when none of your shows of them
/// carries the MusicBrainz id: names collide ("Goose" is two bands).
private struct ArtistPicker: View {
    @Environment(SessionStore.self) private var session
    let name: String
    let picked: (SetlistfmSearch.Artist) -> Void
    @State private var results: [SetlistfmSearch.Artist]?
    @State private var problem: String?

    var body: some View {
        List {
            Section {
                if let problem { Text(problem).foregroundStyle(Color.danger) }
                ForEach(results ?? []) { artist in
                    Button { picked(artist) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(artist.name).foregroundStyle(Color.textPrimary)
                            if let d = artist.disambiguation, !d.isEmpty { Text(d).font(.footnote).foregroundStyle(Color.textSecondary) }
                        }
                    }
                }
                if results == nil, problem == nil { ProgressView() }
            } header: {
                Text("Which \(name)?")
            }
            .brandRow()
        }
        .task {
            do {
                let found = try await SetlistfmSearch(api: session.api).artists(named: name)
                // One exact match: no need to ask.
                let exact = found.filter { $0.name.caseInsensitiveCompare(name) == .orderedSame }
                if exact.count == 1 { picked(exact[0]); return }
                results = found
            } catch {
                problem = TourLookups.message(error)
            }
        }
    }
}

// MARK: - Adding shows from a tour

/// "Add shows from a tour" (`TourBrowseModal`): a band, its tours, then the
/// nights, with the ones already yours marked. From a tour page it starts
/// at the nights.
struct TourBrowseSheet: View {
    enum Start {
        case search
        case tour(artist: String, tourName: String, mbid: String?)
    }

    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let start: Start

    @State private var artistQuery = ""
    @State private var artists: [SetlistfmSearch.Artist] = []
    @State private var artist: SetlistfmSearch.Artist?
    @State private var tours: ArtistTours?
    @State private var tourName: String?
    @State private var nights: TourShows?
    @State private var selected: Set<String> = []
    @State private var problem: String?
    @State private var busy = false
    @State private var result: String?
    @State private var needsArtist = false

    var body: some View {
        NavigationStack {
            List {
                if let problem { Section { Text(problem).foregroundStyle(Color.danger) }.brandRow() }
                if let result {
                    Section { Label(result, systemImage: "checkmark.circle").foregroundStyle(Color.brand) }.brandRow()
                }
                if tourName != nil, artist != nil {
                    nightsSection
                } else if artist != nil {
                    toursSection
                } else {
                    artistSection
                }
            }
            .navigationTitle(tourName ?? artist?.name ?? "Add shows from a tour")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                if tourName != nil, nights != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(selected.isEmpty ? "Add" : "Add \(selected.count)") { Task { await addSelected() } }
                            .disabled(selected.isEmpty || busy)
                    }
                }
            }
            .brandScreen()
        }
        .task { await begin() }
    }

    // Step 1: the band.
    @ViewBuilder private var artistSection: some View {
        Section {
            TextField(needsArtist ? "Which band?" : "Band name", text: $artistQuery)
                .textInputAutocapitalization(.words)
                .onSubmit { Task { await searchArtists() } }
            Button("Search") { Task { await searchArtists() } }.disabled(artistQuery.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        } footer: {
            Text("Pick a band, then one of its tours, then the nights you were there.")
        }
        .brandRow()
        if !artists.isEmpty {
            Section("Bands") {
                ForEach(artists) { a in
                    Button { pickArtist(a) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a.name).foregroundStyle(Color.textPrimary)
                            if let d = a.disambiguation, !d.isEmpty { Text(d).font(.footnote).foregroundStyle(Color.textSecondary) }
                        }
                    }
                }
            }
            .brandRow()
        }
    }

    // Step 2: the tour.
    @ViewBuilder private var toursSection: some View {
        if let tours {
            Section {
                let browsable = tours.tours.filter(\.isBrowsable)
                if browsable.isEmpty { Text("No tours found on setlist.fm.").foregroundStyle(Color.textSecondary) }
                ForEach(browsable) { tour in
                    Button { Task { await pickTour(tour.name) } } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tour.name).foregroundStyle(Color.textPrimary)
                            Text("\(tour.startDate.map(ShowDateText.display) ?? "") · \(tour.showCount) show\(tour.showCount == 1 ? "" : "s")")
                                .font(.footnote).foregroundStyle(Color.textSecondary)
                        }
                    }
                }
            } header: {
                Text("Tours")
            } footer: {
                if tours.truncated { Text("Recent tours, from setlist.fm's latest setlists.") }
            }
            .brandRow()
        } else if problem == nil {
            Section { ProgressView("Finding tours").frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
        }
    }

    // Step 3: the nights.
    @ViewBuilder private var nightsSection: some View {
        if let nights {
            Section {
                ForEach(nights.shows) { night in
                    let yours = TourShows.isYours(night, in: store.shows)
                    Button {
                        if selected.contains(night.id) { selected.remove(night.id) } else { selected.insert(night.id) }
                    } label: {
                        HStack(spacing: Space.x3) {
                            Image(systemName: yours ? "checkmark.seal.fill" : (selected.contains(night.id) ? "checkmark.circle.fill" : "circle"))
                                .foregroundStyle(yours ? Color.textMuted : Color.brand)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(ShowDateText.display(night.date)).foregroundStyle(Color.textPrimary)
                                Text(venueLine(night.venue, night.city)).font(.footnote).foregroundStyle(Color.textSecondary).lineLimit(1)
                            }
                            Spacer(minLength: Space.x2)
                            Text(yours ? "Yours" : (night.songCount > 0 ? "\(night.songCount) songs" : "No setlist"))
                                .font(.caption).foregroundStyle(Color.textMuted)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(yours || busy)
                    .accessibilityAddTraits(selected.contains(night.id) ? .isSelected : [])
                }
            } header: {
                Text("Tap the nights you were at")
            } footer: {
                if nights.truncated { Text("The first 200 nights of the tour.") }
            }
            .brandRow()
        } else if problem == nil {
            Section { ProgressView("Loading the tour's nights").frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
        }
    }

    private func begin() async {
        guard case .tour(let name, let tour, let mbid) = start, artist == nil else { return }
        artistQuery = name
        if let mbid {
            artist = SetlistfmSearch.Artist(mbid: mbid, name: name)
            await pickTour(tour)
        } else {
            // Which band is meant: one exact name match, else ask.
            needsArtist = true
            await searchArtists()
            let exact = artists.filter { $0.name.caseInsensitiveCompare(name) == .orderedSame }
            if exact.count == 1 {
                artist = exact[0]
                await pickTour(tour)
            }
        }
    }

    private func searchArtists() async {
        let q = artistQuery.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        busy = true
        defer { busy = false }
        problem = nil
        do { artists = try await SetlistfmSearch(api: session.api).artists(named: q) } catch { problem = TourLookups.message(error) }
    }

    private func pickArtist(_ a: SetlistfmSearch.Artist) {
        artist = a
        if case .tour(_, let tour, _) = start {
            Task { await pickTour(tour) }
            return
        }
        Task {
            problem = nil
            do { tours = try await TourLookups.tours(mbid: a.mbid, api: session.api) } catch { problem = TourLookups.message(error) }
        }
    }

    private func pickTour(_ name: String) async {
        guard let artist else { return }
        tourName = name
        nights = nil
        selected = []
        problem = nil
        do { nights = try await TourLookups.tourShows(mbid: artist.mbid, tourName: name, api: session.api) } catch { problem = TourLookups.message(error) }
    }

    private func addSelected() async {
        guard let nights else { return }
        busy = true
        defer { busy = false }
        var added = 0, waiting = 0, skipped = 0
        for night in nights.shows where selected.contains(night.id) {
            let display = QueuedShow.Display(artist: night.artist, venue: night.venue, city: night.city, date: night.date)
            switch await store.addShow(ShowInput(.setlistfm(.row(night.raw), .none)), display: display) {
            case .added: added += 1
            case .queued: waiting += 1
            case .alreadyThere, .possibleDuplicate, .refused: skipped += 1
            }
        }
        selected = []
        var parts: [String] = []
        if added > 0 { parts.append("Added \(added) show\(added == 1 ? "" : "s")") }
        if waiting > 0 { parts.append("\(waiting) saved on this iPhone, added when you're online") }
        if skipped > 0 { parts.append("\(skipped) already in your shows or not added") }
        result = parts.isEmpty ? nil : parts.joined(separator: ". ") + "."
    }
}
