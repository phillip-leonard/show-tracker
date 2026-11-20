import FirebaseAuth
import FirebaseCore
import FirebaseCrashlytics
import FirebaseFirestore
import Foundation
import Observation
import UIKit

/// The signed-in person's shows, upcoming shows and server stats, kept live.
///
/// - Shows: `users/{uid}/shows`, the whole collection, as the web reads it
///   (no query, so no index). Upcoming: `users/{uid}/upcomingShows`.
///   Numbers: `userStats/{uid}`, which only the server writes (CLAUDE.md).
/// - Firestore's offline persistence is on, so the first snapshot usually
///   comes from the cache at once, with no spinner; the live one follows.
/// - Loading always ends (`LiveLoad`, lib/liveShows.js): a deadline on the
///   first snapshot, then one read with a deadline of its own.
/// - Guests are anonymous accounts with a uid, so this is the same for them.
/// - Edits (Part 3a) write one field at a time (`ShowFieldEdit`), and a
///   delete removes the document; the listener shows both at once, online
///   or not (Firestore applies a write to the cache before the server has
///   it). Each is followed by `recompute-my-stats`, debounced 3 s, as on
///   the web.
@MainActor
@Observable
public final class ShowsStore {
    public private(set) var uid: String?
    public private(set) var shows: [Show] = [] {
        // The song index is built again from the new list when next read.
        didSet { songIndexCache = nil; runsCache = nil; toursCache = nil }
    }
    public private(set) var upcoming: [UpcomingShow] = []
    public private(set) var stats: UserStats?
    /// The first answer for `userStats/{uid}` has arrived (a document or
    /// none). Stats waits for it, never longer than the listener's first
    /// cached or server answer.
    public private(set) var statsLoaded = false
    /// The numbers on screen came from this device's cache.
    public private(set) var statsFromCache = false
    private var askedForStats = false

    /// The first answer for the shows (live, cached, or the one-time read)
    /// has arrived, or loading gave up. Never false for longer than ~25 s.
    public private(set) var showsLoaded = false
    public private(set) var upcomingLoaded = false
    /// The shows on screen came from this device's cache (offline, or the
    /// server hasn't answered yet).
    public private(set) var fromCache = false
    /// Loading ended with nothing to show and an error.
    public private(set) var loadProblem: String?
    /// The last pull to refresh didn't reach the server.
    public private(set) var refreshProblem: String?
    /// Shows added on this device that the server hasn't built yet
    /// (`ShowOutbox`), oldest first.
    public internal(set) var queued: [QueuedShow] = []
    /// The server refused the last edit or delete (it stays on screen until
    /// the listener brings the stored value back).
    public var writeProblem: String?
    /// `songIndex`, built once per list of shows and day.
    @ObservationIgnored var songIndexCache: (today: String, index: [String: SongIndex.Entry])?
    /// `runs` and `tours`, built once per list of shows (Stage 4, 4-6).
    @ObservationIgnored var runsCache: [RunIndex.Run]?
    @ObservationIgnored var toursCache: [String: TourIndex.Tour]?

    private var showsLoad: LiveLoad<Snapshot<Show>>?
    private var upcomingLoad: LiveLoad<Snapshot<UpcomingShow>>?
    private var statsListener: ListenerRegistration?
    private var reportedDecodeFailure = false
    var api: APIClient?
    private var sources: SetlistSourceCache?
    private var recompute: Task<Void, Never>?
    private var festivalNames: [String: String] = [:]
    /// Song edits not yet applied to the stored setlist, oldest first
    /// (`SetlistEditQueue`, saved to a file on every change).
    public private(set) var queuedEdits: [QueuedSetlistEdit] = []
    /// This device's copy of a show's setlist while edits of it wait, so the
    /// screen shows them at once and doesn't flick back before the stored
    /// setlist has them (`mergeShowsSnapshot` in lib/liveShows.js).
    private var pendingSetlists: [String: (raw: [JSONValue], songs: [Song])] = [:]
    private var settleTasks: [String: Task<Void, Never>] = [:]
    private var flushing = false
    private var flushAgain = false
    private var flushHooksInstalled = false
    /// Adds (Part 4): the outbox flush, one run at a time.
    var outboxFlushing = false
    var outboxFlushAgain = false
    /// The running flushes, so `sendQueued` can wait for them.
    var outboxTask: Task<Void, Never>?
    private var editsTask: Task<Void, Never>?
    /// Shows just added, until the listener has them (the page waits).
    public internal(set) var justAdded: Set<String> = []
    /// The id of a show that was this person's first (Stage 4): a guest's
    /// first show opens the account prompt, as on the web. Taken once with
    /// `takeFirstShow(_:)`.
    var firstShowId: String?

