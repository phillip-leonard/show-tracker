import FirebaseFirestore
import Foundation

// Venues (Stage 4, 4-7): the shapes lib/venues.js, lib/bucketListVenues.js
// and components/VenueRatingModal.jsx read and write, so a venue page here
// and on the web read and write the same documents. Everything here is
// pure; `VenueService` does the reading and writing.
//
// One key joins them all: `venueKeyFor(name, city)`, `name::city` trimmed
// and lowercased (`VenueNames.venueKey`), the `/venues/?venue=` key.

/// `venues/{venueKey}`: the shared venue document, made when someone first
/// applies to verify the venue and edited only by its verified owner. Most
/// venues have none; the page then works from your shows and the key.
public struct VenueInfo: Equatable, Sendable {
    public var key: String
    public var name: String?
    public var city: String?
    public var state: String?
    public var isVerified: Bool
    public var verifiedOwnerUid: String?
    /// As stored: the dashboard saves what the owner typed.
    public var capacity: String?
    public var yearOpened: String?
    public var address: String?
    public var bio: String?
    public var officialWebsite: URL?

    public init(key: String, data: [String: Any]) {
        self.key = key
        name = VenueText.text(data["name"])
        city = VenueText.text(data["city"])
        state = VenueText.text(data["state"])
        isVerified = data["isVerified"] as? Bool ?? false
        verifiedOwnerUid = VenueText.text(data["verifiedOwnerUid"])
        capacity = VenueText.text(data["capacity"])
        yearOpened = VenueText.text(data["yearOpened"])
        address = VenueText.text(data["address"])
        bio = VenueText.text(data["bio"])
        officialWebsite = VenueText.websiteURL(VenueText.text(data["officialWebsite"]))
    }

    /// "Manage venue" is for the verified owner only (`isOwner` on the web).
    public func isOwned(by uid: String?) -> Bool {
        guard isVerified, let uid, let owner = verifiedOwnerUid else { return false }
        return owner == uid
    }
}

/// One person's rating of a venue, `venueRatings/{id}`. Accounts only: the
/// rules refuse guests both reading and writing (`isAccount()`).
public struct VenueRating: Equatable, Sendable, Identifiable {
    public var id: String
    public var userId: String
    public var overallRating: Int
    public var subRatings: [String: Int]
    public var review: String?

    public init(id: String, data: [String: Any]) {
        self.id = id
        userId = data["userId"] as? String ?? ""
        overallRating = VenueText.int(data["overallRating"]) ?? 0
        var subs: [String: Int] = [:]
        for (key, value) in data["subRatings"] as? [String: Any] ?? [:] {
            if let n = VenueText.int(value) { subs[key] = n }
        }
        subRatings = subs
        review = VenueText.text(data["review"])
    }
}

/// An official announcement, `venueAnnouncements/{id}` (read only here: the
/// verified owner posts from the web's venue page).
public struct VenueAnnouncement: Equatable, Sendable, Identifiable {
    public var id: String
    public var text: String
    public var createdAt: Date?

    public init(id: String, data: [String: Any]) {
        self.id = id
        text = VenueText.text(data["text"]) ?? ""
        createdAt = (data["createdAt"] as? Timestamp)?.dateValue()
    }
}

/// An official photo, `venuePhotos/{id}` (read only here).
public struct VenuePhoto: Equatable, Sendable, Identifiable {
    public var id: String
    public var url: URL?
    public var caption: String?

    public init(id: String, data: [String: Any]) {
        self.id = id
        url = VenueText.text(data["url"]).flatMap(URL.init(string:))
        caption = VenueText.text(data["caption"])
    }
}

public enum VenueKeys {
    /// The name and city halves of a key, lowercased as stored (the
    /// rating's `venueName` and `venueCity`, which the web writes as the
    /// two halves it joined into `venueKey`).
    public static func parts(_ key: String) -> (name: String, city: String) {
        guard let r = key.range(of: "::") else { return (key, "") }
        return (String(key[..<r.lowerBound]), String(key[r.upperBound...]))
    }

