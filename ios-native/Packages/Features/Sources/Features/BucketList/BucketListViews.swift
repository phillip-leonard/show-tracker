import Core
import CoreLocation
import DesignSystem
import EventKit
import EventKitUI
@preconcurrency import MapKit
import SwiftUI

// The bucket list (Stage 4, 4-10), as the web's BucketListView: shows you
// want to catch and venues you'd see anything at, written to the web's
// `bucketList` and `bucketListVenues` documents. Guests too (their own
// data). "Share with friends" sends the list as text, as the web does (no
// public page), so guests can share too.

/// `/bucket-list`: Shows | Venues.
struct BucketListScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router

    private enum Part: String, CaseIterable, Identifiable {
        case shows = "Shows", venues = "Venues"
        var id: String { rawValue }
    }

    @State private var part: Part = .shows
    @State private var items: [BucketListItem]?
    @State private var venues: [BucketListVenue]?
    @State private var loadProblem: String?
    @State private var query = ""
    @State private var sort: BucketList.Sort = .soonest
    @State private var addingShow = false
    @State private var addingVenue = false
    @State private var busyKeys: Set<String> = []
    @State private var calendar: CalendarRequest?
    /// The show whose calendar event is being prepared (its place looked up).
    @State private var preparingCalendar: String?
    @State private var flow = AddFlow()
    @State private var notice: String?
    @State private var attempt = 0

    private var uid: String? { session.user?.uid }

    var body: some View {
        let today = ShowDate.today()
        let all = items ?? []
        let upcoming = BucketList.upcoming(all, today: today, query: query, sort: sort)
        let past = BucketList.past(all, today: today, query: query)
        List {
            Section {
                Picker("Show", selection: $part) {
                    ForEach(Part.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
            }
            .listRowInsets(EdgeInsets(top: Space.x2, leading: Space.x4, bottom: Space.x2, trailing: Space.x4))
            .listRowBackground(Color.clear)

            if let loadProblem {
                Section {
                    HStack {
                        Text(loadProblem).foregroundStyle(Color.amber)
                        Spacer()
                        Button("Try again") { attempt += 1 }.buttonStyle(.borderless)
                    }
                }
                .brandRow()
            }

            switch part {
            case .shows: showsSections(all: all, upcoming: upcoming, past: past, today: today)
            case .venues: venueSections
            }
        }
        .navigationTitle("Bucket List")
        .searchable(text: $query, prompt: part == .shows ? "Filter by band or venue" : "Filter venues")
        .toolbar { toolbar(upcoming) }
        .task(id: "\(uid ?? "")|\(attempt)") { await load() }
        .refreshable { attempt += 1 }
        .sheet(isPresented: $addingShow) { AddBucketShowSheet { draft in await addShow(draft) } }
        .sheet(isPresented: $addingVenue) { AddBucketVenueSheet { name, city, state in await addVenue(name, city, state) } }
        .sheet(item: $calendar) { CalendarEventEditor(item: $0.item, place: $0.place).ignoresSafeArea() }
        .addOutcomeHandling(flow) { route in if let route { router.push(route) } }
        .notice($notice)
    }

    @ToolbarContentBuilder
    private func toolbar(_ upcoming: [BucketListItem]) -> some ToolbarContent {
        if part == .shows, !upcoming.isEmpty {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: BucketList.shareText(upcoming), subject: Text("My Bucket List")) {
                    Label("Share with friends", systemImage: "square.and.arrow.up")
                }
            }
        }
        ToolbarItem(placement: .primaryAction) {
            Button {
                if part == .shows { addingShow = true } else { addingVenue = true }
            } label: {
                Label(part == .shows ? "Add a show" : "Add a venue", systemImage: "plus")
            }
            .disabled(uid == nil)
        }
    }

    // MARK: Shows

    @ViewBuilder
    private func showsSections(all: [BucketListItem], upcoming: [BucketListItem], past: [BucketListItem], today: String) -> some View {
        if items == nil, loadProblem == nil {
            Section { HStack { Text("Loading your bucket list"); Spacer(); ProgressView() }.foregroundStyle(Color.textSecondary) }
                .brandRow()
        } else if items != nil {
            if all.isEmpty {
                Section {
                    emptyText("Nothing on your bucket list yet",
                              "Add a show you want to catch with +, and mark it off when you go.")
                }
                .brandRow()
            } else if upcoming.isEmpty, past.isEmpty {
                Section { emptyText("No matches", "Try a different search or clear the filter.") }.brandRow()
            }
            if !upcoming.isEmpty {
                Section {
                    ForEach(upcoming) { item in itemRow(item, today: today) }
                } header: {
                    HStack {
                        Text("Coming up")
                        Spacer()
                        Menu {
                            Picker("Sort", selection: $sort) {
                                ForEach(BucketList.Sort.allCases) { Text($0.label).tag($0) }
                            }
                        } label: {
                            Label(sort.label, systemImage: "arrow.up.arrow.down").labelStyle(.titleAndIcon)
                        }
                        .textCase(nil)
                    }
                }
                .brandRow()
            }
            if !past.isEmpty {
                Section {
                    ForEach(past) { item in itemRow(item, today: today) }
                } header: {
                    Text("Already happened")
                } footer: {
                    Text("Went? Tap I went and it moves to your shows, with the setlist when setlist.fm has it.")
                }
                .brandRow()
            }
        }
    }

    private func itemRow(_ item: BucketListItem, today: String) -> some View {
        let busy = busyKeys.contains(item.key) || flow.busy
        let happened = !item.date.isEmpty && item.date <= today
        return VStack(alignment: .leading, spacing: Space.x2) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.artist)
                    .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(Color.textPrimary)
                Spacer(minLength: Space.x2)
                if let source = item.sourceLabel {
                    Text(source)
                        .font(.jakarta(size: 11, weight: .semibold, relativeTo: .caption2))
                        .foregroundStyle(Color.textMuted)
                        .padding(.horizontal, 6)
                        .overlay(Capsule().stroke(Color.borderSubtle))
                }
            }
            Label(BucketList.longDate(item.date), systemImage: "calendar")
                .font(.jakarta(size: 13, relativeTo: .footnote))
                .foregroundStyle(Color.textSecondary)
            if !item.place.isEmpty {
                Label(item.place, systemImage: "mappin.and.ellipse")
                    .font(.jakarta(size: 13, relativeTo: .footnote))
                    .foregroundStyle(Color.textMuted)
                    .lineLimit(2)
            }
            HStack(spacing: Space.x2) {
                if !happened {
                    Button { Task { await openCalendar(item) } } label: {
                        if preparingCalendar == item.key {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("Add to Calendar", systemImage: "calendar.badge.plus")
                        }
                    }
                    .disabled(preparingCalendar != nil)
                }
                if let url = item.ticketURL, !happened {
                    Button { router.show(url) } label: { Label("Tickets", systemImage: "ticket") }
                }
                if happened {
                    Button { markAttended(item) } label: { Label("I went", systemImage: "checkmark.circle") }
                        .disabled(busy)
                }
            }
            .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
            .buttonStyle(.bordered)
            .tint(.brand)
        }
        .padding(.vertical, Space.x1)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { Task { await remove(item) } } label: { Label("Remove", systemImage: "trash") }
                .disabled(busy)
        }
        .contextMenu {
            Button(role: .destructive) { Task { await remove(item) } } label: { Label("Remove from bucket list", systemImage: "trash") }
        }
        .accessibilityAction(named: "Remove from bucket list") { Task { await remove(item) } }
    }

    // MARK: Venues

    @ViewBuilder private var venueSections: some View {
        if let venues {
            let shown = venues.filter {
                let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
                return q.isEmpty || $0.name.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil
                    || $0.place.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil
            }
            Section {
                if venues.isEmpty {
                    emptyText("No venues yet", "Add a venue you'd see anything at. We'll tell you when a band you follow announces a show there.")
                } else if shown.isEmpty {
                    emptyText("No matches", "Try a different search.")
                } else {
                    ForEach(shown) { venue in
                        NavigationLink(value: AppRoute.venue(key: venue.venueKey)) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(venue.name)
                                    .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                                    .foregroundStyle(Color.textPrimary)
                                if !venue.place.isEmpty {
                                    Text(venue.place)
                                        .font(.jakarta(size: 13, relativeTo: .footnote))
                                        .foregroundStyle(Color.textMuted)
                                }
                                Label("We'll notify you if a band you follow announces a show here", systemImage: "bell")
                                    .font(.jakarta(size: 12, relativeTo: .caption))
                                    .foregroundStyle(Color.textSecondary)
                            }
                            .padding(.vertical, Space.x1)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { Task { await removeVenue(venue) } } label: { Label("Remove", systemImage: "trash") }
                        }
                        .contextMenu {
                            Button(role: .destructive) { Task { await removeVenue(venue) } } label: { Label("Remove from bucket list", systemImage: "trash") }
                        }
                        .accessibilityAction(named: "Remove from bucket list") { Task { await removeVenue(venue) } }
                    }
                }
            } footer: {
                if !venues.isEmpty { Text("Swipe a venue to remove it.") }
            }
            .brandRow()
        } else if loadProblem == nil {
            Section { HStack { Text("Loading your venues"); Spacer(); ProgressView() }.foregroundStyle(Color.textSecondary) }
                .brandRow()
        }
    }

    private func emptyText(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: Space.x1) {
            Text(title)
                .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                .foregroundStyle(Color.textPrimary)
            Text(detail)
                .font(.jakarta(size: 13, relativeTo: .footnote))
                .foregroundStyle(Color.textSecondary)
        }
        .padding(.vertical, Space.x1)
    }

    // MARK: Loading and changes

    private func load() async {
        guard let uid else { return }
        loadProblem = nil
        do {
            items = try await BucketListService.items(uid: uid)
            venues = try await BucketListService.venues(uid: uid)
        } catch {
            if items == nil || venues == nil { loadProblem = "Couldn't load your bucket list. Check your connection." }
        }
    }

    private func addShow(_ draft: BucketListDraft) async -> Bool {
        guard let uid else { return false }
        do {
            try await BucketListService.add(uid: uid, draft: draft)
            notice = "Added to your bucket list."
            attempt += 1
            return true
        } catch {
            notice = "Couldn't add that show. Try again."
            return false
        }
    }

    private func addVenue(_ name: String, _ city: String, _ state: String) async -> Bool {
        guard let uid else { return false }
        do {
            try await BucketListService.addVenue(uid: uid, name: name, city: city, state: state)
            notice = "Added to your venue bucket list."
            attempt += 1
            return true
        } catch {
            notice = "Couldn't add that venue. Try again."
            return false
        }
    }

    private func remove(_ item: BucketListItem) async {
        guard let uid, !busyKeys.contains(item.key) else { return }
        busyKeys.insert(item.key)
        defer { busyKeys.remove(item.key) }
        do {
            try await BucketListService.remove(uid: uid, key: item.key)
            items?.removeAll { $0.key == item.key }
        } catch {
            notice = "Couldn't remove that show. Try again."
        }
    }

    private func removeVenue(_ venue: BucketListVenue) async {
        guard let uid else { return }
        do {
            try await BucketListService.removeVenue(uid: uid, venueKey: venue.venueKey)
            venues?.removeAll { $0.venueKey == venue.venueKey }
        } catch {
            notice = "Couldn't remove that venue. Try again."
        }
    }

    /// Add to Calendar: finds the venue on the map first (a few seconds at
    /// most), so the event's location opens in Maps; without a match the
    /// event still carries the venue and city as text.
    private func openCalendar(_ item: BucketListItem) async {
        preparingCalendar = item.key
        let place = await CalendarPlaces.find(item)
        preparingCalendar = nil
        calendar = CalendarRequest(item: item, place: place)
    }

    /// "I went": adds the show (the add flow's alerts and duplicate question
    /// apply), and takes it off the list once it's in your shows.
    private func markAttended(_ item: BucketListItem) {
        guard let uid else { return }
        let store = self.store
        flow.run {
            let outcome = await store.addFromBucketList(item)
            switch outcome {
            case .added, .alreadyThere, .queued:
                try? await BucketListService.remove(uid: uid, key: item.key)
                items?.removeAll { $0.key == item.key }
            case .possibleDuplicate, .refused:
                break
            }
            return outcome
        }
    }
}

