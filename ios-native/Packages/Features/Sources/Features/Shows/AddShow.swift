import Core
import DesignSystem
import SwiftUI

/// The + on the Shows tab (Stage 1, Part 4): search setlist.fm, add a show
/// by hand, add an upcoming show, or import from a spreadsheet or a
/// screenshot (accounts only; Stage 6, 6-7).
/// Every past show is an input sent to `normalize-show`
/// (`ShowsStore.addShow`); what happens next is `AddFlow`'s.
struct AddShowSheet: View {
    @Environment(ShowsStore.self) private var store
    @Environment(SessionStore.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var flow = AddFlow()
    @State private var upgrading = false

    private var isGuest: Bool { session.user?.isAnonymous == true }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink { SetlistfmSearchView() } label: {
                        row("Search setlist.fm", "Find the night and its setlist.", "magnifyingglass")
                    }
                    NavigationLink { ManualShowForm() } label: {
                        row("Add by hand", "Band, venue and date. The setlist comes from the band's archive when it has one.", "square.and.pencil")
                    }
                    if isGuest {
                        Button { upgrading = true } label: {
                            row("Scan a ticket", "Create an account to scan tickets.", "ticket")
                        }
                    } else {
                        NavigationLink {
                            ScanTicketView { route in
                                dismiss()
                                if let route { router.tab = .shows; router.paths[.shows, default: []].append(route) }
                            }
                        } label: {
                            row("Scan a ticket", "A photo of a ticket stub, wristband or mobile ticket.", "ticket")
                        }
                    }
                } header: { Text("A show you went to") }
                .brandRow()

                Section {
                    NavigationLink {
                        UpcomingForm(editing: nil) { id in
                            dismiss()
                            router.tab = .shows
                            router.paths[.shows, default: []].append(.upcomingShow(id: id))
                        }
                    } label: {
                        row("Add an upcoming show", "A show you have tickets for.", "calendar.badge.plus")
                    }
                }
                .brandRow()

                Section {
                    if isGuest {
                        Button { upgrading = true } label: {
                            row("Import shows", "Create an account to import from a screenshot or a spreadsheet.", "square.and.arrow.down")
                        }
                    } else {
                        NavigationLink {
                            ImportShowsView { dismiss() }
                        } label: {
                            row("Import shows", "From a spreadsheet (.csv or .xlsx), or a screenshot of your past events.", "square.and.arrow.down")
                        }
                    }
                }
                .brandRow()
            }
            .brandScreen()
            .navigationTitle("Add a show")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .environment(flow)
        .addOutcomeHandling(flow) { route in
            dismiss()
            if let route { router.tab = .shows; router.paths[.shows, default: []].append(route) }
        }
        .sheet(isPresented: $upgrading) { GuestUpgradeView() }
    }

    private func row(_ title: String, _ detail: String, _ symbol: String) -> some View {
        HStack(alignment: .top, spacing: Space.x3) {
            Image(systemName: symbol).foregroundStyle(Color.brand).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.jakarta(size: 16, weight: .semibold, relativeTo: .body)).foregroundStyle(Color.textPrimary)
                Text(detail).font(.jakarta(size: 13, relativeTo: .footnote)).foregroundStyle(Color.textSecondary)
            }
        }
        .padding(.vertical, Space.x1)
    }
}

/// What an add came to, and what to say: open the new show, say it's
/// already there, ask about a possible duplicate, say it's saved on the
/// phone, or say why the server refused it.
@MainActor
@Observable
final class AddFlow {
    var busy = false
    var outcome: AddOutcome?

    func run(_ add: @escaping @MainActor () async -> AddOutcome) {
        guard !busy else { return }
        busy = true
        Task {
            let result = await add()
            busy = false
            outcome = result
        }
    }
}

extension View {
    /// The alerts and question for an `AddFlow`. `finish` closes the add
    /// sheet and opens the route (the new show), or just closes it.
    func addOutcomeHandling(_ flow: AddFlow, finish: @escaping (AppRoute?) -> Void) -> some View {
        modifier(AddOutcomeHandling(flow: flow, finish: finish))
    }
}

