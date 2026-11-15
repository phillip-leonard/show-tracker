import Foundation

/// `yearInReviews/{uid}_{year}`. The app owns the document and `privacy`;
/// the server writes `stats` (`lib/yearInReviewStats.js`, 5.60.4).
public struct YearInReviewDocument: Decodable, Hashable, Sendable {
    public var userId: String
    public var year: Int
    /// "public" shares it; absent (both production documents today) or
    /// anything else is private. A guest can't make one public (rules).
    public var privacy: String?
    /// `nil` when the year has no shows.
    public var stats: YearInReviewStats?
    /// The 2026 recap for this year, written by the server next to `stats`
    /// (5.60.16). `nil` for a year with no shows, and until the server has
    /// filled in a document from before 5.60.16 (`recompute-my-stats`).
    public var recap: YearRecap?
    public var generatedDate: Date?
    public var statsComputedAt: Date?

    public var isPublic: Bool { privacy == "public" }

    enum CodingKeys: String, CodingKey { case userId, year, privacy, stats, recap, generatedDate, statsComputedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.text(.userId)
        year = try c.decode(Int.self, forKey: .year)
        privacy = try c.optionalText(.privacy)
        stats = try c.decodeIfPresent(YearInReviewStats.self, forKey: .stats)
        recap = try c.decodeIfPresent(YearRecap.self, forKey: .recap)
        generatedDate = try c.moment(.generatedDate)
        statsComputedAt = try c.moment(.statsComputedAt)
    }
}

/// `computeYearInReview(shows, year)`: fixtures/year-in-review `expected.yearInReview`.
/// `Codable` only so tests can round-trip the fixtures; the app never writes it.
public struct YearInReviewStats: Codable, Hashable, Sendable {
    public var year: Int
    public var totalShows: Int
    /// "Bands" in the UI; the stored name stays `totalArtists`.
    public var totalArtists: Int
    public var totalVenues: Int
    public var countriesVisited: [String]
    public var statesVisited: [String]
    public var topArtist: TopArtist?
    public var topRatedShows: [RatedShow]
    public var favoriteVenue: FavoriteVenue?
    public var mostSeenSong: SongCount?
    public var highestRatedArtist: RatedArtist?
    public var longestConsecutiveStreak: Int
    public var achievements: [Achievement]
    public var shareableQuote: String

    public struct TopArtist: Codable, Hashable, Sendable { public var name: String; public var showCount: Int; public var avgRating: Double? }
    /// `date` is the show's stored date (it may be `DD-MM-YYYY`); read it through `ShowDate`.
    public struct RatedShow: Codable, Hashable, Sendable {
        public var showId: String; public var artist: String; public var venue: String
        public var city: String?; public var date: String; public var rating: Int
    }
    public struct FavoriteVenue: Codable, Hashable, Sendable { public var name: String; public var city: String?; public var frequency: Int }
    public struct SongCount: Codable, Hashable, Sendable { public var name: String; public var count: Int }
    public struct RatedArtist: Codable, Hashable, Sendable { public var name: String; public var avgRating: Double }
    public struct Achievement: Codable, Hashable, Sendable { public var title: String; public var description: String }
}

/// `computeYearRecap(shows, year)` (lib/yearRecap.js): fixtures/year-in-review
/// `expected.recap`. The server writes it as `yearInReviews/{uid}_{year}.recap`
/// (5.60.16); the app reads that, never a Swift port of the calculator. To
/// get one for a year, make sure the document exists (the same merge write
/// the web's privacy toggle makes), then call `recompute-my-stats`.
public struct YearRecap: Codable, Hashable, Sendable {
    public var year: Int
    public var totalShows: Int
    public var totalBands: Int
    public var totalVenues: Int
    public var totalCities: Int
    public var songsHeard: Int
    public var newBands: Int
    public var newBandNames: [String]
    public var newVenues: Int
    public var topBands: [BandShows]
    public var topSongs: [TopSong]
    public var noSetlist: [ShowRef]
    public var showsWithSetlist: Int
    public var highlights: Highlights
    /// ISO day of the latest logged show.
    public var updatedThrough: String

    public struct BandShows: Codable, Hashable, Sendable { public var name: String; public var shows: Int }
    public struct TopSong: Codable, Hashable, Sendable { public var name: String; public var artist: String; public var count: Int }
    /// The parts of a show the recap links to; `date` is ISO.
    public struct ShowRef: Codable, Hashable, Sendable {
        public var id: String; public var artist: String; public var venue: String; public var city: String; public var date: String
    }
    public struct Highlights: Codable, Hashable, Sendable {
        public var firstShow: ShowRef
        public var latestShow: ShowRef
        public var busiestMonth: BusiestMonth
        /// `nil` with no run of two or more nights.
        public var longestRun: Run?
    }
    /// `month` is 0-based (0 = January), as JavaScript counts.
    public struct BusiestMonth: Codable, Hashable, Sendable { public var month: Int; public var name: String; public var shows: Int }
    public struct Run: Codable, Hashable, Sendable {
        public var key: String; public var artist: String; public var venue: String; public var city: String
        public var nights: Int; public var start: String; public var end: String
    }
}
