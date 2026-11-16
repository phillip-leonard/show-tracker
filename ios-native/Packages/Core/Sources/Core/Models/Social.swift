import Foundation

/// `users/{uid}/friends/{friendUid}`. The stored `friendEmail` is not read:
/// addresses come from the server when needed.
public struct FriendEdge: Decodable, Identifiable, Hashable, Sendable {
    public var friendUid: String
    public var id: String { friendUid }
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

    public init(friendUid: String, friendName: String?, friendPhotoURL: String? = nil, addedAt: Date? = nil) {
        self.friendUid = friendUid
        self.friendName = friendName
        self.friendPhotoURL = friendPhotoURL
        self.addedAt = addedAt
    }

    /// The name to show; the server stores "Friend" when there was none.
    public var name: String { friendName ?? "Friend" }
}

/// `friendRequests/{id}`, readable by its two people. Written only by the
/// server (`friends.js` `request`, `decline`, `cancel`, `accept`, 5.60.28).
public struct FriendRequest: Decodable, Identifiable, Hashable, Sendable {
    /// The document id, from the snapshot; not stored.
    public var id: String = ""
    public var from: String
    public var to: String
    public var fromName: String?
    public var toName: String?
    /// pending, accepted or declined.
    public var status: String
    public var createdAt: Date?

    public var isPending: Bool { status == "pending" }

    enum CodingKeys: String, CodingKey { case from, to, fromName, toName, status, createdAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.text(.from)
        to = try c.text(.to)
        fromName = try c.optionalText(.fromName)
        toName = try c.optionalText(.toName)
        status = try c.optionalText(.status) ?? "pending"
        createdAt = try c.moment(.createdAt)
    }
}

/// `invites/{id}`: an invitation the signed-in person emailed. Only its
/// inviter (and an admin) can read it, so the address is theirs to see.
public struct Invite: Decodable, Identifiable, Hashable, Sendable {
    public var id: String = ""
    public var inviteeEmail: String
    /// pending or accepted.
    public var status: String
    public var createdAt: Date?
    public var lastSentAt: Date?

    enum CodingKeys: String, CodingKey { case inviteeEmail, status, createdAt, lastSentAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        inviteeEmail = try c.text(.inviteeEmail)
        status = try c.optionalText(.status) ?? "pending"
        createdAt = try c.moment(.createdAt)
        lastSentAt = try c.moment(.lastSentAt)
    }
}

/// `userBlocks/{uid}`: who the signed-in person has blocked. Only they can
/// read it; only `friends.js` `block` / `unblock` change it (5.60.27).
public struct UserBlocks: Decodable, Hashable, Sendable {
    public var blockedUserIds: [String]

    public init(blockedUserIds: [String] = []) { self.blockedUserIds = blockedUserIds }

    enum CodingKeys: String, CodingKey { case blockedUserIds }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        blockedUserIds = try c.list(.blockedUserIds)
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
public struct ShowTag: Decodable, Identifiable, Hashable, Sendable {
    /// The document id, from the snapshot; not stored.
    public var id: String = ""
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
public struct PendingEmailTag: Decodable, Identifiable, Hashable, Sendable {
    /// The document id, from the snapshot; not stored.
    public var id: String = ""
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
public struct ShowSuggestion: Decodable, Identifiable, Hashable, Sendable {
    /// The document id, from the snapshot; not stored.
    public var id: String = ""
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
public struct UpcomingShow: Decodable, Identifiable, Hashable, Sendable {
    /// The document id, from the snapshot (`decodeUpcomingShow`); not stored.
    public var id: String = ""
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
