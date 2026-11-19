import FirebaseFirestore
import Foundation

// Stage 5, 5-4: creating, joining and editing a festival (festivals.js),
// the typed lineup, picks (festival-lineup), the "is this one of these?"
// lookup (match-festivals) and the lineup search with its import
// (search-festival-lineup, then normalize-show).

// MARK: - Picks

/// "Your picks": the lineup ranked on the server with lib/recommendations.js
/// (Stage 5 call B), from the caller's shows, followed bands and "not
/// interested" list.
public struct FestivalPicks: Decodable, Equatable, Sendable {
    public struct Recommended: Decodable, Equatable, Sendable, Identifiable {
        public var key: String
        public var name: String
        /// "Because you like Goose".
        public var reason: String
        public var id: String { key }
    }
    public struct Loved: Decodable, Equatable, Sendable, Identifiable {
        public var key: String
        public var name: String
        public var timesSeen: Int
        public var favorite: Bool
        public var id: String { key }

        /// "Seen 3 times · you follow them", "You follow them".
        public var detail: String {
            guard timesSeen > 0 else { return "You follow them" }
            return "Seen \(timesSeen) time\(timesSeen == 1 ? "" : "s")" + (favorite ? " · you follow them" : "")
        }
    }
    public struct Other: Decodable, Equatable, Sendable, Identifiable {
        public var key: String
        public var name: String
        public var seenOnce: Bool
        public var id: String { key }
    }

    public var recommended: [Recommended]
    public var love: [Loved]
    public var everyoneElse: [Other]

    public var isEmpty: Bool { recommended.isEmpty && love.isEmpty && everyoneElse.isEmpty }
}

// MARK: - "Is this one of these?"

/// A festival someone already added that looks like the one being created
/// (`match-festivals`): its public fields, best match first.
public struct FestivalMatch: Decodable, Equatable, Sendable, Identifiable {
    public struct Candidate: Decodable, Equatable, Sendable {
        public var id: String
        public var name: String
        public var startDate: String?
        public var endDate: String?
        public var year: Int?
        public var location: String?
        public var source: String?

        public var isSeeded: Bool { source == "seed" }
    }
    public var festival: Candidate
    public var sameLocation: Bool?
    public var id: String { festival.id }
}

/// What the create form holds.
public struct FestivalDraft: Equatable, Sendable {
    public var name = ""
    /// ISO days (the form's date pickers).
    public var startDate = ""
    public var endDate = ""
    /// "I don't know the exact dates": the year stands in for both.
    public var yearOnly = false
    public var year = ""
    public var location = ""
    public var notes = ""

    public init() {}

    /// The form's error, or nil when it can be sent (the web's `validate`;
    /// the server checks again).
    public var problem: String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Give your festival a name." }
        if trimmed.count > FestivalDates.nameMax {
            return "Festival name is too long (\(trimmed.count) characters, max \(FestivalDates.nameMax))."
        }
        if yearOnly {
            return when == nil ? "Enter the year as four digits, from \(FestivalDates.minYear) to \(FestivalDates.maxYear)." : nil
        }
        if startDate.isEmpty || endDate.isEmpty { return "Add the start and end dates, or turn on “I don’t know the exact dates”." }
        if endDate < startDate { return "End date can’t be before the start date." }
        return nil
    }

    /// Both dates and their year, or only the year (`festivalWhenFields`).
    public var when: FestivalDates.When? {
        yearOnly ? FestivalDates.whenFields(startDate: nil, endDate: nil, year: year)
            : FestivalDates.whenFields(startDate: startDate, endDate: endDate, year: nil)
    }

    /// Enough to look for matches: a name and a start date (or a year).
    public var canMatch: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (yearOnly ? when != nil : !startDate.isEmpty)
    }
}

// MARK: - The lineup search

/// One set from `search-festival-lineup`: setlist.fm's setlist, flattened.
/// `raw` is sent back as a `festival-row` input's `row`, unchanged.
public struct LineupSet: Decodable, Equatable, Sendable, Identifiable {
    public var setlistfmId: String
    public var artist: String
    /// ISO.
    public var date: String
    public var venue: String
    public var city: String
    public var songCount: Int
    public var raw: JSONValue
    public var id: String { setlistfmId }

    public init(from decoder: Decoder) throws {
        let json = try JSONValue(from: decoder)
        raw = json
        setlistfmId = json["setlistfmId"]?.stringValue ?? ""
        artist = json["artist"]?.stringValue ?? ""
        date = json["date"]?.stringValue ?? ""
        venue = json["venue"]?.stringValue ?? ""
        city = json["city"]?.stringValue ?? ""
        songCount = json["songCount"]?.intValue ?? 0
    }

    /// "Already logged": the same setlist.fm id, or band, venue and day
    /// (the web's `isLogged`). The import's real check is the server's.
    public func isLogged(in shows: [Show]) -> Bool {
        let key = { (s: String) in s.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) }
        return shows.contains { show in
            (show.setlistfmId != nil && show.setlistfmId == setlistfmId)
                || (key(show.artist) == key(artist) && key(show.venue) == key(venue) && show.date == date)
        }
    }
}

