import FirebaseFirestore
import Foundation

/// What adding a show came to (`ShowsStore.addShow`).
public enum AddOutcome: Equatable, Sendable {
    /// The server built it (or had it already from an earlier try).
    case added(showId: String)
    /// The same show is already logged (setlist.fm id, or band, day and venue).
    case alreadyThere(showId: String)
    /// Same band and day at another venue: the person decides
    /// (`answerPossibleDuplicate`). Nothing is written yet.
    case possibleDuplicate(showId: String, question: String)
    /// Saved on this phone; it finishes when the server can be reached.
    case queued(showId: String)
    /// The server refused it; nothing was saved.
    case refused(String)
}

/// What saving an upcoming show came to.
public enum UpcomingSaveOutcome: Equatable, Sendable {
    case saved(id: String)
    /// The form's message (`UpcomingShowRules.problem`).
    case problem(String)
    /// The same band on the same day is already listed.
    case duplicate(existingId: String)
}

// Adding shows (Stage 1, Part 4): every new show is an input sent to
// `normalize-show`, never a document built here (CLAUDE.md, 5.60.6). The
// input goes into the outbox file first (`ShowOutbox`), keyed by a minted
// show id, so an add made offline, or cut off by a force-quit, is sent
// again later and the server's document replaces the "Waiting to sync"
// row. A retry after a lost answer is safe: the server answers
// `alreadyNormalized` for a show it already built under that id.
extension ShowsStore {
    public var setlistfmSearch: SetlistfmSearch? { api.map(SetlistfmSearch.init(api:)) }
    public var ticketScan: TicketScan? { api.map(TicketScan.init(api:)) }

    /// Adds a show: into the outbox, then committed. `display` is what the
    /// "Waiting to sync" row shows until the server has it.
    public func addShow(_ input: ShowInput, display: QueuedShow.Display) async -> AddOutcome {
        guard let uid else { return .refused("Sign in to add shows.") }
        var input = input
        if input.showId == nil { input.showId = ShowID.mint() }
        let showId = input.showId!
        queued.append(QueuedShow(showId: showId, input: input, display: display, enqueuedAt: Date()))
        saveOutbox(uid: uid)
        return await commit(showId: showId, uid: uid, interactive: true)
    }

    /// The answer to "Add this as a separate show?": yes sends it again with
    /// `confirmPossible`; no drops it.
    public func answerPossibleDuplicate(showId: String, addAnyway: Bool) async -> AddOutcome? {
        guard let uid, let i = queued.firstIndex(where: { $0.showId == showId }) else { return nil }
        guard addAnyway else { discardQueuedShow(showId: showId); return nil }
        queued[i].input.confirmPossible = true
        queued[i].state = .queued
        queued[i].possibleDuplicateOf = nil
        saveOutbox(uid: uid)
        return await commit(showId: showId, uid: uid, interactive: true)
    }

    /// Takes a show out of the outbox without sending it.
    public func discardQueuedShow(showId: String) {
        guard let uid else { return }
        queued.removeAll { $0.showId == showId }
        saveOutbox(uid: uid)
    }

    /// Queued shows not yet built by the server (the list's "Waiting to sync" rows).
    public var waitingShows: [QueuedShow] { queued.filter { show(id: $0.showId) == nil } }

    /// A show just added, until the listener has it: its page waits rather
    /// than saying "not found".
    public func isAwaitingNewShow(id: String) -> Bool { justAdded.contains(id) && show(id: id) == nil }

    /// Sends every queued add, in order, one at a time; stops when offline.
    /// At launch, on reconnect, on return to the foreground, on pull to refresh.
    public func flushOutbox() {
        guard let uid, api != nil else { return }
        guard !outboxFlushing else { outboxFlushAgain = true; return }
        outboxFlushing = true
        outboxTask = Task { [weak self] in
            guard let self else { return }
            repeat {
                self.outboxFlushAgain = false
                for entry in self.queued where entry.state == .queued {
                    guard self.uid == uid, Connectivity.shared.isOnline else { break }
                    if case .queued = await self.commit(showId: entry.showId, uid: uid, interactive: false) { break }
                }
            } while self.outboxFlushAgain && self.uid == uid
            self.outboxFlushing = false
        }
    }

