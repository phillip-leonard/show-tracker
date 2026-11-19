import Foundation

/// `userStats/{uid}`: the owner's numbers, computed on the server by
/// `lib/stats` (recompute-my-stats and the 6-hourly community-stats job).
/// The app never computes these itself.
public struct UserStats: Decodable, Hashable, Sendable {
    /// `lib/stats` STATS_VERSION. 2 since 5.60.12 (avgShowRating a number).
    public var statsVersion: Int
    public var showCount: Int
    public var songCount: Int
    public var ratedSongCount: Int
    public var uniqueSongCount: Int
    public var bandCount: Int
    public var venueCount: Int
    public var yearsActive: Int
    /// `"2026": 29`. Keys are years as strings, as Firestore stores map keys.
    public var showsByYear: [String: Int]
    public var firstShowDate: String?
    public var lastShowDate: String?
    /// One decimal (8.3). Version 1 documents stored a string; both read.
    public var avgShowRating: Double?
    public var ratedShowCount: Int
    /// Top 10 each, all time, most first (5.60.27; top 5 before).
    public var topBands: [NameCount]
    public var topVenues: [NameCount]
    /// Songs by the number of shows they were seen at, per band (5.60.27).
    /// Empty on a document from before then, until the next recompute.
    public var topSongs: [SongCount]
    /// On the leaderboard: a real account (not a guest, test user or banned) with a show.
    public var ranked: Bool
    public var rank: Int?
    public var rankedOf: Int?
    public var computedAt: Date?
    /// Each year with a readable show, by the same definitions applied to
    /// that year's shows (5.60.32, F-15): what the year picker shows. Empty
    /// on a document from before then, until the next recompute.
    public var years: [String: YearStats]

    enum CodingKeys: String, CodingKey {
        case statsVersion, showCount, songCount, ratedSongCount, uniqueSongCount, bandCount, venueCount,
             yearsActive, showsByYear, firstShowDate, lastShowDate, avgShowRating, ratedShowCount, topBands,
             topVenues, topSongs, ranked, rank, rankedOf, computedAt, years
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        statsVersion = try c.decodeIfPresent(Int.self, forKey: .statsVersion) ?? 0
        showCount = try c.decodeIfPresent(Int.self, forKey: .showCount) ?? 0
        songCount = try c.decodeIfPresent(Int.self, forKey: .songCount) ?? 0
        ratedSongCount = try c.decodeIfPresent(Int.self, forKey: .ratedSongCount) ?? 0
        uniqueSongCount = try c.decodeIfPresent(Int.self, forKey: .uniqueSongCount) ?? 0
        bandCount = try c.decodeIfPresent(Int.self, forKey: .bandCount) ?? 0
        venueCount = try c.decodeIfPresent(Int.self, forKey: .venueCount) ?? 0
        yearsActive = try c.decodeIfPresent(Int.self, forKey: .yearsActive) ?? 0
        showsByYear = try c.decodeIfPresent([String: Int].self, forKey: .showsByYear) ?? [:]
        firstShowDate = try c.optionalText(.firstShowDate)
        lastShowDate = try c.optionalText(.lastShowDate)
        avgShowRating = try c.numberOrNumericString(.avgShowRating)
        ratedShowCount = try c.decodeIfPresent(Int.self, forKey: .ratedShowCount) ?? 0
        topBands = try c.list(.topBands, of: NameCount.self)
        topVenues = try c.list(.topVenues, of: NameCount.self)
        topSongs = try c.list(.topSongs, of: SongCount.self)
        ranked = try c.flag(.ranked) ?? false
        rank = try c.decodeIfPresent(Int.self, forKey: .rank)
        rankedOf = try c.decodeIfPresent(Int.self, forKey: .rankedOf)
        computedAt = try c.moment(.computedAt)
        // One year that doesn't decode drops the block, not the document.
        years = (try? c.decodeIfPresent([String: YearStats].self, forKey: .years)) ?? [:]
    }
}

/// One entry of `userStats.years` (lib/stats `yearStats`): that year's
/// numbers and `showsByMonth`, twelve counts January first.
public struct YearStats: Decodable, Hashable, Sendable {
    public var showCount: Int
    public var songCount: Int
    public var ratedSongCount: Int
    public var uniqueSongCount: Int
    public var bandCount: Int
    public var venueCount: Int
    public var firstShowDate: String?
    public var lastShowDate: String?
    public var avgShowRating: Double?
    public var ratedShowCount: Int
    public var topBands: [NameCount]
    public var topVenues: [NameCount]
    public var topSongs: [SongCount]
    public var showsByMonth: [Int]

    enum CodingKeys: String, CodingKey {
        case showCount, songCount, ratedSongCount, uniqueSongCount, bandCount, venueCount, firstShowDate,
             lastShowDate, avgShowRating, ratedShowCount, topBands, topVenues, topSongs, showsByMonth
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        showCount = try c.decodeIfPresent(Int.self, forKey: .showCount) ?? 0
        songCount = try c.decodeIfPresent(Int.self, forKey: .songCount) ?? 0
        ratedSongCount = try c.decodeIfPresent(Int.self, forKey: .ratedSongCount) ?? 0
        uniqueSongCount = try c.decodeIfPresent(Int.self, forKey: .uniqueSongCount) ?? 0
        bandCount = try c.decodeIfPresent(Int.self, forKey: .bandCount) ?? 0
        venueCount = try c.decodeIfPresent(Int.self, forKey: .venueCount) ?? 0
        firstShowDate = try c.optionalText(.firstShowDate)
        lastShowDate = try c.optionalText(.lastShowDate)
        avgShowRating = try c.numberOrNumericString(.avgShowRating)
        ratedShowCount = try c.decodeIfPresent(Int.self, forKey: .ratedShowCount) ?? 0
        topBands = try c.list(.topBands, of: NameCount.self)
        topVenues = try c.list(.topVenues, of: NameCount.self)
        topSongs = try c.list(.topSongs, of: SongCount.self)
        let months = try c.list(.showsByMonth, of: Int.self)
        showsByMonth = months.count == 12 ? months : Array((months + Array(repeating: 0, count: 12)).prefix(12))
    }
}

