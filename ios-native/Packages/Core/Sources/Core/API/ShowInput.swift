import Foundation
import Synchronization

/// What the app sends `normalize-show` to add a show: an input, never a
/// document (CLAUDE.md, 5.60.6). The server builds the document
/// (lib/normalizeShow.js); `fixtures/shows/*.json` `input` are the contract,
/// and every one of them round-trips through this type (ShowInputTests).
public struct ShowInput: Codable, Hashable, Sendable {
    public var kind: Kind
    /// A minted id (`ShowID.mint()`), so the device and the server agree on
    /// the document even when the add is replayed from the offline outbox.
    public var showId: String?
    /// The user said a `possible` duplicate is a different show.
    public var confirmPossible: Bool?

    public enum Kind: Hashable, Sendable {
        /// Search, "Add all", tour bulk add, a ticket scan with a match.
        case setlistfm(SetlistfmSource, UserFields)
        /// The form, a ticket-scan row with no match.
        case manual(ManualShow, UserFields)
        /// A spreadsheet row (lib/importSheet.js showDataFor's output), passed through.
        case csvRow([String: JSONValue])
        case festivalRow(SetlistfmSource, festivalId: String, UserFields)
        /// A friend's tag the caller accepts (an account only).
        case tag(tagId: String, asPastShow: Bool)
        /// A tag sent before the caller had an account (an account only).
        case emailTag(pendingEmailTagId: String)
        /// An upcoming show they went to.
        case upcoming(upcomingId: String, setlistfmId: String?, UserFields)
    }

    /// Where a setlist.fm show comes from: an id the server fetches, or a
    /// setlist / tour-list row the app already has (setlist.fm's own JSON).
    public enum SetlistfmSource: Hashable, Sendable {
        case id(String)
        case setlist(JSONValue)
        case row(JSONValue)
    }

    public struct ManualShow: Hashable, Sendable {
        public var artist: String
        public var venue: String
        public var city: String?
        public var country: String?
        public var state: String?
        public var date: String
        public var tour: String?
        /// Songs to save with it (a Songs I've heard selection, 6-9); the
        /// form sends none.
        public var setlist: [JSONValue]?
        public init(artist: String, venue: String, city: String? = nil, country: String? = nil, state: String? = nil, date: String,
                    tour: String? = nil, setlist: [JSONValue]? = nil) {
            self.artist = artist; self.venue = venue; self.city = city; self.country = country; self.state = state; self.date = date
            self.tour = tour; self.setlist = setlist
        }
    }

    /// The caller's own rating and comment, on every kind but the tags.
    public struct UserFields: Hashable, Sendable {
        public var rating: Int?
        public var comment: String?
        public init(rating: Int? = nil, comment: String? = nil) { self.rating = rating; self.comment = comment }
        public static let none = UserFields()
    }

    public init(_ kind: Kind, showId: String? = ShowID.mint(), confirmPossible: Bool? = nil) {
        self.kind = kind; self.showId = showId; self.confirmPossible = confirmPossible
    }

    // MARK: - The JSON the server reads: flat, keyed by `kind`

    enum Keys: String, CodingKey {
        case kind, showId, confirmPossible, setlistfmId, setlist, row, artist, venue, city, country, state, date, tour,
             rating, comment, festivalId, tagId, asPastShow, pendingEmailTagId, upcomingId
    }

