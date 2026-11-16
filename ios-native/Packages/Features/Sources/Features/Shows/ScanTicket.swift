import Core
import DesignSystem
import PhotosUI
import SwiftUI

/// Scan a ticket (Stage 1, Part 5), accounts only: photos from the camera
/// or the library (up to 10), sent to `analyze-tickets` only when Scan is
/// tapped and not kept afterwards. Then a review: every show found, its
/// band, date, venue and city editable, each one picked or not, and the
/// setlist.fm setlist for that night when there is one. "Add" sends the
/// picked shows one at a time through the outbox → `normalize-show`, with
/// Part 4's duplicate question.
struct ScanTicketView: View {
    @Environment(ShowsStore.self) private var store
    @Environment(SessionStore.self) private var session
    /// Closes the + sheet, opening the show when there is one to open.
    let close: (AppRoute?) -> Void

    @State private var images: [UIImage] = []
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showingCamera = false
    @State private var scanning = false
    @State private var problem: String?
    @State private var shows: [ScannedShow] = []
    @State private var scanned = false

    private var canUseCamera: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    var body: some View {
        Group {
            if scanned {
                ScanReview(shows: $shows, done: close)
            } else {
                pickerList
            }
        }
        .navigationTitle(scanned ? "Review" : "Scan a ticket")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Couldn't scan", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
        .onDisappear { images = [] }
    }

    private var pickerList: some View {
        List {
            Section {
                if canUseCamera {
                    Button { showingCamera = true } label: { Label("Take a photo", systemImage: "camera") }
                        .disabled(images.count >= TicketScan.maxImages)
                }
                PhotosPicker(selection: $pickerItems, maxSelectionCount: TicketScan.maxImages - images.count + pickerItems.count,
                             matching: .images) {
                    Label("Choose from your photos", systemImage: "photo.on.rectangle")
                }
                .disabled(images.count >= TicketScan.maxImages)
            } footer: {
                Text("Ticket stubs, wristbands or mobile tickets, up to \(TicketScan.maxImages). Nothing is sent until you tap Scan, and the photos aren't kept afterwards.")
            }
            .brandRow()

            if !images.isEmpty {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Space.x2) {
                            ForEach(Array(images.enumerated()), id: \.offset) { index, image in
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 88, height: 88)
                                    .clipShape(RoundedRectangle.brand(Radius.lg))
                                    .overlay(alignment: .topTrailing) {
                                        Button { images.remove(at: index) } label: {
                                            Image(systemName: "xmark.circle.fill").symbolRenderingMode(.palette)
                                                .foregroundStyle(.white, .black.opacity(0.6)).imageScale(.large)
                                        }
                                        .padding(4)
                                        .accessibilityLabel("Remove photo \(index + 1)")
                                    }
                            }
                        }
                        .padding(.vertical, Space.x1)
                    }
                    Button {
                        Task { await scan() }
                    } label: {
                        HStack {
                            if scanning { ProgressView() }
                            Text(scanning ? "Reading your tickets…" : (images.count == 1 ? "Scan 1 photo" : "Scan \(images.count) photos"))
                        }
                        .frame(maxWidth: .infinity, minHeight: TouchTarget.minimum)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.brand)
                    .disabled(scanning)
                } header: {
                    Text(images.count == 1 ? "1 photo" : "\(images.count) photos")
                }
                .brandRow()
            }
        }
        .brandScreen()
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            Task {
                for item in items {
                    if images.count >= TicketScan.maxImages { break }
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        images.append(image)
                    }
                }
                pickerItems = []
            }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker { image in
                if let image, images.count < TicketScan.maxImages { images.append(image) }
            }
            .ignoresSafeArea()
        }
    }

    private func scan() async {
        guard !scanning, !images.isEmpty, let ticketScan = store.ticketScan else { return }
        scanning = true
        defer { scanning = false }
        let jpegs = images.compactMap(TicketScan.prepare)
        guard jpegs.count == images.count else {
            problem = "That image is too large. Try a smaller photo or a screenshot."
            return
        }
        do {
            let found = try await ticketScan.scan(jpegs)
            guard !found.isEmpty else {
                problem = "No shows detected in the ticket images. Try different or clearer images."
                return
            }
            shows = found.map { ScannedShow($0) }
            images = []   // not kept after the scan
            scanned = true
        } catch {
            problem = TicketScan.message(for: error)
        }
    }
}

/// The scanned shows, editable, each picked or not; then Add.
struct ScanReview: View {
    @Environment(ShowsStore.self) private var store
    @Binding var shows: [ScannedShow]
    let done: (AppRoute?) -> Void

    /// setlist.fm's setlist for each show's night, looked up by band and date.
    @State private var matches: [UUID: SetlistfmSearch.Setlist] = [:]
    @State private var useMatch: [UUID: Bool] = [:]
    @State private var results: [UUID: ScanAddResult] = [:]
    @State private var adding = false
    @State private var question: (text: String, answer: CheckedContinuation<Bool, Never>)?
    /// Shows that have a page now (added, already logged, or saved to finish later).
    @State private var opened: [String] = []

    private var picked: [ScannedShow] { shows.filter { $0.selected && results[$0.id] == nil } }

