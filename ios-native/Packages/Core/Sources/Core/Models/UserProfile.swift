import Foundation

/// `userProfiles/{uid}`. Readable by any signed-in account, so it never
/// carries an email address (the rules refuse one).
///
/// Deliberately missing: `showCount`, `songCount`, `ratedSongCount` and
/// `venueCount`. Old iOS builds still write them and nothing trusts them;
/// the numbers are `UserStats` / `PublicUserStats` (CLAUDE.md, 5.59.15).
public struct UserProfile: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    /// Set by the server (`moderate-content`), already through the content filter.
    public var displayName: String?
    public var firstName: String?
    public var handle: String?
    public var photoURL: String?
    public var favoriteArtists: [FollowedBand]
    public var termsAcceptedVersion: Int?
    public var termsAcceptedAt: Date?
    public var banned: Bool
    public var isTestUser: Bool
    public var shareActivity: Bool?
    public var publicProfile: Bool?
    /// Missing means on (5.60.1).
    public var showOnLeaderboard: Bool
    public var convertedFromGuest: Bool?
    public var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case displayName, firstName, handle, photoURL, favoriteArtists, termsAcceptedVersion, termsAcceptedAt,
             banned, isTestUser, shareActivity, publicProfile, showOnLeaderboard, convertedFromGuest, createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = ""
        displayName = try c.optionalText(.displayName)
        firstName = try c.optionalText(.firstName)
        handle = try c.optionalText(.handle)
        photoURL = try c.optionalText(.photoURL)
        favoriteArtists = try c.list(.favoriteArtists, of: FollowedBand.self)
        termsAcceptedVersion = try c.decodeIfPresent(Int.self, forKey: .termsAcceptedVersion)
        termsAcceptedAt = try c.moment(.termsAcceptedAt)
        banned = try c.flag(.banned) ?? false
        isTestUser = try c.flag(.isTestUser) ?? false
        shareActivity = try c.flag(.shareActivity)
        publicProfile = try c.flag(.publicProfile)
        showOnLeaderboard = try c.flag(.showOnLeaderboard) ?? true
        convertedFromGuest = try c.flag(.convertedFromGuest)
        createdAt = try c.moment(.createdAt)
    }
}

/// A band the user follows. Stored as `{name, mbid, addedAt}`, or, in
/// older profiles, as a plain name (9 of 16 entries on 2026-11-14).
public struct FollowedBand: Decodable, Hashable, Sendable {
    public var name: String
    public var mbid: String?
    /// ISO string.
    public var addedAt: String?

    enum CodingKeys: String, CodingKey { case name, mbid, addedAt }

    public init(name: String, mbid: String? = nil, addedAt: String? = nil) {
        self.name = name; self.mbid = mbid; self.addedAt = addedAt
    }

    public init(from decoder: Decoder) throws {
        if let plain = try? decoder.singleValueContainer().decode(String.self) {
            self.init(name: plain)
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(name: try c.text(.name), mbid: try c.optionalText(.mbid), addedAt: try c.optionalText(.addedAt))
    }
}
