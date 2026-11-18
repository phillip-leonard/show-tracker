import Foundation

// The public band snapshot as JSON (netlify/functions/artist-api.js,
// lib/publicArtistPages.js artistJson / artistSongJson / artistsIndexJson):
//   /api/artists                     the bands with a snapshot now
//   /api/artist?slug=                band stats and every song
//   /api/artist-song?slug=&song=     one song's stats
// The same daily snapshot as the public /artist/ pages. Decoded leniently:
// setlist.fm bands have no song list and no bust-outs, and a field missing
// from an older snapshot must not fail the page.

/// `/api/artists`: one row per band that may be shown now.
public struct BandIndex: Decodable, Sendable {
    public var artists: [Entry]

    public struct Entry: Decodable, Sendable, Hashable {
        public var slug: String
        public var name: String
        public var source: String?
        public var songPages: Bool
        public var fetchedAt: String?

        enum CodingKeys: String, CodingKey { case slug, name, source, songPages, fetchedAt }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            slug = try c.decode(String.self, forKey: .slug)
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? slug
            source = try c.decodeIfPresent(String.self, forKey: .source)
            songPages = try c.decodeIfPresent(Bool.self, forKey: .songPages) ?? false
            fetchedAt = try c.decodeIfPresent(String.self, forKey: .fetchedAt)
        }
    }

    enum CodingKeys: String, CodingKey { case artists }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        artists = ((try? c.decodeIfPresent([Lenient<Entry>].self, forKey: .artists)) ?? []).compactMap(\.value)
    }
}

/// Who the snapshot is about and where its data came from.
public struct SnapshotArtist: Decodable, Sendable, Hashable {
    public var slug: String
    public var name: String
    public var source: String?
    /// "elgoose.net", "Phish.net", "setlist.fm".
    public var sourceName: String?
    public var attribution: Attribution?
    public var fetchedAt: String?
    public var songPages: Bool
    public var coverage: Coverage?

    public struct Attribution: Decodable, Sendable, Hashable {
        public var text: String
        public var url: URL
    }

    /// `full` (every show), or `window`: song stats from the most recent setlists only.
    public struct Coverage: Decodable, Sendable, Hashable {
        public var kind: String?
        public var shows: Int?
        public var from: String?
        public var to: String?
    }

    enum CodingKeys: String, CodingKey { case slug, name, source, sourceName, attribution, fetchedAt, songPages, coverage }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decodeIfPresent(String.self, forKey: .slug) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        source = try c.decodeIfPresent(String.self, forKey: .source)
        sourceName = try c.decodeIfPresent(String.self, forKey: .sourceName)
        attribution = try? c.decodeIfPresent(Attribution.self, forKey: .attribution)
        fetchedAt = try c.decodeIfPresent(String.self, forKey: .fetchedAt)
        songPages = try c.decodeIfPresent(Bool.self, forKey: .songPages) ?? false
        coverage = try? c.decodeIfPresent(Coverage.self, forKey: .coverage)
    }
}

/// A night of the band's: date, venue, city, its page on the source.
public struct SnapshotShow: Decodable, Sendable, Hashable {
    public var date: String
    public var venue: String
    public var city: String
    public var url: URL?

    enum CodingKeys: String, CodingKey { case date, venue, city, url }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        venue = try c.decodeIfPresent(String.self, forKey: .venue) ?? ""
        city = try c.decodeIfPresent(String.self, forKey: .city) ?? ""
        url = (try? c.decodeIfPresent(String.self, forKey: .url)).flatMap { $0.flatMap(URL.init(string:)) }
    }
}

/// A song in one of the band page's lists.
public struct SnapshotSong: Decodable, Sendable, Hashable, Identifiable {
    public var slug: String?
    public var name: String
    /// nil when the source doesn't say.
    public var isOriginal: Bool?
    public var timesPlayed: Int
    /// Shows since it was last played.
    public var currentGap: Int
    public var lastPlayed: String?
    /// Bust-outs: the gap and the nights it ran between.
    public var longestGap: Int?
    public var gapStart: SnapshotShow?
    public var gapEnd: SnapshotShow?

    public var id: String { slug ?? name }

    enum CodingKeys: String, CodingKey { case slug, name, isOriginal, timesPlayed, currentGap, lastPlayed, longestGap, gapStart, gapEnd }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decodeIfPresent(String.self, forKey: .slug)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        isOriginal = try c.decodeIfPresent(Bool.self, forKey: .isOriginal)
        timesPlayed = try c.decodeIfPresent(Int.self, forKey: .timesPlayed) ?? 0
        currentGap = try c.decodeIfPresent(Int.self, forKey: .currentGap) ?? 0
        lastPlayed = try c.decodeIfPresent(String.self, forKey: .lastPlayed)
        longestGap = try c.decodeIfPresent(Int.self, forKey: .longestGap)
        // The full song list carries the gap's ends as dates; the bust-out list as nights.
        gapStart = try? c.decodeIfPresent(SnapshotShow.self, forKey: .gapStart)
        gapEnd = try? c.decodeIfPresent(SnapshotShow.self, forKey: .gapEnd)
    }
}

/// `/api/artist?slug=`: the band page.
public struct BandSnapshot: Decodable, Sendable {
    public var artist: SnapshotArtist
    public var band: Stats
    /// Every song, for the song slugs (bands with song pages only).
    public var songs: [SnapshotSong]