    var body: some View {
        List {
            Section {
                Text(shows.count == 1 ? "1 show found. Check it before it's added." : "\(shows.count) shows found. Check each one and pick the ones to add.")
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
            }
            .listRowBackground(Color.clear)

            ForEach($shows) { $show in
                Section {
                    ScannedShowEditor(show: $show, match: matches[show.id], useMatch: bindingUseMatch(show.id), result: results[show.id])
                        .disabled(adding || results[show.id] != nil)
                        .task(id: show.artist + "|" + show.date) { await lookUp(show) }
                }
                .brandRow()
            }
        }
        .brandScreen()
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if results.count == shows.count || (picked.isEmpty && !results.isEmpty) {
                    Button("Done") { finish() }
                } else {
                    Button { Task { await addPicked() } } label: {
                        if adding { ProgressView() } else { Text(picked.count <= 1 ? "Add" : "Add \(picked.count)") }
                    }
                    .disabled(adding || picked.isEmpty || picked.contains { $0.problem() != nil })
                }
            }
        }
        .confirmationDialog("Already logged?", isPresented: Binding(get: { question != nil }, set: { if !$0 { answer(false) } }), titleVisibility: .visible) {
            Button("Add as a separate show") { answer(true) }
            Button("Don't add", role: .cancel) { answer(false) }
        } message: { Text(question?.text ?? "") }
    }

    private func bindingUseMatch(_ id: UUID) -> Binding<Bool> {
        Binding(get: { useMatch[id] ?? true }, set: { useMatch[id] = $0 })
    }

    /// The night on setlist.fm, a moment after the band or date stops changing.
    private func lookUp(_ show: ScannedShow) async {
        try? await Task.sleep(for: .milliseconds(600))
        guard !Task.isCancelled else { return }
        let date = ShowDate.isoDay(show.date)
        guard !show.artist.isEmpty, !date.isEmpty, let search = store.setlistfmSearch else { matches[show.id] = nil; return }
        let found = await search.setlist(artist: show.artist, date: date, venue: show.venue)
        guard !Task.isCancelled else { return }
        matches[show.id] = found
    }

    /// One at a time, in order, each through the outbox; a possible
    /// duplicate waits for the person's answer.
    private func addPicked() async {
        guard !adding else { return }
        adding = true
        defer { adding = false }
        for show in picked {
            let match = (useMatch[show.id] ?? true) ? matches[show.id] : nil
            var outcome = await store.addShow(show.input(match: match), display: show.display)
            if case .possibleDuplicate(let id, let text) = outcome {
                let yes = await withCheckedContinuation { continuation in question = (text, continuation) }
                outcome = await store.answerPossibleDuplicate(showId: id, addAnyway: yes) ?? .refused("Not added.")
            }
            results[show.id] = describe(outcome)
            switch outcome {
            case .added(let id), .alreadyThere(let id), .queued(let id): opened.append(id)
            case .refused, .possibleDuplicate: break
            }
        }
    }

    private func answer(_ yes: Bool) {
        guard let q = question else { return }
        question = nil
        q.answer.resume(returning: yes)
    }

    private func describe(_ outcome: AddOutcome) -> ScanAddResult {
        switch outcome {
        case .added: .init(text: "Added to your shows.", kind: .added)
        case .alreadyThere: .init(text: "Already in your shows.", kind: .added)
        case .queued: .init(text: "Saved on this iPhone. It finishes saving when you're back online.", kind: .waiting)
        case .refused(let text): .init(text: text, kind: .notAdded)
        case .possibleDuplicate: .init(text: "Not added.", kind: .notAdded)
        }
    }

    /// Closes the add sheet; when exactly one show has a page, opens it
    /// (as the other add paths do for added, already-logged and saved shows).
    private func finish() {
        done(opened.count == 1 ? opened.first.map { .show(id: $0) } : nil)
    }
}

/// What happened to one scanned show when Add was tapped.
struct ScanAddResult: Hashable {
    enum Kind { case added, waiting, notAdded
        var symbol: String {
            switch self { case .added: "checkmark.circle"; case .waiting: "clock"; case .notAdded: "minus.circle" }
        }
    }
    let text: String
    let kind: Kind
}

/// One scanned show: pick it, fix its fields, see its setlist.fm match.
struct ScannedShowEditor: View {
    @Binding var show: ScannedShow
    let match: SetlistfmSearch.Setlist?
    @Binding var useMatch: Bool
    let result: ScanAddResult?

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Toggle(isOn: $show.selected) {
                Text("Add this show")
                    .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
            }
            .tint(.brand)
            .disabled(result != nil)
            TextField("Band", text: $show.artist).textInputAutocapitalization(.words)
            TextField("Venue", text: $show.venue).textInputAutocapitalization(.words)
            TextField("City", text: $show.city).textInputAutocapitalization(.words)
            if let day = ShowDateText.date(show.date) {
                DatePicker("Date", selection: Binding(get: { day }, set: { show.date = ManualShowForm.isoDay($0) }),
                           in: ...Date(), displayedComponents: .date)
            } else {
                Button("Set the date") { show.date = ShowDate.today() }
            }
            if let match {
                Toggle(isOn: $useMatch) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Use setlist.fm's setlist").font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                        Text([match.venue, match.songCount > 0 ? "\(match.songCount) songs" : "no songs yet"].joined(separator: " · "))
                            .font(.jakarta(size: 12, relativeTo: .caption)).foregroundStyle(Color.textSecondary)
                    }
                }
                .tint(.brand)
            }
            if let result {
                Label(result.text, systemImage: result.kind.symbol).font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
                    .foregroundStyle(result.kind == .notAdded ? Color.textSecondary : Color.brandLight)
            } else if let problem = show.problem() {
                Label(problem, systemImage: "exclamationmark.circle").font(.jakarta(size: 13, relativeTo: .footnote))
                    .foregroundStyle(Color.amber)
            }
        }
        .padding(.vertical, Space.x1)
    }
}

/// The camera, for one photo. The image stays in memory.
struct CameraPicker: UIViewControllerRepresentable {
    let done: (UIImage?) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            parent.done(info[.originalImage] as? UIImage)
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.done(nil)
            parent.dismiss()
        }
    }
}
