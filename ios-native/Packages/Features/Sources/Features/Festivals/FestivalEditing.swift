import Core
import DesignSystem
import SwiftUI

// Festivals, Stage 5 part 4 (5-4), as the web's FestivalFormModal,
// FestivalPicks and FestivalLineupModal: create a festival (offered the
// ones someone already added first, with Join), the creator's edit of the
// details, the lineup you type, your picks, and the lineup search with
// its import. Creating, joining, editing and searching need a connection.

// MARK: - Create and edit

/// New festival, or the creator's edit of one (name, dates or the year,
/// location). In create mode, festivals someone already added that look
/// like it are offered with Join; it never joins on its own and never
/// blocks creating ("Create it anyway").
struct FestivalFormSheet: View {
    @Environment(FestivalsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    /// Nil to create.
    let editing: Festival?
    /// The festival created, joined or saved.
    let done: (Festival) -> Void

    @State private var draft = FestivalDraft()
    @State private var start = Date()
    @State private var end = Date()
    @State private var matches: [FestivalMatch] = []
    @State private var matching = false
    @State private var joiningId: String?
    @State private var saving = false
    @State private var problem: String?

    private var isEdit: Bool { editing != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name (e.g. Bonnaroo 2026)", text: $draft.name)
                        .textInputAutocapitalization(.words)
                    if draft.yearOnly {
                        TextField("Year (e.g. 2019)", text: $draft.year)
                            .keyboardType(.numberPad)
                    } else {
                        DatePicker("Starts", selection: $start, displayedComponents: .date)
                        DatePicker("Ends", selection: $end, in: start..., displayedComponents: .date)
                    }
                    Toggle("I don't know the exact dates", isOn: $draft.yearOnly)
                    TextField("Location (optional, e.g. Manchester, TN)", text: $draft.location)
                        .textInputAutocapitalization(.words)
                } footer: {
                    if draft.yearOnly { Text("You can add the dates later.") }
                }
                .brandRow()

                if !isEdit { matchSection }

                if !isEdit {
                    Section("Notes (optional)") {
                        TextField("Anything you want to remember about this one", text: $draft.notes, axis: .vertical)
                            .lineLimit(3...6)
                    }
                    .brandRow()
                }

                if let problem {
                    Section { Text(problem).foregroundStyle(Color.amber) }.brandRow()
                }
            }
            .brandScreen()
            .disabled(saving || joiningId != nil)
            .navigationTitle(isEdit ? "Edit festival" : "New festival")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView() } else { Text(isEdit ? "Save" : (matches.isEmpty ? "Create" : "Create anyway")) }
                    }
                    .disabled(saving)
                }
            }
            .onAppear(perform: fill)
            .onChange(of: start) { _, value in
                draft.startDate = ManualShowForm.isoDay(value)
                if end < value { end = value }
            }
            .onChange(of: end) { _, value in draft.endDate = ManualShowForm.isoDay(value) }
            .onChange(of: draft.yearOnly) { _, yearOnly in
                // Ticking the box keeps the year of a start date already picked.
                if yearOnly, draft.year.isEmpty, !draft.startDate.isEmpty { draft.year = String(draft.startDate.prefix(4)) }
            }
            // The lookup: create mode only, 400 ms after the last change, as the web does.
            .task(id: "\(draft.name)|\(draft.startDate)|\(draft.endDate)|\(draft.yearOnly)|\(draft.year)|\(draft.location)") {
                guard !isEdit else { return }
                guard draft.canMatch else { matches = []; return }
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled else { return }
                matching = true
                let found = await store.matches(for: draft)
                if !Task.isCancelled { matches = found }
                matching = false
            }
        }
    }

    @ViewBuilder private var matchSection: some View {
        if !matches.isEmpty {
            Section {
                ForEach(matches) { match in
                    HStack(spacing: Space.x3) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(match.festival.name)
                                .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            Text(matchLine(match.festival))
                                .font(.jakarta(size: 12, relativeTo: .caption))
                                .foregroundStyle(Color.textSecondary)
                        }
                        Spacer()
                        Button { Task { await join(match.festival) } } label: {
                            if joiningId == match.festival.id { ProgressView() } else { Text("Join") }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.brand)
                    }
                }
            } header: {
                Label(matches.count > 1 ? "\(matches.count) festivals look like this one"
                      : (matches[0].festival.isSeeded ? "This festival is already listed" : "Someone already added this festival"),
                      systemImage: "person.2")
            } footer: {
                Text("Joining adds it to your festivals with your own notes and shows. Not the same event? Create yours anyway.")
            }
            .brandRow()
        } else if matching {
            Section { HStack { Text("Checking for this festival"); Spacer(); ProgressView() }.foregroundStyle(Color.textSecondary) }
                .brandRow()
        }
    }

    private func matchLine(_ c: FestivalMatch.Candidate) -> String {
        let f = Festival(id: c.id, festivalId: c.id, name: c.name, startDate: c.startDate, endDate: c.endDate, year: c.year)
        return [festivalWhen(f), c.location ?? "", c.isSeeded ? "from the festival catalog" : "created by another user"]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func fill() {
        guard draft == FestivalDraft() else { return }
        if let f = editing {
            draft.name = f.name
            draft.location = f.location
            draft.yearOnly = FestivalDates.isYearOnly(f)
            draft.year = FestivalDates.year(f).map(String.init) ?? ""
            if let s = f.startDate, let d = ShowDateText.date(s) { start = d }
            if let e = f.endDate, let d = ShowDateText.date(e) { end = d }
        }
        draft.startDate = ManualShowForm.isoDay(start)
        draft.endDate = ManualShowForm.isoDay(end)
    }

    private func save() async {
        if let p = draft.problem { problem = p; return }
        problem = nil
        saving = true
        defer { saving = false }
        do {
            let festival = if let editing { try await store.updateDetails(editing, draft: draft) } else { try await store.create(draft) }
            dismiss()
            done(festival)
        } catch {
            problem = error.message ?? (isEdit ? "Couldn't save your changes. Try again." : "Couldn't create the festival. Try again.")
        }
    }

    private func join(_ candidate: FestivalMatch.Candidate) async {
        joiningId = candidate.id
        defer { joiningId = nil }
        do {
            let festival = try await store.join(candidate)
            dismiss()
            done(festival)
        } catch {
            problem = error.message ?? "Couldn't join that festival. Try again."
        }
    }
}

