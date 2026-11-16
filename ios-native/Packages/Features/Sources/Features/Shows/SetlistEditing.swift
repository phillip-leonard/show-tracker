import Core
import DesignSystem
import SwiftUI

// Song edits on the show page (Stage 1, Part 3b). Each is one
// `SetlistEdit`, applied in a transaction to the setlist as stored
// (`ShowsStore.editSetlist`); the screen shows this device's copy at once.

/// A song just deleted, with what the undo puts back.
struct DeletedSong: Identifiable, Equatable {
    let id = UUID()
    let song: JSONValue
    let index: Int
    let name: String
}

/// "Deleted “Tumble”  Undo", for 12 s.
struct UndoBar: View {
    let deleted: DeletedSong
    let undo: () -> Void

    var body: some View {
        HStack(spacing: Space.x3) {
            Text("Deleted \u{201C}\(deleted.name)\u{201D}")
                .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                .foregroundStyle(Color.textPrimary)
                .lineLimit(1)
            Spacer()
            Button("Undo", action: undo)
                .font(.jakarta(size: 15, weight: .bold, relativeTo: .body))
                .tint(.brand)
                .frame(minHeight: TouchTarget.minimum)
        }
        .padding(.horizontal, Space.x4)
        .brandCard(radius: Radius.xl2)
        .accessibilityElement(children: .contain)
    }
}

/// 1–10 as a grid of buttons; the chosen one is filled.
struct RatingGrid: View {
    @Binding var rating: Int?

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Space.x2), count: 5), spacing: Space.x2) {
            ForEach(1...10, id: \.self) { n in
                Button { rating = n } label: {
                    Text("\(n)")
                        .font(.jakarta(size: 17, weight: .bold, relativeTo: .body))
                        .monospacedDigit()
                        .frame(maxWidth: .infinity, minHeight: TouchTarget.minimum)
                        .foregroundStyle(rating == n ? Color.bgBase : Color.textPrimary)
                        .background(rating == n ? Color.amber : Color.surfaceHover, in: RoundedRectangle.brand(Radius.lg))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(n) out of 10")
                .accessibilityAddTraits(rating == n ? .isSelected : [])
            }
        }
    }
}

/// Rate a song and comment on it. Each change that differs is one edit.
struct SongSheet: View {
    @Environment(ShowsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let showId: String
    let song: Song
    @State private var rating: Int?
    @State private var comment: String

    init(showId: String, song: Song) {
        self.showId = showId
        self.song = song
        _rating = State(initialValue: song.rating)
        _comment = State(initialValue: song.comment ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    RatingGrid(rating: $rating)
                    if rating != nil {
                        Button("Clear rating", role: .destructive) { rating = nil }
                    }
                } header: {
                    Text("Your rating")
                }
                .brandRow()
                Section {
                    TextField("What stood out?", text: $comment, axis: .vertical)
                        .lineLimit(2...6)
                } header: {
                    Text("Comment")
                }
                .brandRow()
            }
            .brandScreen()
            .navigationTitle(song.name.isEmpty ? "Song" : song.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        let text = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        let id = song.id
        let newRating = rating
        let ratingChanged = newRating != song.rating
        let commentChanged = text != (song.comment ?? "")
        Task {
            if ratingChanged { await store.editSetlist(showId: showId, .rate(songId: id, rating: newRating)) }
            // Cleared as "", as the web does (fixtures/setlist-edits/comment.json).
            if commentChanged { await store.editSetlist(showId: showId, .comment(songId: id, comment: .string(text))) }
        }
        dismiss()
    }
}

/// Add a song by name, to a set.
struct AddSongSheet: View {
    @Environment(ShowsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let showId: String
    let options: [String]
    @State private var name = ""
    @State private var set: String
    @FocusState private var focused: Bool

    init(showId: String, options: [String], defaultSet: String) {
        self.showId = showId
        self.options = options
        _set = State(initialValue: defaultSet)
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Song title", text: $name)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit(add)
                    Picker("Set", selection: $set) {
                        ForEach(options, id: \.self) { Text($0).tag($0) }
                    }
                }
                .brandRow()
            }
            .brandScreen()
            .navigationTitle("Add a song")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Add", action: add).disabled(trimmed.isEmpty) }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }

