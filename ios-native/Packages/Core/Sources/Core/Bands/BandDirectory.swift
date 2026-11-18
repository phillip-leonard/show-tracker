import Foundation

/// A band with a public snapshot (`config/public-artists.json`, bundled as
/// `Config`): the Swift side of `lib/bandScreens.js` `PUBLIC_BANDS`.
public struct PublicBand: Hashable, Sendable {
    public var slug: String
    public var name: String
    /// songfish, phishnet or setlistfm.
    public var source: String
    /// Song pages (`/bands/?band=&song=`): the archive bands, not setlist.fm's.
    public var songPages: Bool
    /// `artistNameKeyLoose`, which is Stats' `bandKey`: "Goose (US)" is Goose.
    public var key: String

    public init(slug: String, name: String, source: String, songPages: Bool) {
        self.slug = slug
        self.name = name
        self.source = source
        self.songPages = songPages
        self.key = StatsKeys.bandKey(name)
    }
}

/// Which bands have a band page, and which band a name or a link means.
///
/// Any band gets a page in the app: your own side of it (your shows, songs
/// heard, most heard) and artist info. A band in `public-artists.json` also
/// gets its own stats from the snapshot (Stage 4, 4-5). The web sends an
/// unknown band to Top Artists instead; the native app has no Top Artists
/// screen to send it to, and your own side needs no snapshot.
public enum BandDirectory {
    /// Every configured band, from the bundled config.
    public static let configured: [PublicBand] = load()

    /// The configured band for an artist name ("Goose", "goose (US)").
    public static func band(forArtist name: String?) -> PublicBand? {
        let key = StatsKeys.bandKey(name)
        guard !key.isEmpty else { return nil }
        return configured.first { $0.key == key }
    }

    /// The configured band a link's slug names: the config slug (what the
    /// server's links use: tour pushes, the welcome email), or the app's own
    /// slug of a band name (`BandFollows.slug`, which writes "King Gizzard &
    /// the Lizard Wizard" as `king-gizzard-the-lizard-wizard`).
    public static func band(forSlug slug: String) -> PublicBand? {
        let s = slug.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        return configured.first { $0.slug == s } ?? configured.first { BandFollows.slug($0.name) == s }
    }

    /// The slug a band page is opened with from the app: the config slug for
    /// a public band (so its web page is the same link), else the band's own.
    public static func slug(forArtist name: String) -> String {
        band(forArtist: name)?.slug ?? BandFollows.slug(name)
    }

    // MARK: The Phish rule

    /// How long phish.net data may be shown after it was fetched.
    public static let phishnetMaxAge: TimeInterval = 24 * 3600

    /// `isShowable`: only phish.net data expires.
    public static func isShowable(source: String?, fetchedAt: String?, now: Date = Date()) -> Bool {
        guard source == "phishnet" else { return true }
        guard let fetchedAt, let at = parseInstant(fetchedAt) else { return false }
        return now.timeIntervalSince(at) < phishnetMaxAge
    }