// MARK: - Adding

/// A show by hand: band and date required, as on the web.
private struct AddBucketShowSheet: View {
    @Environment(\.dismiss) private var dismiss
    let save: (BucketListDraft) async -> Bool
    @State private var draft = BucketListDraft()
    @State private var day = Date()
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Band", text: $draft.artist).textInputAutocapitalization(.words)
                    DatePicker("Date", selection: $day, displayedComponents: .date)
                }
                .brandRow()
                Section("Where (optional)") {
                    TextField("Venue", text: $draft.venue).textInputAutocapitalization(.words)
                    TextField("City", text: $draft.city).textInputAutocapitalization(.words)
                    TextField("State", text: $draft.state).textInputAutocapitalization(.characters)
                }
                .brandRow()
            }
            .brandScreen()
            .disabled(saving)
            .navigationTitle("Add a Show")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            saving = true
                            var d = draft
                            d.date = ManualShowForm.isoDay(day)
                            if await save(d) { dismiss() }
                            saving = false
                        }
                    } label: { if saving { ProgressView() } else { Text("Add") } }
                    .disabled(saving || draft.artist.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

/// A venue: name required, as on the web.
private struct AddBucketVenueSheet: View {
    @Environment(\.dismiss) private var dismiss
    let save: (String, String, String) async -> Bool
    @State private var name = ""
    @State private var city = ""
    @State private var state = ""
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Venue name", text: $name).textInputAutocapitalization(.words)
                    TextField("City", text: $city).textInputAutocapitalization(.words)
                    TextField("State", text: $state).textInputAutocapitalization(.characters)
                } footer: {
                    Text("We'll tell you when a band you follow announces a show there.")
                }
                .brandRow()
            }
            .brandScreen()
            .disabled(saving)
            .navigationTitle("Add a Venue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            saving = true
                            if await save(name, city, state) { dismiss() }
                            saving = false
                        }
                    } label: { if saving { ProgressView() } else { Text("Add") } }
                    .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