public struct LineupSearchAnswer: Decodable, Sendable {
    public var results: [LineupSet]
}

public enum FestivalLineupSearch {
    /// The query the web sends: the festival's own name, city and dates
    /// (or its year), and a band for "By artist".
    public static func query(_ f: Festival, artist: String?) -> [String: String] {
        var q: [String: String] = [:]
        if !f.name.isEmpty { q["name"] = f.name }
        if !f.location.isEmpty { q["city"] = f.location }
        if let start = f.startDate, !start.isEmpty {
            q["from"] = start
            q["to"] = f.endDate ?? start
        } else if let year = FestivalDates.year(f) {
            q["year"] = String(year)
        }
        if let artist = artist?.trimmingCharacters(in: .whitespacesAndNewlines), !artist.isEmpty { q["artist"] = artist }
        return q
    }
}

/// What an import of lineup sets did, or that it's waiting for the person.
public enum LineupImportOutcome: Equatable, Sendable {
    case done(created: Int, attached: Int)
    /// Some sets are already logged and in another festival: nothing was
    /// written; ask, then import again with `moveConflicts`.
    case conflicts([Show])
}

// MARK: - The writes

extension FestivalsStore {
    struct FestivalAnswer: Decodable, Sendable { let festival: Festival; let already: Bool? }

    /// A new attendance id, minted on the device so a retry can't make two.
    func mintAttendanceId(uid: String) async -> String {
        let db = await Database.ready()
        return db.collection("users").document(uid).collection("festivals").document().documentID
    }

    private func keep(_ festival: Festival) {
        if let i = festivals?.firstIndex(where: { $0.id == festival.id }) { festivals?[i] = festival }
        else { festivals = (festivals ?? []) + [festival] }
    }

    /// Creates a festival (`festivals.js` `create`): the shared festival and
    /// this person's record, in one batch on the server.
    public func create(_ draft: FestivalDraft) async throws(APIError) -> Festival {
        guard let api, let uid = currentUid, let when = draft.when else { throw .signInRequired(message: nil) }
        struct Body: Encodable, Sendable {
            let action = "create"
            let attendanceId: String, name: String, startDate: String, endDate: String
            let year: Int?, location: String, notes: String
        }
        let id = await mintAttendanceId(uid: uid)
        let body = Body(attendanceId: id, name: draft.name.trimmingCharacters(in: .whitespacesAndNewlines),
                        startDate: when.startDate ?? "", endDate: when.endDate ?? "",
                        year: when.startDate == nil ? when.year : nil,
                        location: draft.location.trimmingCharacters(in: .whitespacesAndNewlines),
                        notes: draft.notes.trimmingCharacters(in: .whitespacesAndNewlines))
        let answer = try await api.post("festivals", body, as: FestivalAnswer.self)
        keep(answer.festival)
        return answer.festival
    }

    /// Joins a festival someone else added (`festivals.js` `join`): only
    /// this person's record is written. Joining twice opens the first.
    public func join(_ candidate: FestivalMatch.Candidate) async throws(APIError) -> Festival {
        if let mine = festivals?.first(where: { $0.festivalId == candidate.id }) { return mine }
        guard let api, let uid = currentUid else { throw .signInRequired(message: nil) }
        struct Body: Encodable, Sendable { let action = "join"; let festivalId: String; let attendanceId: String }
        let answer = try await api.post("festivals", Body(festivalId: candidate.id, attendanceId: await mintAttendanceId(uid: uid)),
                                        as: FestivalAnswer.self)
        keep(answer.festival)
        return answer.festival
    }

    /// The creator's edit of the shared details (`festivals.js` `update`):
    /// name, location, and dates rewritten whole (both, or only the year).
    public func updateDetails(_ festival: Festival, draft: FestivalDraft) async throws(APIError) -> Festival {
        guard let api, let when = draft.when else { throw .signInRequired(message: nil) }
        struct Body: Encodable, Sendable {
            let action = "update"
            let attendanceId: String, name: String, startDate: String, endDate: String
            let year: Int?, location: String
        }
        let body = Body(attendanceId: festival.id, name: draft.name.trimmingCharacters(in: .whitespacesAndNewlines),
                        startDate: when.startDate ?? "", endDate: when.endDate ?? "",
                        year: when.startDate == nil ? when.year : nil,
                        location: draft.location.trimmingCharacters(in: .whitespacesAndNewlines))
        var answer = try await api.post("festivals", body, as: FestivalAnswer.self).festival
        // The server answers with the record as stored; keep anything this
        // device already fetched that it doesn't carry.
        if answer.lineup.isEmpty, !festival.lineup.isEmpty {
            answer.lineup = festival.lineup; answer.lineupSource = festival.lineupSource; answer.lineupUrl = festival.lineupUrl
        }
        keep(answer)
        return answer
    }

