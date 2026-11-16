import Foundation

/// `notifications/{id}`: the in-app inbox (Stage 3, Part 4). Written by the
/// server (engagement since 5.60.29, band alerts, anniversaries) or an
/// admin (the roadmap notice); the recipient reads them and marks them read.
///
/// Only `type` and `message` matter for every kind; everything else depends
/// on the type and is optional. A type this build doesn't know shows its
/// message with nowhere to go, rather than failing to decode
/// (STAGE3-AUDIT §3.3).
public struct AppNotification: Decodable, Identifiable, Hashable, Sendable {
    /// The document id, from the snapshot; not stored.
    public var id: String = ""
    public var type: String
    public var message: String
    public var read: Bool
    public var createdAt: Date?

    // About a show (engagement, anniversaries)
    public var concertKey: String?
    public var showId: String?
    public var artist: String?
    public var venue: String?
    public var date: String?
    public var fromUid: String?
    public var fromName: String?

    // Band alerts
    public var venueKey: String?
    public var url: String?
    public var dates: [TourDate]
    public var dateCount: Int?
    public var eventDate: String?
    public var city: String?
    public var windows: [SaleWindow]
    public var presaleCode: String?
    public var codeSource: String?
    public var signupUrl: String?
    public var portalUrl: String?

    // The roadmap notice
    public var itemId: String?
    public var itemTitle: String?

    public struct TourDate: Decodable, Hashable, Sendable {
        public var date: String?
        public var venue: String?
        public var city: String?
        public var url: String?
    }

    /// A sale window, already in the recipient's time zone ("Fri, Nov 21, 10:00 AM PST").
    public struct SaleWindow: Decodable, Hashable, Sendable {
        public var label: String
        public var when: String
    }

    public var kind: NotificationKind { NotificationKind(rawValue: type) ?? .other }

    enum CodingKeys: String, CodingKey {
        case type, message, read, createdAt, concertKey, showId, artist, venue, date, fromUid, fromName,
             venueKey, url, dates, dateCount, eventDate, city, windows, presaleCode, codeSource, signupUrl, portalUrl,
             itemId, itemTitle
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.text(.type)
        message = try c.text(.message)
        read = try c.flag(.read) ?? false
        createdAt = try c.moment(.createdAt)
        concertKey = try c.optionalText(.concertKey)
        showId = try c.optionalText(.showId)
        artist = try c.optionalText(.artist)
        venue = try c.optionalText(.venue)
        date = try c.optionalText(.date)
        fromUid = try c.optionalText(.fromUid)
        fromName = try c.optionalText(.fromName)
        venueKey = try c.optionalText(.venueKey)
        url = try c.optionalText(.url)
        dates = (try? c.list(.dates, of: TourDate.self)) ?? []
        dateCount = try? c.decodeIfPresent(Int.self, forKey: .dateCount)
        eventDate = try c.optionalText(.eventDate)
        city = try c.optionalText(.city)
        windows = (try? c.list(.windows, of: SaleWindow.self)) ?? []
        presaleCode = try c.optionalText(.presaleCode)
        codeSource = try c.optionalText(.codeSource)
        signupUrl = try c.optionalText(.signupUrl)
        portalUrl = try c.optionalText(.portalUrl)
        itemId = try c.optionalText(.itemId)
        itemTitle = try c.optionalText(.itemTitle)
    }
}

/// The types the inbox knows (`ICONS` in components/notifications/NotificationCenter.jsx).
public enum NotificationKind: String, Sendable, CaseIterable {
    case commentReply = "comment_reply"
    case commentLike = "comment_like"
    case commentMention = "comment_mention"
    case photoLike = "photo_like"
    case meetupJoin = "meetup_join"
    case anniversary
    case followedBandTour = "followed_band_tour"
    case venueBucketListMatch = "venue_bucket_list_match"
    case onsaleAlert = "onsale_alert"
    case roadmapPublished = "roadmap_published"
    case other

    /// The "Band alerts" filter (`BAND_ALERT_TYPES`).
    public var isBandAlert: Bool { self == .followedBandTour || self == .venueBucketListMatch || self == .onsaleAlert }

    public var isEngagement: Bool { [.commentReply, .commentLike, .commentMention, .photoLike].contains(self) }

    /// An SF Symbol for the row.
    public var symbol: String {
        switch self {
        case .commentReply: "bubble.left"
        case .commentLike: "heart"
        case .commentMention: "at"
        case .photoLike: "photo"
        case .meetupJoin: "person.3"
        case .anniversary: "party.popper"
        case .followedBandTour: "calendar.badge.plus"
        case .venueBucketListMatch: "mappin.and.ellipse"
        case .onsaleAlert: "ticket"
        case .roadmapPublished: "megaphone"
        case .other: "bell"
        }
    }
}
