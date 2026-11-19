import FirebaseFirestore
import Foundation

// The bucket list (Stage 4, 4-10): lib/bucketList.js (shows you want to
// catch) and lib/bucketListVenues.js (venues you'd see anything at), read
// and written as the web does. The rules let the owner keep both, guests
// included (their own data).
//
//   bucketList/{uid}_{itemKey}
//     { userId, artist, venue, city, state, date (ISO), source, ticketUrl, addedAt }
//   bucketListVenues/{uid}_{venueKey}   (see `VenueBucketList`)

/// One show on your bucket list.
public struct BucketListItem: Hashable, Sendable, Identifiable {
    /// The document id after `{uid}_` (`bucketListItemKey`).
    public var key: String
    public var artist: String
    public var venue: String?
    public var city: String?
    public var state: String?
    /// ISO, through `ShowDate` (a legacy date reads too).
    public var date: String
    /// "manual", "ticketmaster" or "seatgeek".
    public var source: String
    public var ticketURL: URL?
    public var id: String { key }

    public init(id: String, uid: String, data: [String: Any]) {
        let prefix = "\(uid)_"
        key = id.hasPrefix(prefix) ? String(id.dropFirst(prefix.count)) : id
        artist = (data["artist"] as? String) ?? ""
        venue = BucketList.text(data["venue"])
        city = BucketList.text(data["city"])
        state = BucketList.text(data["state"])
        date = ShowDate.isoDay(data["date"] as? String)
        source = BucketList.text(data["source"]) ?? "manual"
        ticketURL = VenueText.websiteURL(BucketList.text(data["ticketUrl"]))
    }

    /// "Red Rocks · Morrison, CO", or whatever there is.
    public var place: String {
        let town = [city, state].compactMap { $0 }.joined(separator: ", ")
        return [venue, town.isEmpty ? nil : town].compactMap { $0 }.joined(separator: " · ")
    }

    /// The source when it isn't you ("Ticketmaster", "SeatGeek").
    public var sourceLabel: String? {
        switch source {
        case "ticketmaster": "Ticketmaster"
        case "seatgeek": "SeatGeek"
        default: nil
        }
    }
}

/// A show to add by hand (the web's "Add a show manually").
public struct BucketListDraft: Equatable, Sendable {
    public var artist = ""
    public var venue = ""
    public var city = ""
    public var state = ""
    /// ISO.
    public var date = ""

    public init() {}

    public var canSave: Bool {
        !artist.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !ShowDate.isoDay(date).isEmpty
    }
}

/// A venue on your venue bucket list.
public struct BucketListVenue: Hashable, Sendable, Identifiable {
    public var venueKey: String
    public var name: String
    public var city: String?
    public var state: String?
    public var id: String { venueKey }

    public init(data: [String: Any]) {
        venueKey = (data["venueKey"] as? String) ?? ""
        name = (data["venueName"] as? String) ?? ""
        city = BucketList.text(data["venueCity"])
        state = BucketList.text(data["venueState"])
    }

    public var place: String { [city, state].compactMap { $0 }.joined(separator: ", ") }
}

public enum BucketList {
    /// `bucketListItemKey`: band, venue and date, each lowercased, trimmed,
    /// every run of anything but a-z and 0-9 as "-", joined by "_".
    public static func itemKey(artist: String, venue: String?, date: String) -> String {
        [artist, venue ?? "", date].map { part in
            part.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        }.joined(separator: "_")
    }

    public static func documentId(uid: String, key: String) -> String { "\(uid)_\(key)" }

    /// What `addToBucketList` writes (with `merge: true`) for a show added by hand.
    public static func addData(uid: String, draft: BucketListDraft) -> (key: String, data: [String: Any])? {
        guard draft.canSave else { return nil }
        let artist = draft.artist.trimmingCharacters(in: .whitespacesAndNewlines)
        let venue = draft.venue.trimmingCharacters(in: .whitespacesAndNewlines)
        let date = ShowDate.isoDay(draft.date)
        let key = itemKey(artist: artist, venue: venue, date: date)
        return (key, [
            "userId": uid,
            "artist": artist,
            "venue": VenueText.nullable(venue),
            "city": VenueText.nullable(draft.city.trimmingCharacters(in: .whitespacesAndNewlines)),
            "state": VenueText.nullable(draft.state.trimmingCharacters(in: .whitespacesAndNewlines)),
            "date": date,
            "source": "manual",
            "ticketUrl": NSNull(),
            "addedAt": FieldValue.serverTimestamp(),
        ])
    }

    public enum Sort: String, CaseIterable, Identifiable, Sendable {
        case soonest, name
        public var id: String { rawValue }
        public var label: String { self == .soonest ? "Soonest" : "A–Z" }
    }