    /// Festivals someone already added that look like the draft
    /// (`match-festivals`). Empty when it can't be asked: a failed lookup
    /// never blocks creating.
    public func matches(for draft: FestivalDraft) async -> [FestivalMatch] {
        guard let api, draft.canMatch else { return [] }
        struct Body: Encodable, Sendable { let name: String; let startDate: String; let endDate: String; let year: Int?; let location: String }
        struct Answer: Decodable, Sendable { let matches: [FestivalMatch] }
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let location = draft.location.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = draft.yearOnly
            ? Body(name: name, startDate: "", endDate: "", year: draft.when?.year, location: location)
            : Body(name: name, startDate: draft.startDate, endDate: draft.endDate.isEmpty ? draft.startDate : draft.endDate, year: nil, location: location)
        return (try? await api.post("match-festivals", body, as: Answer.self))?.matches ?? []
    }

    /// Saves the lineup this person typed: one per line, trimmed, each
    /// once, 300 at most (the web's `saveDraft`). One `updateData` of their
    /// own record's `myLineup`; private to them.
    public func saveMyLineup(_ text: String, festivalId id: String) async throws {
        guard let uid = currentUid else { return }
        let names = Self.lineupNames(text)
        let before = festival(id: id)?.myLineup
        if let i = festivals?.firstIndex(where: { $0.id == id }) { festivals?[i].myLineup = names }
        let db = await Database.ready()
        let ref = db.collection("users").document(uid).collection("festivals").document(id)
        do {
            try await withDeadline(.seconds(4)) {
                try await ref.updateData(["myLineup": names, "updatedAt": FieldValue.serverTimestamp()])
            }
        } catch is DeadlineError {
            return
        } catch {
            if let before, let i = festivals?.firstIndex(where: { $0.id == id }) { festivals?[i].myLineup = before }
            throw error
        }
    }

    nonisolated static let maxTypedLineup = 300

    nonisolated static func lineupNames(_ text: String) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for line in text.split(whereSeparator: \.isNewline) {
            let name = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if name.isEmpty || seen.contains(name) { continue }
            seen.insert(name)
            out.append(name)
            if out.count == maxTypedLineup { break }
        }
        return out
    }

    /// "Find who played" or "By artist" (`search-festival-lineup`, public).
    public func searchLineup(_ festival: Festival, artist: String?) async throws(APIError) -> [LineupSet] {
        guard let api else { throw .signInRequired(message: nil) }
        let answer = try await api.get("search-festival-lineup", query: FestivalLineupSearch.query(festival, artist: artist),
                                       as: LineupSearchAnswer.self)
        return answer.results
    }
}

extension ShowsStore {
    /// Adds picked lineup sets to the person's shows and to the festival,
    /// as the web's `importShowsToFestival` does, with the server deciding
    /// "the same show":
    ///   1. `normalize-show` previews every set as a `festival-row` input
    ///      (nothing written). A set already logged (by setlist.fm id, or
    ///      band, venue and day) is attached rather than added again; a
    ///      `possible` match is added (the person picked it from the lineup).
    ///   2. An already-logged set in another festival stops the import
    ///      before anything is written, unless `moveConflicts`.
    ///   3. The new sets are committed (they carry the festival), and the
    ///      already-logged ones attached (`setFestival`).
    /// Needs a connection.
    public func importLineup(_ sets: [LineupSet], into festivalId: String, moveConflicts: Bool) async throws(APIError) -> LineupImportOutcome {
        guard let api else { throw .signInRequired(message: nil) }
        let inputs = sets.map {
            ShowInput(.festivalRow(.row($0.raw), festivalId: festivalId, .none), confirmPossible: true)
        }
        var existing: [String] = []
        var fresh: [ShowInput] = []
        for chunk in Self.chunks(inputs) {
            let answer = try await api.post("normalize-show", NormalizeShowRequest.batch(chunk, .preview), as: NormalizeShowBatchResponse.self)
            for (input, result) in zip(chunk, answer.results) {
                if let dup = result.duplicate, !dup.isPossible { existing.append(dup.showId) } else if result.error == nil { fresh.append(input) }
            }
        }
        existing = Array(NSOrderedSet(array: existing)) as? [String] ?? existing
        if !moveConflicts {
            let conflicts = FestivalList.conflicts(existing, shows: shows, festivalId: festivalId)
            if !conflicts.isEmpty { return .conflicts(conflicts) }
        }
        var created = 0
        for chunk in Self.chunks(fresh) {
            let answer = try await api.post("normalize-show", NormalizeShowRequest.batch(chunk, .commit), as: NormalizeShowBatchResponse.self)
            for result in answer.results {
                if result.created == true { created += 1 } else if let merged = result.mergedInto { existing.append(merged) }
            }
        }
        let attach = existing.filter { id in show(id: id)?.festivalId != festivalId }
        if !attach.isEmpty { try? await setFestival(festivalId, showIds: attach) }
        if created > 0 { noteSetlistChangedOnServer() }
        return .done(created: created, attached: existing.count)
    }

    nonisolated static func chunks<T>(_ items: [T]) -> [[T]] {
        stride(from: 0, to: items.count, by: NormalizeShowRequest.maxInputs).map {
            Array(items[$0..<min($0 + NormalizeShowRequest.maxInputs, items.count)])
        }
    }
}