    /// One commit of one queued input, and what it means for the entry.
    func commit(showId: String, uid: String, interactive: Bool) async -> AddOutcome {
        guard let entry = queued.first(where: { $0.showId == showId }), let api else { return .queued(showId: showId) }
        let verdict: CommitVerdict
        do {
            let r = try await api.post("normalize-show", NormalizeShowRequest.one(entry.input, .commit), as: NormalizeShowResult.self)
            verdict = Self.verdict(r, showId: showId)
        } catch {
            verdict = Self.verdict(error)
            if verdict == .wait { Self.log(error, stage: "normalize-show") }
        }
        guard self.uid == uid else { return .queued(showId: showId) }
        switch verdict {
        case .added(let id):
            if Self.isFirstShow(id, loaded: showsLoaded, existing: shows.map(\.id)) { firstShowId = id }
            finishAdd(entry, uid: uid)
            justAdded.insert(id)
            requestStatsRecompute()
            return .added(showId: id)
        case .alreadyThere(let id):
            finishAdd(entry, uid: uid)
            return .alreadyThere(showId: id)
        case .needsAnswer(let existing):
            updateQueued(showId, uid: uid) { $0.state = .needsAnswer; $0.possibleDuplicateOf = existing }
            return .possibleDuplicate(showId: showId, question: possibleDuplicateQuestion(entry, existingId: existing))
        case .refused(let text, let dropsInput):
            if dropsInput {
                if interactive { discardQueuedShow(showId: showId) } else {
                    updateQueued(showId, uid: uid) { $0.state = .failed; $0.problem = text }
                }
            }
            return .refused(text)
        case .wait:
            return .queued(showId: showId)
        }
    }

    /// A show the server just built was this person's first: their shows
    /// had loaded and held no other. Before they load, nobody can tell.
    nonisolated static func isFirstShow(_ id: String, loaded: Bool, existing: [String]) -> Bool {
        loaded && existing.allSatisfy { $0 == id }
    }

    /// True once for the show that was this person's first (`isFirstShow`),
    /// then false: the add flow asks, and a guest gets the account prompt.
    public func takeFirstShow(_ id: String) -> Bool {
        guard firstShowId == id else { return false }
        firstShowId = nil
        return true
    }

    /// What one commit's answer means for its outbox entry.
    enum CommitVerdict: Equatable {
        /// Built (created, updated, or already built under this id by an earlier try).
        case added(String)
        /// Matched a show already logged; nothing new.
        case alreadyThere(String)
        /// A possible duplicate: the person decides.
        case needsAnswer(existing: String?)
        /// Refused. `dropsInput`: the input itself is wrong (a 4xx), so it
        /// leaves the outbox (or is marked failed); otherwise it stays.
        case refused(String, dropsInput: Bool)
        /// Offline, the server unreachable or busy, a daily limit: try again later.
        case wait
    }

    nonisolated static func verdict(_ r: NormalizeShowResult, showId: String) -> CommitVerdict {
        if let merged = r.mergedInto { return .alreadyThere(merged) }
        if r.needsConfirmation == true { return .needsAnswer(existing: r.duplicate?.showId) }
        return .added(r.showId ?? showId)
    }

    nonisolated static func verdict(_ error: APIError) -> CommitVerdict {
        switch error {
        case .server(let status, let message, _) where (400..<500).contains(status) && status != 408:
            return .refused(message ?? "That show couldn't be added.", dropsInput: true)
        case .signInRequired(let message), .accountRequired(let message):
            // The input is fine; the session isn't. It stays queued.
            return .refused(message ?? "Sign in again to add shows.", dropsInput: false)
        default:
            return .wait
        }
    }

    /// The server has the show: out of the outbox. "I went" also takes the
    /// upcoming show off the list now that the server has read it.
    private func finishAdd(_ entry: QueuedShow, uid: String) {
        queued.removeAll { $0.showId == entry.showId }
        saveOutbox(uid: uid)
        if case .upcoming(let upcomingId, _, _) = entry.input.kind { deleteUpcoming(id: upcomingId) }
    }

    private func updateQueued(_ showId: String, uid: String, _ change: (inout QueuedShow) -> Void) {
        guard let i = queued.firstIndex(where: { $0.showId == showId }) else { return }
        change(&queued[i])
        saveOutbox(uid: uid)
    }

    func saveOutbox(uid: String) {
        do { try ShowOutbox.save(queued, uid: uid) } catch { Self.log(error, stage: "outbox file") }
    }

    /// The web's question (lib/showAdd.js possibleDuplicateQuestion).
    public func possibleDuplicateQuestion(_ entry: QueuedShow, existingId: String?) -> String {
        let existing = existingId.flatMap { show(id: $0) }
        let place = { (venue: String, city: String) -> String in
            let s = [venue, city].filter { !$0.isEmpty }.joined(separator: ", ")
            return s.isEmpty ? "another venue" : s
        }
        let band = existing?.artist ?? (entry.display.artist.isEmpty ? "this band" : entry.display.artist)
        let date = Self.readableDay(entry.display.date) ?? (entry.display.date.isEmpty ? "this date" : entry.display.date)
        let at = existing.map { place($0.venue, $0.city) } ?? "another venue"
        return "You already have \(band) on \(date) at \(at).\n\nAdd \(place(entry.display.venue, entry.display.city)) as a separate show?"
    }