// MARK: - Add to Calendar

/// The system's event editor, filled in with the show as an all-day event.
/// Since iOS 17 an app can show it without asking for calendar access: the
/// person saves the event themselves.
struct CalendarEventEditor: UIViewControllerRepresentable {
    let item: BucketListItem
    /// Where the venue is, when the map found it.
    let place: CalendarPlace?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = "\(item.artist) at \(item.venue ?? "TBD")"
        // Venue plus city; with the map's coordinates it's a structured
        // location, which Calendar shows on a map and opens in Maps.
        let title = BucketList.calendarLocation(item)
        if let place {
            let location = EKStructuredLocation(title: title)
            location.geoLocation = CLLocation(latitude: place.latitude, longitude: place.longitude)
            event.structuredLocation = location
        } else if !title.isEmpty {
            event.location = title
        }
        if let day = Self.day(item.date) {
            event.isAllDay = true
            event.startDate = day
            event.endDate = day
        }
        if let url = item.ticketURL {
            event.url = url
            event.notes = "Tickets: \(url.absoluteString)"
        }
        let editor = EKEventEditViewController()
        editor.eventStore = store
        editor.event = event
        editor.editViewDelegate = context.coordinator
        return editor
    }

    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator { dismiss() } }

    /// The show's day (ISO, from `ShowDate`) at its start here.
    static func day(_ iso: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: ShowDate.isoDay(iso))
    }

    /// EventKitUI's delegate protocol isn't marked main-actor; EventKit
    /// calls it on the main thread, which `@preconcurrency` checks at run time.
    @MainActor
    final class Coordinator: NSObject, @preconcurrency EKEventEditViewDelegate {
        let finish: () -> Void
        init(finish: @escaping () -> Void) { self.finish = finish }

        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            finish()
        }
    }
}

