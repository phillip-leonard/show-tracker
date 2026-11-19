import Core
import DesignSystem
import SwiftUI

// The Search tab (Stage 4, 4-12; PARITY F-2): search over your own shows.
// The search field finds a band, venue, city or song at once; Advanced
// search is the web's /advanced-search (every filter, presets, sort, saved
// and recent searches); By artist is the Shows page's "By artist" view; and
// "Add shows from a tour" is the web's tour browser. Searching setlist.fm
// to add one show stays under + on Shows. It all reads the shows on this
// device, so it works offline, and guests can use it on their own shows.

/// The Search tab's root.
struct SearchHome: View {
    @Environment(ShowsStore.self) private var store
    @Environment(SessionStore.self) private var session
    @State private var query = ""
    @State private var saved: [SavedSearch] = []
    @State private var recent: [RecentSearch] = []
    @State private var browsingTours = false

    private var uid: String? { session.user?.uid }
    private var today: String { ShowDate.today() }

    var body: some View {
        List {
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                home
            } else {
                quickResults
            }
        }
        .brandScreen()
        .navigationTitle("Search")
        .searchable(text: $query, prompt: "Bands, venues, cities, songs")
        .sheet(isPresented: $browsingTours) { TourBrowseSheet(start: .search) }
        .onAppear(perform: reload)
    }

    private func reload() {
        guard let uid else { saved = []; recent = []; return }
        let store = SavedSearches(uid: uid)
        saved = store.saved
        recent = store.recent
    }

    // MARK: Home

    @ViewBuilder private var home: some View {
        Section {
            NavigationLink {
                AdvancedSearchScreen(initial: ShowSearchFilters())
            } label: {
                row("Advanced search", detail: "Filter by band, place, dates, tour, rating, notes or song", symbol: "line.3.horizontal.decrease.circle")
            }
            NavigationLink {
                ArtistGroupsScreen()
            } label: {
                row("By artist", detail: "Every band you've seen, with your shows of each", symbol: "music.mic")
            }
            Button { browsingTours = true } label: {
                row("Add shows from a tour", detail: "Pick a tour and tick the nights you were at", symbol: "map")
            }
            .buttonStyle(.plain)
        }
        .brandRow()

        if !saved.isEmpty {
            Section {
                ForEach(saved) { search in
                    NavigationLink {
                        AdvancedSearchScreen(initial: search.filters)
                    } label: {
                        Label(search.name, systemImage: "bookmark")
                            .foregroundStyle(Color.textPrimary)
                    }
                }
                .onDelete { offsets in
                    guard let uid else { return }
                    let store = SavedSearches(uid: uid)
                    let names = offsets.map { saved[$0].name }
                    for name in names { store.delete(name: name) }
                    saved = store.saved
                }
            } header: {
                Text("Saved searches")
            }
            .brandRow()
        }

        if !recent.isEmpty {
            Section {
                ForEach(recent) { item in
                    if let filters = item.filters {
                        NavigationLink {
                            AdvancedSearchScreen(initial: filters)
                        } label: {
                            recentLabel(item.summary)
                        }
                    } else {
                        recentLabel(item.summary)
                    }
                }
            } header: {
                HStack {
                    Text("Recent searches")
                    Spacer()
                    Button("Clear") {
                        if let uid { SavedSearches(uid: uid).clearRecent() }
                        recent = []
                    }
                    .font(.footnote)
                    .textCase(nil)
                }
            }
            .brandRow()
        }
    }

    private func recentLabel(_ summary: String) -> some View {
        Label {
            Text(summary).lineLimit(2).foregroundStyle(Color.textPrimary)
        } icon: {
            Image(systemName: "clock").foregroundStyle(Color.textSecondary)
        }
    }

    private func row(_ title: String, detail: String, symbol: String) -> some View {
        HStack(spacing: Space.x3) {
            Image(systemName: symbol)
                .foregroundStyle(Color.brand)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.jakarta(size: 16, weight: .semibold, relativeTo: .body))
                    .foregroundStyle(Color.textPrimary)
                Text(detail)
                    .font(.jakarta(size: 13, relativeTo: .footnote))
                    .foregroundStyle(Color.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Space.x1)
        .contentShape(Rectangle())
    }

    // MARK: Quick search

    @ViewBuilder private var quickResults: some View {
        let found = ShowList.filter(ShowList.pastOrder(store.shows), ShowList.Filter(text: query))
        Section {
            if !store.showsLoaded {
                ProgressView("Loading your shows").frame(maxWidth: .infinity)
            } else if found.isEmpty {
                ContentUnavailableView.search(text: query)
            }
            ForEach(found) { show in
                NavigationLink(value: AppRoute.show(id: show.id)) { ShowRow(show: show, today: today) }
            }
        } header: {
            if !found.isEmpty { Text(ShowSearch.countLine(found.count)) }
        } footer: {
            NavigationLink {
                AdvancedSearchScreen(initial: ShowSearchFilters())
            } label: {
                Text("More filters in Advanced search")
                    .font(.footnote)
                    .foregroundStyle(Color.brand)
            }
        }
        .brandRow()
    }
}

