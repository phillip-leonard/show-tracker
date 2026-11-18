import Foundation

/// "Listen to this night" and "Where to stream this show" (Stage 4, 4-4):
/// one GET of `archival-audio-lookup`, which answers the recordings
/// Relisten has of the show (Relisten carries the Internet Archive's Live
/// Music Archive and phish.in) and, since 5.60.32, the streaming list
/// (`lib/streamingPlatforms.js`, Stage 4 call A: no Swift copy).
///
/// The function takes only an ISO `YYYY-MM-DD` date (`lib/cacheGuard.js`
/// `isoDay`), so the stored date goes through `ShowDate`; a show whose date
/// can't be read asks nothing. Recordings link out; nothing is played or
/// rehosted in the app.
public struct Listening: Decodable, Equatable, Sendable {
    public var found: Bool
    public var recordings: [Recording]
    public var streaming: [Platform]

    public struct Recording: Decodable, Equatable, Identifiable, Sendable {
        public var id: String
        /// "Soundboard", "AUD", the source's own label, or "Recording".
        public var label: String
        public var isSoundboard: Bool
        public var taper: String?
        public var transferrer: String?
        public var lineage: String?
        /// Relisten's listener rating, one decimal.
        public var avgRating: Double?
        public var numReviews: Int
        public var url: URL?
        /// The link's own label ("Listen on Relisten", "View on archive.org").
        public var linkLabel: String

        enum CodingKeys: String, CodingKey {
            case id, label, isSoundboard, taper, transferrer, lineage, avgRating, numReviews, url, linkLabel
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
            label = try c.decodeIfPresent(String.self, forKey: .label) ?? "Recording"
            isSoundboard = try c.decodeIfPresent(Bool.self, forKey: .isSoundboard) ?? false
            taper = try c.optionalText(.taper)
            transferrer = try c.optionalText(.transferrer)
            lineage = try c.optionalText(.lineage)
            avgRating = try c.decodeIfPresent(Double.self, forKey: .avgRating)
            numReviews = try c.decodeIfPresent(Int.self, forKey: .numReviews) ?? 0
            url = try c.optionalText(.url).flatMap(URL.init(string:))
            linkLabel = try c.optionalText(.linkLabel) ?? "Listen"
        }

        /// The heading on its row: "Soundboard" or the source's label.
        public var title: String { isSoundboard ? "Soundboard" : label }

        /// "Taper: X · Transfer: Y", or nil.
        public var credit: String? {
            let parts = [taper.map { "Taper: \($0)" }, transferrer.map { "Transfer: \($0)" }].compactMap { $0 }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        }
    }

    /// One place that may stream the show: nugs.net, PlayDead, Relisten, archive.org.
    public struct Platform: Decodable, Equatable, Identifiable, Sendable {
        public var name: String
        public var url: URL
        public var label: String
        public var icon: String?
        public var description: String?
        public var id: String { name }
    }

    enum CodingKeys: String, CodingKey { case found, recordings, streaming }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        found = try c.decodeIfPresent(Bool.self, forKey: .found) ?? false
        recordings = (try? c.decodeIfPresent([Recording].self, forKey: .recordings)) ?? []
        // A platform without a link is left out, not a failed answer.
        streaming = ((try? c.decodeIfPresent([Lenient<Platform>].self, forKey: .streaming)) ?? []).compactMap(\.value)
    }

    public init(found: Bool, recordings: [Recording], streaming: [Platform]) {
        self.found = found
        self.recordings = recordings
        self.streaming = streaming
    }

    /// The recordings to show: none unless the lookup found some.
    public var shownRecordings: [Recording] { found ? recordings : [] }

    /// The picked recording (`archivalAudioPick`), or the first.
    public func selected(pick: String?) -> Recording? {
        let shown = shownRecordings
        return shown.first { $0.id == pick } ?? shown.first
    }

    /// The recordings listed before "Show all": a famous show has dozens.
    public static let shortList = 3

    /// The rows to list: the first `shortList`, plus the picked one if it's
    /// further down, or all of them.
    public func listed(pick: String?, showAll: Bool) -> [Recording] {
        let shown = shownRecordings
        guard !showAll, shown.count > Self.shortList else { return shown }
        var rows = Array(shown.prefix(Self.shortList))
        if let picked = selected(pick: pick), !rows.contains(where: { $0.id == picked.id }) { rows.append(picked) }
        return rows
    }

    public static let function = "archival-audio-lookup"

    /// The query for a show, or nil when there's nothing to ask (no band,
    /// or a date that can't be read).
    public static func query(artist: String, date: String) -> [String: String]? {
        let band = artist.trimmingCharacters(in: .whitespacesAndNewlines)
        let day = ShowDate.isoDay(date)
        guard !band.isEmpty, !day.isEmpty else { return nil }
        return ["artist": band, "date": day]
    }

    /// Asks the server; nil when it can't be reached. A source being down
    /// reads as "nothing to listen to", never as an error.
    public static func lookup(artist: String, date: String, api: APIClient) async -> Listening? {
        guard let query = query(artist: artist, date: date) else { return nil }
        return try? await api.get(function, query: query, auth: .none, as: Listening.self)
    }
}

/// Decodes a value, or nil instead of failing the whole list.
struct Lenient<T: Decodable & Sendable>: Decodable, Sendable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}