// MARK: - The lineup you type

struct LineupEditorSheet: View {
    @Environment(FestivalsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let festival: Festival
    let saved: () -> Void
    @State private var text = ""
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text)
                        .frame(minHeight: 260)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.words)
                        .accessibilityLabel("Lineup, one band per line")
                } footer: {
                    Text(problem ?? "One band per line. Only you can see this.")
                        .foregroundStyle(problem == nil ? Color.textSecondary : Color.amber)
                }
                .brandRow()
            }
            .brandScreen()
            .navigationTitle("Enter the lineup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            saving = true
                            defer { saving = false }
                            do {
                                try await store.saveMyLineup(text, festivalId: festival.id)
                                dismiss()
                                saved()
                            } catch {
                                problem = "Couldn't save the lineup. Try again."
                            }
                        }
                    } label: { if saving { ProgressView() } else { Text("Save") } }
                    .disabled(saving)
                }
            }
        }
        .onAppear { text = festival.myLineup.joined(separator: "\n") }
    }
}

// MARK: - Your picks

/// "Your picks": the lineup in three groups, ranked on the server
/// (`festival-lineup`). Until the answer comes (or offline), the lineup
/// as a plain list.
struct FestivalPicksSection: View {
    @Environment(AppRouter.self) private var router
    let festival: Festival
    let answer: FestivalLineupAnswer?
    let loading: Bool
    let enterLineup: () -> Void

    private var shared: [String] { festival.lineup }
    private var lineup: [String] { shared.isEmpty ? festival.myLineup : shared }

    var body: some View {
        let picks = answer?.picks
        if lineup.isEmpty {
            Section("Your picks") {
                if loading {
                    HStack { Text("Looking for the lineup"); Spacer(); ProgressView() }.foregroundStyle(Color.textSecondary)
                } else {
                    Text("We couldn't find this festival's lineup on Ticketmaster yet. Lineups usually appear there once tickets are on sale, so check back closer to the dates, or enter the lineup yourself.")
                        .font(.jakarta(size: 14, relativeTo: .subheadline))
                        .foregroundStyle(Color.textSecondary)
                    Button { enterLineup() } label: { Label("Enter the lineup", systemImage: "music.note.list") }
                }
            }
            .brandRow()
        } else if let picks, !picks.isEmpty {
            if !picks.recommended.isEmpty {
                Section {
                    ForEach(picks.recommended) { p in bandRow(p.name, detail: p.reason, badge: nil) }
                } header: {
                    groupHeader("Your picks", "Recommended for you", "sparkles")
                } footer: {
                    Text("Bands you haven't seen that fans of your bands see often.")
                }
                .brandRow()
            }
            if !picks.love.isEmpty {
                Section {
                    ForEach(picks.love) { p in bandRow(p.name, detail: p.detail, badge: nil) }
                } header: {
                    groupHeader(picks.recommended.isEmpty ? "Your picks" : nil, "Bands you love", "heart")
                }
                .brandRow()
            }
            if !picks.everyoneElse.isEmpty {
                Section {
                    ForEach(picks.everyoneElse) { p in bandRow(p.name, detail: nil, badge: p.seenOnce ? "Seen once" : nil) }
                } header: {
                    groupHeader(picks.recommended.isEmpty && picks.love.isEmpty ? "Your picks" : nil,
                                picks.recommended.isEmpty && picks.love.isEmpty ? "The lineup" : "Everyone else on the lineup", "music.note.list")
                } footer: {
                    credit
                }
                .brandRow()
            }
        } else {
            Section {
                ForEach(lineup, id: \.self) { name in bandRow(name, detail: nil, badge: nil) }
                if loading {
                    HStack { Text("Ranking it for you"); Spacer(); ProgressView() }.foregroundStyle(Color.textSecondary)
                }
            } header: {
                Text("Lineup")
            } footer: {
                credit
            }
            .brandRow()
        }
    }