    /// "Nov 15, 2026" for an ISO day, on this phone's calendar.
    static func readableDay(_ iso: String) -> String? {
        let parts = ShowDate.isoDay(iso).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let date = Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return nil }
        return date.formatted(.dateTime.month(.abbreviated).day().year())
    }

    // MARK: Upcoming shows (written directly, field by field; DECISIONS "Stage 1")

    private func upcomingCollection(_ uid: String) async -> CollectionReference {
        await Database.ready().collection("users").document(uid).collection("upcomingShows")
    }

    /// A new upcoming show (`newUpcomingRecord`), or why it can't be saved.
    public func addUpcoming(_ input: UpcomingInput) async -> UpcomingSaveOutcome {
        guard let uid else { return .problem("Sign in to add shows.") }
        if let problem = UpcomingShowRules.problem(input) { return .problem(problem) }
        if let existing = UpcomingShowRules.duplicate(of: input, in: upcoming) { return .duplicate(existingId: existing.id) }
        let ref = await upcomingCollection(uid).document()
        let doc = Self.firestoreData(UpcomingShowRules.newRecord(input, now: .null), timestamps: ["createdAt", "updatedAt"])
        guard self.uid == uid else { return .problem("Sign in to add shows.") }
        Task { [weak self] in
            do { try await ref.setData(doc) } catch { self?.writeProblem = "The upcoming show wasn't saved. \(error.localizedDescription)" }
        }
        return .saved(id: ref.documentID)
    }

    /// An edit (`upcomingUpdate`): every field, so a cleared one is cleared.
    public func updateUpcoming(id: String, _ input: UpcomingInput) async -> UpcomingSaveOutcome {
        guard let uid else { return .problem("Sign in to edit shows.") }
        if let problem = UpcomingShowRules.problem(input) { return .problem(problem) }
        if let existing = UpcomingShowRules.duplicate(of: input, in: upcoming.filter { $0.id != id }) {
            return .duplicate(existingId: existing.id)
        }
        let ref = await upcomingCollection(uid).document(id)
        let doc = Self.firestoreData(UpcomingShowRules.update(input, now: .null), timestamps: ["updatedAt"])
        let tagged = !(upcomingShow(id: id)?.taggedFriendUids.isEmpty ?? true)
        Task { [weak self] in
            do {
                try await ref.updateData(doc)
                // Friends who haven't answered yet answer about the new date
                // and venue: the server rebuilds their tags (5.60.29).
                if tagged { await self?.tellServer(.refreshUpcomingTags(upcomingId: id)) }
            } catch { self?.writeProblem = "That change wasn't saved. \(error.localizedDescription)" }
        }
        return .saved(id: id)
    }

    public func deleteUpcoming(id: String) {
        guard let uid else { return }
        let tagged = !(upcomingShow(id: id)?.taggedFriendUids.isEmpty ?? true)
        Task { [weak self] in
            do {
                try await self?.upcomingCollection(uid).document(id).delete()
                // Tags nobody has answered are taken back (5.60.29).
                if tagged { await self?.tellServer(.revokeUpcomingTags(upcomingId: id, toUid: nil)) }
            } catch {
                self?.writeProblem = "The upcoming show wasn't deleted. \(error.localizedDescription)"
            }
        }
    }

    /// A best-effort `friends.js` call after an upcoming show changed.
    private func tellServer(_ request: FriendsRequest) async {
        _ = try? await api?.post(FriendsRequest.function, request, as: JSONValue.self)
    }

    /// "I went": the night's setlist.fm setlist when there is one, then
    /// `normalize-show` kind `upcoming`, which builds the show from the
    /// upcoming one; the upcoming show leaves the list once the server has it.
    public func markAttended(_ show: UpcomingShow) async -> AddOutcome {
        let found = await setlistfmSearch?.setlist(artist: show.artist, date: show.date, venue: show.venue)
        let input = ShowInput(.upcoming(upcomingId: show.id, setlistfmId: found?.id, .none))
        return await addShow(input, display: .init(artist: show.artist, venue: show.venue, city: show.city, date: ShowDate.isoDay(show.date)))
    }

    /// A document for Firestore, with `serverTimestamp()` in the named fields.
    static func firestoreData(_ doc: [String: JSONValue], timestamps: [String]) -> [String: Any] {
        var out = doc.mapValues(\.firestoreValue)
        for key in timestamps { out[key] = FieldValue.serverTimestamp() }
        return out
    }
}