struct AddOutcomeHandling: ViewModifier {
    @Environment(ShowsStore.self) private var store
    @Environment(SessionStore.self) private var session
    @Bindable var flow: AddFlow
    let finish: (AppRoute?) -> Void
    /// A guest's first show: the account prompt first, then the show
    /// (Stage 4; the web shows it in place of the "added" toast).
    @State private var firstShow: FirstShow?
    /// The show to open once the prompt closes (kept apart from `firstShow`,
    /// which the sheet clears before `onDismiss` runs).
    @State private var openAfterPrompt: String?

    struct FirstShow: Identifiable { let id: String }

    func body(content: Content) -> some View {
        content
            .onChange(of: flow.outcome) { _, outcome in
                guard case .added(let id)? = outcome else { return }
                flow.outcome = nil
                // Taken for accounts too, so it never lingers.
                if store.takeFirstShow(id), session.user?.isAnonymous == true {
                    openAfterPrompt = id
                    firstShow = FirstShow(id: id)
                } else {
                    finish(.show(id: id))
                }
            }
            .sheet(item: $firstShow, onDismiss: {
                if let id = openAfterPrompt { openAfterPrompt = nil; finish(.show(id: id)) }
            }) { _ in
                FirstShowPrompt()
            }
            .alert(title, isPresented: Binding(get: { showsAlert }, set: { if !$0 { flow.outcome = nil } })) {
                switch flow.outcome {
                case .alreadyThere(let id)?:
                    Button("Open it") { flow.outcome = nil; finish(.show(id: id)) }
                    Button("OK", role: .cancel) { flow.outcome = nil }
                case .queued(let id)?:
                    Button("OK") { flow.outcome = nil; finish(.show(id: id)) }
                default:
                    Button("OK", role: .cancel) { flow.outcome = nil }
                }
            } message: {
                Text(message)
            }
            .confirmationDialog("Already logged?", isPresented: Binding(get: { question != nil }, set: { if !$0 { cancelQuestion() } }), titleVisibility: .visible) {
                if case .possibleDuplicate(let id, _)? = flow.outcome {
                    Button("Add as a separate show") {
                        flow.outcome = nil
                        flow.run { await store.answerPossibleDuplicate(showId: id, addAnyway: true) ?? .refused("That show isn't waiting any more.") }
                    }
                    Button("Don't add", role: .cancel) { cancelQuestion() }
                }
            } message: {
                Text(question ?? "")
            }
    }

    private var showsAlert: Bool {
        switch flow.outcome {
        case .alreadyThere?, .queued?, .refused?: true
        default: false
        }
    }

    private var question: String? {
        if case .possibleDuplicate(_, let q)? = flow.outcome { return q }
        return nil
    }

    private func cancelQuestion() {
        if case .possibleDuplicate(let id, _)? = flow.outcome {
            Task { _ = await store.answerPossibleDuplicate(showId: id, addAnyway: false) }
        }
        flow.outcome = nil
    }

    private var title: String {
        switch flow.outcome {
        case .alreadyThere?: "Already in your shows"
        case .queued?: "Saved on this iPhone"
        case .refused?: "Not added"
        default: ""
        }
    }

    private var message: String {
        switch flow.outcome {
        case .alreadyThere?: "This show is already in your shows, so nothing new was added."
        case .queued?: "It finishes saving when you're back online. Until then it's marked \u{201C}Waiting to sync\u{201D}."
        case .refused(let text)?: text
        default: ""
        }
    }
}

// MARK: - Search setlist.fm

/// Band (picked among same-named artists), and optionally a year, venue or
/// city; then setlist.fm's setlists, 20 a page. Tapping one adds it.
struct SetlistfmSearchView: View {
    @Environment(ShowsStore.self) private var store
    @Environment(AddFlow.self) private var flow
    @State private var band = ""
    @State private var year = ""
    @State private var venue = ""
    @State private var city = ""
    @State private var artist: SetlistfmSearch.Artist?
    @State private var choices: [SetlistfmSearch.Artist] = []
    @State private var results: [SetlistfmSearch.Setlist] = []
    @State private var page = SetlistfmSearch.Page.empty
    @State private var searching = false
    @State private var searched = false
    @State private var problem: String?
    @State private var confirming: SetlistfmSearch.Setlist?

