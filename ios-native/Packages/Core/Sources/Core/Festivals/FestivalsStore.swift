import FirebaseFirestore
import Foundation
import Observation

/// What `festival-lineup` answers (5.60.36): the shared lineup (fetched
/// from Ticketmaster first when the festival is upcoming and the stored
/// copy is old), and the caller's picks (Stage 5, 5-4).
public struct FestivalLineupAnswer: Decodable, Equatable, Sendable {
    public var lineup: [String]
    /// "ticketmaster", "seed" (the announced lineup) or nil.
    public var source: String?
    public var url: String?
    public var upcoming: Bool?

    public init(lineup: [String], source: String?, url: String?, upcoming: Bool?) {
        self.lineup = lineup; self.source = source; self.url = url; self.upcoming = upcoming
    }
}

/// The signed-in account's festivals (Stage 5, 5-3): each attendance record
/// joined to its shared festival, as the web's `loadFestivals` builds them.
/// Read from the device's copy first, so the list shows at once offline,
/// then from the server. Accounts only: guests can't have festivals.
///
/// Writes:
///   - notes and the typed lineup: one `updateData` of the person's own
///     record (works offline; Firestore sends it later)
///   - leave (and, in 5-4, create, join, edit): `festivals.js`, which
///     needs a connection
///   - attaching and removing shows: `ShowsStore.setFestival`
@MainActor
@Observable
public final class FestivalsStore {
    /// Nil until the first read answers (the device's copy or the server's).
    public private(set) var festivals: [Festival]?
    /// The server couldn't be reached; what's shown is the device's copy.
    public private(set) var fromCache = false
    /// Nothing could be read at all.
    public private(set) var loadProblem: String?

    private var uid: String?
    private var api: APIClient?
    private var loadTask: Task<Void, Never>?

    public init() {}

    public func festival(id: String) -> Festival? { festivals?.first { $0.id == id } }

    /// The festival a show is attached to, by its attendance id.
    public func name(forAttendanceId id: String?) -> String? {
        guard let id else { return nil }
        return festival(id: id)?.name
    }

    public func start(uid: String, api: APIClient) {
        guard self.uid != uid else { return }
        stop()
        self.uid = uid
        self.api = api
        reload()
    }

    public func stop() {
        loadTask?.cancel()
        loadTask = nil
        uid = nil
        api = nil
        festivals = nil
        fromCache = false
        loadProblem = nil
    }

    /// Reads again: the device's copy at once, then the server's.
    public func reload() {
        guard let uid else { return }
        loadTask?.cancel()
        loadTask = Task { [weak self] in await self?.load(uid: uid) }
    }

    /// Waits for a reload to finish (pull to refresh).
    public func refresh() async {
        reload()
        await loadTask?.value
    }

    static let deadline: Duration = .seconds(10)

    private func load(uid: String) async {
        let db = await Database.ready()
        let records = db.collection("users").document(uid).collection("festivals")

        // The device's copy first, so the list never waits on the network.
        if festivals == nil, let cached = try? await records.getDocuments(source: .cache), !cached.documents.isEmpty {
            let list = await Self.join(cached.documents, uid: uid, db: db, source: .cache)
            guard self.uid == uid, !Task.isCancelled else { return }
            if festivals == nil { festivals = list; fromCache = true }
        }

        do {
            let snap = try await withDeadline(Self.deadline) { try await records.getDocuments(source: .server) }
            let list = await Self.join(snap.documents, uid: uid, db: db, source: .default)
            guard self.uid == uid, !Task.isCancelled else { return }
            festivals = list
            fromCache = false
            loadProblem = nil
        } catch {
            guard self.uid == uid, !Task.isCancelled else { return }
            if festivals == nil {
                // Nothing on the device either: an empty cache read is still an answer.
                if let cached = try? await records.getDocuments(source: .cache) {
                    festivals = await Self.join(cached.documents, uid: uid, db: db, source: .cache)
                    fromCache = true
                    if festivals?.isEmpty == true { loadProblem = "Couldn't load your festivals. Check your connection and try again." }
                } else {
                    loadProblem = "Couldn't load your festivals. Check your connection and try again."
                }
            } else {
                fromCache = true
            }
        }
    }

