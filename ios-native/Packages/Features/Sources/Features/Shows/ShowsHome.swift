import Core
import DesignSystem
import SwiftUI

/// The Shows tab (Stage 1, Part 2): Past | Upcoming, search, filters,
/// counts, empty states, pull to refresh. Reads `ShowsStore`; writes
/// nothing yet. Adding a show (+) arrives in Part 4.
struct ShowsHome: View {
    enum Segment: String, CaseIterable { case past = "Past", upcoming = "Upcoming" }

    @Environment(ShowsStore.self) private var store
    @Environment(SessionStore.self) private var session
    @State private var segment = Segment.past
    @State private var query = ""
    @State private var filter = ShowList.Filter()
    @State private var adding = false
    @State private var upgrading = false
    /// The list has come from the cache for a while: say it's offline.
    @State private var showOfflineNote = false
    /// "Relive this night" dismissed (also kept for the app's run by `ReliveThisNight`).
    @State private var reliveDismissed = false
    /// Shows the Internet Archive may have setlists for (the backfill card).
    @State private var backfill: [Show] = []
    @State private var backfillChecked: Set<String> = []
    @State private var backfillReview: ArchiveBackfillSection.ReviewList?

    private var isGuest: Bool { session.user?.isAnonymous == true }
    private var today: String { ShowDate.today() }