    public func encode(to encoder: Encoder) throws {
        if case .csvRow(let fields) = kind {
            var all = fields
            all["kind"] = .string("csv-row")
            if let showId { all["showId"] = .string(showId) }
            if let confirmPossible { all["confirmPossible"] = .bool(confirmPossible) }
            try all.encode(to: encoder)
            return
        }
        var c = encoder.container(keyedBy: Keys.self)
        try c.encodeIfPresent(showId, forKey: .showId)
        try c.encodeIfPresent(confirmPossible, forKey: .confirmPossible)
        func user(_ u: UserFields) throws {
            try c.encodeIfPresent(u.rating, forKey: .rating)
            try c.encodeIfPresent(u.comment, forKey: .comment)
        }
        func source(_ s: SetlistfmSource) throws {
            switch s {
            case .id(let id): try c.encode(id, forKey: .setlistfmId)
            case .setlist(let json): try c.encode(json, forKey: .setlist)
            case .row(let json): try c.encode(json, forKey: .row)
            }
        }
        switch kind {
        case .setlistfm(let s, let u):
            try c.encode("setlistfm", forKey: .kind); try source(s); try user(u)
        case .manual(let m, let u):
            try c.encode("manual", forKey: .kind)
            try c.encode(m.artist, forKey: .artist); try c.encode(m.venue, forKey: .venue)
            try c.encodeIfPresent(m.city, forKey: .city); try c.encodeIfPresent(m.country, forKey: .country)
            try c.encodeIfPresent(m.state, forKey: .state); try c.encode(m.date, forKey: .date)
            try c.encodeIfPresent(m.tour, forKey: .tour); try c.encodeIfPresent(m.setlist, forKey: .setlist); try user(u)
        case .festivalRow(let s, let festivalId, let u):
            try c.encode("festival-row", forKey: .kind); try source(s); try c.encode(festivalId, forKey: .festivalId); try user(u)
        case .tag(let tagId, let asPastShow):
            try c.encode("tag", forKey: .kind); try c.encode(tagId, forKey: .tagId)
            if asPastShow { try c.encode(true, forKey: .asPastShow) }
        case .emailTag(let id):
            try c.encode("email-tag", forKey: .kind); try c.encode(id, forKey: .pendingEmailTagId)
        case .upcoming(let upcomingId, let setlistfmId, let u):
            try c.encode("upcoming", forKey: .kind); try c.encode(upcomingId, forKey: .upcomingId)
            try c.encodeIfPresent(setlistfmId, forKey: .setlistfmId); try user(u)
        case .csvRow: break
        }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        showId = try c.decodeIfPresent(String.self, forKey: .showId)
        confirmPossible = try c.decodeIfPresent(Bool.self, forKey: .confirmPossible)
        let user = UserFields(rating: try? c.decodeIfPresent(Int.self, forKey: .rating),
                              comment: try c.decodeIfPresent(String.self, forKey: .comment))
        func source() throws -> SetlistfmSource {
            if let id = try c.decodeIfPresent(String.self, forKey: .setlistfmId) { return .id(id) }
            if let s = try c.decodeIfPresent(JSONValue.self, forKey: .setlist) { return .setlist(s) }
            return .row(try c.decode(JSONValue.self, forKey: .row))
        }
        switch try c.decode(String.self, forKey: .kind) {
        case "setlistfm": kind = .setlistfm(try source(), user)
        case "manual":
            kind = .manual(ManualShow(
                artist: try c.decode(String.self, forKey: .artist), venue: try c.decode(String.self, forKey: .venue),
                city: try c.decodeIfPresent(String.self, forKey: .city), country: try c.decodeIfPresent(String.self, forKey: .country),
                state: try c.decodeIfPresent(String.self, forKey: .state), date: try c.decode(String.self, forKey: .date),
                tour: try c.decodeIfPresent(String.self, forKey: .tour),
                setlist: try c.decodeIfPresent([JSONValue].self, forKey: .setlist)), user)
        case "csv-row":
            var all = try [String: JSONValue](from: decoder)
            for k in ["kind", "showId", "confirmPossible"] { all[k] = nil }
            kind = .csvRow(all)
        case "festival-row": kind = .festivalRow(try source(), festivalId: try c.decode(String.self, forKey: .festivalId), user)
        case "tag": kind = .tag(tagId: try c.decode(String.self, forKey: .tagId), asPastShow: try c.decodeIfPresent(Bool.self, forKey: .asPastShow) ?? false)
        case "email-tag": kind = .emailTag(pendingEmailTagId: try c.decode(String.self, forKey: .pendingEmailTagId))
        case "upcoming": kind = .upcoming(upcomingId: try c.decode(String.self, forKey: .upcomingId), setlistfmId: try c.decodeIfPresent(String.self, forKey: .setlistfmId), user)
        case let other: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "Unknown input kind \(other)")
        }
    }
}

/// Show document ids: millisecond timestamps as strings, never repeating
/// within a process (lib/showDoc.js mintShowId). Every existing document is
/// keyed this way.
public enum ShowID {
    private static let last = Mutex(Int64(0))

    public static func mint(now: Date = Date()) -> String {
        let ms = Int64((now.timeIntervalSince1970 * 1000).rounded(.down))
        return last.withLock { last in
            last = ms > last ? ms : last + 1
            return String(last)
        }
    }
}
