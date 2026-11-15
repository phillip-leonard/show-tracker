import Foundation

/// `users/{uid}/friends/{friendUid}`. The stored `friendEmail` is not read:
/// addresses come from the server when needed.
public struct FriendEdge: Decodable, Hashable, Sendable {
    public var friendUid: String
    public var friendName: String?
    public var friendPhotoURL: String?
    public var addedAt: Date?

    enum CodingKeys: String, CodingKey { case friendUid, friendName, friendPhotoURL, addedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        friendUid = try c.text(.friendUid)
        friendName = try c.optionalText(.friendName)
        friendPhotoURL = try c.optionalText(.friendPhotoURL)
        addedAt = try c.moment(.addedAt)
    }
}

/// The copy of a show a tag or suggestion carries. Songs are `{id, name}`.
/// `date` is still `DD-MM-YYYY` in most tags (108 of 127 on 2026-11-14,
/// until `scripts/normalize-tag-dates.js` runs); read it through `ShowDate`.
public struct TagShowData: Decodable, Hashable, Sendable {
    public var artist: String
    public var venue: String
    public var city: String
    public var date: String
    public var tour: String?
    public var setlistfmId: String?
    public var setlistfmUrl: String?
    public var isManual: Bool?
    public var setlist: [TagSong]
    /// An upcoming show's tag, with `time` and `ticketUrl`.
    public var upcoming: Bool
    public var time: String?
    public var ticketUrl: String?

    public var isoDate: String { ShowDate.isoDay(date) }

    public struct TagSong: Decodable, Hashable, Sendable { public var id: String; public var name: String }

    enum CodingKeys: String, CodingKey { case artist, venue, city, date, tour, setlistfmId, setlistfmUrl, isManual, setlist, upcoming, time, ticketUrl }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        artist = try c.text(.artist)
        venue = try c.text(.venue)
        city = try c.text(.city)
        date = try c.text(.date)
        tour = try c.optionalText(.tour)
        setlistfmId = try c.optionalText(.setlistfmId)
        setlistfmUrl = try c.optionalText(.setlistfmUrl)
        isManual = try c.flag(.isManual)
        setlist = try c.list(.setlist)
        upcoming = try c.flag(.upcoming) ?? false
        time = try c.optionalText(.time)
        ticketUrl = try c.optionalText(.ticketUrl)
    }
}

/// `showTags/{id}`: a friend says you were at a show with them.
public struct ShowTag: Decodable, Hashable, Sendable {
    public var fromUid: String
    public var fromName: String
    public var toUid: String
    public var showData: TagShowData
    /// pending, accepted, declined or revoked.
    public var status: String
    public var createdAt: Date?
    public var upcomingShowId: String?

    enum CodingKeys: String, CodingKey { case fromUid, fromName, toUid, showData, status, createdAt, upcomingShowId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fromUid = try c.text(.fromUid)
        fromName = try c.text(.fromName)
        toUid = try c.text(.toUid)
        showData = try c.decode(TagShowData.self, forKey: .showData)
        status = try c.text(.status)
        createdAt = try c.moment(.createdAt)
        upcomingShowId = try c.optionalText(.upcomingShowId)
    }
}

/// `pendingEmailTags/{id}`: a tag sent to an address with no account yet,
/// read by its recipient once they have one. The addresses on it are not read.
public struct PendingEmailTag: Decodable, Hashable, Sendable {
    public var fromUid: String
    public var fromName: String
    public var toName: String?
    public var showData: TagShowData
    public var personalMessage: String?
    public var status: String
    public var createdAt: Date?

    enum CodingKeys: String, CodingKey { case fromUid, fromName, toName, showData, personalMessage, status, createdAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fromUid = try c.text(.fromUid)
        fromName = try c.text(.fromName)
        toName = try c.optionalText(.toName)
        showData = try c.decode(TagShowData.self, forKey: .showData)
        personalMessage = try c.optionalText(.personalMessage)
        status = try c.text(.status)
        createdAt = try c.moment(.createdAt)
    }
}

/// `showSuggestions/{id}`: "were you there together?", created by the
/// server (`friends.js` suggestionScan) for two mutual friends and a night.
public struct ShowSuggestion: Decodable, Hashable, Sendable {
    public var participants: [String]
    public var names: [String: String]
    public var showKey: String
    public var showData: SuggestedShow
    /// uid → pending, yes or no.
    public var responses: [String: String]
    public var overallStatus: String
    public var createdAt: Date?
    public var updatedAt: Date?
    /// Made by the one-off backfill: in-app only, never emailed.
    public var backfill: Bool

    public struct SuggestedShow: Decodable, Hashable, Sendable {
        public var artist: String; public var venue: String; public var date: String; public var city: String
        public var setlistfmId: String?
        public var isoDate: String { ShowDate.isoDay(date) }
    }

    enum CodingKeys: String, CodingKey { case participants, names, showKey, showData, responses, overallStatus, createdAt, updatedAt, backfill }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        participants = try c.list(.participants)
        names = try c.decodeIfPresent([String: String].self, forKey: .names) ?? [:]
        showKey = try c.text(.showKey)
        showData = try c.decode(SuggestedShow.self, forKey: .showData)
        responses = try c.decodeIfPresent([String: String].self, forKey: .responses) ?? [:]
        overallStatus = try c.text(.overallStatus)
        createdAt = try c.moment(.createdAt)
        updatedAt = try c.moment(.updatedAt)
        backfill = try c.flag(.backfill) ?? false
    }
}

/// `users/{uid}/upcomingShows/{id}`: a show the user is going to.
public struct UpcomingShow: Decodable, Hashable, Sendable {
    public var artist: String
    public var venue: String
    public var city: String
    /// ISO day.
    public var date: String
    public var time: String?
    public var notes: String?
    /// manual, ticketmaster or seatgeek.
    public var source: String?
    public var sourceEventId: String?
    public var ticketUrl: String?
    public var taggedFriendUids: [String]
    public var taggedBy: String?
    public var taggedByUid: String?
    public var originUpcomingId: String?
    public var createdAt: Date?
    public var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case artist, venue, city, date, time, notes, source, sourceEventId, ticketUrl, taggedFriendUids,
             taggedBy, taggedByUid, originUpcomingId, createdAt, updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        artist = try c.text(.artist)
        venue = try c.text(.venue)
        city = try c.text(.city)
        date = try c.text(.date)
        time = try c.optionalText(.time)
        notes = try c.optionalText(.notes)
        source = try c.optionalText(.source)
        sourceEventId = try c.optionalText(.sourceEventId)
        ticketUrl = try c.optionalText(.ticketUrl)
        taggedFriendUids = try c.list(.taggedFriendUids)
        taggedBy = try c.optionalText(.taggedBy)
        taggedByUid = try c.optionalText(.taggedByUid)
        originUpcomingId = try c.optionalText(.originUpcomingId)
        createdAt = try c.moment(.createdAt)
        updatedAt = try c.moment(.updatedAt)
    }
}