    static func parseInstant(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    // MARK: Loading the config

    struct ConfigFile: Decodable {
        var artists: [Entry]
        struct Entry: Decodable {
            var slug: String
            var name: String
            var source: String
            var songPages: Bool?
        }
    }

    static func load(bundle: Bundle = .module) -> [PublicBand] {
        guard let url = bundle.url(forResource: "public-artists", withExtension: "json", subdirectory: "Config"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(ConfigFile.self, from: data) else { return [] }
        return file.artists.map { PublicBand(slug: $0.slug, name: $0.name, source: $0.source, songPages: $0.songPages ?? false) }
    }
}

/// Song titles other sources spell differently from the band's own archive
/// (`config/song-title-aliases.json`): El Goose's "Same Old Shenanigans" is
/// setlist.fm's "SOS". Keyed by the band's `artistNameKey`.
public enum SongTitleAliases {
    /// normalized alias → (normalized target, target as written), for one band.
    public static func forBand(_ name: String) -> [String: (key: String, name: String)] {
        guard let entry = all[StatsKeys.artistNameKey(name)] else { return [:] }
        var out: [String: (key: String, name: String)] = [:]
        for (from, to) in entry {
            let f = StatsKeys.normalizeSongTitle(from)
            let t = StatsKeys.normalizeSongTitle(to)
            if !f.isEmpty, !t.isEmpty, f != t { out[f] = (t, to) }
        }
        return out
    }

    static let all: [String: [String: String]] = load()

    static func load(bundle: Bundle = .module) -> [String: [String: String]] {
        guard let url = bundle.url(forResource: "song-title-aliases", withExtension: "json", subdirectory: "Config"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        var out: [String: [String: String]] = [:]
        for (band, value) in json {
            // "_comment" and anything else that isn't a map of titles.
            if let map = value as? [String: String] { out[band] = map }
        }
        return out
    }
}

/// Why a band's or a song's stats aren't here.
public enum BandLoadError: Error, Equatable, Sendable {
    /// phish.net data past its 24 hours (the server's 503).
    case unavailable
    /// No snapshot for this band or song.
    case notFound
    /// Offline, or the server didn't answer.
    case network
}

/// Loads the snapshot JSON and keeps it for the session, per band and per
/// song (`loadBand`, `loadBandSong`). A Phish answer past its 24 hours is
/// dropped from the cache and refused, never shown.
@MainActor
public final class BandService {
    public static let shared = BandService()

    private var index: [String: BandIndex.Entry]?
    private var bands: [String: BandSnapshot] = [:]
    private var songs: [String: BandSongSnapshot] = [:]

    public init() {}

    /// The configured band for an artist that has a snapshot now. Offline
    /// (no index), every configured band counts, so its page shows the
    /// error state rather than no stats at all (`loadBandIndex`).
    public func showableBand(forArtist name: String, api: APIClient) async -> PublicBand? {
        guard let band = BandDirectory.band(forArtist: name) else { return nil }
        return await isShowable(band, api: api) ? band : nil
    }

    public func isShowable(_ band: PublicBand, api: APIClient) async -> Bool {
        if index == nil, let loaded = try? await api.get(path: "/api/artists", query: [:], as: BandIndex.self) {
            index = Dictionary(loaded.artists.map { ($0.slug, $0) }, uniquingKeysWith: { a, _ in a })
        }
        guard let index else { return true }
        guard let entry = index[band.slug] else { return false }
        return BandDirectory.isShowable(source: entry.source, fetchedAt: entry.fetchedAt)
    }

    public func cachedBand(_ slug: String, now: Date = Date()) -> BandSnapshot? {
        guard let hit = bands[slug] else { return nil }
        if BandDirectory.isShowable(source: hit.artist.source, fetchedAt: hit.artist.fetchedAt, now: now) { return hit }
        bands[slug] = nil
        return nil
    }

    public func cachedSong(_ slug: String, song: String, now: Date = Date()) -> BandSongSnapshot? {
        let key = "\(slug)/\(song)"
        guard let hit = songs[key] else { return nil }
        if BandDirectory.isShowable(source: hit.artist.source, fetchedAt: hit.artist.fetchedAt, now: now) { return hit }
        songs[key] = nil
        return nil
    }

    public func band(_ slug: String, api: APIClient) async throws(BandLoadError) -> BandSnapshot {
        if let hit = cachedBand(slug) { return hit }
        let body: BandSnapshot = try await fetch("/api/artist", ["slug": slug], api: api)
        // A stale CDN copy past the limit is refused, not shown.
        guard BandDirectory.isShowable(source: body.artist.source, fetchedAt: body.artist.fetchedAt) else { throw .unavailable }
        bands[slug] = body
        return body
    }

    public func song(_ slug: String, song: String, api: APIClient) async throws(BandLoadError) -> BandSongSnapshot {
        if let hit = cachedSong(slug, song: song) { return hit }
        let body: BandSongSnapshot = try await fetch("/api/artist-song", ["slug": slug, "song": song], api: api)
        guard BandDirectory.isShowable(source: body.artist.source, fetchedAt: body.artist.fetchedAt) else { throw .unavailable }
        songs["\(slug)/\(song)"] = body
        return body
    }

    private func fetch<T: Decodable & Sendable>(_ path: String, _ query: [String: String], api: APIClient) async throws(BandLoadError) -> T {
        do {
            return try await api.get(path: path, query: query, as: T.self)
        } catch .server(let status, _, _) where status == 503 {
            throw .unavailable
        } catch .server(let status, _, _) where status == 404 {
            throw .notFound
        } catch {
            throw .network
        }
    }
}