// MARK: - Advanced search

/// The web's Advanced search, results first (Stage 4 TestFlight, native
/// 4.0.43): a count and the matching shows fill the screen; "Filters" opens
/// every filter in a sheet; each active filter is a chip above the results
/// that removes it; saved and recent searches are in the toolbar menu.
/// With no filter set it lists all your shows.
struct AdvancedSearchScreen: View {
    @Environment(ShowsStore.self) private var store
    @Environment(SessionStore.self) private var session
    @Environment(FriendsStore.self) private var friendsStore
    @State private var filters: ShowSearchFilters
    @State private var sort = ShowSearch.Sort.newest
    @State private var editing = false
    @State private var naming = false
    @State private var saveName = ""
    @State private var notice: String?
    @State private var saved: [SavedSearch] = []
    @State private var recent: [RecentSearch] = []

    init(initial: ShowSearchFilters) {
        _filters = State(initialValue: initial)
    }

    private var uid: String? { session.user?.uid }
    private var isGuest: Bool { session.user?.isAnonymous == true }
    private var today: String { ShowDate.today() }

    var body: some View {
        let tours = store.tours.values.sorted { $0.tourName.localizedStandardCompare($1.tourName) == .orderedAscending }
        let festivals = ShowSearch.festivals(store.shows)
        let friendList: [FriendEdge] = isGuest ? [] : friendsStore.friends
        let results = results()
        let chips = chips(tours: tours, festivals: festivals)
        return List {
            Section {
                chipRow(chips)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: Space.x1, leading: 0, bottom: Space.x1, trailing: 0))

            Section {
                if !store.showsLoaded {
                    ProgressView("Loading your shows").frame(maxWidth: .infinity)
                } else if results.isEmpty {
                    if filters.isActive {
                        ContentUnavailableView {
                            Label("No shows match", systemImage: "magnifyingglass")
                        } description: {
                            Text("Remove a filter or two.")
                        } actions: {
                            Button("Edit filters") { editing = true }
                        }
                    } else {
                        ContentUnavailableView("No shows yet", systemImage: "music.mic",
                                               description: Text("Shows you add are searchable here."))
                    }
                }
                ForEach(results) { match in
                    NavigationLink(value: AppRoute.show(id: match.show.id)) {
                        VStack(alignment: .leading, spacing: 2) {
                            ShowRow(show: match.show, today: today)
                            if let hint = ShowSearch.hint(match.fields) {
                                Text(hint)
                                    .font(.jakarta(size: 12, relativeTo: .caption))
                                    .foregroundStyle(Color.textSecondary)
                            }
                        }
                    }
                }
            } header: {
                HStack {
                    Text(ShowSearch.countLine(results.count))
                        .font(.jakarta(size: 15, weight: .semibold, relativeTo: .subheadline))
                        .foregroundStyle(Color.textPrimary)
                        .contentTransition(.numericText())
                        .accessibilityAddTraits(.updatesFrequently)
                    Spacer()
                    Menu {
                        Picker("Sort", selection: $sort) {
                            ForEach(ShowSearch.Sort.allCases) { Text($0.title).tag($0) }
                        }
                    } label: {
                        Label(sort.title, systemImage: "arrow.up.arrow.down")
                            .font(.footnote)
                    }
                    .accessibilityLabel("Sort: \(sort.title)")
                }
                .textCase(nil)
            }
            .brandRow()
        }
        .brandScreen()
        .animation(.default, value: chips)
        .navigationTitle("Advanced search")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { editing = true } label: {
                    Text(chips.isEmpty ? "Filters" : "Filters (\(chips.count))")
                }
                .accessibilityLabel(chips.isEmpty ? "Filters" : "Filters, \(chips.count) on")
            }
            ToolbarItem(placement: .primaryAction) { searchesMenu }
        }
        .sheet(isPresented: $editing) {
            SearchFiltersSheet(filters: $filters, resultCount: results.count, tours: tours,
                               festivals: festivals, friends: friendList)
                .presentationDetents([.large])
        }
        .alert("Name this search", isPresented: $naming) {
            TextField("Name", text: $saveName)
            Button("Save") { save() }
                .disabled(saveName.trimmingCharacters(in: .whitespaces).isEmpty)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Saved searches are kept on this iPhone.")
        }
        .notice($notice)
        .onAppear(perform: reloadSearches)
        // A search you looked at goes into Recent searches when you leave it.
        .onDisappear { record(tours: tours, festivals: festivals) }
    }

    // MARK: Chips

    private func chips(tours: [TourIndex.Tour], festivals: [ShowSearch.FestivalOption]) -> [ShowSearch.Chip] {
        ShowSearch.chips(filters,
                         tourName: tours.first { $0.key == filters.tourKey }?.tourName,
                         festivalName: festivals.first { $0.id == filters.festivalKey }?.name,
                         friendName: friendsStore.friends.first { $0.friendUid == filters.friendUid }?.friendName,
                         day: ShowDateText.display)
    }

    /// The active filters, each removable; with none, the date presets.
    private func chipRow(_ chips: [ShowSearch.Chip]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.x2) {
                if chips.isEmpty {
                    ForEach(ShowSearch.Preset.allCases) { preset in
                        Button(preset.title) { filters = ShowSearch.apply(preset, to: filters, today: today) }
                            .buttonStyle(.bordered)
                            .tint(.brand)
                            .controlSize(.small)
                    }
                } else {
                    ForEach(chips) { chip in
                        FilterChip(label: chip.label) { filters = ShowSearch.clearing(chip.field, in: filters) }
                    }
                    if chips.count > 1 {
                        Button("Clear all") { filters = ShowSearchFilters() }
                            .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                            .foregroundStyle(Color.brand)
                            .frame(minHeight: 44)
                    }
                }
            }
            .padding(.horizontal, Space.x4)
        }
    }

    // MARK: Saved and recent

    private var searchesMenu: some View {
        Menu {
            Button { saveName = ""; naming = true } label: { Label("Save search", systemImage: "bookmark") }
                .disabled(!filters.isActive || uid == nil)
            if !saved.isEmpty {
                Section("Saved searches") {
                    ForEach(saved) { search in
                        Button { filters = search.filters } label: { Label(search.name, systemImage: "bookmark.fill") }
                    }
                }
            }
            let runs = recent.filter { $0.filters != nil }
            if !runs.isEmpty {
                Section("Recent searches") {
                    ForEach(runs) { item in
                        Button { if let f = item.filters { filters = f } } label: { Label(item.summary, systemImage: "clock") }
                    }
                }
            }
            if filters.isActive {
                Divider()
                Button(role: .destructive) { filters = ShowSearchFilters() } label: { Label("Clear filters", systemImage: "xmark") }
            }
        } label: {
            Label("Saved and recent searches", systemImage: "bookmark")
        }
    }

    private func reloadSearches() {
        guard let uid else { saved = []; recent = []; return }
        let store = SavedSearches(uid: uid)
        saved = store.saved
        recent = store.recent
    }

    // MARK: Results

    private func results() -> [ShowSearch.Match] {
        let tourIds: Set<String>? = filters.tourKey.isEmpty ? nil : Set(store.tours[filters.tourKey]?.stops.map(\.showId) ?? [])
        let festivalIds = ShowSearch.festivalShowIds(store.shows, festivalId: filters.festivalKey)
        return ShowSearch.sorted(ShowSearch.filter(store.shows, filters, tourShowIds: tourIds, festivalShowIds: festivalIds), by: sort)
    }

    private func summary(tours: [TourIndex.Tour], festivals: [ShowSearch.FestivalOption]) -> String {
        ShowSearch.summary(filters,
                           tourName: tours.first { $0.key == filters.tourKey }?.tourName,
                           festivalName: festivals.first { $0.id == filters.festivalKey }?.name,
                           friendName: friendsStore.friends.first { $0.friendUid == filters.friendUid }?.friendName)
    }

    private func record(tours: [TourIndex.Tour], festivals: [ShowSearch.FestivalOption]) {
        guard let uid, filters.isActive else { return }
        SavedSearches(uid: uid).push(summary: summary(tours: tours, festivals: festivals), filters: filters)
    }

    private func save() {
        guard let uid else { return }
        let name = saveName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        saved = SavedSearches(uid: uid).save(name: name, filters: filters)
        notice = "Saved “\(name)”."
    }
}