    private var query: SetlistfmSearch.Query {
        .init(artistMbid: artist?.mbid, artistName: artist == nil ? band : nil, year: year, venueName: venue, cityName: city)
    }

    var body: some View {
        List {
            Section {
                TextField("Band", text: $band)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.search)
                    .onSubmit { Task { await search() } }
                    .onChange(of: band) { _, _ in artist = nil; choices = [] }
                if let artist {
                    Label(artist.disambiguation.map { "\(artist.name) (\($0))" } ?? artist.name, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Color.brand)
                }
                TextField("Year (optional)", text: $year).keyboardType(.numberPad)
                TextField("Venue (optional)", text: $venue).textInputAutocapitalization(.words)
                    .submitLabel(.search).onSubmit { Task { await search() } }
                TextField("City (optional)", text: $city).textInputAutocapitalization(.words)
                    .submitLabel(.search).onSubmit { Task { await search() } }
                Button {
                    Task { await search() }
                } label: {
                    if searching { ProgressView() } else { Text("Search") }
                }
                .disabled(searching || query.isEmpty)
            } footer: {
                Text("A band, a venue or a city. Setlists from setlist.fm.")
            }
            .brandRow()

            if !choices.isEmpty {
                Section {
                    ForEach(choices) { choice in
                        Button {
                            artist = choice
                            choices = []
                            Task { await loadSetlists(reset: true) }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(choice.name).foregroundStyle(Color.textPrimary)
                                if let d = choice.disambiguation { Text(d).font(.footnote).foregroundStyle(Color.textSecondary) }
                            }
                        }
                    }
                } header: { Text("Which \(band.trimmingCharacters(in: .whitespaces))?") }
                .brandRow()
            }

            if !results.isEmpty {
                Section {
                    ForEach(results) { setlist in
                        Button { confirming = setlist } label: { SetlistResultRow(setlist: setlist) }
                    }
                    if page.hasMore {
                        Button { Task { await loadSetlists(reset: false) } } label: {
                            if searching { ProgressView() } else { Text("More") }
                        }
                    }
                } header: { Text(page.total == 1 ? "1 setlist" : "\(page.total) setlists") }
                .brandRow()
            } else if searched, choices.isEmpty, !searching {
                Section {
                    Text("No setlists found. Try another year or spelling, or add the show by hand.")
                        .foregroundStyle(Color.textSecondary)
                }
                .brandRow()
            }

