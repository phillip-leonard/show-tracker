import Foundation

// setlist.fm's side of a band's tours, through the functions the web's
// TourInfoModal and TourBrowseModal call (all keyed by the artist's
// MusicBrainz id, all behind the shared setlist.fm limit):
//   get-artist-tours       the tours setlist.fm knows, most recent first
//   get-artist-song-stats  what they play most, from recent setlists
//   get-tour-shows         every night of one tour, to add the ones you caught

/// `get-artist-tours`.
public struct ArtistTours: Decodable, Sendable, Equatable {
    public var artistName: String
    public var tours: [Tour]
    public var totalShows: Int
    /// Only the most recent pages were walked.
    public var truncated: Bool

    public struct Tour: Decodable, Sendable, Equatable, Identifiable {
        public var name: String
        /// setlist.fm's "No Tour Listed" bucket: never browsable.
        public var untagged: Bool
        public var showCount: Int
        public var startDate: String?
        public var endDate: String?
        public var avgSongCount: Int
        public var shows: [Night]
        public var id: String { "\(name)|\(startDate ?? "")" }

        public struct Night: Decodable, Sendable, Equatable {
            public var date: String
            public var venue: String
            public var city: String
            public var country: String
        }

        enum CodingKeys: String, CodingKey { case name, untagged, showCount, startDate, endDate, avgSongCount, shows }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
            untagged = try c.decodeIfPresent(Bool.self, forKey: .untagged) ?? false
            showCount = try c.decodeIfPresent(Int.self, forKey: .showCount) ?? 0
            startDate = try c.optionalText(.startDate)
            endDate = try c.optionalText(.endDate)
            avgSongCount = try c.decodeIfPresent(Int.self, forKey: .avgSongCount) ?? 0
            shows = ((try? c.decodeIfPresent([Lenient<Night>].self, forKey: .shows)) ?? []).compactMap(\.value)
        }

        public var isBrowsable: Bool { !untagged && !name.trimmingCharacters(in: .whitespaces).isEmpty && name != "No Tour Listed" }
    }

    enum CodingKeys: String, CodingKey { case artistName, tours, totalShows, truncated }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        artistName = try c.decodeIfPresent(String.self, forKey: .artistName) ?? ""
        tours = ((try? c.decodeIfPresent([Lenient<Tour>].self, forKey: .tours)) ?? []).compactMap(\.value)
        totalShows = try c.decodeIfPresent(Int.self, forKey: .totalShows) ?? 0
        truncated = try c.decodeIfPresent(Bool.self, forKey: .truncated) ?? false
    }

    /// The tour still going: it ended (by its last known night) within the
    /// last 30 days (TourInfoModal's "Current Tour").
    public func activeTour(today: String = ShowDate.today()) -> Tour? {
        tours.first { tour in
            guard let end = tour.endDate, let days = ShowDate.daysBetween(end, today) else { return false }
            return days <= 30
        }
    }

    /// The five most recent.
    public var recentTours: [Tour] { Array(tours.prefix(5)) }
}

/// `get-artist-song-stats`: every song in the setlists it read, most played first.
public struct ArtistSongStats: Decodable, Sendable, Equatable {
    public var songs: [Song]
    public var totalSetlistsFetched: Int
    public var totalSetlistsAvailable: Int

    public struct Song: Decodable, Sendable, Equatable, Identifiable {
        public var name: String
        public var count: Int
        public var plays: [Play]
        public var id: String { name }

        public struct Play: Decodable, Sendable, Equatable {
            /// setlist.fm's `DD-MM-YYYY`; read through `ShowDate`.
            public var date: String
            public var venue: String
            public var city: String
            public var setlistUrl: String?
        }
    }

    enum CodingKeys: String, CodingKey { case songs, totalSetlistsFetched, totalSetlistsAvailable }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        songs = ((try? c.decodeIfPresent([Lenient<Song>].self, forKey: .songs)) ?? []).compactMap(\.value)
        totalSetlistsFetched = try c.decodeIfPresent(Int.self, forKey: .totalSetlistsFetched) ?? 0
        totalSetlistsAvailable = try c.decodeIfPresent(Int.self, forKey: .totalSetlistsAvailable) ?? 0
    }
}

