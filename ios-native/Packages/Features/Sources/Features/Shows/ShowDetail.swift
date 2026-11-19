import Core
import DesignSystem
import SwiftUI

/// Where `/shows/?show=<id>` and a row lead (Stage 1, Part 3a): the show
/// page, a show still waiting to sync, or "Show not found". Waits for the
/// shows to load, which always ends (`ShowsStore`).
struct ShowDetailScreen: View {
    @Environment(ShowsStore.self) private var store
    let id: String
    /// Deleted from this screen: it is closing, so don't say "not found".
    @State private var deleted = false

    var body: some View {
        Group {
            if let show = store.show(id: id) {
                ShowDetailView(show: show) { deleted = true }
            } else if let queued = store.queuedShow(id: id) {
                QueuedShowDetail(entry: queued)
            } else if store.isAwaitingNewShow(id: id) {
                ProgressView("Saving the show")
            } else if deleted {
                Color.clear
            } else if !store.showsLoaded {
                ProgressView("Loading the show")
            } else {
                ContentUnavailableView {
                    Label("Show not found", systemImage: "music.mic")
                } description: {
                    Text("It may have been deleted, or it belongs to another account.")
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - The show page

/// The show page, as the Stage 1 mockup lays it out: the header, your
/// ratings and note, the setlist by set, the source's notes and credit,
/// listening, then the night's comments (Stage 6, 6-3).
/// The ratings and the note are each one field written on its own
/// (`ShowFieldEdit`). Song edits (Part 3b) run as transactions on the
/// setlist as stored (`ShowsStore.editSetlist`). Re-sync, the Archive
/// review and a waiting proposal go through the server's setlist
/// operations (`SetlistOps`); the app writes nothing to `setlist` after
/// one, and the listener brings the result.
struct ShowDetailView: View {
    @Environment(ShowsStore.self) private var store
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    let show: Show
    let onDelete: () -> Void

    @State private var source: SetlistSourceAnswer?
    @State private var festival: String?
    @State private var editingNote = false
    @State private var confirmingDelete = false
    /// A setlist operation is running (its busy label shows).
    @State private var opBusy = false
    /// What an operation did, said once.
    @State private var opMessage: String?
    @State private var review: ProposalReview?
    /// The song just deleted, for 12 s of Undo.
    @State private var undo: DeletedSong?
    @State private var tagging = false
    @State private var socialNotice: String?
    @State private var follow = FollowFlow()
    @State private var shareNeedsPublicProfile = false
    /// Recordings and streaming links (Stage 4, 4-4); nil until answered,
    /// or when the server can't be reached.
    @State private var listening: Listening?
    /// The band's song pages, for a public band that has them (4-5).
    @State private var bandSongs: (band: PublicBand, slugs: BandSongSlugs)?

    private var isGuest: Bool { session.user?.isAnonymous == true }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x5) {
                ShowHeader(date: show.date, tour: show.tour, artist: show.artist, venue: show.venue,
                           city: show.city, state: show.state, festival: festival,
                           bandSlug: show.artist.isEmpty ? nil : BandDirectory.slug(forArtist: show.artist),
                           festivalId: isGuest ? nil : show.festivalId)
                ShowPlaceLinks(show: show)
                YourRatingsCard(show: show, editNote: { editingNote = true })
                if !isGuest {
                    // Friends who were there (Stage 3, Part 3b): accounts only.
                    TaggedWithCard(taggedUids: show.taggedFriendUids, taggedBy: show.taggedBy, upcoming: false) { tagging = true }
                }
                SetlistSection(show: show, source: source, undo: $undo, reviewStoredProposal: { review = .stored },
                               bandSongs: bandSongs)
                if let listening {
                    ListenSection(show: show, listening: listening)
                    StreamingSection(platforms: listening.streaming)
                }
                // Everyone who logged this night shares the photos (6-4)
                // and the thread (6-3); guests see a prompt instead (D-1).
                ShowMediaSection(show: show)
                CommentsSection(show: show)
            }
            .padding(.horizontal, Space.x5)
            .padding(.top, Space.x2)
            .padding(.bottom, Space.x8)
            // A readable column on a wide iPad window (layout follows width).
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(show.artist)
        .toolbar {
            // The header carries the band; the title stays for VoiceOver and the back stack.
            ToolbarItem(placement: .principal) { Text("").accessibilityHidden(true) }
            if let resync = source?.resync, resync.offered, let label = resync.label {
                ToolbarItem(placement: .primaryAction) {
                    if opBusy {
                        ProgressView().accessibilityLabel(resync.busyLabel ?? "Working")
                    } else {
                        Button { Task { await runResync() } } label: { Label(label, systemImage: "arrow.triangle.2.circlepath") }
                    }
                }
            }
            ToolbarItem(placement: .primaryAction) { moreMenu }
        }
        .sheet(isPresented: $editingNote) {
            NoteEditor(note: show.comment ?? "") { text in
                store.update(ShowFieldEdit.comment(text), showId: show.id)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let undo {
                UndoBar(deleted: undo) {
                    self.undo = nil
                    Task { await store.editSetlist(showId: show.id, .restore(song: undo.song, index: undo.index)) }
                }
                .padding(.horizontal, Space.x4)
                .padding(.bottom, Space.x2)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.default, value: undo?.id)
        .task(id: undo?.id) {
            guard undo != nil else { return }
            try? await Task.sleep(for: .seconds(12))
            if !Task.isCancelled { undo = nil }
        }
        .sheet(isPresented: $tagging) {
            TagFriendsSheet(target: .show(show.id), band: show.artist, alreadyTagged: show.taggedFriendUids) { socialNotice = $0 }
        }
        .notice($socialNotice)
        .followFlow(follow, session: session)
        .alert("Make your profile public to share", isPresented: $shareNeedsPublicProfile) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("A show has a page anyone can open only while your profile is public. Turn it on in Me → Public profile (it needs a handle).")
        }
        .sheet(item: $review) { item in
            ProposalReviewSheet(review: item, show: show, sourceName: sourceName) { message in
                opMessage = message
            }
        }
        .alert(source?.resync.label ?? "Setlist", isPresented: Binding(get: { opMessage != nil }, set: { if !$0 { opMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(opMessage ?? "")
        }
        .alert("Not saved", isPresented: Binding(get: { store.writeProblem != nil }, set: { if !$0 { store.writeProblem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.writeProblem ?? "")
        }
        .task(id: SetlistSourceAnswer.query(for: show)) { source = await store.setlistSource(for: show) }
        .task(id: show.festivalId) { festival = await store.festivalName(for: show) }
        // The ISO day, so a legacy stored date asks the same question.
        // Which setlist songs have a band song page (a public band with song
        // pages only; the band's JSON is CDN-cached and kept for the session).
        .task(id: show.artist) {
            guard let band = await BandService.shared.showableBand(forArtist: show.artist, api: session.api), band.songPages,
                  let snapshot = try? await BandService.shared.band(band.slug, api: session.api) else { bandSongs = nil; return }
            let slugs = BandSongSlugs(snapshot, band: band)
            bandSongs = slugs.isEmpty ? nil : (band, slugs)
        }
        .task(id: "\(show.artist)|\(show.isoDate)") {
            listening = await Listening.lookup(artist: show.artist, date: show.date, api: session.api)
        }
    }

    private var moreMenu: some View {
        Menu {
            if !isGuest {
                // The show's public page (STAGE3-AUDIT §7), which exists only
                // while the profile is public; otherwise, how to get one.
                if session.profile?.publicProfile == true, let handle = session.profile?.handle,
                   let url = ProfileSettings.publicShowURL(handle: handle, showId: show.id) {
                    ShareLink(item: url, subject: Text(show.artist), message: Text(describe(show))) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                } else {
                    Button { shareNeedsPublicProfile = true } label: { Label("Share", systemImage: "square.and.arrow.up") }
                }
            }
            if !show.artist.isEmpty {
                let following = BandFollows.isFollowing(show.artist, in: session.profile?.favoriteArtists ?? [])
                Button { Task { await follow.toggle(show.artist, session: session) } } label: {
                    Label(following ? "Unfollow \(show.artist)" : "Follow \(show.artist)", systemImage: following ? "bell.slash" : "bell")
                }
            }
            if !isGuest {
                Button { tagging = true } label: { Label("Tag friends", systemImage: "person.badge.plus") }
            }
            Button(role: .destructive) { confirmingDelete = true } label: {
                Label("Delete show", systemImage: "trash")
            }
        } label: {
            Label("More", systemImage: "ellipsis")
        }
        // Anchored to the button it came from (a popover on iPad and iOS 26).
        .confirmationDialog("Delete this show?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete show", role: .destructive) {
                onDelete()
                dismiss()
                store.delete(showId: show.id)
            }
        } message: {
            Text("\(describe(show)), with its setlist, ratings and note. This can't be undone.")
        }
    }

    private var sourceName: String { source?.source.label ?? "the band's archive" }

    /// The ⟳ button: `resync-show` for a band source; for `review` (the
    /// Internet Archive), `propose-setlist` and the review sheet first.
    private func runResync() async {
        guard let ops = store.setlistOps, let resync = source?.resync, resync.offered else { return }
        opBusy = true
        defer { opBusy = false }
        let date = ShowDateText.display(show.date)
        do {
            if resync.action == .review {
                let answer = try await ops.propose(showId: show.id)
                if answer.ok, answer.result != nil { review = .proposed(answer) } else { opMessage = answer.describe(sourceName: sourceName, date: date) }
            } else {
                let answer = try await ops.resync(showId: show.id)
                if answer.ok { store.noteSetlistChangedOnServer() }
                opMessage = answer.describe(sourceName: sourceName, date: date)
            }
        } catch {
            opMessage = error.message ?? "Couldn't reach the server. Nothing was changed."
        }
    }

    private func describe(_ show: Show) -> String {
        let band = show.artist.isEmpty ? "This show" : show.artist
        let at = show.venue.isEmpty ? "" : " at \(show.venue)"
        return "\(band)\(at), \(ShowDateText.display(show.date))"
    }
}

// MARK: - Tour, run and venue

/// The show's tour (when it's one of yours), "Night 2 of 3" when it's part
/// of a run (Stage 4, 4-6), and its venue page (4-7).
struct ShowPlaceLinks: View {
    @Environment(ShowsStore.self) private var store
    let show: Show

    var body: some View {
        let tour = store.tour(for: show)
        let run = store.run(containing: show.id)
        let venueKey = VenueNames.venueKey(name: show.venue, city: show.city)
        if tour != nil || run != nil || (venueKey != nil && !show.venue.isEmpty) {
            VStack(alignment: .leading, spacing: 0) {
                if let tour {
                    linkRow(NavigationLink(value: AppRoute.tour(key: tour.key)) {
                        rowLabel(tour.tourName, detail: "\(tour.stopCount) stop\(tour.stopCount == 1 ? "" : "s") you caught", symbol: "map", outward: false)
                    })
                }
                if let run, let night = run.nightNumber(of: show.id) {
                    if tour != nil { Divider().overlay(Color.borderSubtle) }
                    linkRow(NavigationLink(value: AppRoute.run(key: run.key)) {
                        rowLabel("Night \(night) of \(run.nightCount)", detail: "View the full run", symbol: "calendar.day.timeline.left", outward: false)
                    })
                }
                if let venueKey, !show.venue.isEmpty {
                    if tour != nil || run != nil { Divider().overlay(Color.borderSubtle) }
                    linkRow(NavigationLink(value: AppRoute.venue(key: venueKey)) {
                        rowLabel(show.venue, detail: "Venue page", symbol: "building.columns", outward: false)
                    })
                }
            }
            .padding(.horizontal, Space.x3)
            .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
        }
    }

    private func linkRow<V: View>(_ content: V) -> some View {
        content.buttonStyle(.plain)
    }

    private func rowLabel(_ title: String, detail: String, symbol: String, outward: Bool) -> some View {
        HStack(spacing: Space.x3) {
            Image(systemName: symbol).foregroundStyle(Color.brand).frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(2)
                Text(detail)
                    .font(.jakarta(size: 12, relativeTo: .caption))
                    .foregroundStyle(Color.textSecondary)
            }
            Spacer(minLength: Space.x2)
            Image(systemName: outward ? "arrow.up.forward.square" : "chevron.right")
                .font(.footnote)
                .foregroundStyle(Color.textMuted)
                .accessibilityHidden(true)
        }
        .frame(minHeight: TouchTarget.minimum + 8)
        .contentShape(Rectangle())
    }
}

// MARK: - Header

/// "SAT, NOV 8, 2026 · FALL TOUR", the band, the venue and city, and the
/// festival it was part of.
struct ShowHeader: View {
    let date: String
    let tour: String?
    let artist: String
    let venue: String
    let city: String
    let state: String?
    let festival: String?
    /// The band's page (Stage 4, 4-5); the name links to it when given.
    var bandSlug: String? = nil
    /// The festival's page (Stage 5, 5-3): the attendance id the show
    /// points at. The badge opens it when given.
    var festivalId: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x1) {
            Text(kicker)
                .font(.jakarta(size: 13, weight: .bold, relativeTo: .footnote))
                .tracking(0.4)
                .foregroundStyle(Color.amber)
            if let bandSlug {
                NavigationLink(value: AppRoute.band(slug: bandSlug)) {
                    HStack(alignment: .firstTextBaseline, spacing: Space.x2) {
                        Text(artist)
                            .font(.jakarta(size: 30, weight: .heavy, relativeTo: .largeTitle))
                            .foregroundStyle(Color.textPrimary)
                            .multilineTextAlignment(.leading)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(Color.textMuted)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isHeader)
                .accessibilityHint("Opens the band's page")
            } else {
                Text(artist.isEmpty ? "Unknown band" : artist)
                    .font(.jakarta(size: 30, weight: .heavy, relativeTo: .largeTitle))
                    .foregroundStyle(Color.textPrimary)
                    .accessibilityAddTraits(.isHeader)
            }
            if !place.isEmpty {
                Text(place)
                    .font(.jakarta(size: 15, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
            }
            if let festival {
                if let festivalId {
                    NavigationLink(value: AppRoute.festival(id: festivalId)) { festivalBadge(festival) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Part of \(festival)")
                    .accessibilityHint("Opens the festival")
                } else {
                    festivalBadge(festival)
                        .accessibilityLabel("Part of \(festival)")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func festivalBadge(_ name: String) -> some View {
        HStack(spacing: Space.x1) {
            Label(name, systemImage: "tent")
            if festivalId != nil {
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold))
            }
        }
        .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
        .foregroundStyle(Color.amber)
        .padding(.horizontal, Space.x3)
        .padding(.vertical, Space.x1)
        .background(Color.amberSubtle, in: Capsule())
        .padding(.top, Space.x1)
    }

    private var kicker: String {
        let day = ShowDateText.date(date).map { $0.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year()) }
            ?? (date.isEmpty ? "No date" : date)
        return [day, tour].compactMap { $0 }.joined(separator: " · ").uppercased()
    }

    /// "Red Rocks Amphitheatre · Morrison, CO".
    private var place: String {
        var town = city.trimmingCharacters(in: .whitespaces)
        if let state = state?.trimmingCharacters(in: .whitespaces), !state.isEmpty, !town.hasSuffix(state) {
            town = town.isEmpty ? state : "\(town), \(state)"
        }
        return [venue.trimmingCharacters(in: .whitespaces), town].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

// MARK: - Ratings and note

/// Your show rating, venue rating and note: each changes one field.
struct YourRatingsCard: View {
    @Environment(ShowsStore.self) private var store
    let show: Show
    let editNote: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your show rating")
                        .font(.jakarta(size: 13, relativeTo: .footnote))
                        .foregroundStyle(Color.textSecondary)
                    RatingFigure(rating: show.rating, size: 22)
                }
                Spacer()
                RatingMenu(title: "Show rating", rating: show.rating) { rate(.rating, $0) }
            }
            Divider().overlay(Color.borderSubtle)
            HStack {
                Text("Venue rating")
                    .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                    .foregroundStyle(Color.textPrimary)
                Spacer()
                RatingFigure(rating: show.venueRating, size: 15)
                RatingMenu(title: "Venue rating", rating: show.venueRating) { rate(.venueRating, $0) }
            }
            Divider().overlay(Color.borderSubtle)
            note
        }
        .brandCard(radius: Radius.xl2)
    }

    @ViewBuilder private var note: some View {
        if let comment = show.comment {
            Button(action: editNote) {
                HStack(alignment: .top, spacing: Space.x2) {
                    Image(systemName: "text.bubble").foregroundStyle(Color.textMuted)
                    Text(comment)
                        .italic()
                        .font(.jakarta(size: 15, relativeTo: .body))
                        .foregroundStyle(Color.textSecondary)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Your note: \(comment)")
            .accessibilityHint("Edit your note")
        } else {
            Button(action: editNote) {
                Label("Add a note", systemImage: "square.and.pencil")
                    .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                    .frame(minHeight: TouchTarget.minimum)
            }
            .tint(.brand)
        }
    }

    private func rate(_ field: ShowField, _ value: Int?) {
        // 1–10 or nil from the menu: never refused.
        if case .success(let change) = ShowFieldEdit.rating(field, value) {
            store.update(change, showId: show.id)
        }
    }
}

/// "★ 8/10" in amber, or "Not rated".
struct RatingFigure: View {
    let rating: Int?
    let size: CGFloat

    var body: some View {
        if let rating {
            Text("★ \(rating)/10")
                .font(.jakarta(size: size, weight: .bold, relativeTo: size > 18 ? .title3 : .body))
                .monospacedDigit()
                .foregroundStyle(Color.amber)
        } else {
            Text("Not rated")
                .font(.jakarta(size: size > 18 ? 17 : 15, relativeTo: .body))
                .foregroundStyle(Color.textMuted)
        }
    }
}

/// A 1–10 picker for one rating, with "No rating" to clear it.
struct RatingMenu: View {
    let title: String
    let rating: Int?
    let onChange: (Int?) -> Void

    var body: some View {
        Menu {
            Picker(title, selection: Binding(get: { rating }, set: { onChange($0) })) {
                ForEach((1...10).reversed(), id: \.self) { n in Text("\(n)").tag(Int?.some(n)) }
                Text("No rating").tag(Int?.none)
            }
            .pickerStyle(.inline)
        } label: {
            Text(rating == nil ? "Rate" : "Change")
                .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
                .padding(.horizontal, Space.x3)
                .frame(minHeight: 36)
                .overlay(Capsule().strokeBorder(Color.borderActive))
                .contentShape(Capsule())
        }
        .frame(minHeight: TouchTarget.minimum)
        .tint(.textPrimary)
        .accessibilityLabel(title)
        .accessibilityValue(rating.map { "\($0) out of 10" } ?? "Not rated")
    }
}

/// The show's note (`comment`): saved as typed, trimmed; empty removes it.
struct NoteEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @FocusState private var focused: Bool
    let original: String
    let onSave: (String) -> Void

    init(note: String, onSave: @escaping (String) -> Void) {
        _text = State(initialValue: note)
        original = note
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .font(.jakarta(size: 17, relativeTo: .body))
                .focused($focused)
                .scrollContentBackground(.hidden)
                .padding(Space.x4)
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("What do you want to remember about this show?")
                            .font(.jakarta(size: 17, relativeTo: .body))
                            .foregroundStyle(Color.textMuted)
                            .padding(.horizontal, Space.x5)
                            .padding(.vertical, Space.x6)
                            .allowsHitTesting(false)
                    }
                }
                .brandBackground()
                .navigationTitle(original.isEmpty ? "Add a note" : "Your note")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            if text.trimmingCharacters(in: .whitespacesAndNewlines) != original { onSave(text) }
                            dismiss()
                        }
                    }
                }
                .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Setlist

/// The setlist by set and encore: tap a song to rate it, long-press to
/// edit (the Stage 1 mockup). Every change is one `SetlistEdit`.
struct SetlistSection: View {
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    let show: Show
    let source: SetlistSourceAnswer?
    @Binding var undo: DeletedSong?
    let reviewStoredProposal: () -> Void
    var bandSongs: (band: PublicBand, slugs: BandSongSlugs)? = nil

    @State private var editingSong: Song?
    @State private var addingSong = false
    @State private var ratingUnrated = false

    var body: some View {
        let groups = SetGroups.group(show.setlist)
        let options = SetlistEdits.setOptions(existing: groups.map(\.label))
        VStack(alignment: .leading, spacing: Space.x4) {
            if show.setlistProposal?.status == "pending" {
                Notice(title: "A setlist is waiting for your review",
                       text: "A setlist from \(sourceName(show.setlistProposal?.source)) was found for this show. Your ratings and comments are kept if you accept it.",
                       symbol: "tray.and.arrow.down", tint: .amber, action: ("Review", reviewStoredProposal))
            }
            if show.needsReview == true, show.setlistSource == "archive" {
                Notice(title: "Check this setlist",
                       text: "The Internet Archive's recordings of this show don't agree on the setlist, so one was picked. You can edit any song.",
                       symbol: "exclamationmark.bubble", tint: .amber,
                       action: ("It looks right", { store.markSetlistReviewed(showId: show.id) }))
            }

            if groups.isEmpty {
                VStack(alignment: .leading, spacing: Space.x2) {
                    Text("No setlist yet")
                        .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                        .foregroundStyle(Color.textPrimary)
                    if let hint = source?.resync.offered == true ? source?.resync.hint : nil {
                        Text(hint).font(.jakarta(size: 13, relativeTo: .footnote)).foregroundStyle(Color.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .brandCard(radius: Radius.xl2)
            } else {
                let numbers = Self.numbers(groups)
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: Space.x2) {
                        Text(group.label.uppercased())
                            .font(.jakarta(size: 13, weight: .bold, relativeTo: .footnote))
                            .tracking(0.8)
                            .foregroundStyle(Color.brandLight)
                            .accessibilityAddTraits(.isHeader)
                        VStack(spacing: 0) {
                            ForEach(Array(group.songs.enumerated()), id: \.element.id) { index, song in
                                SongRow(number: numbers[song.id] ?? index + 1, song: song) { editingSong = song }
                                    .contextMenu { songMenu(song, group: group, index: index, options: options) }
                                if index < group.songs.count - 1 { Divider().overlay(Color.borderSubtle) }
                            }
                        }
                        .padding(.vertical, Space.x1)
                        .padding(.horizontal, Space.x3)
                        .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
                    }
                }
                if store.isSavingSetlist(showId: show.id) {
                    // Until the queued edits land: online it keeps retrying;
                    // offline they wait on this phone for the connection.
                    HStack(spacing: Space.x2) {
                        if Connectivity.shared.isOnline {
                            ProgressView().controlSize(.small)
                            Text("Saving…")
                        } else {
                            Image(systemName: "icloud.and.arrow.up").foregroundStyle(Color.amber)
                            Text("Saved on this iPhone. It syncs when you're back online.")
                        }
                    }
                    .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                    .foregroundStyle(Color.textSecondary)
                    .accessibilityElement(children: .combine)
                } else {
                    Text("Tap a song to rate it · Touch and hold for its history and edits")
                        .font(.jakarta(size: 12, relativeTo: .caption))
                        .foregroundStyle(Color.textMuted)
                }
            }

            HStack(spacing: Space.x3) {
                Button { addingSong = true } label: { Label("Add a song", systemImage: "plus") }
                if show.setlist.contains(where: { $0.rating == nil }) {
                    Button { ratingUnrated = true } label: { Label("Rate unrated", systemImage: "star") }
                }
            }
            .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
            .buttonStyle(.bordered)
            .tint(.brand)

            if let notes = show.setlistNotes {
                Text(notes)
                    .font(.jakarta(size: 13, relativeTo: .footnote))
                    .foregroundStyle(Color.textSecondary)
                    .padding(Space.x3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.surfaceHover, in: RoundedRectangle.brand(Radius.lg))
            }

            SetlistCredit(show: show, source: source)
        }
        .sheet(item: $editingSong) { song in SongSheet(showId: show.id, song: song) }
        .sheet(isPresented: $addingSong) { AddSongSheet(showId: show.id, options: options, defaultSet: groups.last?.label ?? "Set I") }
        .sheet(isPresented: $ratingUnrated) {
            RateUnratedSheet(showId: show.id, count: show.setlist.filter { $0.rating == nil }.count)
        }
    }

    @ViewBuilder
    private func songMenu(_ song: Song, group: SetGroups.Group, index: Int, options: [String]) -> some View {
        Button { editingSong = song } label: { Label(song.rating == nil ? "Rate and comment" : "Change rating or comment", systemImage: "star") }
        // Your history with this song (Stage 4, 4-4).
        if SongIndex.key(artist: show.artist, title: song.name) != nil {
            Button { router.push(.song(artist: SongIndex.artistSlug(show.artist), song: SongIndex.songSlug(song.name))) } label: {
                Label("Your history with this song", systemImage: "music.note")
            }
        }
        if let bandSongs, let slug = bandSongs.slugs.slug(for: song.name) {
            Button { router.push(.bandSong(band: bandSongs.band.slug, song: slug)) } label: {
                Label("\(bandSongs.band.name) stats for this song", systemImage: "chart.bar")
            }
        }
        Button { move(group.label, index, -1) } label: { Label("Move up", systemImage: "arrow.up") }
            .disabled(index == 0)
        Button { move(group.label, index, 1) } label: { Label("Move down", systemImage: "arrow.down") }
            .disabled(index == group.songs.count - 1)
        Menu {
            ForEach(options.filter { $0 != group.label }, id: \.self) { label in
                Button(label) { Task { await store.editSetlist(showId: show.id) { .reorder(setlist: SetlistEdits.moveSong($0, songId: song.id, toSet: label)) } } }
            }
        } label: { Label("Move to set", systemImage: "arrow.left.arrow.right") }
        Divider()
        Button(role: .destructive) { delete(song) } label: { Label("Delete song", systemImage: "trash") }
    }

    private func move(_ label: String, _ index: Int, _ direction: Int) {
        Task { await store.editSetlist(showId: show.id) { .reorder(setlist: SetlistEdits.moveSong($0, inSet: label, at: index, by: direction)) } }
    }

    private func delete(_ song: Song) {
        Task {
            let result = await store.editSetlist(showId: show.id, .delete(songId: song.id))
            if let removed = result?.removed, let index = result?.index, index >= 0 {
                undo = DeletedSong(song: removed, index: index, name: song.name)
            }
        }
    }

    /// Songs are numbered through the whole show, in playing order.
    static func numbers(_ groups: [SetGroups.Group]) -> [String: Int] {
        var out: [String: Int] = [:]
        var n = 0
        for song in groups.flatMap(\.songs) {
            n += 1
            if out[song.id] == nil { out[song.id] = n }
        }
        return out
    }

    private func sourceName(_ id: String?) -> String {
        if id == "archive" { return "the Internet Archive" }
        return source?.source.label ?? "the band's archive"
    }
}

/// One song: its number, title and segue mark, a cover's original artist,
/// a band source's footnote, jam chart and debut marks, and your rating
/// and comment. Tapping it opens the rating sheet.
struct SongRow: View {
    let number: Int
    let song: Song
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .firstTextBaseline, spacing: Space.x3) {
                Text("\(number)")
                    .font(.jakarta(size: 13, relativeTo: .footnote))
                    .monospacedDigit()
                    .foregroundStyle(Color.textMuted)
                    .frame(minWidth: 20, alignment: .trailing)
                VStack(alignment: .leading, spacing: 2) {
                    (Text(song.name.isEmpty ? "Untitled" : song.name).foregroundStyle(Color.textPrimary)
                     + Text(segue.map { " \($0)" } ?? "").foregroundStyle(Color.brandLight).fontWeight(.bold))
                        .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                    let marks = self.marks
                    if !marks.isEmpty {
                        Text(marks.joined(separator: " · "))
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textMuted)
                    }
                    if let footnote = song.footnote, !footnote.isEmpty {
                        Text(footnote)
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textSecondary)
                    }
                    if let comment = song.comment {
                        Text(comment)
                            .italic()
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textSecondary)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: Space.x2)
                if let rating = song.rating {
                    Text("★ \(rating)")
                        .font(.jakarta(size: 13, weight: .bold, relativeTo: .footnote))
                        .monospacedDigit()
                        .foregroundStyle(Color.amber)
                } else {
                    Text("Rate")
                        .font(.jakarta(size: 13, relativeTo: .footnote))
                        .foregroundStyle(Color.textMuted)
                }
            }
            .padding(.vertical, Space.x2)
            .frame(minHeight: TouchTarget.minimum)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Rate this song. Touch and hold for more.")
    }

    /// A segue to the next song: the mark the band source recorded ('>' and
    /// '->' differ to the people who keep these archives), or '>'.
    private var segue: String? {
        guard song.tape == true else { return nil }
        if let mark = song.transitionMark, !mark.isEmpty { return mark }
        return ">"
    }

    private var marks: [String] {
        var out: [String] = []
        if let cover = song.cover { out.append("\(cover) cover") }
        if song.debut == true { out.append("Debut") }
        if song.jamchart == true { out.append(song.jamchartNote.map { "Jam chart: \($0)" } ?? "Jam chart") }
        if song.manuallyAdded == true { out.append("Added by you") }
        return out
    }
}

/// The setlist's source, linked: setlist.fm's terms require it wherever its
/// data is shown; band archives are volunteer-run and get the same credit.
struct SetlistCredit: View {
    let show: Show
    let source: SetlistSourceAnswer?

    static let setlistfmHome = URL(string: "https://www.setlist.fm/")!

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x1) {
            if let fm = setlistfm {
                credit("Source: ", link: fm.text, url: fm.url)
            } else if let band = bandSource {
                if show.setlistSource == "archive" {
                    credit("Setlist from a tape on ", link: "the \(band.label)", url: band.url,
                           after: "\(show.sourceShowId.map { ", recording \($0)" } ?? ""). Tape setlists can be incomplete.")
                } else {
                    credit("Setlist via ", link: band.label, url: band.url)
                }
            }
            if let change = show.setlistSourceChange, show.setlistSource == "archive", change.to == "archive", change.songsChanged == false {
                let was = change.from.flatMap { $0 == "archive" ? nil : $0 }
                Text("Now sourced from the Internet Archive\(was.map { " (was \(label(for: $0)))" } ?? ""). The songs didn't change.")
                    .font(.jakarta(size: 12, relativeTo: .caption))
                    .foregroundStyle(Color.textMuted)
            }
        }
    }

    /// A sentence with the source's name linked (opened in Safari).
    private func credit(_ before: String, link: String, url: URL?, after: String = "") -> some View {
        var name = AttributedString(link)
        if let url {
            name.link = url
            name.underlineStyle = .single
        }
        return Text(AttributedString(before) + name + AttributedString(after))
            .font(.jakarta(size: 12, relativeTo: .caption))
            .foregroundStyle(Color.textMuted)
            .tint(Color.textSecondary)
    }

    /// A setlist.fm show: a setlist.fm id and no band source (an absent
    /// source means setlist.fm; shows before 5.33.0 have none).
    private var setlistfm: (text: String, url: URL)? {
        guard show.setlistfmId != nil, show.setlistSource == nil || show.setlistSource == "setlistfm" else { return nil }
        let stored = show.setlistfmUrl.flatMap(URL.init(string:))
        let url = stored.flatMap { ["setlist.fm", "www.setlist.fm"].contains($0.host?.lowercased() ?? "") && $0.scheme == "https" ? $0 : nil }
        return (show.artist.isEmpty ? "setlist on setlist.fm" : "\(show.artist) setlist on setlist.fm", url ?? Self.setlistfmHome)
    }

    /// A band source's name and the show's own page there.
    private var bandSource: (label: String, url: URL?)? {
        guard let id = show.setlistSource, id != "setlistfm", !show.setlist.isEmpty else { return nil }
        var url = show.sourcePermalink.flatMap(URL.init(string:))
        if url == nil, id == "archive", let item = show.sourceShowId,
           let encoded = item.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) {
            url = URL(string: "https://archive.org/details/\(encoded)")
        }
        if url == nil { url = source?.stored?.homeUrl.flatMap(URL.init(string:)) }
        return (label(for: id), url)
    }