    private func groupHeader(_ title: String?, _ group: String, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: Space.x1) {
            if let title {
                Text(title)
                    .font(.jakarta(size: 18, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(Color.textPrimary)
                    .textCase(nil)
                Text("The lineup, ranked by how likely you are to love each band.")
                    .font(.jakarta(size: 13, relativeTo: .footnote))
                    .foregroundStyle(Color.textSecondary)
                    .textCase(nil)
                    .padding(.bottom, Space.x2)
            }
            Label(group, systemImage: symbol)
        }
    }

    @ViewBuilder private var credit: some View {
        if shared.isEmpty {
            HStack {
                Text("The lineup you entered. Only you can see it.")
                Spacer()
                Button("Edit lineup") { enterLineup() }.font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
            }
        } else if let url = festival.lineupUrl.flatMap(URL.init(string:)) {
            Button(festival.lineupSource == "seed" ? "The announced lineup" : "Lineup from Ticketmaster") { router.show(url) }
                .font(.jakarta(size: 12, relativeTo: .caption))
        } else {
            Text(festival.lineupSource == "seed" ? "The announced lineup" : "Lineup from Ticketmaster")
        }
    }

    private func bandRow(_ name: String, detail: String?, badge: String?) -> some View {
        NavigationLink(value: AppRoute.band(slug: BandDirectory.slug(forArtist: name))) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                    if let detail, !detail.isEmpty {
                        Text(detail)
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textSecondary)
                    }
                }
                Spacer()
                if let badge {
                    Text(badge)
                        .font(.jakarta(size: 11, weight: .semibold, relativeTo: .caption2))
                        .foregroundStyle(Color.textMuted)
                        .padding(.horizontal, 6)
                        .overlay(Capsule().stroke(Color.borderSubtle))
                }
            }
        }
    }
}

// MARK: - The lineup search

/// "Search this festival's lineup" (`FestivalLineupModal`): everyone
/// setlist.fm logged in the festival's city on its days ("Find who
/// played"), or one band inside them ("By artist"); the picked sets are
/// added to your shows and to the festival.
struct LineupSearchSheet: View {
    @Environment(FestivalsStore.self) private var festivals
    @Environment(ShowsStore.self) private var showsStore
    @Environment(\.dismiss) private var dismiss
    let festival: Festival

    private enum Mode: String, CaseIterable, Identifiable {
        case lineup = "Whole lineup", artist = "By artist"
        var id: String { rawValue }
    }