/// A show to add to the calendar, with its place when the map found one.
struct CalendarRequest: Identifiable {
    let item: BucketListItem
    let place: CalendarPlace?
    var id: String { item.key }
}

/// Where a venue is, for the event's structured location.
struct CalendarPlace: Equatable, Sendable {
    let latitude: Double
    let longitude: Double
}

enum CalendarPlaces {
    /// The venue (or, with none, the city) on the map: Apple's place search
    /// for "venue, city, state", given four seconds.
    @MainActor
    static func find(_ item: BucketListItem) async -> CalendarPlace? {
        let query = [item.venue, item.city, item.state].compactMap { $0 }.joined(separator: ", ")
        guard !query.isEmpty else { return nil }
        let isVenue = item.venue != nil
        return await withTaskGroup(of: CalendarPlace?.self) { group in
            group.addTask { await search(query, venue: isVenue) }
            group.addTask {
                try? await Task.sleep(for: .seconds(4))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    @MainActor
    private static func search(_ query: String, venue: Bool) async -> CalendarPlace? {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.resultTypes = venue ? .pointOfInterest : .address
        guard let response = try? await MKLocalSearch(request: request).start(),
              let found = response.mapItems.first else { return nil }
        let coordinate = found.placemark.coordinate
        return CalendarPlace(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }
}
