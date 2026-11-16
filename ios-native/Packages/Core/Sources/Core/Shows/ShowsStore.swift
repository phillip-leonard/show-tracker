import FirebaseCrashlytics
import FirebaseFirestore
import Foundation
import Observation

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
@MainActor
@Observable
public final class ShowsStore {
    public private(set) var uid: String?
    public private(set) var shows: [Show] = []
    public private(set) var upcoming: [UpcomingShow] = []
    public private(set) var stats: UserStats?

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

    private var showsLoad: LiveLoad<Snapshot<Show>>?
    private var upcomingLoad: LiveLoad<Snapshot<UpcomingShow>>?
    private var statsListener: ListenerRegistration?
    private var reportedDecodeFailure = false

    struct Snapshot<T> {
        var items: [T]
        var fromCache: Bool
        var undecodable: Int
    }

    public init() {}

    /// Starts (or restarts, for a different person) the listeners.
    public func start(uid: String) {
        guard uid != self.uid else { return }
        stop()
        self.uid = uid
        Task { await attach(uid: uid) }
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
        showsLoaded = false
        upcomingLoaded = false
        fromCache = false
        loadProblem = nil
        refreshProblem = nil
    }

    public func show(id: String) -> Show? { shows.first { $0.id == id } }
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

        statsListener = db.document("userStats/\(uid)").addSnapshotListener { [weak self] snapshot, _ in
            MainActor.assumeIsolated {
                guard let self, self.uid == uid else { return }
                // Absent until the server's first recompute; the header shows
                // the count from the list and leaves the rest out.
                if let snapshot, snapshot.exists, let stats = try? snapshot.data(as: UserStats.self) {
                    self.stats = stats
                }
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

    private static func log(_ error: Error, stage: String) {
        Crashlytics.crashlytics().log("ShowsStore \(stage): \(error.localizedDescription)")
    }
}
