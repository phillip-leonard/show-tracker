import Core
import DesignSystem
import SwiftUI

/// Add or edit an upcoming show: written straight to
/// `users/{uid}/upcomingShows`, field by field, with the web's rules
/// (`UpcomingShowRules`, fixtures/upcoming-shows/).
struct UpcomingForm: View {
    @Environment(ShowsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let editing: UpcomingShow?
    var onSaved: (String) -> Void = { _ in }

    @State private var band = ""
    @State private var venue = ""
    @State private var city = ""
    @State private var date = Date()
    @State private var time = ""
    @State private var notes = ""
    @State private var problem: String?
    @State private var duplicateId: String?
    @State private var loaded = false

    var body: some View {
        Form {
            Section {
                TextField("Band", text: $band).textInputAutocapitalization(.words)
                TextField("Venue", text: $venue).textInputAutocapitalization(.words)
                TextField("City (optional)", text: $city).textInputAutocapitalization(.words)
                DatePicker("Date", selection: $date, in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date)
                TextField("Time (optional)", text: $time)
            }
            .brandRow()
            Section {
                TextField("Notes (seats, who's going)", text: $notes, axis: .vertical).lineLimit(2...5)
            }
            .brandRow()
        }
        .brandScreen()
        .navigationTitle(editing == nil ? "Upcoming show" : "Edit upcoming show")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button(editing == nil ? "Add" : "Save") { Task { await save() } } }
            if editing != nil {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .alert("Not saved", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
        .alert("Already on your list", isPresented: Binding(get: { duplicateId != nil }, set: { if !$0 { duplicateId = nil } })) {
            Button("Open it") { if let id = duplicateId { onSaved(id) } }
            Button("OK", role: .cancel) {}
        } message: { Text("You already have this band on this day as an upcoming show.") }
        .onAppear(perform: load)
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        guard let show = editing else { return }
        band = show.artist; venue = show.venue; city = show.city; time = show.time ?? ""; notes = show.notes ?? ""
        if let d = ShowDateText.date(show.date) { date = d }
    }

    private func save() async {
        var input = editing.map(UpcomingInput.init) ?? UpcomingInput()
        input.artist = band; input.venue = venue; input.city = city
        input.date = ManualShowForm.isoDay(date); input.time = time; input.notes = notes
        let outcome = editing == nil ? await store.addUpcoming(input) : await store.updateUpcoming(id: editing!.id, input)
        switch outcome {
        case .saved(let id):
            if editing != nil { dismiss() }
            onSaved(id)
        case .problem(let text): problem = text
        case .duplicate(let id): duplicateId = id
        }
    }
}

/// An upcoming show: when and where, notes, then Edit, Delete, and, the
/// morning after, "I went", which moves it to your shows with its setlist.
struct UpcomingDetail: View {
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var flow = AddFlow()

    var body: some View {
        Group {
            if let show = store.upcomingShow(id: id) {
                content(show)
            } else if !store.upcomingLoaded {
                ProgressView("Loading the show")
            } else {
                ContentUnavailableView {
                    Label("That upcoming show isn't here any more", systemImage: "calendar")
                } description: {
                    Text("It may have been moved to your shows, or deleted.")
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ show: UpcomingShow) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x5) {
                ShowHeader(date: show.date, tour: show.time, artist: show.artist, venue: show.venue, city: show.city, state: nil, festival: nil)
                if let notes = show.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.jakarta(size: 15, relativeTo: .body))
                        .foregroundStyle(Color.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .brandCard(radius: Radius.xl2)
                }
                if UpcomingShowRules.canMarkAttended(show) {
                    Notice(title: "Did you go?", text: "Move it to your shows. The setlist comes from setlist.fm or the band's archive when there is one.",
                           symbol: "checkmark.seal", tint: .brand,
                           action: ("I went", { flow.run { await store.markAttended(show) } }))
                }
            }
            .padding(.horizontal, Space.x5)
            .padding(.top, Space.x2)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(show.artist)
        .toolbar {
            ToolbarItem(placement: .principal) { Text("").accessibilityHidden(true) }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { editing = true } label: { Label("Edit", systemImage: "pencil") }
                    Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete", systemImage: "trash") }
                } label: { Label("More", systemImage: "ellipsis") }
                .confirmationDialog("Delete this upcoming show?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                    Button("Delete", role: .destructive) { dismiss(); store.deleteUpcoming(id: show.id) }
                } message: { Text("\(show.artist), \(ShowDateText.display(show.date)).") }
            }
        }
        .overlay { if flow.busy { ProgressView("Finding the setlist").padding().background(.regularMaterial, in: RoundedRectangle.brand()) } }
        .sheet(isPresented: $editing) { NavigationStack { UpcomingForm(editing: show) } }
        .addOutcomeHandling(flow) { route in
            guard let route else { return }
            router.paths[.shows] = [route]
        }
    }
}