    private func label(for id: String) -> String {
        if let stored = source?.stored, stored.id == id { return stored.label }
        switch id {
        case "archive": return "Internet Archive"
        case "setlistfm": return "setlist.fm"
        default: return id
        }
    }
}

/// A boxed message above the setlist.
struct Notice: View {
    let title: String
    let text: String
    let symbol: String
    let tint: Color
    var action: (label: String, run: () -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: Space.x3) {
            Image(systemName: symbol).foregroundStyle(tint).imageScale(.large).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Space.x2) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                        .foregroundStyle(Color.textPrimary)
                    Text(text)
                        .font(.jakarta(size: 13, relativeTo: .footnote))
                        .foregroundStyle(Color.textSecondary)
                }
                .accessibilityElement(children: .combine)
                if let action {
                    Button(action.label, action: action.run)
                        .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                        .buttonStyle(.borderedProminent)
                        .tint(.brand)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(Space.x3)
        .background(Color.surfaceHover, in: RoundedRectangle.brand(Radius.xl))
    }
}

// MARK: - Waiting to sync

/// A show added on this device that the server hasn't built yet: what was
/// typed or picked, read-only, until it syncs (STAGE1-AUDIT §4).
struct QueuedShowDetail: View {
    @Environment(ShowsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let entry: QueuedShow
    @State private var flow = AddFlow()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x5) {
                ShowHeader(date: entry.display.date, tour: nil, artist: entry.display.artist, venue: entry.display.venue,
                           city: entry.display.city, state: nil, festival: nil)
                switch entry.state {
                case .queued:
                    Notice(title: "Waiting to sync",
                           text: "Saved on this iPhone. It finishes saving when you're back online. Then you can rate it, add a note and see its setlist.",
                           symbol: "icloud.and.arrow.up", tint: .amber)
                case .needsAnswer:
                    Notice(title: "Already logged?",
                           text: store.possibleDuplicateQuestion(entry, existingId: entry.possibleDuplicateOf),
                           symbol: "questionmark.circle", tint: .amber,
                           action: ("Add as a separate show", {
                               flow.run { await store.answerPossibleDuplicate(showId: entry.showId, addAnyway: true) ?? .refused("That show isn't waiting any more.") }
                           }))
                    Button("Don't add", role: .destructive) { store.discardQueuedShow(showId: entry.showId); dismiss() }
                case .failed:
                    Notice(title: "Couldn't be added", text: entry.problem ?? "The server didn't accept this show.",
                           symbol: "exclamationmark.triangle", tint: .amber,
                           action: ("Delete", { store.discardQueuedShow(showId: entry.showId); dismiss() }))
                }
            }
            .padding(.horizontal, Space.x5)
            .padding(.top, Space.x2)
            .padding(.bottom, Space.x8)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(entry.display.artist)
        .toolbar { ToolbarItem(placement: .principal) { Text("").accessibilityHidden(true) } }
        .addOutcomeHandling(flow) { _ in }
    }
}