            Section {
                Text("Setlist data from setlist.fm").font(.caption).foregroundStyle(Color.textMuted)
            }
            .listRowBackground(Color.clear)
        }
        .brandScreen()
        .navigationTitle("Search setlist.fm")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Search didn't work", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
        .confirmationDialog("Add this show?", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), titleVisibility: .visible) {
            if let setlist = confirming {
                Button("Add \(setlist.artist)") { add(setlist) }
                Button("Cancel", role: .cancel) {}
            }
        } message: {
            if let s = confirming { Text("\(s.artist), \(ShowDateText.display(s.date)), \(venueLine(s.venue, s.city))") }
        }
        .overlay { if flow.busy { ProgressView("Adding").padding().background(.regularMaterial, in: RoundedRectangle.brand()) } }
    }

    /// With a band typed and none picked yet: its artists first; one match
    /// (or an exact name) goes straight to its setlists.
    private func search() async {
        guard !searching, !query.isEmpty, let search = store.setlistfmSearch else { return }
        let name = band.trimmingCharacters(in: .whitespaces)
        if artist == nil, !name.isEmpty {
            searching = true
            defer { searching = false }
            do {
                let found = try await search.artists(named: name)
                let exact = found.filter { $0.name.compare(name, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
                if found.count == 1 || exact.count == 1 {
                    artist = exact.first ?? found.first
                } else if found.count > 1 {
                    choices = Array(found.prefix(10))
                    results = []
                    searched = true
                    return
                }
            } catch {
                problem = error.message ?? "Couldn't reach setlist.fm. Try again in a moment."
                return
            }
        }
        await loadSetlists(reset: true)
    }

    private func loadSetlists(reset: Bool) async {
        guard let search = store.setlistfmSearch else { return }
        searching = true
        defer { searching = false; searched = true }
        do {
            let next = try await search.setlists(query, page: reset ? 1 : page.page + 1)
            page = next
            results = reset ? next.setlists : results + next.setlists
        } catch {
            problem = error.message ?? "Couldn't reach setlist.fm. Try again in a moment."
        }
    }

    private func add(_ setlist: SetlistfmSearch.Setlist) {
        guard !flow.busy else { return }
        let input = ShowInput(.setlistfm(.setlist(setlist.raw), .none))
        let display = QueuedShow.Display(artist: setlist.artist, venue: setlist.venue, city: setlist.city, date: setlist.date)
        flow.run { await store.addShow(input, display: display) }
    }
}

struct SetlistResultRow: View {
    let setlist: SetlistfmSearch.Setlist

    var body: some View {
        HStack(spacing: Space.x3) {
            DateBlock(date: setlist.date)
            VStack(alignment: .leading, spacing: 2) {
                Text(setlist.artist).font(.jakarta(size: 16, weight: .bold, relativeTo: .headline)).foregroundStyle(Color.textPrimary)
                Text(venueLine(setlist.venue, setlist.city)).font(.jakarta(size: 13, relativeTo: .subheadline)).foregroundStyle(Color.textSecondary).lineLimit(1)
                Text([ShowDateText.display(setlist.date), setlist.songCount > 0 ? "\(setlist.songCount) songs" : "No setlist yet"].joined(separator: " · "))
                    .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                    .foregroundStyle(setlist.songCount > 0 ? Color.brandLight : Color.textMuted)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Add by hand

/// Band, venue, city and date (today or earlier), and your rating. The
/// server builds the show and asks the band's archive for its setlist.
struct ManualShowForm: View {
    @Environment(ShowsStore.self) private var store
    @Environment(AddFlow.self) private var flow
    @State private var band = ""
    @State private var venue = ""
    @State private var city = ""
    @State private var date = Date()
    @State private var rating: Int?
    @FocusState private var focus: Field?

    enum Field { case band, venue, city }

    private var trimmed: (band: String, venue: String) {
        (band.trimmingCharacters(in: .whitespaces), venue.trimmingCharacters(in: .whitespaces))
    }

    var body: some View {
        Form {
            Section {
                TextField("Band", text: $band).textInputAutocapitalization(.words)
                    .focused($focus, equals: .band).submitLabel(.next).onSubmit { focus = .venue }
                TextField("Venue", text: $venue).textInputAutocapitalization(.words)
                    .focused($focus, equals: .venue).submitLabel(.next).onSubmit { focus = .city }
                TextField("City (optional)", text: $city).textInputAutocapitalization(.words)
                    .focused($focus, equals: .city).submitLabel(.done).onSubmit(add)
                DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
            } footer: {
                Text("For a show coming up, add an upcoming show instead.")
            }
            .brandRow()
            Section {
                Picker("Your rating", selection: $rating) {
                    Text("Not now").tag(Int?.none)
                    ForEach((1...10).reversed(), id: \.self) { Text("\($0)").tag(Int?.some($0)) }
                }
            }
            .brandRow()
        }
        .brandScreen()
        .navigationTitle("Add by hand")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                // One button throughout (no swap to a spinner view), so a tap
                // while the keyboard is up lands on it; disabled while sending.
                Button(action: add) {
                    if flow.busy { ProgressView() } else { Text("Add") }
                }
                .disabled(flow.busy || trimmed.band.isEmpty || trimmed.venue.isEmpty)
            }
        }
    }

    private func add() {
        guard !flow.busy, !trimmed.band.isEmpty, !trimmed.venue.isEmpty else { return }
        focus = nil
        let day = Self.isoDay(date)
        let cityText = city.trimmingCharacters(in: .whitespaces)
        let input = ShowInput(.manual(.init(artist: trimmed.band, venue: trimmed.venue, city: cityText.isEmpty ? nil : cityText, date: day),
                                      .init(rating: rating)))
        let display = QueuedShow.Display(artist: trimmed.band, venue: trimmed.venue, city: cityText, date: day)
        flow.run { await store.addShow(input, display: display) }
    }

    /// The picked day on this phone's calendar, as `YYYY-MM-DD`.
    static func isoDay(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
