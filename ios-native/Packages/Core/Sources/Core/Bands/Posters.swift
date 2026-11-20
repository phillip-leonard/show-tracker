import Foundation

// Posters (Stage 6, 6-9): your own "Songs I've heard" record and poster
// for any band (the web's /my-poster/), built and drawn by `my-poster` from
// your stored shows (5.60.41, call G), and the links into the web's Songs
// I've heard tool for the bands with a full setlist archive (F-11).

/// The web's "Songs I've heard" tool (lib/heardLinks.js): a web page for
/// the archive bands, opened on the poster made from your shows.
public enum HeardTool {
    /// The bands the tool covers (lib/publicBands.js HEARD_BANDS).
    public static let bands: [PublicBand] = BandDirectory.configured.filter {
        $0.songPages && ($0.source == "songfish" || $0.source == "phishnet")
    }

    public static func band(forArtist name: String?) -> PublicBand? {
        let key = StatsKeys.bandKey(name)
        guard !key.isEmpty else { return nil }
        return bands.first { $0.key == key }
    }

    public struct BandShows: Identifiable, Hashable, Sendable {
        public let band: PublicBand
        /// ISO day and venue, as the tool matches them.
        public let shows: [Seen]
        public var id: String { band.slug }

        public struct Seen: Hashable, Sendable {
            public let date: String
            public let venue: String
        }
    }

    /// Your shows per tool band, most shows first (heardBandsFor).
    public static func bandsFor(_ shows: [Show]) -> [BandShows] {
        var bySlug: [String: [BandShows.Seen]] = [:]
        for show in shows {
            guard let band = band(forArtist: show.artist) else { continue }
            let day = ShowDate.isoDay(show.date)
            guard !day.isEmpty else { continue }
            bySlug[band.slug, default: []].append(.init(date: day, venue: show.venue))
        }
        return bands.compactMap { band in bySlug[band.slug].map { BandShows(band: band, shows: $0) } }
            .enumerated()
            .sorted { ($1.element.shows.count, $0.offset) < ($0.element.shows.count, $1.offset) }
            .map(\.element)
    }

    /// The tool's page for a band, opening on the poster made from `shows`
    /// (heardHref): the shows travel in the fragment, so they never reach a
    /// server.
    public static func url(slug: String, shows: [BandShows.Seen]) -> URL {
        var text = "\(DeepLink.webOrigin.absoluteString)/heard/\(slug)/?mine=1"
        let pairs = shows.map { [$0.date, $0.venue] }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        if !pairs.isEmpty, let json = try? encoder.encode(pairs) {
            text += "#mine=" + json.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        return URL(string: text)!
    }

    public static func url(for band: PublicBand, shows: [Show]) -> URL {
        url(slug: band.slug, shows: bandsFor(shows).first { $0.band.slug == band.slug }?.shows ?? [])
    }
}

/// What a poster is drawn from (heardRecord.js cleanPersonalRecord).
public struct PosterRecord: Codable, Hashable, Sendable {
    public struct ShowRef: Codable, Hashable, Sendable {
        public var date: String
        public var venue: String
        public var city: String
    }

    public struct Song: Codable, Hashable, Sendable, Identifiable {
        public var name: String
        public var count: Int
        public var firstHeard: String
        public var lastHeard: String
        public var id: String { name }
    }

    public var name: String
    public var shows: Int
    public var showsWithSetlist: Int
    public var years: Int
    public var venues: Int
    public var uniqueSongs: Int
    public var totalSongs: Int
    public var firstShow: ShowRef?
    public var lastShow: ShowRef?
    public var songs: [Song]
    /// The ten most heard.
    public var top: [Song]

    /// "2016" or "2016–2026".
    public var yearSpan: String {
        guard let first = firstShow?.date.prefix(4), let last = lastShow?.date.prefix(4) else { return "" }
        return first == last ? String(first) : "\(first)–\(last)"
    }
}

/// `my-poster` `record`'s answer.
public struct PosterAnswer: Decodable, Hashable, Sendable {
    public struct Archive: Decodable, Hashable, Sendable { public var slug: String; public var name: String }
    public struct NoSetlist: Decodable, Hashable, Sendable, Identifiable {
        public var id: String
        public var date: String
        public var venue: String
        public var city: String
    }