/// `get-tour-shows`: one tour's nights, each a row `normalize-show` adds as is.
public struct TourShows: Decodable, Sendable {
    public var tourName: String
    public var shows: [Night]
    public var truncated: Bool

    public struct Night: Decodable, Sendable, Identifiable, Hashable {
        /// The row as the function sent it: `ShowInput.SetlistfmSource.row`.
        public var raw: JSONValue
        public var id: String { raw["setlistfmId"]?.stringValue ?? "\(date)|\(venue)" }
        public var date: String { ShowDate.isoDay(raw["date"]?.stringValue) }
        public var artist: String { raw["artist"]?.stringValue ?? "" }
        public var venue: String { raw["venue"]?.stringValue ?? "" }
        public var city: String {
            [raw["city"]?.stringValue, raw["state"]?.stringValue ?? raw["country"]?.stringValue]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
        }
        public var songCount: Int { raw["songCount"]?.intValue ?? 0 }
        public var setlistfmId: String? { raw["setlistfmId"]?.stringValue }

        public init(from decoder: Decoder) throws { raw = try JSONValue(from: decoder) }
        public init(raw: JSONValue) { self.raw = raw }
    }

    enum CodingKeys: String, CodingKey { case tourName, shows, truncated }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tourName = try c.decodeIfPresent(String.self, forKey: .tourName) ?? ""
        shows = (try? c.decodeIfPresent([Night].self, forKey: .shows)) ?? []
        truncated = try c.decodeIfPresent(Bool.self, forKey: .truncated) ?? false
    }

    /// One of yours already (`existingShowStatus`): the same setlist.fm
    /// setlist, or the same band on the same day.
    public static func isYours(_ night: Night, in shows: [Show]) -> Bool {
        if let id = night.setlistfmId, shows.contains(where: { $0.setlistfmId == id }) { return true }
        let band = StatsKeys.bandKey(night.artist)
        return !night.date.isEmpty && shows.contains { StatsKeys.bandKey($0.artist) == band && ShowDate.isSameDay($0.date, night.date) }
    }
}

public enum TourLookups {
    /// The artist's MusicBrainz id from your own shows of them (setlist.fm
    /// imports store it), the most used one; nil when none has it.
    public static func mbid(forArtist artist: String, in shows: [Show]) -> String? {
        let key = StatsKeys.bandKey(artist)
        let ids = shows.filter { StatsKeys.bandKey($0.artist) == key }.compactMap(\.artistMbid)
        return RunIndex.mostCommon(ids)
    }

    public static func tours(mbid: String, api: APIClient) async throws(APIError) -> ArtistTours {
        try await api.get("get-artist-tours", query: ["mbid": mbid], auth: .none, as: ArtistTours.self)
    }

    public static func songStats(mbid: String, api: APIClient) async throws(APIError) -> ArtistSongStats {
        try await api.get("get-artist-song-stats", query: ["mbid": mbid], auth: .none, as: ArtistSongStats.self)
    }

    public static func tourShows(mbid: String, tourName: String, api: APIClient) async throws(APIError) -> TourShows {
        try await api.get("get-tour-shows", query: ["mbid": mbid, "tourName": tourName], auth: .none, as: TourShows.self)
    }

    /// The words to show for a failed lookup (the functions send their own
    /// for setlist.fm's rate limit and time-outs).
    public static func message(_ error: any Error) -> String {
        (error as? APIError).map { message($0) } ?? "Couldn't reach setlist.fm. Try again in a moment."
    }

    public static func message(_ error: APIError) -> String {
        switch error {
        case .offline: return "You're offline. Try again when you're connected."
        case .rateLimited: return "setlist.fm is rate limiting us right now. Try again in a minute."
        case .server(let status, _, _) where status == 504: return "setlist.fm took too long to answer. Try again."
        default: return "Couldn't reach setlist.fm. Try again in a moment."
        }
    }
}
