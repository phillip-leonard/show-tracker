import Foundation

/// What the upcoming-show form sends: the Swift copy of the input
/// `lib/upcomingShows.js` takes, checked against `fixtures/upcoming-shows/`
/// (`UpcomingShowRulesTests`). The native app writes these documents
/// directly, field by field (DECISIONS.md, "Stage 1").
public struct UpcomingInput: Equatable, Sendable {
    public var artist: String
    public var venue: String
    public var city: String
    /// ISO day.
    public var date: String
    public var time: String
    public var notes: String
    /// `manual`, `ticketmaster` or `seatgeek`; kept on an edit.
    public var source: String?
    public var sourceEventId: String?
    public var ticketUrl: String?

    public init(artist: String = "", venue: String = "", city: String = "", date: String = "", time: String = "", notes: String = "",
                source: String? = nil, sourceEventId: String? = nil, ticketUrl: String? = nil) {
        self.artist = artist; self.venue = venue; self.city = city; self.date = date; self.time = time; self.notes = notes
        self.source = source; self.sourceEventId = sourceEventId; self.ticketUrl = ticketUrl
    }

    /// The form filled from a stored upcoming show (to edit it).
    public init(_ show: UpcomingShow) {
        self.init(artist: show.artist, venue: show.venue, city: show.city, date: ShowDate.isoDay(show.date), time: show.time ?? "",
                  notes: show.notes ?? "", source: show.source, sourceEventId: show.sourceEventId, ticketUrl: show.ticketUrl)
    }

    /// An input as the fixtures write it: anything that isn't a string reads as "".
    public init(json: JSONValue) {
        let s = { (k: String) in json[k]?.stringValue ?? "" }
        let opt = { (k: String) -> String? in
            guard let v = json[k], v != .null, v != .bool(false), v != .string("") else { return nil }
            return v.stringValue
        }
        self.init(artist: s("artist"), venue: s("venue"), city: s("city"), date: s("date"), time: s("time"), notes: s("notes"),
                  source: json["source"]?.stringValue, sourceEventId: opt("sourceEventId"), ticketUrl: opt("ticketUrl"))
    }
}

public enum UpcomingShowRules {
    /// `normalizeUpcomingInput`: every field trimmed, every optional one an
    /// explicit null, so an edit can clear a field.
    public static func fields(_ input: UpcomingInput) -> [String: JSONValue] {
        let t = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        let time = t(input.time)
        let source = ["ticketmaster", "seatgeek"].contains(input.source ?? "") ? input.source! : "manual"
        return [
            "artist": .string(t(input.artist)),
            "venue": .string(t(input.venue)),
            "city": .string(t(input.city)),
            "date": .string(t(input.date)),
            "time": time.isEmpty ? .null : .string(time),
            "notes": .string(String(t(input.notes).prefix(1000))),
            "source": .string(source),
            "sourceEventId": input.sourceEventId.map(JSONValue.string) ?? .null,
            "ticketUrl": input.ticketUrl.map(JSONValue.string) ?? .null,
        ]
    }

    /// `validateUpcomingInput`: what's missing, as the form shows it, or nil.
    public static func problem(_ input: UpcomingInput, today: String = ShowDate.today()) -> String? {
        let f = fields(input)
        let date = f["date"]?.stringValue ?? ""
        if f["artist"]?.stringValue?.isEmpty != false { return "Add the artist." }
        if f["venue"]?.stringValue?.isEmpty != false { return "Add the venue." }
        if date.isEmpty { return "Add the date." }
        if !isValidIsoDate(date) { return "That date doesn\u{2019}t look right." }
        if date < today { return "That date has passed. Add it to My Shows instead." }
        return nil
    }

    static func isValidIsoDate(_ date: String) -> Bool {
        let shape = date.count == 10 && date.enumerated().allSatisfy { i, c in (i == 4 || i == 7) ? c == "-" : c.isASCII && c.isNumber }
        return shape && ShowDate.isoDay(date) == date
    }

    /// `newUpcomingRecord`: a new document. `now` is the stored timestamp
    /// (`FieldValue.serverTimestamp()` in the app, a placeholder in tests).
    public static func newRecord(_ input: UpcomingInput, taggedBy: String? = nil, taggedByUid: String? = nil,
                                 originUpcomingId: String? = nil, now: JSONValue) -> [String: JSONValue] {
        var doc = fields(input)
        doc["taggedFriendUids"] = .array([])
        doc["taggedBy"] = taggedBy.map(JSONValue.string) ?? .null
        doc["taggedByUid"] = taggedByUid.map(JSONValue.string) ?? .null
        doc["originUpcomingId"] = originUpcomingId.map(JSONValue.string) ?? .null
        doc["createdAt"] = now
        doc["updatedAt"] = now
        return doc
    }

    /// `upcomingUpdate`: an edit's `updateData`: every field (a cleared one
    /// written as cleared) and `updatedAt`; tags and `createdAt` untouched.
    public static func update(_ input: UpcomingInput, now: JSONValue) -> [String: JSONValue] {
        var doc = fields(input)
        doc["updatedAt"] = now
        return doc
    }

    /// `findDuplicateUpcoming`: the one already listed for the same band
    /// (trimmed, any case) on the same day.
    public static func duplicate(of input: UpcomingInput, in shows: [UpcomingShow]) -> UpcomingShow? {
        let f = fields(input)
        let band = (f["artist"]?.stringValue ?? "").lowercased()
        let date = f["date"]?.stringValue ?? ""
        return shows.first { $0.artist.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == band && $0.date == date }
    }

    /// "I went" opens the morning after: the day itself still counts as upcoming.
    public static func canMarkAttended(_ show: UpcomingShow, today: String = ShowDate.today()) -> Bool {
        let date = ShowDate.isoDay(show.date)
        return !date.isEmpty && date < today
    }
}