    struct Snapshot<T> {
        var items: [T]
        var fromCache: Bool
        var undecodable: Int
    }

    public init() {}

    /// Starts (or restarts, for a different person) the listeners. `api`
    /// is for the functions an edit calls (`recompute-my-stats`) and the
    /// show page asks (`setlist-source`).
    public func start(uid: String, api: APIClient? = nil) {
        if let api {
            self.api = api
            if sources == nil { sources = SetlistSourceCache(api: api) }
        }
        guard uid != self.uid else { return }
        stop()
        self.uid = uid
        queued = ShowOutbox.load(uid: uid)
        queuedEdits = SetlistEditQueue.load(uid: uid)
        installFlushHooks()
        Task {
            await attach(uid: uid)
            await rebuildOverlays(uid: uid)
            flushEdits()
            flushOutbox()
        }
    }

    /// Stops listening and forgets everything (sign-out, another person).
    public func stop() {
        showsLoad?.stop(); showsLoad = nil
        upcomingLoad?.stop(); upcomingLoad = nil
        statsListener?.remove(); statsListener = nil
        uid = nil
        shows = []
        upcoming = []
        stats = nil
        statsLoaded = false
        statsFromCache = false
        askedForStats = false
        showsLoaded = false
        upcomingLoaded = false
        fromCache = false
        loadProblem = nil
        refreshProblem = nil
        queued = []
        writeProblem = nil
        festivalNames = [:]
        recompute?.cancel(); recompute = nil
        queuedEdits = []
        justAdded = []
        firstShowId = nil
        outboxFlushAgain = false
        pendingSetlists = [:]
        settleTasks.values.forEach { $0.cancel() }
        settleTasks = [:]
        flushAgain = false
    }

    /// The show, with this device's setlist while an edit of it is in flight.
    public func show(id: String) -> Show? {
        guard var show = shows.first(where: { $0.id == id }) else { return nil }
        if let pending = pendingSetlists[id] { show.setlist = pending.songs }
        return show
    }

    /// A show still in this device's outbox. Once the server has built it,
    /// the stored show (same id) is the one to open.
    public func queuedShow(id: String) -> QueuedShow? {
        guard show(id: id) == nil else { return nil }
        return queued.first { $0.showId == id }
    }
    public func upcomingShow(id: String) -> UpcomingShow? { upcoming.first { $0.id == id } }

    // MARK: Listening