    @State private var mode: Mode = .lineup
    @State private var artist = ""
    @State private var searching = false
    @State private var searched = false
    @State private var results: [LineupSet] = []
    @State private var selected: Set<String> = []
    @State private var problem: String?
    @State private var conflicts: [Show] = []
    @State private var confirmMove = false
    @State private var importing = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: Space.x1) {
                        Text(festival.name).font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                        let line = [festival.location, festivalWhen(festival)].filter { !$0.isEmpty }.joined(separator: " · ")
                        if !line.isEmpty {
                            Text(line).font(.jakarta(size: 13, relativeTo: .footnote)).foregroundStyle(Color.textSecondary)
                        }
                        if FestivalDates.isYearOnly(festival) {
                            Text("This festival has a year but no dates, so the search can't narrow it to the festival's days and may show other shows from that year. Add the dates (Edit festival) for a closer match.")
                                .font(.jakarta(size: 12, relativeTo: .caption)).foregroundStyle(Color.textMuted)
                        }
                        if festival.location.isEmpty {
                            Text("Add a location to this festival (its city) and the lineup search gets a lot more accurate: without one it has to guess the venue from the name.")
                                .font(.jakarta(size: 12, relativeTo: .caption)).foregroundStyle(Color.textMuted)
                        }
                    }
                    Picker("Search", selection: $mode) {
                        ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if mode == .lineup {
                        Button { Task { await search() } } label: {
                            HStack { Label("Find who played", systemImage: "magnifyingglass"); if searching { Spacer(); ProgressView() } }
                        }
                        .disabled(searching)
                    } else {
                        HStack {
                            TextField("Just the band you saw", text: $artist)
                                .textInputAutocapitalization(.words)
                                .onSubmit { Task { await search() } }
                            Button("Search") { Task { await search() } }
                                .disabled(searching || artist.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                } footer: {
                    if mode == .lineup { Text("Everyone logged on setlist.fm at this festival's city and dates.") }
                }
                .brandRow()

                if let problem {
                    Section { Text(problem).foregroundStyle(Color.amber) }.brandRow()
                }

                if searched, !searching, results.isEmpty, problem == nil {
                    Section {
                        VStack(alignment: .leading, spacing: Space.x2) {
                            Text(mode == .artist ? "No set found for that artist" : "No lineup found on setlist.fm")
                                .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            Text(mode == .artist
                                 ? "Check the spelling, or that they really played inside these dates. Nobody may have logged their set yet."
                                 : "Not every festival is well covered there. Try looking up the bands one at a time under “By artist”, or use “Pick from my shows” for the shows you've already logged.")
                                .font(.jakarta(size: 13, relativeTo: .footnote))
                                .foregroundStyle(Color.textSecondary)
                        }
                    }
                    .brandRow()
                }

                if !results.isEmpty {
                    Section {
                        ForEach(results) { set in resultRow(set) }
                    } header: {
                        HStack {
                            Text(results.count == 1 ? "1 set found" : "\(results.count) sets found")
                            Spacer()
                            Button(selected.count == results.count ? "Clear all" : "Select all") {
                                selected = selected.count == results.count ? [] : Set(results.map(\.id))
                            }
                            .textCase(nil)
                        }
                    } footer: {
                        Text("Lineup and setlist data from setlist.fm")
                    }
                    .brandRow()
                }
            }
            .brandScreen()
            .navigationTitle("Search the lineup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await add(move: false) } } label: {
                        if importing { ProgressView() } else { Text(selected.count == 1 ? "Add 1 show" : "Add \(selected.count) shows") }
                    }
                    .disabled(selected.isEmpty || importing)
                }
            }
            .onChange(of: mode) { _, _ in results = []; selected = []; problem = nil; searched = false }
            .alert(conflicts.count == 1 ? "1 of these is already in another festival" : "\(conflicts.count) of these are already in another festival",
                   isPresented: $confirmMove) {
                Button(conflicts.count == 1 ? "Move it here" : "Move them here", role: .destructive) { Task { await add(move: true) } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(conflicts.map { "\($0.artist), \(ShowDateText.display($0.date)) (in \(festivals.name(forAttendanceId: $0.festivalId) ?? "another festival"))" }
                    .joined(separator: "\n"))
            }
        }
    }

    private func resultRow(_ set: LineupSet) -> some View {
        Button {
            if selected.contains(set.id) { selected.remove(set.id) } else { selected.insert(set.id) }
        } label: {
            HStack(spacing: Space.x3) {
                Image(systemName: selected.contains(set.id) ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(selected.contains(set.id) ? Color.brand : Color.textMuted)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(set.artist).font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                    Text([ShowDateText.display(set.date), set.venue, set.songCount > 0 ? "\(set.songCount) song\(set.songCount == 1 ? "" : "s")" : "no setlist"]
                        .filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.jakarta(size: 12, relativeTo: .caption))
                        .foregroundStyle(Color.textSecondary)
                }
                Spacer()
                if set.isLogged(in: showsStore.shows) {
                    Text("Already logged")
                        .font(.jakarta(size: 11, weight: .semibold, relativeTo: .caption2))
                        .foregroundStyle(Color.brandLight)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected.contains(set.id) ? .isSelected : [])
    }

    private func search() async {
        if mode == .artist, artist.trimmingCharacters(in: .whitespaces).isEmpty { return }
        searching = true
        problem = nil
        results = []
        selected = []
        defer { searching = false; searched = true }
        do {
            results = try await festivals.searchLineup(festival, artist: mode == .artist ? artist : nil)
        } catch {
            problem = error.message ?? "Search failed. Please try again."
        }
    }

    private func add(move: Bool) async {
        let picked = results.filter { selected.contains($0.id) }
        guard !picked.isEmpty else { return }
        importing = true
        defer { importing = false }
        do {
            switch try await showsStore.importLineup(picked, into: festival.id, moveConflicts: move) {
            case .conflicts(let found):
                conflicts = found
                confirmMove = true
            case .done:
                dismiss()
            }
        } catch {
            problem = error == .offline
                ? "You're offline. Import the lineup again when you're connected."
                : (error.message ?? "Couldn't add those shows. Try again.")
        }
    }
}
