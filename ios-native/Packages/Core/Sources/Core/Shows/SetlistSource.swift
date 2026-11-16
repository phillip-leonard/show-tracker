import Foundation

/// `setlist-source`'s answer (5.60.22): where a band's setlists come from,
/// and the re-sync control the show page offers for it. The app asks
/// rather than keeping a copy of the band registry (DECISIONS.md, "Stage 1").
///
///   GET /.netlify/functions/setlist-source?artist=&mbid=&setlistSource=
public struct SetlistSourceAnswer: Decodable, Hashable, Sendable {
    public var artist: String
    public var source: Source
    public var resync: Resync
    /// The credit for the setlist the show has now (only when the request
    /// gave its `setlistSource`).
    public var stored: Stored?

    public struct Source: Decodable, Hashable, Sendable {
        public var id: String
        public var label: String
        public var homeUrl: String?
        public var isBandSource: Bool
        public var requiresReview: Bool
    }

    public struct Resync: Decodable, Hashable, Sendable {
        public var offered: Bool
        /// `resync` → `resync-show`; `review` → `propose-setlist`, then the
        /// review sheet and `accept-proposal` (Part 3b).
        public var action: Action?
        /// "Re-fetch from El Goose", "Get setlist from Phish.net".
        public var label: String?
        public var busyLabel: String?
        public var hint: String?

        public enum Action: String, Decodable, Sendable { case resync, review }
    }

    public struct Stored: Decodable, Hashable, Sendable {
        public var id: String
        public var label: String
        public var homeUrl: String?
    }

    /// The request's query for a show: its band, MusicBrainz id and stored source.
    public static func query(for show: Show) -> [String: String] {
        var q = ["artist": show.artist]
        if let mbid = show.artistMbid { q["mbid"] = mbid }
        if let source = show.setlistSource { q["setlistSource"] = source }
        return q
    }
}

/// Asks `setlist-source` once per band and source while the app runs. The
/// answer changes only with a deploy (the function says so in its cache
/// header), so a session's copy is enough.
@MainActor
public final class SetlistSourceCache {
    private let api: APIClient
    private var answers: [[String: String]: SetlistSourceAnswer] = [:]
    private var inFlight: [[String: String]: Task<SetlistSourceAnswer?, Never>] = [:]

    public init(api: APIClient) { self.api = api }

    /// The answer for this show, or nil when the band has no name or the
    /// request failed (offline): the page then offers no re-sync.
    public func answer(for show: Show) async -> SetlistSourceAnswer? {
        let query = SetlistSourceAnswer.query(for: show)
        guard !show.artist.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        if let known = answers[query] { return known }
        if let running = inFlight[query] { return await running.value }
        let api = self.api
        let task = Task<SetlistSourceAnswer?, Never> {
            try? await api.get("setlist-source", query: query, auth: .none, as: SetlistSourceAnswer.self)
        }
        inFlight[query] = task
        let answer = await task.value
        inFlight[query] = nil
        if let answer { answers[query] = answer }
        return answer
    }
}