/// An active filter above the results; tapping it removes it.
private struct FilterChip: View {
    let label: String
    let remove: () -> Void

    var body: some View {
        Button(action: remove) {
            HStack(spacing: Space.x1) {
                Text(label).lineLimit(1)
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .accessibilityHidden(true)
            }
            .font(.jakarta(size: 14, weight: .medium, relativeTo: .subheadline))
            .foregroundStyle(Color.brand)
            .padding(.horizontal, Space.x3)
            .padding(.vertical, 6)
            .background(Color.brandSubtle, in: Capsule())
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityHint("Removes this filter")
    }
}

/// Every filter, in a sheet over the results; the count updates as you go.
private struct SearchFiltersSheet: View {
    @Environment(ShowsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Binding var filters: ShowSearchFilters
    let resultCount: Int
    let tours: [TourIndex.Tour]
    let festivals: [ShowSearch.FestivalOption]
    let friends: [FriendEdge]

    private var today: String { ShowDate.today() }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: Space.x2) {
                        ForEach(ShowSearch.Preset.allCases) { preset in
                            Button(preset.title) { filters = ShowSearch.apply(preset, to: filters, today: today) }
                                .buttonStyle(.bordered)
                                .tint(.brand)
                                .controlSize(.small)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: Space.x4, bottom: 0, trailing: Space.x4))