    /// Each record joined to its shared festival (read from `source`, with
    /// a deadline); a shared festival that can't be read marks the record
    /// unavailable rather than dropping it, as on the web.
    private static func join(_ docs: [QueryDocumentSnapshot], uid: String, db: Firestore, source: FirestoreSource) async -> [Festival] {
        var out: [Festival] = []
        for doc in docs {
            let data = doc.data()
            guard let festivalId = data["festivalId"] as? String, !festivalId.isEmpty else {
                out.append(Festival.joined(attendanceId: doc.documentID, attendance: data, canonical: nil, uid: uid))
                continue
            }
            let ref = db.collection("festivals").document(festivalId)
            var canonical: [String: Any]?
            if source == .cache {
                canonical = (try? await ref.getDocument(source: .cache))?.data()
            } else {
                canonical = (try? await withDeadline(deadline) { try await ref.getDocument() })?.data()
                if canonical == nil { canonical = (try? await ref.getDocument(source: .cache))?.data() }
            }
            out.append(Festival.joined(attendanceId: doc.documentID, attendance: data, canonical: canonical, uid: uid))
        }
        return out
    }

    // MARK: Writing

    /// Saves this person's notes for a festival: one `updateData` of their
    /// own record. On screen at once; offline, Firestore sends it later.
    public func saveNotes(_ notes: String, festivalId id: String) async throws {
        guard let uid else { return }
        let text = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let before = festival(id: id)?.notes
        setLocal(id) { $0.notes = text }
        let db = await Database.ready()
        let ref = db.collection("users").document(uid).collection("festivals").document(id)
        do {
            // Not awaited past a short wait: offline, the write is queued and
            // the change already shows.
            try await withDeadline(.seconds(4)) {
                try await ref.updateData(["notes": text, "updatedAt": FieldValue.serverTimestamp()])
            }
        } catch is DeadlineError {
            return
        } catch {
            if let before { setLocal(id) { $0.notes = before } }
            throw error
        }
    }

    /// Leaves a festival (`festivals.js` `leave`): every attached show is
    /// kept and detached on the server, the record goes, the shared
    /// festival stays. Needs a connection.
    public func leave(festivalId id: String) async throws(APIError) {
        guard let api else { throw .signInRequired(message: nil) }
        struct Body: Encodable, Sendable { let action = "leave"; let attendanceId: String }
        try await api.post("festivals", Body(attendanceId: id))
        festivals?.removeAll { $0.id == id }
    }

    /// The shared lineup (`festival-lineup`, attendees only). Nil when it
    /// can't be reached: the page keeps what the festival already holds.
    public func lineup(for festival: Festival) async -> FestivalLineupAnswer? {
        guard let api, let canonical = festival.festivalId else { return nil }
        struct Body: Encodable, Sendable { let festivalId: String }
        guard let answer = try? await api.post("festival-lineup", Body(festivalId: canonical), as: FestivalLineupAnswer.self) else { return nil }
        setLocal(festival.id) {
            if !answer.lineup.isEmpty {
                $0.lineup = answer.lineup
                $0.lineupSource = answer.source
                $0.lineupUrl = answer.url
            }
        }
        return answer
    }

    private func setLocal(_ id: String, _ change: (inout Festival) -> Void) {
        guard let i = festivals?.firstIndex(where: { $0.id == id }) else { return }
        change(&festivals![i])
    }
}

public extension ShowsStore {
    /// Attaches shows to a festival (its attendance id), or with nil
    /// removes them from whichever festival they're on: one batch of
    /// `updateData(["festivalId": …])`, that field alone (R-06), as the
    /// web's attach and detach write it. The listener shows it at once;
    /// offline, Firestore sends it later.
    func setFestival(_ attendanceId: String?, showIds: [String]) async throws {
        guard let uid, !showIds.isEmpty else { return }
        let db = await Database.ready()
        let batch = db.batch()
        for id in showIds {
            batch.updateData(["festivalId": attendanceId ?? NSNull()],
                             forDocument: db.collection("users").document(uid).collection("shows").document(id))
        }
        do {
            try await withDeadline(.seconds(4)) { try await batch.commit() }
        } catch is DeadlineError {
            // Queued offline; the listener already has it.
        }
    }
}