    private func add() {
        guard !trimmed.isEmpty else { return }
        let song = ShowsStore.newSong(name: trimmed, set: set)
        Task { await store.editSetlist(showId: showId, .add(song: song)) }
        dismiss()
    }
}

/// One rating for every song not rated yet.
struct RateUnratedSheet: View {
    @Environment(ShowsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let showId: String
    let count: Int
    @State private var rating: Int?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    RatingGrid(rating: $rating)
                } footer: {
                    Text(count == 1 ? "1 song has no rating yet. Songs you've rated keep theirs." : "\(count) songs have no rating yet. Songs you've rated keep theirs.")
                }
                .brandRow()
            }
            .brandScreen()
            .navigationTitle("Rate unrated songs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(count == 1 ? "Rate 1 song" : "Rate \(count) songs") {
                        if let rating { Task { await store.editSetlist(showId: showId, .rateUnrated(rating: rating)) } }
                        dismiss()
                    }
                    .disabled(rating == nil)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Reviewing a proposed setlist

/// A setlist to look at before it replaces the current one: what
/// `propose-setlist` found (the Internet Archive), or the show's stored
/// `setlistProposal` (the Archive backfill).
enum ProposalReview: Identifiable {
    case proposed(SetlistOpAnswer)
    case stored

    var id: String {
        switch self {
        case .proposed: "proposed"
        case .stored: "stored"
        }
    }
}

struct ProposalReviewSheet: View {
    @Environment(ShowsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let review: ProposalReview
    let show: Show
    let sourceName: String
    /// What happened, for the page to say.
    let done: (String) -> Void
    @State private var busy = false

    private var songs: [Song] {
        switch review {
        case .proposed(let answer): answer.proposedSongs
        case .stored: show.setlistProposal?.songs ?? []
        }
    }

    private var warnings: [String] {
        switch review {
        case .proposed(let answer): answer.reviewWarnings
        case .stored:
            SetlistOpAnswer.reviewWarnings(confidence: show.setlistProposal?.confidence,
                                           needsReview: show.setlistProposal?.needsReview == true,
                                           partial: show.setlistProposal?.partial == true)
        }
    }

    private var from: String {
        switch review {
        case .proposed: sourceName
        case .stored: show.setlistProposal?.source == "archive" || show.setlistProposal?.source == nil ? "the Internet Archive" : sourceName
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.x4) {
                    Text("The setlist from \(from), with your ratings and comments carried over. Nothing changes until you accept it.")
                        .font(.jakarta(size: 15, relativeTo: .body))
                        .foregroundStyle(Color.textSecondary)
                    ForEach(warnings, id: \.self) { warning in
                        Notice(title: "Check this", text: warning, symbol: "exclamationmark.triangle", tint: .amber)
                    }
                    ForEach(SetGroups.group(songs)) { group in
                        VStack(alignment: .leading, spacing: Space.x1) {
                            Text(group.label.uppercased())
                                .font(.jakarta(size: 12, weight: .bold, relativeTo: .caption))
                                .tracking(0.8)
                                .foregroundStyle(Color.brandLight)
                            Text(group.songs.enumerated().map { i, song in
                                song.name + (i < group.songs.count - 1 ? (song.tape == true ? " \(song.transitionMark.flatMap { $0.isEmpty ? nil : $0 } ?? ">") " : ", ") : "")
                            }.joined())
                            .font(.jakarta(size: 15, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .brandCard()
                    }
                }
                .padding(Space.x5)
            }
            .brandBackground()
            .navigationTitle("Review setlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Keep current") { Task { await keep() } }.disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button("Accept") { Task { await accept() } }.disabled(songs.isEmpty) }
                }
            }
            .interactiveDismissDisabled(busy)
        }
    }

    private func accept() async {
        guard let ops = store.setlistOps else { return }
        busy = true
        defer { busy = false }
        do {
            let answer: SetlistOpAnswer
            switch review {
            case .proposed(let proposed):
                guard let result = proposed.result else { return }
                answer = try await ops.accept(showId: show.id, result: result)
            case .stored:
                answer = try await ops.acceptStored(showId: show.id)
            }
            if answer.ok { store.noteSetlistChangedOnServer() }
            done(answer.describe(sourceName: from, date: ShowDateText.display(show.date)))
        } catch {
            done(error.message ?? "Couldn't reach the server. Nothing was changed.")
        }
        dismiss()
    }

    /// A proposal from the review is simply not used; a stored one is
    /// recorded as declined (`reject-proposal`), so it isn't offered again.
    private func keep() async {
        guard case .stored = review else { dismiss(); return }
        guard let ops = store.setlistOps else { return }
        busy = true
        defer { busy = false }
        do {
            let answer = try await ops.reject(showId: show.id)
            done(answer.ok ? "Kept your setlist." : answer.describe(sourceName: from, date: ShowDateText.display(show.date)))
        } catch {
            done(error.message ?? "Couldn't reach the server. Nothing was changed.")
        }
        dismiss()
    }
}