                Section("Who and where") {
                    SuggestField("Band", text: $filters.artist, prompt: "Any band",
                                 options: ShowSearch.options(store.shows.map(\.artist)))
                    SuggestField("Venue", text: $filters.venue, prompt: "Any venue",
                                 options: ShowSearch.options(store.shows.map(\.venue)))
                    SuggestField("City", text: $filters.city, prompt: "Any city",
                                 options: ShowSearch.options(store.shows.map(\.city)))
                    SuggestField("Country", text: $filters.country, prompt: "Any country",
                                 options: ShowSearch.options(store.shows.compactMap(\.country)))
                }
                .brandRow()

                Section("When") {
                    DayField(title: "From", day: $filters.dateFrom)
                    DayField(title: "To", day: $filters.dateTo)
                }
                .brandRow()

                Section("More") {
                    Picker("Tour", selection: $filters.tourKey) {
                        Text("Any tour").tag("")
                        ForEach(tours) { Text("\($0.tourName) (\($0.artistName))").tag($0.key) }
                    }
                    if !festivals.isEmpty {
                        Picker("Festival", selection: $filters.festivalKey) {
                            Text("Any festival").tag("")
                            ForEach(festivals) { Text($0.name).tag($0.id) }
                        }
                    }
                    Picker("Minimum rating", selection: $filters.minRating) {
                        Text("Any rating").tag(0)
                        ForEach(1...10, id: \.self) { Text("\($0)★ and up").tag($0) }
                    }
                    if !friends.isEmpty {
                        Picker("With friend", selection: $filters.friendUid) {
                            Text("Any friend").tag("")
                            ForEach(friends) { Text($0.friendName ?? "Friend").tag($0.friendUid) }
                        }
                    }
                    LabeledField("My notes contain", text: $filters.notes, prompt: "Search your notes")
                    LabeledField("Setlist song", text: $filters.song, prompt: "e.g. Tweezer")
                }
                .brandRow()
            }
            .brandScreen()
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Clear") { filters = ShowSearchFilters() }
                        .disabled(!filters.isActive)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Show \(ShowSearch.countLine(resultCount))") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
    }
}

/// A text filter with a menu of the values in your shows (the web's datalist).
private struct SuggestField: View {
    let title: String
    @Binding var text: String
    let prompt: String
    let options: [String]

    init(_ title: String, text: Binding<String>, prompt: String, options: [String]) {
        self.title = title
        _text = text
        self.prompt = prompt
        self.options = options
    }

    var body: some View {
        HStack {
            LabeledField(title, text: $text, prompt: prompt)
            if !options.isEmpty {
                Menu {
                    if !text.isEmpty { Button("Any \(title.lowercased())") { text = "" } }
                    ForEach(options.prefix(200), id: \.self) { option in
                        Button(option) { text = option }
                    }
                } label: {
                    Image(systemName: "chevron.up.chevron.down")
                        .foregroundStyle(Color.brand)
                        .frame(minWidth: 32, minHeight: 32)
                }
                .accessibilityLabel("Pick a \(title.lowercased()) from your shows")
            }
        }
    }
}