    var body: some View {
        Group {
            switch segment {
            case .past: pastList
            case .upcoming: upcomingList
            }
        }
        .navigationTitle("Shows")
        .searchable(text: $query, prompt: segment == .past ? "Bands, venues, cities, songs" : "Bands, venues, cities")
        .refreshable { await store.refresh() }
        .toolbar {
            if segment == .past {
                ToolbarItem(placement: .topBarLeading) { filterMenu }
            }
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Label("Add a show", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.circle)
                    .tint(.brand)
            }
        }
        .sheet(isPresented: $adding) { AddShowSheet() }
        .sheet(isPresented: $upgrading) { GuestUpgradeView() }
        .task(id: store.fromCache) {
            // A launch's first snapshot is often the cache for a moment; only
            // a cache that lasts means the phone is offline.
            showOfflineNote = false
            guard store.fromCache else { return }
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { showOfflineNote = store.fromCache }
        }
    }

    // MARK: Header

    /// The switch and active filters as the list's first row, so a pull to
    /// refresh moves them with the list and the spinner shows above them
    /// (they used to sit in a fixed inset the list slid under).
    private var headerSection: some View {
        Section { header }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }

    /// An empty, loading or no-results state as a row under the switch, so
    /// the switch stays reachable (an overlay would cover it).
    private func stateSection<V: View>(@ViewBuilder _ content: () -> V) -> some View {
        Section {
            content()
                .frame(maxWidth: .infinity, minHeight: 320)
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    private var header: some View {
        VStack(spacing: Space.x2) {
            UpdateBanner()
            Picker("Shows", selection: $segment) {
                // "Past · 214" | "Upcoming · 6" (the Stage 1 mockup), once loaded.
                Text(store.showsLoaded ? "Past · \(store.shows.count)" : "Past").tag(Segment.past)
                Text(store.upcomingLoaded ? "Upcoming · \(store.upcoming.count)" : "Upcoming").tag(Segment.upcoming)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Space.x4)
            if segment == .past, filter.activeCount > 0 { activeFilters }
        }
        .padding(.vertical, Space.x2)
    }

    /// The menu filters in force, each a tap to remove.
    private var activeFilters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.x2) {
                if let year = filter.year { chip(year) { filter.year = nil } }
                if let band = filter.band { chip(band) { filter.band = nil } }
                if let venue = filter.venue { chip(venue) { filter.venue = nil } }
            }
            .padding(.horizontal, Space.x4)
        }
    }

    private func chip(_ title: String, remove: @escaping () -> Void) -> some View {
        Button(action: remove) {
            Label(title, systemImage: "xmark")
                .labelStyle(TrailingIconLabelStyle())
                .font(.jakarta(size: 14, weight: .medium, relativeTo: .subheadline))
                .padding(.horizontal, Space.x3)
                .frame(minHeight: 32)
                .background(Color.brandSubtle, in: Capsule())
                .foregroundStyle(Color.brand)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove filter \(title)")
    }

    private var filterMenu: some View {
        Menu {
            Picker("Year", selection: $filter.year) {
                Text("Any year").tag(String?.none)
                ForEach(ShowList.years(store.shows), id: \.self) { Text($0).tag(String?.some($0)) }
            }
            .pickerStyle(.menu)
            Picker("Band", selection: $filter.band) {
                Text("Any band").tag(String?.none)
                ForEach(ShowList.bands(store.shows)) { Text("\($0.name) (\($0.count))").tag(String?.some($0.name)) }
            }
            .pickerStyle(.menu)
            Picker("Venue", selection: $filter.venue) {
                Text("Any venue").tag(String?.none)
                ForEach(ShowList.venues(store.shows)) { Text("\($0.name) (\($0.count))").tag(String?.some($0.name)) }
            }
            .pickerStyle(.menu)
            if filter.activeCount > 0 {
                Button("Clear filters", role: .destructive) { clearFilters(keepText: true) }
            }
        } label: {
            Label("Filter", systemImage: filter.activeCount > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .disabled(store.shows.isEmpty)
    }

    private func clearFilters(keepText: Bool = false) {
        filter = ShowList.Filter()
        if !keepText { query = "" }
    }

    // MARK: Past

    private var pastFilter: ShowList.Filter {
        var f = filter
        f.text = query
        return f
    }

    private var pastList: some View {
        let filtered = ShowList.filter(store.shows, pastFilter)
        let sections = ShowList.byYear(filtered)
        return List {
            headerSection
            // "Keep your shows" for a guest with a show (6-11).
            if isGuest {
                Section { GuestRescueBanner { upgrading = true } }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if pastFilter.isEmpty, store.showsLoaded, let uid = session.user?.uid {
                if !reliveDismissed, let relive = ReliveThisNight.show(for: uid, shows: store.shows, today: today) {
                    ReliveThisNightSection(show: relive, today: today) {
                        ReliveThisNight.dismiss()
                        reliveDismissed = true
                    }
                }
                if !isGuest {
                    ArchiveBackfillSection(candidates: backfill, checked: backfillChecked) { backfillReview = .init(shows: $0) }
                }
            }
            if store.shows.isEmpty, store.waitingShows.isEmpty {
                stateSection { pastEmptyState }
            } else if !store.shows.isEmpty, filtered.isEmpty {
                // Only a filter that hides stored shows; "Waiting to sync"
                // rows alone aren't "no results".
                stateSection { noResults }
            }
            if !store.shows.isEmpty {
                Section {
                    if pastFilter.isEmpty {
                        ShowsSummary(showCount: store.shows.count, stats: store.stats)
                    } else {
                        Text("\(filtered.count) of \(store.shows.count) shows")
                            .font(.jakarta(size: 14, relativeTo: .subheadline))
                            .foregroundStyle(Color.textSecondary)
                    }
                } footer: {
                    statusNote
                }
                .brandRow()
            }
            if !store.waitingShows.isEmpty {
                Section {
                    ForEach(store.waitingShows) { entry in
                        NavigationLink(value: AppRoute.show(id: entry.showId)) { WaitingShowRow(entry: entry) }
                    }
                } header: {
                    Text("Waiting to sync").textCase(nil)
                }
                .brandRow()
            }
            ForEach(sections) { section in
                Section {
                    ForEach(section.shows) { show in
                        NavigationLink(value: AppRoute.show(id: show.id)) {
                            ShowRow(show: show, today: today)
                        }
                    }
                } header: {
                    YearHeader(year: section.year, count: section.shows.count)
                }
                .brandRow()
            }
        }
        // Again when the shows without a setlist change.
        .task(id: store.shows.filter(\.setlist.isEmpty).map(\.id)) {
            guard let user = session.user, !user.isAnonymous, store.showsLoaded else { backfill = []; return }
            backfillChecked = ArchiveBackfill.checked(uid: user.uid)
            backfill = await ArchiveBackfillSection.find(in: store, uid: user.uid)
        }
        .sheet(item: $backfillReview) { list in
            ArchiveBackfillSheet(shows: list.shows) { showId in
                if let uid = session.user?.uid { ArchiveBackfill.remember(showId, uid: uid) }
                backfillChecked.insert(showId)
            }
        }
    }

    @ViewBuilder private var pastEmptyState: some View {
        if !store.showsLoaded {
            ProgressView("Loading your shows")
        } else if let problem = store.loadProblem {
            ContentUnavailableView {
                Label("Your shows couldn't be loaded", systemImage: "wifi.exclamationmark")
            } description: {
                Text("Check your connection and pull to try again. (\(problem))")
            } actions: {
                Button("Try again") { Task { await store.refresh() } }
                    .buttonStyle(.borderedProminent)
                    .fixedSize()
            }
        } else {
            firstShowEmptyState
        }
    }

    /// Offline, or the last refresh didn't reach the server.
    @ViewBuilder private var statusNote: some View {
        if let problem = store.refreshProblem {
            Text(problem)
        } else if showOfflineNote {
            Text("You're offline. Showing the shows saved on this device.")
        }
    }

    /// "Add a show" in an empty state. These sit in a list row, where a
    /// `Label` in a prominent button wrapped onto two lines or drew as a
    /// tall empty pill; an icon and text in a stack, at its own size, draw
    /// on one line.
    private var addShowButton: some View {
        Button { adding = true } label: {
            HStack(spacing: Space.x2) {
                Image(systemName: "plus")
                Text("Add a show")
            }
        }
        .buttonStyle(.borderedProminent)
        .tint(.brand)
        .fixedSize()
    }

    private var firstShowEmptyState: some View {
        ContentUnavailableView {
            Label("Your concert journey starts here", systemImage: "music.note.list")
        } description: {
            Text(isGuest
                 ? "Add the shows you've been to, with their setlists, ratings and notes. They stay with you when you create an account."
                 : "Add the shows you've been to, with their setlists, ratings and notes.")
        } actions: {
            addShowButton
            if isGuest {
                Button("Create your account") { upgrading = true }
                    .buttonStyle(.borderless)
            }
        }
    }

    private var noResults: some View {
        ContentUnavailableView {
            Label("No shows match", systemImage: "magnifyingglass")
        } description: {
            Text(query.isEmpty ? "Nothing matches these filters." : "Nothing matches \u{201C}\(query)\u{201D}\(filter.activeCount > 0 ? " with these filters" : "").")
        } actions: {
            Button("Clear search and filters") { clearFilters() }
                .buttonStyle(.borderless)
            addShowButton
        }
    }

    // MARK: Upcoming

    private var upcomingList: some View {
        let shown = ShowList.upcoming(store.upcoming, matching: query)
        let sections = ShowList.upcomingByYear(shown)
        return List {
            headerSection
            if store.upcoming.isEmpty {
                stateSection { upcomingEmptyState }
            } else if shown.isEmpty {
                stateSection {
                    ContentUnavailableView {
                        Label("No upcoming shows match", systemImage: "magnifyingglass")
                    } description: {
                        Text("Nothing matches \u{201C}\(query)\u{201D}.")
                    } actions: {
                        Button("Clear search") { query = "" }
                            .buttonStyle(.borderless)
                        addShowButton
                    }
                }
            }
            if !store.upcoming.isEmpty, !query.trimmingCharacters(in: .whitespaces).isEmpty {
                Section {
                    Text("\(shown.count) of \(store.upcoming.count) upcoming")
                        .font(.jakarta(size: 14, relativeTo: .subheadline))
                        .foregroundStyle(Color.textSecondary)
                }
                .brandRow()
            }
            ForEach(sections) { section in
                Section {
                    ForEach(section.shows) { show in
                        NavigationLink(value: AppRoute.upcomingShow(id: show.id)) { UpcomingRow(show: show) }
                    }
                } header: {
                    YearHeader(year: section.year, count: section.shows.count)
                } footer: {
                    if section.id == sections.last?.id { statusNote }
                }
                .brandRow()
            }
        }
    }

    @ViewBuilder private var upcomingEmptyState: some View {
        if !store.upcomingLoaded {
            ProgressView("Loading your upcoming shows")
        } else {
            ContentUnavailableView {
                Label("No upcoming shows", systemImage: "calendar")
            } description: {
                Text("Add the shows you have tickets for. After the night, move each one to your shows with its setlist.")
            } actions: {
                addShowButton
            }
        }
    }
}

/// Title first, icon after it ("2026 ✕").
struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: Space.x1) {
            configuration.title
            configuration.icon.imageScale(.small)
        }
    }
}
