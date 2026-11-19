import Core
import DesignSystem
import SwiftUI

// "Add shows from a tour" (the web's TourBrowseModal; Stage 4, 4-6, and its
// full flow in 4-12): a band, its tours, then the nights you were at, added
// in one go. Typing "Goose Summer Tour 2025" goes straight to that tour when
// it can tell where the band name ends (`TourBrowse`), and to the pickers
// with the text filled in when it can't. Nights already yours are marked
// and can't be picked; a night that may be yours (same band and day, venue
// spelled differently) says so and can still be picked.

struct TourBrowseSheet: View {
    enum Start {
        case search
        case tour(artist: String, tourName: String, mbid: String?)
    }

    private enum Step { case artist, tour, nights }

    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    let start: Start

    @State private var step = Step.artist
    @State private var query = ""
    @State private var artists: [SetlistfmSearch.Artist] = []
    @State private var artist: SetlistfmSearch.Artist?
    @State private var tours: ArtistTours?
    @State private var tourFilter = ""
    @State private var tourName: String?
    @State private var nights: TourShows?
    @State private var nightFilter = ""
    @State private var selected: Set<String> = []
    @State private var failed: Set<String> = []
    @State private var problem: String?
    @State private var notice: String?
    @State private var busy = false
    @State private var saving = false
    @State private var result: String?
    @State private var confirmBulk = false
    /// Stamped on every lookup, so a slow answer to an older one is dropped.
    @State private var seq = 0
    @State private var began = false

