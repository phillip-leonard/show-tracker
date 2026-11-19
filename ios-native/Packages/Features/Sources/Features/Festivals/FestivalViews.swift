import Core
import DesignSystem
import SwiftUI

// Festivals (Stage 5, 5-3), as the web's FestivalListView and
// FestivalDetailView: your festivals, and one festival's tiles, notes,
// artists, lineup and shows by day, with "Pick from my shows", remove and
// leave. Creating, joining, editing details, entering the lineup, the
// lineup search and your picks (5-4) are in FestivalEditing.swift.
// Accounts only (DECISIONS.md "Guests"): a guest gets the account prompt.

/// "Jun 13, 2024 – Jun 16, 2024", "Jun 13, 2024", "2024", or "".
func festivalWhen(_ f: Festival) -> String {
    if let start = f.startDate, !start.isEmpty {
        let end = f.endDate ?? start
        return end == start ? ShowDateText.display(start) : "\(ShowDateText.display(start)) – \(ShowDateText.display(end))"
    }
    return FestivalDates.year(f).map(String.init) ?? ""
}

/// The account prompt in place of Festivals for a guest.
private struct FestivalsNeedAnAccount: View {
    @State private var upgrading = false

    var body: some View {
        ContentUnavailableView {
            Label("Create an account to use Festivals", systemImage: "tent")
        } description: {
            Text("Group the shows you caught at a festival, and join festivals other people have added. Your shows come with you.")
        } actions: {
            Button("Create your account") { upgrading = true }
                .buttonStyle(.borderedProminent)
                .tint(.brand)
        }
        .sheet(isPresented: $upgrading) { GuestUpgradeView() }
    }
}

// MARK: - The list

/// `/festivals`: your festivals, newest first, with the shared show filter.
struct FestivalsScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(FestivalsStore.self) private var store
    @Environment(ShowsStore.self) private var shows
    @Environment(AppRouter.self) private var router
    @State private var query = ""
    @State private var year: String?
    @State private var creating = false

    var body: some View {
        Group {
            if session.user?.isAnonymous == true {
                FestivalsNeedAnAccount()
            } else {
                list
            }
        }
        .navigationTitle("Festivals")
    }

    private var list: some View {
        let all = store.festivals ?? []
        let rows = FestivalList.rows(all, shows: shows.shows, query: query, year: year)
        let filtering = !query.trimmingCharacters(in: .whitespaces).isEmpty || year != nil
        return List {
            if store.fromCache, store.festivals != nil {
                Section {
                    Label("Offline. Showing the festivals saved on this device.", systemImage: "wifi.slash")
                        .font(.jakarta(size: 13, relativeTo: .footnote))
                        .foregroundStyle(Color.amber)
                }
                .brandRow()
            }
            if store.festivals == nil {
                Section {
                    if let problem = store.loadProblem {
                        HStack {
                            Text(problem).foregroundStyle(Color.amber)
                            Spacer()
                            Button("Try again") { store.reload() }.buttonStyle(.borderless)
                        }
                    } else {
                        HStack { Text("Loading your festivals"); Spacer(); ProgressView() }.foregroundStyle(Color.textSecondary)
                    }
                }
                .brandRow()
            } else if all.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: Space.x2) {
                        Text("No festivals yet")
                            .font(.jakarta(size: 17, weight: .bold, relativeTo: .headline))
                            .foregroundStyle(Color.textPrimary)
                        Text("Create a festival and attach the shows you caught there: multiple artists, one event, all grouped together. If someone's already added the one you went to, you can join theirs instead.")
                            .font(.jakarta(size: 14, relativeTo: .subheadline))
                            .foregroundStyle(Color.textSecondary)
                        Button { creating = true } label: {
                            Label("New festival", systemImage: "plus")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.brand)
                        .padding(.top, Space.x1)
                    }
                    .padding(.vertical, Space.x2)
                }
                .brandRow()
            } else if rows.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: Space.x2) {
                        Text("No festivals match those filters")
                            .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                        Text("Only festivals with a show that matches the filter are listed. Try clearing a filter to see more.")
                            .font(.jakarta(size: 14, relativeTo: .subheadline))
                            .foregroundStyle(Color.textSecondary)
                        Button("Clear filters") { query = ""; year = nil }
                            .buttonStyle(.bordered)
                            .tint(.brand)
                    }
                    .padding(.vertical, Space.x2)
                }
                .brandRow()
            } else {
                Section {
                    ForEach(rows) { row in
                        NavigationLink(value: AppRoute.festival(id: row.festival.id)) { FestivalRow(row: row) }
                    }
                } footer: {
                    if filtering { Text("Counting the shows that match.") }
                }
                .brandRow()
            }
        }
        .searchable(text: $query, prompt: "Filter by band, venue or festival")
        .refreshable { await store.refresh() }
        .sheet(isPresented: $creating) {
            FestivalFormSheet(editing: nil) { festival in router.push(.festival(id: festival.id)) }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { creating = true } label: { Label("New festival", systemImage: "plus") }
            }
            ToolbarItem(placement: .topBarTrailing) {
                let years = FestivalList.years(shows: shows.shows)
                if !years.isEmpty {
                    Menu {
                        Picker("Year", selection: $year) {
                            Text("Every year").tag(String?.none)
                            ForEach(years, id: \.self) { Text($0).tag(String?.some($0)) }
                        }
                    } label: {
                        Label(year ?? "Year", systemImage: year == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                    }
                }
            }
        }
    }
}