    public var record: PosterRecord?
    /// Enough shows with a setlist for a poster.
    public var eligible: Bool
    public var name: String
    public var archive: Archive?
    public var shows: Int
    public var noSetlist: [NoSetlist]
}

/// The songs list's orders (MyPosterView.jsx EverySong).
public enum PosterSort: String, CaseIterable, Identifiable, Sendable {
    case mostHeard, name, firstHeard, lastHeard

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .mostHeard: "Most heard"
        case .name: "A–Z"
        case .firstHeard: "First heard"
        case .lastHeard: "Last heard"
        }
    }

    /// The record's songs come most heard first already.
    public func sorted(_ songs: [PosterRecord.Song]) -> [PosterRecord.Song] {
        let byName: (PosterRecord.Song, PosterRecord.Song) -> Bool = {
            $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
        switch self {
        case .mostHeard: return songs
        case .name: return songs.sorted(by: byName)
        case .firstHeard:
            return songs.sorted {
                let a = $0.firstHeard.isEmpty ? "9999" : $0.firstHeard, b = $1.firstHeard.isEmpty ? "9999" : $1.firstHeard
                return a == b ? byName($0, $1) : a < b
            }
        case .lastHeard:
            return songs.sorted { $0.lastHeard == $1.lastHeard ? byName($0, $1) : $0.lastHeard > $1.lastHeard }
        }
    }
}

/// "Make my poster" shows for a band with this many shows with a setlist
/// (lib/myPoster.js MIN_SHOWS_WITH_SETLIST).
public enum MyPoster {
    public static let minShowsWithSetlist = 2

    public static let archiveNote = "Rarest catches and bust-outs are available for bands with a full setlist archive: Goose, Phish, Umphrey's McGee and King Gizzard."

    /// Whether a poster can be made from your shows of this band (the
    /// server decides again).
    public static func canMake(_ shows: [Show], artist: String) -> Bool {
        let key = StatsKeys.bandKey(artist)
        guard !key.isEmpty else { return false }
        return shows.filter { StatsKeys.bandKey($0.artist) == key && $0.setlist.contains { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty } }
            .count >= minShowsWithSetlist
    }
}

/// `my-poster`, by band: the record, the two images and the share link,
/// each built on the server from your stored shows.
public struct PosterClient: Sendable {
    let api: APIClient
    public init(api: APIClient) { self.api = api }

    public enum Kind: String, Sendable, CaseIterable { case feed, story }

    struct Request: Encodable, Sendable {
        let action: String
        let artist: String
        var kind: String?
    }

    struct Shared: Decodable { let ok: Bool; let url: String? }

    public func record(artist: String) async throws(APIError) -> PosterAnswer {
        try await api.post("my-poster", Request(action: "record", artist: artist), as: PosterAnswer.self)
    }

    /// The poster as a PNG.
    public func image(artist: String, kind: Kind) async throws(APIError) -> Data {
        try await api.send("my-poster", body: Request(action: "image", artist: artist, kind: kind.rawValue), auth: .required,
                           timeout: .seconds(45))
    }

    /// A public link to the record and poster, with no name or notes on it.
    public func shareLink(artist: String) async throws(APIError) -> URL {
        let answer = try await api.post("my-poster", Request(action: "share", artist: artist), as: Shared.self)
        guard let raw = answer.url, let url = URL(string: raw) else { throw .invalidResponse("my-poster share: no url") }
        return url
    }

    public static func message(for error: APIError) -> String {
        switch error {
        case .offline: "You're offline. Posters are drawn on the server, so they need a connection."
        case .accountRequired: "Create a free account to share your poster."
        case .rateLimited: "That's a lot of posters for one day. Try again tomorrow."
        case .server(_, let m, _) where m == "not_eligible":
            "Add setlists to at least \(MyPoster.minShowsWithSetlist) of these shows to make a poster."
        default: "Couldn't make the poster. Try again."
        }
    }
}

// MARK: - Save these shows to MySetlists