    private func attach(uid: String) async {
        let db = await Database.ready()
        guard self.uid == uid else { return }
        let showsRef = db.collection("users").document(uid).collection("shows")
        let upcomingRef = db.collection("users").document(uid).collection("upcomingShows")

        let showsLoad = LiveLoad<Snapshot<Show>>()
        self.showsLoad = showsLoad
        showsLoad.start(
            subscribe: { next, fail in Self.listen(showsRef, decode: { try $0.decodeShow() }, next: next, fail: fail) },
            readOnce: { Self.snapshot(try await showsRef.getDocuments(), decode: { try $0.decodeShow() }) },
            onValue: { [weak self] snap in
                guard let self, self.uid == uid else { return }
                self.shows = snap.items
                self.fromCache = snap.fromCache
                self.settlePendingSetlists()
                self.noteUndecodable(snap.undecodable, collection: "shows")
            },
            onLoaded: { [weak self] outcome in
                guard let self, self.uid == uid else { return }
                self.showsLoaded = true
                if case .failed(let message) = outcome, self.shows.isEmpty { self.loadProblem = message }
            },
            onError: { error, stage in Self.log(error, stage: "shows \(stage)") }
        )

        let upcomingLoad = LiveLoad<Snapshot<UpcomingShow>>()
        self.upcomingLoad = upcomingLoad
        upcomingLoad.start(
            subscribe: { next, fail in Self.listen(upcomingRef, decode: { try $0.decodeUpcomingShow() }, next: next, fail: fail) },
            readOnce: { Self.snapshot(try await upcomingRef.getDocuments(), decode: { try $0.decodeUpcomingShow() }) },
            onValue: { [weak self] snap in
                guard let self, self.uid == uid else { return }
                self.upcoming = snap.items
                self.noteUndecodable(snap.undecodable, collection: "upcomingShows")
            },
            onLoaded: { [weak self] _ in
                guard let self, self.uid == uid else { return }
                self.upcomingLoaded = true
            },
            onError: { error, stage in Self.log(error, stage: "upcoming \(stage)") }
        )

        statsListener = db.document("userStats/\(uid)").addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, error in
            MainActor.assumeIsolated {
                guard let self, self.uid == uid else { return }
                if let error { Self.log(error, stage: "userStats") }
                guard let snapshot else { self.statsLoaded = true; return }
                self.statsFromCache = snapshot.metadata.isFromCache
                // Absent until the server's first recompute; the header shows
                // the count from the list and leaves the rest out.
                if snapshot.exists, let stats = try? snapshot.data(as: UserStats.self) {
                    self.stats = stats
                } else if !snapshot.metadata.isFromCache, !self.askedForStats {
                    // The server says there's none yet (a new account, or a
                    // guest who hasn't added a show): ask once, as the web does.
                    self.askedForStats = true
                    self.requestStatsRecompute()
                }
                self.statsLoaded = true
            }
        }
    }

    private static func listen<T>(_ ref: CollectionReference, decode: @escaping (QueryDocumentSnapshot) throws -> T,
                                  next: @escaping @MainActor (Snapshot<T>) -> Void,
                                  fail: @escaping @MainActor (Error) -> Void) -> () -> Void {
        // Metadata changes too, so "from the cache" clears when the server
        // answers with the same documents.
        let registration = ref.addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
            MainActor.assumeIsolated {
                if let snapshot { next(Self.snapshot(snapshot, decode: decode)) } else if let error { fail(error) }
            }
        }
        return { registration.remove() }
    }

    private static func snapshot<T>(_ query: QuerySnapshot, decode: (QueryDocumentSnapshot) throws -> T) -> Snapshot<T> {
        var items: [T] = []
        var undecodable = 0
        // Firestore returns documents by id, the order ShowList keeps for ties.
        for doc in query.documents {
            if let item = try? decode(doc) { items.append(item) } else { undecodable += 1 }
        }
        return Snapshot(items: items, fromCache: query.metadata.isFromCache, undecodable: undecodable)
    }

    // MARK: Pull to refresh

    /// Reads both lists from the server (not the cache), with a deadline.
    /// The listeners would bring the same; this is for "is it up to date?".
    public func refresh() async {
        guard let uid else { return }
        refreshProblem = nil
        flushOutbox()
        flushEdits()
        let db = await Database.ready()
        let base = db.collection("users").document(uid)
        do {
            let shows = try await withDeadline(.seconds(10)) { try await base.collection("shows").getDocuments(source: .server) }
            let upcoming = try await withDeadline(.seconds(10)) { try await base.collection("upcomingShows").getDocuments(source: .server) }
            guard self.uid == uid else { return }
            let s = Self.snapshot(shows, decode: { try $0.decodeShow() })
            self.shows = s.items
            self.fromCache = false
            self.showsLoaded = true
            self.loadProblem = nil
            self.upcoming = Self.snapshot(upcoming, decode: { try $0.decodeUpcomingShow() }).items
            self.upcomingLoaded = true
        } catch {
            guard self.uid == uid else { return }
            refreshProblem = "Couldn't reach the server. Showing the shows saved on this device."
            Self.log(error, stage: "refresh")
        }
    }

    // MARK: Editing

    /// Writes one field of one show (`updateData` of that field only).
    /// The listener has the new value at once; the server gets it when it
    /// can (Firestore queues it offline, across a force-quit).
    public func update(_ change: ShowFieldChange, showId: String) {
        guard let uid else { return }
        writeProblem = nil
        Task { [weak self] in
            let db = await Database.ready()
            guard self?.uid == uid else { return }
            // Resolves when the server has it: offline, this task waits
            // (the listener already shows the change) and nothing blocks.
            do {
                try await db.collection("users").document(uid).collection("shows").document(showId)
                    .updateData(change.firestoreData)
                // Your friends' feed: the server reads the stored rating,
                // so only once it's there (as the web's logRating).
                if case .set(.rating, _) = change { await self?.logRating(showId: showId) }
            } catch {
                guard let self, self.uid == uid else { return }
                self.writeProblem = "That change wasn't saved. \(error.localizedDescription)"
                Self.log(error, stage: "update \(change.field.rawValue)")
            }
        }
        requestStatsRecompute()
    }

    /// Asks `friends.js` for the "rated" entry (Stage 6, 6-6). Accounts
    /// only; best effort, never shown as an error on the rating. The
    /// server checks "Show my activity to friends".
    private func logRating(showId: String) async {
        guard let api, FirebaseApp.app() != nil, Auth.auth().currentUser?.isAnonymous == false else { return }
        do {
            _ = try await api.post(FriendsRequest.function, FriendsRequest.rated(showId: showId), as: JSONValue.self)
        } catch {
            Self.log(error, stage: "rated")
        }
    }

    /// "It looks right" on an Archive setlist the recordings disagreed on:
    /// `needsReview: false, needsReviewReason: null`, as the web writes it
    /// (one `updateData` of those two fields only).
    public func markSetlistReviewed(showId: String) {
        guard let uid else { return }
        writeProblem = nil
        Task { [weak self] in
            let db = await Database.ready()
            guard self?.uid == uid else { return }
            do {
                try await db.collection("users").document(uid).collection("shows").document(showId)
                    .updateData(["needsReview": false, "needsReviewReason": NSNull()])
            } catch {
                guard let self, self.uid == uid else { return }
                self.writeProblem = "That change wasn't saved. \(error.localizedDescription)"
                Self.log(error, stage: "needsReview")
            }
        }
    }

    /// Deletes the show document. The web also rewrites the legacy profile
    /// counters; the native app never does (CLAUDE.md: nothing trusts them).
    public func delete(showId: String) {
        guard let uid else { return }
        writeProblem = nil
        Task { [weak self] in
            let db = await Database.ready()
            guard self?.uid == uid else { return }
            do {
                try await db.collection("users").document(uid).collection("shows").document(showId).delete()
            } catch {
                guard let self, self.uid == uid else { return }
                self.writeProblem = "The show wasn't deleted. \(error.localizedDescription)"
                Self.log(error, stage: "delete")
            }
        }
        requestStatsRecompute()
    }

    // MARK: Setlist edits

    /// Applies a song edit (`SetlistEdit`): on this device's copy at once,
    /// then queued (`SetlistEditQueue`, saved to a file) and replayed in
    /// order as a transaction against the setlist as stored, so another
    /// device's rating made meanwhile is kept. Online it lands straight away,
    /// retrying while the server is slow; offline it waits for the
    /// connection, across a force-quit. The whole setlist is never written
    /// from this device's copy. Returns the edit's result on this device (a
    /// delete's `removed` and `index`, for the undo), or nil when the
    /// setlist couldn't be read.
    @discardableResult
    public func editSetlist(showId: String, _ edit: SetlistEdit) async -> SetlistEditResult? {
        await editSetlist(showId: showId) { _ in edit }
    }

    /// An edit built from this device's copy of the setlist: the set
    /// editor's moves (`SetlistEdits.moveSong`), sent as a `.reorder` that
    /// the transaction applies to the stored copy.
    @discardableResult
    public func editSetlist(showId: String, building build: ([JSONValue]) -> SetlistEdit) async -> SetlistEditResult? {
        guard let uid else { return nil }
        let base: [JSONValue]
        if let pending = pendingSetlists[showId]?.raw {
            base = pending
        } else if let stored = await storedSetlist(showId: showId, uid: uid, serverIfNotCached: true) {
            base = stored
        } else {
            if self.uid == uid { writeProblem = "That change wasn't saved: the setlist couldn't be read." }
            return nil
        }
        guard self.uid == uid else { return nil }
        let edit = build(base)
        let result = SetlistEdits.apply(base, edit)
        guard result.changed else { return result }

        pendingSetlists[showId] = (result.setlist, Self.songs(result.setlist))
        settleTasks[showId]?.cancel()
        queuedEdits.append(QueuedSetlistEdit(showId: showId, edit: edit))
        saveQueue(uid: uid)
        flushEdits()
        requestStatsRecompute()
        return result
    }

    /// Song edits of this show are waiting to land ("Saving…", or, offline,
    /// "Saved on this iPhone").
    public func isSavingSetlist(showId: String) -> Bool { queuedEdits.contains { $0.showId == showId } }

    /// Every song edit waiting, on any show (the sign-out warning reads the file).
    public var queuedEditCount: Int { queuedEdits.count }

    /// Replays the queue (`SetlistEditReplay`), one transaction at a time, in
    /// order. One run at a time; a request during a run starts another after it.
    public func flushEdits() {
        guard let uid else { return }
        guard !flushing else { flushAgain = true; return }
        flushing = true
        editsTask = Task { [weak self] in
            guard let self else { return }
            repeat {
                self.flushAgain = false
                let db = await Database.ready()
                guard self.uid == uid else { break }
                await SetlistEditReplay.run(
                    next: { self.uid == uid ? self.queuedEdits.first : nil },
                    canRun: { self.uid == uid && Connectivity.shared.isOnline },
                    attempt: { entry in
                        guard let edit = entry.setlistEdit else { return .landed }
                        let ref = db.collection("users").document(uid).collection("shows").document(entry.showId)
                        return await Self.transactionOrOffline(edit, on: ref)
                    },
                    landed: { entry in self.finish(entry, uid: uid) },
                    gaveUp: { entry, error in
                        self.writeProblem = error is SetlistTransaction.Failure
                            ? "A change to a setlist wasn't saved: it has data the app can't read."
                            : "A change to a setlist wasn't saved. \(error.localizedDescription)"
                        Self.log(error, stage: "setlist edit given up")
                        self.finish(entry, uid: uid, landed: false)
                    },
                    failed: { error, n in Self.log(error, stage: "setlist transaction attempt \(n)") }
                )
            } while self.flushAgain && self.uid == uid
            self.flushing = false
        }
    }

    /// Sends everything this phone is holding for the account (queued adds
    /// and song edits) and waits for it, then returns how many are still
    /// waiting: offline, a show waiting for an answer, or one the server
    /// refused. Before a guest's shows move to another account
    /// (`SessionStore.startAdoption`), so nothing is left behind.
    public func sendQueued() async -> Int {
        flushEdits()
        flushOutbox()
        await editsTask?.value
        await outboxTask?.value
        return queued.count + queuedEdits.count
    }

    /// Replays when the phone gets its connection back and when the app
    /// returns to the foreground (installed once).
    private func installFlushHooks() {
        guard !flushHooksInstalled else { return }
        flushHooksInstalled = true
        Connectivity.shared.onReconnect { [weak self] in self?.flushEdits(); self?.flushOutbox() }
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.flushEdits(); self?.flushOutbox() }
        }
    }

    /// An entry is done: out of the queue (and the file). When it was the
    /// show's last, this device's copy is kept until the listener has the
    /// stored setlist (at most 3 s). An edit given up is taken off this
    /// device's copy too.
    private func finish(_ entry: QueuedSetlistEdit, uid: String, landed: Bool = true) {
        guard self.uid == uid else { return }
        queuedEdits.removeAll { $0.id == entry.id }
        saveQueue(uid: uid)
        if !landed {
            Task { await self.rebuildOverlay(showId: entry.showId, uid: uid) }
            return
        }
        guard !isSavingSetlist(showId: entry.showId) else { return }
        settleTasks[entry.showId]?.cancel()
        settleTasks[entry.showId] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled, let self, !self.isSavingSetlist(showId: entry.showId) else { return }
            self.pendingSetlists[entry.showId] = nil
            self.settleTasks[entry.showId] = nil
        }
        settlePendingSetlists()
    }

    /// At launch: this device's copy of every show with queued edits, from
    /// the cached setlist with those edits on top.
    private func rebuildOverlays(uid: String) async {
        for showId in Set(queuedEdits.map(\.showId)) { await rebuildOverlay(showId: showId, uid: uid) }
    }

    private func rebuildOverlay(showId: String, uid: String) async {
        let edits = queuedEdits.filter { $0.showId == showId }
        guard !edits.isEmpty else { pendingSetlists[showId] = nil; return }
        guard let stored = await storedSetlist(showId: showId, uid: uid, serverIfNotCached: false), self.uid == uid else { return }
        let overlay = SetlistEditQueue.overlay(stored, queuedEdits.filter { $0.showId == showId })
        pendingSetlists[showId] = (overlay, Self.songs(overlay))
    }

    /// The setlist as stored: the cached copy, or (when asked) the server's
    /// within 10 s. Nil when neither can be read.
    private func storedSetlist(showId: String, uid: String, serverIfNotCached: Bool) async -> [JSONValue]? {
        let db = await Database.ready()
        let ref = db.collection("users").document(uid).collection("shows").document(showId)
        if let cached = try? await ref.getDocument(source: .cache), cached.exists,
           let list = SetlistTransaction.setlist(in: cached.data()) {
            return list
        }
        guard serverIfNotCached,
              let fresh = try? await withDeadline(.seconds(10), { try await ref.getDocument() }), fresh.exists else { return nil }
        return SetlistTransaction.setlist(in: fresh.data())
    }

    private func saveQueue(uid: String) {
        do { try SetlistEditQueue.save(queuedEdits, uid: uid) } catch { Self.log(error, stage: "setlist edit queue file") }
    }

    /// One transaction attempt, or `.wentOffline` as soon as the phone loses
    /// its network path while it runs (a transaction can't finish offline).
    /// An attempt cut off that way may still land later; replaying it is
    /// harmless (the fixtures' rules).
    static func transactionOrOffline(_ edit: SetlistEdit, on ref: DocumentReference) async -> SetlistEditReplay.Outcome {
        let once = Once()
        return await withCheckedContinuation { (continuation: CheckedContinuation<SetlistEditReplay.Outcome, Never>) in
            let watch = Task { @MainActor in
                await Connectivity.shared.waitUntilOffline()
                if !Task.isCancelled, once.claim() { continuation.resume(returning: .wentOffline) }
            }
            Task { @MainActor in
                let result: SetlistEditReplay.Outcome
                do { _ = try await SetlistTransaction.run(edit, on: ref); result = .landed } catch { result = .failed(error) }
                watch.cancel()
                if once.claim() { continuation.resume(returning: result) }
            }
        }
    }

    /// Drops this device's copy once nothing waits and the stored setlist matches it.
    private func settlePendingSetlists() {
        for (id, pending) in pendingSetlists where !isSavingSetlist(showId: id) {
            if shows.first(where: { $0.id == id })?.setlist == pending.songs {
                pendingSetlists[id] = nil
                settleTasks[id]?.cancel()
                settleTasks[id] = nil
            }
        }
    }

    /// A song typed in on the show page, as the web adds one: a fresh id,
    /// `manuallyAdded`, unrated.
    public static func newSong(name: String, set: String, id: String = ShowID.mint()) -> JSONValue {
        .object([
            "id": .string(id), "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
            "set": .string(set), "manuallyAdded": .bool(true), "rating": .null,
        ])
    }

    static func songs(_ raw: [JSONValue]) -> [Song] {
        guard let data = try? JSONEncoder().encode(raw) else { return [] }
        return (try? JSONDecoder().decode([Song].self, from: data)) ?? []
    }

    // MARK: Setlist operations

    /// The server's setlist operations (re-sync, propose, accept, reject).
    public var setlistOps: SetlistOps? { api.map { SetlistOps(api: $0) } }

    /// A setlist operation wrote on the server: the listener brings the
    /// setlist; the stats follow.
    public func noteSetlistChangedOnServer() { requestStatsRecompute() }

    /// `recompute-my-stats`, 3 s after the last change (the web's debounce),
    /// so `userStats/{uid}` (and the header's numbers) follow. Offline it
    /// fails quietly; the 6-hourly `community-stats` job catches up.
    func requestStatsRecompute() {
        recompute?.cancel()
        guard let api else { return }
        recompute = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            do { try await api.post("recompute-my-stats", [String: String]()) } catch {
                Self.log(error, stage: "recompute-my-stats")
            }
        }
    }

    // MARK: What the show page asks

    /// `setlist-source` for this show's band, cached for the session.
    public func setlistSource(for show: Show) async -> SetlistSourceAnswer? {
        await sources?.answer(for: show)
    }

    /// The festival this show is part of, by name: the person's attendance
    /// record (`users/{uid}/festivals/{festivalId}`) points at the shared
    /// `festivals/{id}`, which holds the name; an older record has its own.
    public func festivalName(for show: Show) async -> String? {
        guard let uid, let festivalId = show.festivalId else { return show.festivalName }
        if let known = festivalNames[festivalId] { return known }
        let db = await Database.ready()
        do {
            let attendance = try await withDeadline(.seconds(10)) {
                try await db.collection("users").document(uid).collection("festivals").document(festivalId).getDocument()
            }
            var name = attendance.data()?["name"] as? String
            if let canonicalId = attendance.data()?["festivalId"] as? String, !canonicalId.isEmpty {
                let canonical = try await withDeadline(.seconds(10)) {
                    try await db.collection("festivals").document(canonicalId).getDocument()
                }
                name = (canonical.data()?["name"] as? String) ?? name
            }
            let found = name?.trimmingCharacters(in: .whitespaces)
            guard self.uid == uid else { return nil }
            if let found, !found.isEmpty { festivalNames[festivalId] = found; return found }
        } catch {
            Self.log(error, stage: "festival")
        }
        return show.festivalName
    }

    // MARK: Reporting

    private func noteUndecodable(_ count: Int, collection: String) {
        guard count > 0, !reportedDecodeFailure else { return }
        reportedDecodeFailure = true
        // A model that doesn't read a production document is a bug in the
        // model (DECISIONS.md, "Data"); counts only, no document content.
        Crashlytics.crashlytics().record(error: NSError(domain: "ShowsStore.decode", code: count, userInfo: [
            NSLocalizedDescriptionKey: "\(count) \(collection) document(s) didn't decode",
        ]))
    }

    static func log(_ error: Error, stage: String) {
        Crashlytics.crashlytics().log("ShowsStore \(stage): \(error.localizedDescription)")
    }
}

extension ShowFieldChange {
    /// The `updateData` payload: exactly one key.
    public var firestoreData: [String: Any] {
        switch self {
        case .set(let field, let value): [field.rawValue: value.firestoreValue]
        case .remove(let field): [field.rawValue: FieldValue.delete()]
        }
    }
}

extension JSONValue {
    /// As Firestore stores it: whole numbers as integers.
    var firestoreValue: Any {
        switch self {
        case .null: NSNull()
        case .bool(let b): b
        case .number(let n): n.rounded() == n && abs(n) < 9e15 ? Int(n) : n
        case .string(let s): s
        case .array(let a): a.map(\.firestoreValue)
        case .object(let o): o.mapValues(\.firestoreValue)
        }
    }
}