private struct FestivalRow: View {
    let row: FestivalList.Row

    var body: some View {
        let f = row.festival
        VStack(alignment: .leading, spacing: 3) {
            Text(f.name)
                .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                .foregroundStyle(Color.textPrimary)
            Text(([festivalWhen(f), f.location].filter { !$0.isEmpty } + [row.showCount == 1 ? "1 show" : "\(row.showCount) shows"])
                .joined(separator: " · "))
                .font(.jakarta(size: 13, relativeTo: .subheadline))
                .foregroundStyle(Color.textSecondary)
                .lineLimit(2)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - One festival

/// `/festivals/?festival=<attendance id>`.
struct FestivalScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(FestivalsStore.self) private var store
    let id: String

    var body: some View {
        Group {
            if session.user?.isAnonymous == true {
                FestivalsNeedAnAccount()
            } else if let festival = store.festival(id: id) {
                FestivalPage(festival: festival)
            } else if store.festivals == nil, store.loadProblem == nil {
                ProgressView("Loading festival")
            } else {
                ContentUnavailableView {
                    Label("Festival not found", systemImage: "tent")
                } description: {
                    Text("It isn't one of your festivals. A festival link only opens for the person it belongs to.")
                } actions: {
                    Button("Try again") { store.reload() }
                }
            }
        }
        .navigationTitle(store.festival(id: id)?.name ?? "Festival")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct FestivalPage: View {
    @Environment(FestivalsStore.self) private var store
    @Environment(ShowsStore.self) private var showsStore
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    let festival: Festival

    @State private var editingNotes = false
    @State private var attaching = false
    @State private var confirmLeave = false
    @State private var leaving = false
    @State private var notice: String?
    @State private var lineupLoading = false
    @State private var editingDetails = false
    @State private var editingLineup = false
    @State private var searchingLineup = false

    private var attached: [Show] { showsStore.shows.filter { $0.festivalId == festival.id } }

    var body: some View {
        let shows = attached
        let byId = Dictionary(shows.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let stats = FestivalStats.build(shows: shows)
        let today = ShowDate.today()
        List {
            Section { header }.brandRow()
            Section { tiles(stats) }
                .listRowInsets(EdgeInsets(top: Space.x2, leading: Space.x4, bottom: Space.x2, trailing: Space.x4))
                .listRowBackground(Color.clear)
            notesSection
            if !stats.artists.isEmpty { artistsSection(stats.artists) }
            if festival.festivalId != nil, FestivalDates.isUpcoming(festival, today: today) || !festival.lineup.isEmpty || !festival.myLineup.isEmpty {
                FestivalPicksSection(festival: festival, answer: store.lineupAnswers[festival.id], loading: lineupLoading) { editingLineup = true }
            } else if !festival.myLineup.isEmpty {
                FestivalPicksSection(festival: festival, answer: nil, loading: false) { editingLineup = true }
            }
            showsSections(stats: stats, byId: byId, today: today)
        }
        .refreshable { await store.refresh() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { attaching = true } label: { Label("Add shows", systemImage: "plus") }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { attaching = true } label: { Label("Pick from my shows", systemImage: "music.note.list") }
                    Button { searchingLineup = true } label: { Label("Search the lineup", systemImage: "magnifyingglass") }
                    if festival.lineup.isEmpty, festival.festivalId != nil {
                        Button { editingLineup = true } label: {
                            Label(festival.myLineup.isEmpty ? "Enter the lineup" : "Edit the lineup", systemImage: "list.bullet")
                        }
                    }
                    if festival.isCreator || festival.unmigrated {
                        Button { editingDetails = true } label: { Label("Edit festival", systemImage: "pencil") }
                    }
                    Button { editingNotes = true } label: { Label(festival.notes.isEmpty ? "Add a note" : "Edit your note", systemImage: "square.and.pencil") }
                    Divider()
                    Button(role: .destructive) { confirmLeave = true } label: { Label("Leave festival", systemImage: "rectangle.portrait.and.arrow.right") }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .disabled(leaving)
            }
        }
        .sheet(isPresented: $attaching) { AttachShowsSheet(festival: festival) }
        .sheet(isPresented: $editingNotes) { FestivalNotesSheet(festival: festival) }
        .sheet(isPresented: $editingDetails) { FestivalFormSheet(editing: festival) { _ in notice = "Saved. Everyone who added this festival sees the change." } }
        .sheet(isPresented: $editingLineup) { LineupEditorSheet(festival: festival) { Task { await askLineup() } } }
        .sheet(isPresented: $searchingLineup) { LineupSearchSheet(festival: festival) }
        .confirmationDialog("Leave this festival?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave festival", role: .destructive) { Task { await leave() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes \(festival.name) from your festivals and takes your notes for it with it. Every show you had attached is kept: they go back to being ordinary shows in your history. "
                 + (festival.isCreator ? "You created this festival, but leaving doesn't remove it for anyone else who's added it." : "Nobody else's copy of this festival is affected."))
        }
        .notice($notice)
        .task(id: festival.id) {
            // The shared lineup (Ticketmaster's, fetched at most daily by the
            // server, for an upcoming festival) and your picks of it, or of
            // the one you typed (as the web asks).
            guard store.lineupAnswers[festival.id] == nil, festival.festivalId != nil,
                  FestivalDates.isUpcoming(festival, today: ShowDate.today()) || !festival.lineup.isEmpty || !festival.myLineup.isEmpty else { return }
            await askLineup()
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Text(festival.name)
                .font(.jakarta(size: 28, weight: .heavy, relativeTo: .largeTitle))
                .foregroundStyle(Color.textPrimary)
                .accessibilityAddTraits(.isHeader)
            let line = [festivalWhen(festival), festival.location].filter { !$0.isEmpty }.joined(separator: " · ")
            if !line.isEmpty {
                Text(line)
                    .font(.jakarta(size: 15, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
            }
            if festival.isCutShort {
                Label {
                    Text("**Cut short.** \(festival.catalogNote ?? "This edition ended early.")")
                } icon: { Image(systemName: "cloud.bolt") }
                    .font(.jakarta(size: 13, relativeTo: .footnote))
                    .foregroundStyle(Color.textSecondary)
            }
            if festival.unavailable {
                Label("This festival isn't available any more. Your shows and notes are still here, and you can leave it.", systemImage: "exclamationmark.triangle")
                    .font(.jakarta(size: 13, relativeTo: .footnote))
                    .foregroundStyle(Color.amber)
            } else if festival.festivalId != nil, !festival.isCreator {
                Label(festival.isSeeded
                      ? "From the MySetlists festival catalog, so its name, dates and location are fixed. Your shows and notes here are yours alone."
                      : "Added by another user: its name, dates and location are theirs to change. Your shows and notes here are yours alone.",
                      systemImage: festival.isSeeded ? "book" : "person.2")
                    .font(.jakarta(size: 13, relativeTo: .footnote))
                    .foregroundStyle(Color.textMuted)
            }
        }
        .padding(.vertical, Space.x1)
    }

    private func tiles(_ stats: FestivalStats) -> some View {
        Grid(horizontalSpacing: Space.x2, verticalSpacing: Space.x2) {
            GridRow {
                tile("\(stats.showCount)", "Shows attended")
                tile("\(stats.artistCount)", stats.artistCount == 1 ? "Artist" : "Artists")
            }
            GridRow {
                tile("\(stats.dayCount)", stats.dayCount == 1 ? "Day" : "Days")
                tile(stats.avgRating.map { String(format: "%.1f", $0) } ?? "—", "Avg rating")
            }
        }
    }

    private func tile(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.jakarta(size: 24, weight: .heavy, relativeTo: .title2))
                .monospacedDigit()
                .foregroundStyle(Color.textPrimary)
            Text(label)
                .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                .foregroundStyle(Color.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Space.x3)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: Notes and artists

    private var notesSection: some View {
        Section("Notes") {
            Button { editingNotes = true } label: {
                Text(festival.notes.isEmpty ? "Add a note…" : festival.notes)
                    .font(.jakarta(size: 15, relativeTo: .body))
                    .italic(festival.notes.isEmpty)
                    .foregroundStyle(festival.notes.isEmpty ? Color.textMuted : Color.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Edits your note for this festival")
        }
        .brandRow()
    }

    private func artistsSection(_ artists: [String]) -> some View {
        Section("Artists") {
            ForEach(artists, id: \.self) { artist in
                NavigationLink(value: AppRoute.band(slug: BandDirectory.slug(forArtist: artist))) { Text(artist) }
            }
        }
        .brandRow()
    }

    // MARK: Shows

    @ViewBuilder
    private func showsSections(stats: FestivalStats, byId: [String: Show], today: String) -> some View {
        if stats.days.isEmpty {
            Section("Shows") {
                VStack(alignment: .leading, spacing: Space.x3) {
                    Text("No shows attached yet.")
                        .font(.jakarta(size: 15, relativeTo: .body))
                        .foregroundStyle(Color.textSecondary)
                    VStack(spacing: Space.x2) {
                        Button { searchingLineup = true } label: {
                            Label("Search the lineup", systemImage: "magnifyingglass").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        Button { attaching = true } label: {
                            Label("Pick from my shows", systemImage: "music.note.list").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                    .tint(.brand)
                }
                .padding(.vertical, Space.x2)
            }
            .brandRow()
        } else {
            ForEach(stats.days) { day in
                Section(day.date.isEmpty ? "No date" : ShowDateText.display(day.date)) {
                    ForEach(day.showIds, id: \.self) { id in
                        if let show = byId[id] {
                            NavigationLink(value: AppRoute.show(id: show.id)) { ShowRow(show: show, today: today, showsFestival: false) }
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) { Task { await remove(show) } } label: {
                                        Label("Remove from festival", systemImage: "minus.circle")
                                    }
                                }
                                .contextMenu {
                                    Button(role: .destructive) { Task { await remove(show) } } label: {
                                        Label("Remove from festival", systemImage: "minus.circle")
                                    }
                                }
                                .accessibilityAction(named: "Remove from festival") { Task { await remove(show) } }
                        }
                    }
                }
                .brandRow()
            }
        }
    }

    private func askLineup() async {
        lineupLoading = true
        defer { lineupLoading = false }
        _ = await store.lineup(for: festival)
    }

    private func remove(_ show: Show) async {
        do {
            try await showsStore.setFestival(nil, showIds: [show.id])
            notice = "Removed \(show.artist) from the festival."
        } catch {
            notice = "Couldn't remove that show. Try again."
        }
    }

    private func leave() async {
        leaving = true
        defer { leaving = false }
        do {
            try await store.leave(festivalId: festival.id)
            dismiss()
        } catch {
            notice = error.message ?? "Couldn't leave the festival. Try again."
        }
    }
}

// MARK: - Notes

private struct FestivalNotesSheet: View {
    @Environment(FestivalsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let festival: Festival
    @State private var text = ""
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text)
                        .frame(minHeight: 160)
                        .accessibilityLabel("Your note")
                } footer: {
                    Text(problem ?? "Only you can see your notes.")
                        .foregroundStyle(problem == nil ? Color.textSecondary : Color.amber)
                }
                .brandRow()
            }
            .brandScreen()
            .navigationTitle(festival.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            saving = true
                            defer { saving = false }
                            do {
                                try await store.saveNotes(text, festivalId: festival.id)
                                dismiss()
                            } catch {
                                problem = "Couldn't save your note. Try again."
                            }
                        }
                    } label: { if saving { ProgressView() } else { Text("Save") } }
                    .disabled(saving)
                }
            }
        }
        .onAppear { text = festival.notes }
    }
}

// MARK: - Pick from my shows

/// `AttachShowsModal`: search by band, venue or date; inside the festival's
/// dates (or its year) unless asked; several at once. A show already in
/// another festival is moved only after asking.
struct AttachShowsSheet: View {
    @Environment(ShowsStore.self) private var showsStore
    @Environment(FestivalsStore.self) private var festivals
    @Environment(\.dismiss) private var dismiss
    let festival: Festival
    @State private var query = ""
    @State private var anyDate = false
    @State private var selected: Set<String> = []
    @State private var conflicts: [Show] = []
    @State private var confirmMove = false
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        let candidates = FestivalList.attachCandidates(showsStore.shows, festival: festival, query: query, anyDate: anyDate)
        let today = ShowDate.today()
        NavigationStack {
            List {
                if FestivalList.hasWindow(festival) {
                    Section {
                        Toggle("Show shows outside \(festivalWhen(festival))", isOn: $anyDate)
                    }
                    .brandRow()
                }
                if let problem {
                    Section { Text(problem).foregroundStyle(Color.amber) }.brandRow()
                }
                Section {
                    if candidates.isEmpty {
                        Text("No matching shows.")
                            .foregroundStyle(Color.textSecondary)
                    }
                    ForEach(candidates) { show in
                        Button { toggle(show.id) } label: {
                            HStack(spacing: Space.x3) {
                                Image(systemName: selected.contains(show.id) ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(selected.contains(show.id) ? Color.brand : Color.textMuted)
                                    .accessibilityHidden(true)
                                ShowRow(show: show, today: today)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected.contains(show.id) ? .isSelected : [])
                    }
                }
                .brandRow()
            }
            .brandScreen()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search by artist, venue, or date")
            .navigationTitle("Add shows to festival")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submit(force: false) }
                    } label: {
                        if saving { ProgressView() } else { Text(selected.count == 1 ? "Add 1 show" : "Add \(selected.count) shows") }
                    }
                    .disabled(selected.isEmpty || saving)
                }
            }
            .alert(conflicts.count == 1 ? "1 show is already in another festival" : "\(conflicts.count) shows are already in another festival",
                   isPresented: $confirmMove) {
                Button(conflicts.count == 1 ? "Move it here" : "Move them here", role: .destructive) { Task { await submit(force: true) } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(conflicts.map { "\($0.artist), \(ShowDateText.display($0.date)) (in \(festivals.name(forAttendanceId: $0.festivalId) ?? "another festival"))" }
                    .joined(separator: "\n"))
            }
        }
    }

    private func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }

    private func submit(force: Bool) async {
        let ids = Array(selected)
        if !force {
            conflicts = FestivalList.conflicts(ids, shows: showsStore.shows, festivalId: festival.id)
            if !conflicts.isEmpty { confirmMove = true; return }
        }
        saving = true
        defer { saving = false }
        do {
            try await showsStore.setFestival(festival.id, showIds: ids)
            dismiss()
        } catch {
            problem = "Couldn't add those shows. Try again."
        }
    }
}