    public struct Stats: Decodable, Sendable {
        public var totalShows: Int
        public var firstShow: SnapshotShow?
        public var lastShow: SnapshotShow?
        public var recentShows: [SnapshotShow]
        public var songCount: Int
        public var mostPlayed: [SnapshotSong]
        public var originalGapLeaders: [SnapshotSong]
        public var coverGapLeaders: [SnapshotSong]
        /// Since 5.47.13; when present, the page splits overdue from long gone.
        public var overdueOriginals: [SnapshotSong]?
        public var overdueCovers: [SnapshotSong]
        public var notPlayedSince: [SnapshotSong]
        public var bustOuts: [SnapshotSong]

        enum CodingKeys: String, CodingKey {
            case totalShows, firstShow, lastShow, recentShows, songCount, mostPlayed, originalGapLeaders,
                 coverGapLeaders, overdueOriginals, overdueCovers, notPlayedSince, bustOuts
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            func list<T: Decodable & Sendable>(_ key: CodingKeys, _: T.Type) -> [T] {
                ((try? c.decodeIfPresent([Lenient<T>].self, forKey: key)) ?? []).compactMap(\.value)
            }
            totalShows = try c.decodeIfPresent(Int.self, forKey: .totalShows) ?? 0
            firstShow = try? c.decodeIfPresent(SnapshotShow.self, forKey: .firstShow)
            lastShow = try? c.decodeIfPresent(SnapshotShow.self, forKey: .lastShow)
            recentShows = list(.recentShows, SnapshotShow.self)
            songCount = try c.decodeIfPresent(Int.self, forKey: .songCount) ?? 0
            mostPlayed = list(.mostPlayed, SnapshotSong.self)
            originalGapLeaders = list(.originalGapLeaders, SnapshotSong.self)
            coverGapLeaders = list(.coverGapLeaders, SnapshotSong.self)
            overdueOriginals = (try? c.decodeIfPresent([Lenient<SnapshotSong>].self, forKey: .overdueOriginals))?.flatMap { $0.compactMap(\.value) }
            overdueCovers = list(.overdueCovers, SnapshotSong.self)
            notPlayedSince = list(.notPlayedSince, SnapshotSong.self)
            bustOuts = list(.bustOuts, SnapshotSong.self)
        }

        /// Song stats come from the most recent setlists, not every show.
        public func isWindowed(_ artist: SnapshotArtist) -> Bool {
            artist.coverage?.kind == "window" && (artist.coverage?.shows ?? 0) < totalShows
        }
    }

    enum CodingKeys: String, CodingKey { case artist, band, songs }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        artist = try c.decode(SnapshotArtist.self, forKey: .artist)
        band = try c.decode(Stats.self, forKey: .band)
        songs = ((try? c.decodeIfPresent([Lenient<SnapshotSong>].self, forKey: .songs)) ?? []).compactMap(\.value)
    }
}

/// `/api/artist-song?slug=&song=`: the band's song page.
public struct BandSongSnapshot: Decodable, Sendable {
    public var artist: SnapshotArtist
    public var song: Song

    public struct Song: Decodable, Sendable {
        public var name: String
        public var isOriginal: Bool?
        public var originalArtist: String?
        public var timesPlayed: Int
        public var firstPlayed: SnapshotShow?
        public var lastPlayed: SnapshotShow?
        public var currentGap: Int
        public var longestGap: Int?
        public var gapStart: SnapshotShow?
        public var gapEnd: SnapshotShow?
        public var recentPerformances: [SnapshotShow]
        /// Every performance on the source.
        public var sourceUrl: URL?

        enum CodingKeys: String, CodingKey {
            case name, isOriginal, originalArtist, timesPlayed, firstPlayed, lastPlayed, currentGap, longestGap,
                 gapStart, gapEnd, recentPerformances, sourceUrl
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
            isOriginal = try c.decodeIfPresent(Bool.self, forKey: .isOriginal)
            originalArtist = try c.decodeIfPresent(String.self, forKey: .originalArtist).flatMap { $0.isEmpty ? nil : $0 }
            timesPlayed = try c.decodeIfPresent(Int.self, forKey: .timesPlayed) ?? 0
            firstPlayed = try? c.decodeIfPresent(SnapshotShow.self, forKey: .firstPlayed)
            lastPlayed = try? c.decodeIfPresent(SnapshotShow.self, forKey: .lastPlayed)
            currentGap = try c.decodeIfPresent(Int.self, forKey: .currentGap) ?? 0
            longestGap = try c.decodeIfPresent(Int.self, forKey: .longestGap)
            gapStart = try? c.decodeIfPresent(SnapshotShow.self, forKey: .gapStart)
            gapEnd = try? c.decodeIfPresent(SnapshotShow.self, forKey: .gapEnd)
            recentPerformances = ((try? c.decodeIfPresent([Lenient<SnapshotShow>].self, forKey: .recentPerformances)) ?? []).compactMap(\.value)
            sourceUrl = (try? c.decodeIfPresent(String.self, forKey: .sourceUrl)).flatMap { $0.flatMap(URL.init(string:)) }
        }

        /// "Original", "Cover (Vampire Weekend)", "Cover", or nil (`songKind`).
        public var kind: String? {
            switch isOriginal {
            case true?: return "Original"
            case false?: return originalArtist.map { "Cover (\($0))" } ?? "Cover"
            case nil: return nil
            }
        }
    }
}