/// `publicUserStats/{uid}`: what other signed-in accounts see (friend
/// cards, the profile sheet).
public struct PublicUserStats: Decodable, Hashable, Sendable {
    public var statsVersion: Int?
    public var showCount: Int
    public var songCount: Int
    public var ratedSongCount: Int
    public var venueCount: Int
    public var rank: Int?
    public var rankedOf: Int?
    public var computedAt: FlexibleDate?
}

public struct NameCount: Decodable, Hashable, Sendable {
    public var name: String
    public var count: Int
}

/// `userStats.topSongs`: a song, the band it was seen by ("" when the show
/// had no band), and the number of shows.
public struct SongCount: Decodable, Hashable, Sendable {
    public var name: String
    public var artist: String
    public var count: Int
}

/// `communityStats/global`: the leaderboards and community totals.
public struct CommunityStats: Decodable, Hashable, Sendable {
    /// Hidden below 1,000 (`UserCount.shouldShow`); never display it directly.
    public var totalUsers: Int
    public var totalShows: Int
    public var totalSongs: Int
    public var rankedCount: Int?
    public var topShowsAttended: [LeaderboardEntry]
    public var topSongsRated: [LeaderboardEntry]
    public var topVenuesVisited: [LeaderboardEntry]
    public var topSongsBySightings: [SongSightings]
    public var topSongsByRating: [SongRating]
    public var topVenues: [VenueTotal]
    public var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case totalUsers, totalShows, totalSongs, rankedCount, topShowsAttended, topSongsRated, topVenuesVisited,
             topSongsBySightings, topSongsByRating, topVenues, updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // A number; read leniently, as shouldShowUserCount's Number() does.
        totalUsers = try c.numberOrNumericString(.totalUsers).map { $0.isFinite ? Int(min(max($0, 0), 1e12)) : 0 } ?? 0
        totalShows = try c.decodeIfPresent(Int.self, forKey: .totalShows) ?? 0
        totalSongs = try c.decodeIfPresent(Int.self, forKey: .totalSongs) ?? 0
        rankedCount = try c.decodeIfPresent(Int.self, forKey: .rankedCount)
        topShowsAttended = try c.list(.topShowsAttended)
        topSongsRated = try c.list(.topSongsRated)
        topVenuesVisited = try c.list(.topVenuesVisited)
        topSongsBySightings = try c.list(.topSongsBySightings)
        topSongsByRating = try c.list(.topSongsByRating)
        topVenues = try c.list(.topVenues)
        updatedAt = try c.moment(.updatedAt)
    }

    public struct LeaderboardEntry: Decodable, Hashable, Sendable {
        public var userId: String
        public var firstName: String?
        public var photoURL: String?
        public var count: Int

        enum CodingKeys: String, CodingKey { case userId, odubleserId, firstName, photoURL, count }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            // userId since 5.59.10; the misspelled odubleserId before (GATED-CLEANUPS).
            userId = try c.optionalText(.userId) ?? c.text(.odubleserId)
            firstName = try c.optionalText(.firstName)
            photoURL = try c.optionalText(.photoURL)
            count = try c.decodeIfPresent(Int.self, forKey: .count) ?? 0
        }
    }

    public struct SongSightings: Decodable, Hashable, Sendable {
        public var songName: String
        public var userCount: Int
        public var artists: [String]
    }

    public struct SongRating: Decodable, Hashable, Sendable {
        public var songName: String
        /// Stored as a string ("9.5") by the job; read as a number.
        public var avgRating: Double
        public var ratingCount: Int
        public var artists: [String]

        enum CodingKeys: String, CodingKey { case songName, avgRating, ratingCount, artists }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            songName = try c.text(.songName)
            avgRating = try c.numberOrNumericString(.avgRating) ?? 0
            ratingCount = try c.decodeIfPresent(Int.self, forKey: .ratingCount) ?? 0
            artists = try c.list(.artists)
        }
    }

    public struct VenueTotal: Decodable, Hashable, Sendable {
        public var venueName: String
        public var showCount: Int
        public var artistCount: Int
    }
}

/// The one rule for showing how many people use MySetlists (`lib/userCount.js`,
/// decision 2026-11-14): nothing at all below 1,000.
public enum UserCount {
    public static let minimumToShow = 1_000

    public static func shouldShow(_ totalUsers: Int?) -> Bool {
        guard let n = totalUsers else { return false }
        return n >= minimumToShow
    }

    /// The same rule on a raw value (`fixtures/user-count/threshold.json`):
    /// JavaScript's `Number(totalUsers)`, so a numeric string counts and
    /// `null`, `true` or text don't.
    public static func shouldShow(raw value: Any?) -> Bool {
        let n: Double?
        switch value {
        case let number as NSNumber:
            n = CFGetTypeID(number) == CFBooleanGetTypeID() ? nil : number.doubleValue
        case let text as String:
            n = Double(text.trimmingCharacters(in: .whitespacesAndNewlines))
        default:
            n = nil
        }
        guard let n, n.isFinite else { return false }
        return n >= Double(minimumToShow)
    }
}