/// A selection from the Songs I've heard tool (`/shows/?heard=<slug>.<code>`):
/// the shows `/api/artist-shows?slug=&code=` names, with their setlists.
public struct HeardSelection: Decodable, Sendable {
    public struct Artist: Decodable, Sendable { public var slug: String; public var name: String }
    public struct Night: Decodable, Sendable {
        public struct Track: Decodable, Sendable {
            public var name: String
            public var set: String?
            public var cover: String?
        }
        public var date: String
        public var venue: String
        public var city: String?
        public var tour: String?
        public var setlist: [Track]
    }

    public var artist: Artist
    public var shows: [Night]

    /// `slug.code`, as the link carries it, split; nil when malformed.
    public static func parts(_ value: String) -> (slug: String, code: String)? {
        let pieces = value.split(separator: ".", maxSplits: 1).map(String.init)
        guard pieces.count == 2, pieces[0].range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil,
              !pieces[1].isEmpty, pieces[1].count <= 400 else { return nil }
        return (pieces[0], pieces[1])
    }

    /// Each night as a typed show with its setlist (HeardSaveModal.jsx
    /// toCandidate); `normalize-show` adds the band source's details.
    public func inputs() -> [(input: ShowInput, display: QueuedShow.Display)] {
        shows.map { night in
            let songs: [JSONValue] = night.setlist.enumerated().map { i, track in
                var song: [String: JSONValue] = ["id": .string("h\(i)"), "name": .string(track.name), "tape": .bool(false)]
                if let set = track.set { song["set"] = .string(set) }
                song["cover"] = track.cover.map(JSONValue.string) ?? .null
                return .object(song)
            }
            let manual = ShowInput.ManualShow(artist: artist.name, venue: night.venue, city: night.city, date: night.date,
                                              tour: night.tour.flatMap { $0.isEmpty ? nil : $0 }, setlist: songs)
            return (ShowInput(.manual(manual, .none)),
                    QueuedShow.Display(artist: artist.name, venue: night.venue, city: night.city ?? "", date: night.date))
        }
    }
}

/// What saving a selection came to.
public struct HeardSaveResult: Equatable, Sendable {
    public var added = 0
    /// Already in your shows (or the same band and day elsewhere).
    public var already = 0
    /// Saved on this phone, waiting for a connection.
    public var queued = 0
    public var failed: [String] = []
    public init() {}
}

extension ShowsStore {
    public var posters: PosterClient? { api.map(PosterClient.init(api:)) }

    /// The selection a `heard=` link names.
    public func heardSelection(_ value: String) async throws(APIError) -> HeardSelection {
        guard let api, let parts = HeardSelection.parts(value) else { throw .invalidResponse("heard: bad link") }
        return try await api.get(path: "/api/artist-shows", query: ["slug": parts.slug, "code": parts.code], as: HeardSelection.self)
    }

    /// Saves a selection's nights (HeardSaveModal.jsx): the ones already in
    /// your shows are left out first (a `normalize-show` preview, the
    /// server's duplicate rule), then the rest are committed 25 at a time
    /// through the outbox (`importRows`). Offline, they wait there like any add.
    public func saveHeard(_ selection: HeardSelection) async -> HeardSaveResult {
        var result = HeardSaveResult()
        let items = selection.inputs()
        var fresh: [(input: ShowInput, display: QueuedShow.Display)] = []
        if let api {
            for chunk in Self.chunks(items) {
                do {
                    let answer = try await api.post("normalize-show", NormalizeShowRequest.batch(chunk.map(\.input), .preview),
                                                    as: NormalizeShowBatchResponse.self)
                    for (item, r) in zip(chunk, answer.results) {
                        if let dup = r.duplicate, !dup.isPossible { result.already += 1 } else if r.error == nil { fresh.append(item) }
                        else { result.failed.append(item.display.date) }
                    }
                } catch {
                    // Offline or busy: send them all; the server checks again on commit.
                    fresh.append(contentsOf: chunk)
                }
            }
        } else {
            fresh = items
        }
        for chunk in Self.chunks(fresh) {
            let outcomes = await importRows(chunk)
            for (item, outcome) in zip(chunk, outcomes) {
                switch outcome {
                case .added: result.added += 1
                case .alreadyThere, .skippedPossible: result.already += 1
                case .queued: result.queued += 1
                case .refused: result.failed.append(item.display.date)
                }
            }
        }
        return result
    }
}