    var body: some View {
        NavigationStack {
            List {
                if let notice {
                    Section { Text(notice).foregroundStyle(Color.textSecondary) }.brandRow()
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.circle").foregroundStyle(Color.danger) }.brandRow()
                }
                if let result {
                    Section {
                        Label(result, systemImage: failed.isEmpty ? "checkmark.circle" : "exclamationmark.triangle")
                            .foregroundStyle(failed.isEmpty ? Color.brand : Color.amber)
                        if !failed.isEmpty {
                            Button("Try the \(failed.count) again") { Task { await add(ids: failed) } }
                                .disabled(saving)
                        }
                    }
                    .brandRow()
                }
                switch step {
                case .artist: artistSection
                case .tour: toursSection
                case .nights: nightsSection
                }
            }
            .brandScreen()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                if step == .nights, nights != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(selected.isEmpty ? "Add" : "Add \(selected.count)") {
                            if selected.count > TourBrowse.bulkWarnThreshold { confirmBulk = true } else { Task { await add(ids: selected) } }
                        }
                        .disabled(selected.isEmpty || saving)
                    }
                }
                if busy || saving { ToolbarItem(placement: .principal) { ProgressView() } }
            }
            .confirmationDialog("Add \(selected.count) shows?", isPresented: $confirmBulk, titleVisibility: .visible) {
                Button("Add \(selected.count) shows") { Task { await add(ids: selected) } }
            } message: {
                Text("Each night is added with its setlist, one after another. It can take a minute.")
            }
        }
        .task {
            guard !began else { return }
            began = true
            await begin()
        }
    }

    private var title: String {
        switch step {
        case .artist: "Add shows from a tour"
        case .tour: artist.map { "\($0.name): pick a tour" } ?? "Pick a tour"
        case .nights: tourName ?? "Pick the nights"
        }
    }

    // MARK: Step 1: the band

    @ViewBuilder private var artistSection: some View {
        Section {
            TextField("Goose, or Goose Summer Tour 2025", text: $query)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { Task { await runArtistSearch() } }
            Button("Search") { Task { await runArtistSearch() } }
                .disabled(query.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        } header: {
            Text("Band, or band and tour")
        } footer: {
            Text("Pick a band, then one of its tours, then the nights you were there.")
        }
        .brandRow()
        if !artists.isEmpty {
            Section("Bands") {
                ForEach(artists) { a in
                    Button { Task { await choose(a) } } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a.name).foregroundStyle(Color.textPrimary)
                            if let d = a.disambiguation, !d.isEmpty {
                                Text(d).font(.footnote).foregroundStyle(Color.textSecondary)
                            }
                        }
                    }
                }
            }
            .brandRow()
        }
    }

    // MARK: Step 2: the tour

    @ViewBuilder private var toursSection: some View {
        Section {
            Button { back() } label: { Label("Change band", systemImage: "chevron.left") }
        }
        .brandRow()
        if let tours {
            let browsable = tours.tours.filter(\.isBrowsable)
            let shown = tourFilter.isEmpty ? browsable
                : browsable.filter { $0.name.localizedCaseInsensitiveContains(tourFilter.trimmingCharacters(in: .whitespaces)) }
            Section {
                if browsable.count > 6 {
                    TextField("Filter tours", text: $tourFilter)
                        .autocorrectionDisabled()
                }
                if browsable.isEmpty {
                    Text("setlist.fm has no tours for \(artist?.name ?? "this band").").foregroundStyle(Color.textSecondary)
                } else if shown.isEmpty {
                    Text("No tour matches “\(tourFilter)”.").foregroundStyle(Color.textSecondary)
                }
                ForEach(shown) { tour in
                    Button { Task { await pickTour(tour.name) } } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(TourBrowse.optionLabel(tour, in: browsable)).foregroundStyle(Color.textPrimary)
                            Text(tourLine(tour)).font(.footnote).foregroundStyle(Color.textSecondary)
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

    private func tourLine(_ tour: ArtistTours.Tour) -> String {
        var range = tour.startDate.map(ShowDateText.display) ?? ""
        if let end = tour.endDate, end != tour.startDate { range += " – " + ShowDateText.display(end) }
        let count = "\(tour.showCount) show\(tour.showCount == 1 ? "" : "s")"
        return range.isEmpty ? count : "\(range) · \(count)"
    }

    // MARK: Step 3: the nights

    @ViewBuilder private var nightsSection: some View {
        Section {
            Button { back() } label: { Label("All tours", systemImage: "chevron.left") }
        }
        .brandRow()
        if let nights {
            let visible = TourBrowse.filter(nights.shows, nightFilter)
            let statuses = Dictionary(nights.shows.map { ($0.id, TourBrowse.status($0, in: store.shows)) }) { a, _ in a }
            let selectable = visible.filter { statuses[$0.id] != .added }
            let alreadyYours = nights.shows.filter { statuses[$0.id] == .added }.count
            Section {
                if nights.shows.count > 6 {
                    TextField("Filter by venue or city", text: $nightFilter)
                        .autocorrectionDisabled()
                }
                if nights.shows.isEmpty {
                    Text("setlist.fm has no nights for this tour yet.").foregroundStyle(Color.textSecondary)
                } else if !selectable.isEmpty {
                    let all = selectable.allSatisfy { selected.contains($0.id) }
                    Button(all ? "Deselect all" : "Select all \(selectable.count)") {
                        if all { selected.subtract(selectable.map(\.id)) } else { selected.formUnion(selectable.map(\.id)) }
                    }
                    .disabled(saving)
                }
            } footer: {
                if alreadyYours > 0 {
                    Text("\(alreadyYours) of these \(alreadyYours == 1 ? "is" : "are") already in your shows.")
                }
            }
            .brandRow()
            ForEach(TourBrowse.grouped(visible)) { group in
                Section {
                    ForEach(group.nights) { night in
                        nightRow(night, status: statuses[night.id] ?? .new)
                    }
                } header: {
                    if let label = group.label { Text(label) } else { Text("Tap the nights you were at") }
                } footer: {
                    if group.id == TourBrowse.grouped(visible).last?.id, nights.truncated {
                        Text("The first 200 nights of the tour.")
                    }
                }
                .brandRow()
            }
            Section {
                SetlistfmCreditLine()
            }
            .listRowBackground(Color.clear)
        } else if problem == nil {
            Section { ProgressView("Loading the tour's nights").frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
        }
    }

    private func nightRow(_ night: TourShows.Night, status: TourBrowse.Status) -> some View {
        let on = selected.contains(night.id)
        return Button {
            if on { selected.remove(night.id) } else { selected.insert(night.id) }
        } label: {
            HStack(spacing: Space.x3) {
                Image(systemName: status == .added ? "checkmark.seal.fill" : (on ? "checkmark.circle.fill" : "circle"))
                    .foregroundStyle(status == .added ? Color.textMuted : Color.brand)
                    .font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(ShowDateText.display(night.date)).foregroundStyle(Color.textPrimary)
                    Text(venueLine(night.venue, night.city)).font(.footnote).foregroundStyle(Color.textSecondary).lineLimit(1)
                    if status == .possible {
                        Text("You may already have this night")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(Color.amber)
                    }
                }
                Spacer(minLength: Space.x2)
                Text(status == .added ? "Yours" : (night.songCount > 0 ? "\(night.songCount) songs" : "No setlist yet"))
                    .font(.caption).foregroundStyle(Color.textMuted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(status == .added || saving)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityHint(status == .added ? "Already in your shows" : "")
    }

    // MARK: Lookups

    private func begin() async {
        guard case .tour(let name, let tour, let mbid) = start else { return }
        query = name
        if let mbid {
            artist = SetlistfmSearch.Artist(mbid: mbid, name: name)
            if let resolved = await loadTours(autoTourQuery: tour) { await pickTour(resolved.name) }
            return
        }
        // A show stores the band's name, not its id: find which band is
        // meant, and go as far as that allows.
        let mine = beginLookup()
        busy = true
        do {
            let found = try await search(name)
            guard mine == seq else { return }
            busy = false
            let exact = TourBrowse.exactMatches(found, name)
            guard exact.count == 1 else {
                artists = Array(found.prefix(10))
                notice = "Pick which \(name) you mean."
                return
            }
            artist = exact[0]
            if let resolved = await loadTours(autoTourQuery: tour) { await pickTour(resolved.name) }
        } catch {
            guard mine == seq else { return }
            busy = false
            problem = TourLookups.message(error)
        }
    }

    private func beginLookup() -> Int {
        seq += 1
        problem = nil
        return seq
    }

    private func search(_ name: String) async throws(APIError) -> [SetlistfmSearch.Artist] {
        try await SetlistfmSearch(api: session.api).artists(named: name)
    }

    /// The whole text as a band first; then "band + tour" splits, longest
    /// band first, each needing exactly one band of exactly that name. Any
    /// doubt lists the bands instead of guessing.
    private func runArtistSearch() async {
        let raw = query.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return }
        let mine = beginLookup()
        busy = true
        notice = nil
        artists = []
        defer { if mine == seq { busy = false } }
        do {
            let whole = try await search(raw)
            guard mine == seq else { return }
            let wholeExact = TourBrowse.exactMatches(whole, raw)
            if wholeExact.count == 1 {
                artist = wholeExact[0]
                _ = await loadTours(autoTourQuery: nil)
                return
            }
            for split in TourBrowse.splitCandidates(raw) {
                let found = try await search(split.artistQuery)
                guard mine == seq else { return }
                let exact = TourBrowse.exactMatches(found, split.artistQuery)
                guard exact.count == 1 else { continue }
                artist = exact[0]
                if let resolved = await loadTours(autoTourQuery: split.tourQuery) { await pickTour(resolved.name) }
                return
            }
            if whole.isEmpty {
                problem = "No bands found. Try just the band name."
            } else {
                artists = Array(whole.prefix(10))
                if !TourBrowse.splitCandidates(raw).isEmpty {
                    notice = "Couldn't tell where the band name ends. Pick the band, then the tour."
                }
            }
        } catch {
            guard mine == seq else { return }
            problem = TourLookups.message(error)
        }
    }

    private func choose(_ a: SetlistfmSearch.Artist) async {
        artist = a
        artists = []
        notice = nil
        if case .tour(_, let tour, _) = start {
            if let resolved = await loadTours(autoTourQuery: tour) { await pickTour(resolved.name) }
        } else {
            _ = await loadTours(autoTourQuery: nil)
        }
    }

    /// The band's tours; with a tour name from the text, the one tour it
    /// names, if it names exactly one (else the picker, filtered by it).
    private func loadTours(autoTourQuery: String?) async -> ArtistTours.Tour? {
        guard let artist else { return nil }
        let mine = beginLookup()
        busy = true
        tours = nil
        tourFilter = ""
        step = .tour
        defer { if mine == seq { busy = false } }
        do {
            let found = try await TourLookups.tours(mbid: artist.mbid, api: session.api)
            guard mine == seq else { return nil }
            tours = found
            if let q = autoTourQuery?.trimmingCharacters(in: .whitespaces), !q.isEmpty {
                if let resolved = TourBrowse.resolveTourQuery(q, in: found.tours) { return resolved }
                tourFilter = q
                notice = "Couldn't pin “\(q)” to a single tour. Pick the one you meant."
            }
        } catch {
            guard mine == seq else { return nil }
            problem = TourLookups.message(error)
        }
        return nil
    }

    private func pickTour(_ name: String) async {
        guard let artist else { return }
        let mine = beginLookup()
        tourName = name
        nights = nil
        nightFilter = ""
        selected = []
        failed = []
        result = nil
        step = .nights
        busy = true
        defer { if mine == seq { busy = false } }
        do {
            let found = try await TourLookups.tourShows(mbid: artist.mbid, tourName: name, api: session.api)
            guard mine == seq else { return }
            nights = found
        } catch {
            guard mine == seq else { return }
            problem = TourLookups.message(error)
        }
    }

    private func back() {
        seq += 1
        busy = false
        problem = nil
        notice = nil
        result = nil
        switch step {
        case .nights:
            step = .tour
            tourName = nil
            nights = nil
            selected = []
            failed = []
            if tours == nil { Task { _ = await loadTours(autoTourQuery: nil) } }
        case .tour:
            step = .artist
            artist = nil
            tours = nil
        case .artist:
            break
        }
    }

    // MARK: Adding

    /// Adds the picked nights one at a time through the add flow
    /// (`normalize-show`, kind `setlistfm`, as the web's `addShowsFromTour`).
    /// A "maybe yours" night was picked knowing that, so it's sent with
    /// `confirmPossible`, as the web sends every tour night.
    private func add(ids: Set<String>) async {
        guard let nights, !ids.isEmpty else { return }
        saving = true
        defer { saving = false }
        var added = 0, waiting = 0, skipped = 0
        var nowFailed: Set<String> = []
        var landedTour: String?
        for night in nights.shows where ids.contains(night.id) {
            var input = ShowInput(.setlistfm(.row(night.raw), .none))
            input.confirmPossible = true
            let display = QueuedShow.Display(artist: night.artist, venue: night.venue, city: night.city, date: night.date)
            switch await store.addShow(input, display: display) {
            case .added:
                added += 1
                if landedTour == nil { landedTour = TourIndex.key(artist: night.artist, tour: night.raw["tour"]?.stringValue ?? tourName ?? "") }
            case .queued: waiting += 1
            case .alreadyThere: skipped += 1
            case .possibleDuplicate(let showId, _):
                // Not expected with confirmPossible; never leave it waiting for an answer.
                store.discardQueuedShow(showId: showId)
                nowFailed.insert(night.id)
            case .refused: nowFailed.insert(night.id)
            }
        }
        selected.subtract(ids)
        failed = nowFailed
        result = TourBrowse.resultLine(added: added, waiting: waiting, skipped: skipped, failed: nowFailed.count)
        // Everything in: land on the tour so the new shows are right there
        // (from a tour's own page, that page is already under the sheet).
        if nowFailed.isEmpty, added > 0, let key = landedTour {
            dismiss()
            if case .search = start { router.push(.tour(key: key)) }
        }
    }
}

/// "Data from setlist.fm", where setlist.fm's data is listed.
private struct SetlistfmCreditLine: View {
    var body: some View {
        Link(destination: URL(string: "https://www.setlist.fm")!) {
            Text("Setlist data from setlist.fm")
                .font(.footnote)
                .foregroundStyle(Color.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }
}