private struct LabeledField: View {
    let title: String
    @Binding var text: String
    let prompt: String

    init(_ title: String, text: Binding<String>, prompt: String) {
        self.title = title
        _text = text
        self.prompt = prompt
    }

    var body: some View {
        LabeledContent(title) {
            TextField(title, text: $text, prompt: Text(prompt))
                .multilineTextAlignment(.trailing)
                .autocorrectionDisabled()
                .submitLabel(.search)
        }
    }
}

/// A `YYYY-MM-DD` filter: "Any" until set, then a date picker and a clear button.
private struct DayField: View {
    let title: String
    @Binding var day: String

    var body: some View {
        if let date = DayField.date(day) {
            HStack {
                DatePicker(title, selection: Binding(get: { date }, set: { day = DayField.day($0) }), displayedComponents: .date)
                Button { day = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Color.textMuted) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear \(title.lowercased()) date")
            }
        } else {
            LabeledContent(title) {
                Button("Any date") { day = ShowDate.today() }
                    .foregroundStyle(Color.brand)
            }
        }
    }

    static func date(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard day.count == 10, parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func day(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }
}

// MARK: - By artist

/// The Shows page's "By artist" view: every band, how many shows, your
/// average rating, and the shows under each.
struct ArtistGroupsScreen: View {
    @Environment(ShowsStore.self) private var store
    @State private var sort = ShowSearch.GroupSort.mostShows
    @State private var query = ""
    @State private var expanded: Set<String> = []

    private var today: String { ShowDate.today() }

    var body: some View {
        let groups = ShowSearch.artistGroups(store.shows, sort: sort).filter {
            query.isEmpty || $0.artist.localizedCaseInsensitiveContains(query.trimmingCharacters(in: .whitespaces))
        }
        List {
            if store.showsLoaded, store.shows.isEmpty {
                ContentUnavailableView("No shows yet", systemImage: "music.mic",
                                       description: Text("The bands you've seen are listed here once you add shows."))
            }
            Section {
                ForEach(groups) { group in
                    DisclosureGroup(isExpanded: Binding(
                        get: { expanded.contains(group.artist) },
                        set: { if $0 { expanded.insert(group.artist) } else { expanded.remove(group.artist) } }
                    )) {
                        ForEach(group.shows) { show in
                            NavigationLink(value: AppRoute.show(id: show.id)) { ShowRow(show: show, today: today) }
                        }
                        NavigationLink(value: AppRoute.band(slug: BandDirectory.slug(forArtist: group.artist))) {
                            Label("\(group.artist) band page", systemImage: "guitars")
                                .foregroundStyle(Color.brand)
                        }
                    } label: {
                        HStack(spacing: Space.x3) {
                            Text(group.artist)
                                .font(.jakarta(size: 16, weight: .semibold, relativeTo: .body))
                                .foregroundStyle(Color.textPrimary)
                                .lineLimit(1)
                            Spacer(minLength: Space.x2)
                            Text("\(group.shows.count)")
                                .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
                                .monospacedDigit()
                                .padding(.horizontal, Space.x2)
                                .padding(.vertical, 2)
                                .background(Color.brandSubtle, in: Capsule())
                                .foregroundStyle(Color.brand)
                                .accessibilityLabel("\(group.shows.count) show\(group.shows.count == 1 ? "" : "s")")
                            Text(ShowSearch.average(group.averageRating) ?? "--")
                                .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
                                .monospacedDigit()
                                .foregroundStyle(group.averageRating == nil ? Color.textMuted : Color.amber)
                                .frame(minWidth: 52, alignment: .trailing)
                                .accessibilityLabel(group.averageRating.map { String(format: "average rating %.1f", $0) } ?? "not rated")
                        }
                    }
                }
            } header: {
                if !groups.isEmpty { Text("\(groups.count) band\(groups.count == 1 ? "" : "s")") }
            }
            .brandRow()
        }
        .brandScreen()
        .navigationTitle("By artist")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Bands")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Sort", selection: $sort) {
                        ForEach(ShowSearch.GroupSort.allCases) { Text($0.title).tag($0) }
                    }
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
            }
        }
    }
}