    /// Shows still to come (today included), as the web lists them, filtered
    /// by band or venue and sorted.
    public static func upcoming(_ items: [BucketListItem], today: String, query: String, sort: Sort) -> [BucketListItem] {
        sorted(items.filter { !$0.date.isEmpty && $0.date >= today && matches($0, query) }, sort)
    }

    /// Shows whose date has passed: the web stops listing them; here they
    /// wait for "I went" or Remove.
    public static func past(_ items: [BucketListItem], today: String, query: String) -> [BucketListItem] {
        items.filter { ($0.date.isEmpty || $0.date < today) && matches($0, query) }
            .sorted { $0.date > $1.date }
    }

    static func matches(_ item: BucketListItem, _ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return true }
        return [item.artist, item.venue ?? ""].contains { $0.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
    }

    static func sorted(_ items: [BucketListItem], _ sort: Sort) -> [BucketListItem] {
        items.sorted { a, b in
            switch sort {
            case .soonest where a.date != b.date: return a.date < b.date
            case .name:
                let c = a.artist.localizedStandardCompare(b.artist)
                if c != .orderedSame { return c == .orderedAscending }
                return a.date < b.date
            default: return a.artist.localizedStandardCompare(b.artist) == .orderedAscending
            }
        }
    }

    /// The text "Share with friends" sends: one line per show with its
    /// band, date, venue and city (the web's `handleShare` leaves out the
    /// city), and no links. Plain text, as on the web: no public page.
    public static func shareText(_ items: [BucketListItem]) -> String {
        let lines = items.map { item in
            let place = [item.venue, item.city].compactMap { $0 }.joined(separator: ", ")
            return "- \(item.artist) — \(longDate(item.date))\(place.isEmpty ? "" : " @ \(place)")"
        }
        return (["My concert bucket list:"] + lines).joined(separator: "\n")
    }

    /// A calendar event's location: the venue plus the city ("Red Rocks,
    /// Morrison"), whichever there is.
    public static func calendarLocation(_ item: BucketListItem) -> String {
        [item.venue, item.city].compactMap { $0 }.joined(separator: ", ")
    }

    /// "Sat, May 10, 2026" (the web's `formatDate`, en-US).
    public static func longDate(_ iso: String) -> String {
        let parse = DateFormatter()
        parse.locale = Locale(identifier: "en_US_POSIX")
        parse.timeZone = TimeZone(identifier: "UTC")
        parse.dateFormat = "yyyy-MM-dd"
        guard let d = parse.date(from: iso) else { return iso }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US_POSIX")
        out.timeZone = TimeZone(identifier: "UTC")
        out.dateFormat = "EEE, MMM d, yyyy"
        return out.string(from: d)
    }

    static func text(_ value: Any?) -> String? {
        guard let s = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return s
    }
}

// MARK: - A missing venue, from Ticketmaster

/// What `find-bucket-venue` is asked: the band, the day, and the city and
/// state when the show has them.
public struct BucketVenueRequest: Encodable, Equatable, Sendable {
    public var artist: String
    public var date: String
    public var city: String?
    public var state: String?
}

/// Its answer: the venue and where it is, or why there's none
/// (`not_found`, `ambiguous`, `unavailable`).
public struct BucketVenueAnswer: Decodable, Equatable, Sendable {
    public var found: Bool
    public var venue: String?
    public var city: String?
    public var state: String?
    public var lat: Double?
    public var lng: Double?
    public var url: String?
    public var reason: String?
}

public extension BucketList {
    static func venueRequest(_ item: BucketListItem) -> BucketVenueRequest {
        BucketVenueRequest(artist: item.artist, date: item.date, city: item.city, state: item.state)
    }

    /// What saving a found venue writes to the show: the venue, and the
    /// city, state and ticket link only where the show has none, so nothing
    /// the person typed is replaced. Nil when there's nothing to save.
    static func venueUpdate(_ item: BucketListItem, answer: BucketVenueAnswer) -> [String: Any]? {
        guard answer.found, let venue = text(answer.venue) else { return nil }
        var fields: [String: Any] = ["venue": venue]
        if item.city == nil, let city = text(answer.city) { fields["city"] = city }
        if item.state == nil, let state = text(answer.state) { fields["state"] = state }
        if item.ticketURL == nil, let url = VenueText.websiteURL(text(answer.url)) { fields["ticketUrl"] = url.absoluteString }
        return fields
    }