    /// Whether a key can name a Firestore document (`venues/{key}`,
    /// `bucketListVenues/{uid}_{key}`). A venue name with "/" can't, on the
    /// web either; asking the SDK for one raises an exception Swift can't
    /// catch, so the page skips those reads.
    public static func isDocumentId(_ key: String) -> Bool {
        !key.isEmpty && !key.contains("/") && key != "." && key != ".."
            && !(key.hasPrefix("__") && key.hasSuffix("__"))
    }

    /// The name to show when there's no venue document and none of your
    /// shows are there: the key's own name half, capitalized.
    public static func fallbackName(_ key: String) -> String {
        let name = parts(key).name
        return name.isEmpty ? "Venue" : name.capitalized
    }
}

public enum VenueLinks {
    /// The venue dashboard on the web (`venueDashboardHref`), where the
    /// verified owner manages the venue (F-6).
    public static func dashboard(_ key: String) -> URL {
        var params = SearchParams(nil)
        params.set("venue", key)
        return DeepLink.webURL(path: "/venue-dashboard", params: params)
    }
}

/// Your shows at one venue, newest first: the shows whose `venueKeyFor`
/// is this key, as `VenueDetailClient` and `VenueShowsView` match them.
public enum VenueShows {
    public static func mine(_ key: String, in shows: [Show]) -> [Show] {
        ShowList.pastOrder(shows.filter { VenueNames.venueKey(name: $0.venue, city: $0.city) == key })
    }
}

// MARK: - Ratings

public enum VenueRatings {
    public struct SubRating: Sendable, Identifiable {
        public let key: String
        public let label: String
        public var id: String { key }
    }

    /// The optional sub-ratings, in the web's order (`SUB_LABELS`).
    public static let subRatings: [SubRating] = [
        SubRating(key: "soundQuality", label: "Sound Quality"),
        SubRating(key: "sightlines", label: "Sightlines"),
        SubRating(key: "atmosphere", label: "Atmosphere"),
        SubRating(key: "accessibility", label: "Accessibility"),
        SubRating(key: "foodDrinks", label: "Food & Drinks"),
    ]
    public static let maxReview = 500

    /// The average overall rating to one decimal, as the web shows it
    /// (`(sum / count).toFixed(1)`), or nil with no ratings. A rating
    /// without an overall counts as 0, as there.
    public static func average(_ ratings: [VenueRating]) -> String? {
        guard !ratings.isEmpty else { return nil }
        let mean = Double(ratings.reduce(0) { $0 + $1.overallRating }) / Double(ratings.count)
        return NumberText.toFixed1(mean)
    }

    /// The document a rating is saved as: the existing one when there is
    /// one, else `${uid}_${venueKey with every non a-z0-9 unit as "_"}`,
    /// the key part cut to 60 (UTF-16 units, as `replace` and `slice` count).
    public static func documentId(uid: String, venueKey: String) -> String {
        var units: [UInt16] = []
        for unit in venueKey.utf16 {
            let isAllowed = (unit >= 0x61 && unit <= 0x7A) || (unit >= 0x30 && unit <= 0x39)
            units.append(isAllowed ? unit : 0x5F)
            if units.count == 60 { break }
        }
        return "\(uid)_\(String(decoding: units, as: UTF16.self))"
    }

    /// What `VenueRatingModal` writes (with `merge: true`). `createdAt`
    /// only on a new rating; `review` null when empty. `venueName` and
    /// `venueCity` are the key's halves, so they always join back into
    /// `venueKey`.
    public static func writeData(uid: String, userName: String, venueKey: String, venueName: String, venueCity: String,
                                 draft: VenueRatingDraft, isNew: Bool) -> [String: Any] {
        let parts = VenueKeys.parts(venueKey)
        var subs: [String: Int] = draft.subRatings
        for sub in subRatings where subs[sub.key] == nil { subs[sub.key] = 0 }
        let review = draft.review.trimmingCharacters(in: .whitespacesAndNewlines)
        var data: [String: Any] = [
            "venueName": parts.name,
            "venueCity": parts.city,
            "venueKey": venueKey,
            "venueDisplayName": venueName,
            "venueCityDisplay": venueCity,
            "userId": uid,
            "userDisplayName": userName.isEmpty ? "Anonymous" : userName,
            "overallRating": draft.overallRating,
            "subRatings": subs,
            "review": VenueText.nullable(String(review.prefix(maxReview))),
            "updatedAt": FieldValue.serverTimestamp(),
        ]
        if isNew { data["createdAt"] = FieldValue.serverTimestamp() }
        return data
    }
}