    /// The show as it reads once the found venue is saved.
    static func applying(_ answer: BucketVenueAnswer, to item: BucketListItem) -> BucketListItem {
        guard let fields = venueUpdate(item, answer: answer) else { return item }
        var out = item
        out.venue = fields["venue"] as? String ?? out.venue
        out.city = fields["city"] as? String ?? out.city
        out.state = fields["state"] as? String ?? out.state
        if let url = fields["ticketUrl"] as? String { out.ticketURL = URL(string: url) }
        return out
    }
}

// MARK: - Reading and writing

@MainActor
public enum BucketListService {
    static let deadline: Duration = .seconds(10)

    public static func items(uid: String) async throws -> [BucketListItem] {
        let db = await Database.ready()
        let query = db.collection("bucketList").whereField("userId", isEqualTo: uid)
        let snap = try await withDeadline(deadline) { try await query.getDocuments() }
        return snap.documents.map { BucketListItem(id: $0.documentID, uid: uid, data: $0.data()) }
    }

    /// Adds a show by hand; returns its key.
    @discardableResult
    public static func add(uid: String, draft: BucketListDraft) async throws -> String? {
        guard let made = BucketList.addData(uid: uid, draft: draft) else { return nil }
        let db = await Database.ready()
        try await db.collection("bucketList").document(BucketList.documentId(uid: uid, key: made.key)).setData(made.data, merge: true)
        return made.key
    }

    /// The venue of a show saved without one (`find-bucket-venue`,
    /// accounts only). Nil when Ticketmaster has no single answer or can't
    /// be reached: the calendar event goes ahead without it.
    public static func findVenue(_ item: BucketListItem, api: APIClient) async -> BucketVenueAnswer? {
        guard item.venue == nil, !item.date.isEmpty else { return nil }
        guard let answer = try? await api.post("find-bucket-venue", BucketList.venueRequest(item), as: BucketVenueAnswer.self),
              answer.found else { return nil }
        return answer
    }

    /// Saves a found venue to the show (one `updateData` of those fields).
    public static func saveVenue(uid: String, item: BucketListItem, answer: BucketVenueAnswer) async throws {
        guard let fields = BucketList.venueUpdate(item, answer: answer) else { return }
        let db = await Database.ready()
        try await db.collection("bucketList").document(BucketList.documentId(uid: uid, key: item.key)).updateData(fields)
    }

    public static func remove(uid: String, key: String) async throws {
        let db = await Database.ready()
        do {
            try await db.collection("bucketList").document(BucketList.documentId(uid: uid, key: key)).delete()
        } catch {
            if (error as NSError).code != FirestoreErrorCode.notFound.rawValue { throw error }
        }
    }

    public static func venues(uid: String) async throws -> [BucketListVenue] {
        let db = await Database.ready()
        let query = db.collection("bucketListVenues").whereField("userId", isEqualTo: uid)
        let snap = try await withDeadline(deadline) { try await query.getDocuments() }
        return snap.documents.map { BucketListVenue(data: $0.data()) }
            .filter { !$0.venueKey.isEmpty }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    /// Adds a venue (`addVenueToBucketList`): keyed by `venueKeyFor(name, city)`.
    /// Returns its key, or nil with no name.
    @discardableResult
    public static func addVenue(uid: String, name: String, city: String, state: String) async throws -> String? {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let city = city.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let key = VenueNames.venueKey(name: name, city: city) else { return nil }
        try await VenueService.setOnBucketList(true, uid: uid, venueKey: key, name: name, city: city,
                                               state: state.trimmingCharacters(in: .whitespacesAndNewlines))
        return key
    }

    public static func removeVenue(uid: String, venueKey: String) async throws {
        try await VenueService.setOnBucketList(false, uid: uid, venueKey: venueKey, name: "", city: nil, state: nil)
    }
}

public extension ShowsStore {
    /// "I went" for a bucket-list show: the night from setlist.fm when it's
    /// there (its setlist comes too), else the show by hand, through
    /// `normalize-show` as every add is. The bucket item stays until the
    /// caller sees it added.
    func addFromBucketList(_ item: BucketListItem) async -> AddOutcome {
        let venue = item.venue ?? ""
        let found = await setlistfmSearch?.setlist(artist: item.artist, date: item.date, venue: venue)
        let display = QueuedShow.Display(artist: item.artist, venue: venue, city: item.city ?? "", date: item.date)
        if let found {
            return await addShow(ShowInput(.setlistfm(.setlist(found.raw), .none)), display: display)
        }
        guard !venue.isEmpty else {
            return .refused("setlist.fm doesn't have this night, and it has no venue. Add it by hand from Shows → +.")
        }
        return await addShow(ShowInput(.manual(.init(artist: item.artist, venue: venue, city: item.city, state: item.state, date: item.date), .none)),
                             display: display)
    }
}