/// The rating being edited: an overall from 1 to 5 (required), sub-ratings
/// from 0 (none) to 5, and a review of up to 500 characters.
public struct VenueRatingDraft: Equatable, Sendable {
    public var overallRating: Int
    public var subRatings: [String: Int]
    public var review: String

    public init(_ existing: VenueRating? = nil) {
        overallRating = existing?.overallRating ?? 0
        subRatings = existing?.subRatings ?? [:]
        review = existing?.review ?? ""
    }

    public var canSave: Bool { (1...5).contains(overallRating) }
}

// MARK: - Reports

/// Why a venue is reported (`ReportVenueModal`'s reasons). Accounts only.
public enum VenueReportReason: String, CaseIterable, Identifiable, Sendable {
    case unverifiedClaimingOfficial = "unverified_claiming_official"
    case duplicate
    case wrongInfo = "wrong_info"
    case other

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .unverifiedClaimingOfficial: "Claiming to be official but not verified"
        case .duplicate: "Duplicate venue entry"
        case .wrongInfo: "Inaccurate venue information"
        case .other: "Something else"
        }
    }

    public static let maxComment = 500

    /// The `venueReports` document (`reportVenue`), which only the admin reads.
    public func reportData(venueKey: String, venueName: String, uid: String, userName: String, comment: String) -> [String: Any] {
        [
            "venueKey": venueKey,
            "venueName": venueName,
            "reporterUid": uid,
            "reporterName": userName.isEmpty ? "Anonymous" : userName,
            "reason": rawValue,
            "comment": String(comment.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxComment)),
            "status": "open",
            "createdAt": FieldValue.serverTimestamp(),
        ]
    }
}

// MARK: - Venue bucket list

/// `bucketListVenues/{uid}_{venueKey}`: venues you'd see any show at. The
/// daily followed-band job matches them against your bands' tour dates
/// (the "venue on your bucket list" alert). Guests too: the rules let any
/// signed-in owner keep one.
public enum VenueBucketList {
    public static func documentId(uid: String, venueKey: String) -> String { "\(uid)_\(venueKey)" }

    /// What `addVenueToBucketList` writes (with `merge: true`).
    public static func data(uid: String, venueKey: String, name: String, city: String?, state: String?) -> [String: Any] {
        [
            "userId": uid,
            "venueKey": venueKey,
            "venueName": name,
            "venueCity": VenueText.nullable(city),
            "venueState": VenueText.nullable(state),
            "addedAt": FieldValue.serverTimestamp(),
        ]
    }
}

// MARK: - Text

public enum VenueText {
    /// A stored value as text: a trimmed, non-empty string, or a number
    /// (a capacity typed as 9525 is stored either way).
    static func text(_ value: Any?) -> String? {
        if let s = value as? String {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        if let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() {
            let d = n.doubleValue
            return d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : n.stringValue
        }
        return nil
    }

    /// A string for Firestore, or null when empty (the web's `x || null`).
    static func nullable(_ value: String?) -> Any {
        guard let value, !value.isEmpty else { return NSNull() }
        return value
    }

    static func int(_ value: Any?) -> Int? {
        if let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() { return n.intValue }
        if let s = value as? String { return Int(s.trimmingCharacters(in: .whitespaces)) }
        return nil
    }

    /// The official website as a link: http or https only, with
    /// "https://" added when the owner typed a bare domain.
    public static func websiteURL(_ raw: String?) -> URL? {
        guard var s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") {
            guard !s.contains("://") else { return nil }
            // Another scheme ("javascript:", "mailto:"): a colon before any
            // "/" with no dot before it. "example.com:8080" is a domain.
            let head = s.prefix { $0 != "/" }
            if let colon = head.firstIndex(of: ":"), !head[..<colon].contains(".") { return nil }
            s = "https://" + s
        }
        guard let url = URL(string: s), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else { return nil }
        return url
    }

    /// A capacity as it reads: "9,525" for a number, else as typed.
    public static func capacity(_ raw: String?) -> String? {
        guard let raw else { return nil }
        if let n = Int(raw) { return n.formatted() }
        return raw
    }
}
