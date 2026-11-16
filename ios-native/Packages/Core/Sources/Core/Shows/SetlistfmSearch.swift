import Foundation

/// Searching setlist.fm through our functions (`search-artists`,
/// `search-setlists`; both pass setlist.fm's JSON through, cached and under
/// the per-IP setlist.fm limit). A setlist found here is added by sending
/// its JSON, as returned, to `normalize-show` (`{ kind: 'setlistfm', setlist }`).
public struct SetlistfmSearch: Sendable {
    let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// One artist setlist.fm knows. Several can share a name; the
    /// disambiguation tells them apart ("US jam band").
    public struct Artist: Decodable, Hashable, Identifiable, Sendable {
        public var mbid: String
        public var name: String
        public var disambiguation: String?
        public var id: String { mbid }

        enum CodingKeys: String, CodingKey { case mbid, name, disambiguation }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            mbid = try c.text(.mbid)
            name = try c.text(.name)
            disambiguation = try c.optionalText(.disambiguation)
        }
        public init(mbid: String, name: String, disambiguation: String? = nil) {
            self.mbid = mbid; self.name = name; self.disambiguation = disambiguation
        }
    }

    /// One setlist: setlist.fm's JSON (sent to `normalize-show` as is) and
    /// what a result row shows.
    public struct Setlist: Hashable, Identifiable, Sendable {
        public let raw: JSONValue
        public var id: String { raw["id"]?.stringValue ?? "" }
        public var artist: String { raw["artist"]?["name"]?.stringValue ?? "" }
        public var artistMbid: String? { raw["artist"]?["mbid"]?.stringValue }
        /// ISO day (setlist.fm writes `DD-MM-YYYY`).
        public var date: String { ShowDate.fromSetlistfm(raw["eventDate"]?.stringValue) }
        public var venue: String { raw["venue"]?["name"]?.stringValue ?? "" }
        /// "Morrison, CO" or "London, GB".
        public var city: String {
            let city = raw["venue"]?["city"]
            let name = city?["name"]?.stringValue ?? ""
            let region = city?["stateCode"]?.stringValue ?? city?["country"]?["code"]?.stringValue
            return [name, region ?? ""].filter { !$0.isEmpty }.joined(separator: ", ")
        }
        public var tour: String? { raw["tour"]?["name"]?.stringValue }
        public var songCount: Int {
            guard case .array(let sets)? = raw["sets"]?["set"] else { return 0 }
            return sets.reduce(0) { n, set in
                if case .array(let songs)? = set["song"] { return n + songs.count }
                return n
            }
        }

        public init(raw: JSONValue) { self.raw = raw }
    }

    public struct Page: Sendable {
        public var setlists: [Setlist]
        public var page: Int
        public var total: Int
        public var itemsPerPage: Int
        public var hasMore: Bool { page * max(itemsPerPage, 1) < total }

        public static let empty = Page(setlists: [], page: 1, total: 0, itemsPerPage: 20)
    }

    /// What to search for: an artist (by setlist.fm id once picked, else by
    /// name), and/or a venue or city, optionally a year.
    public struct Query: Equatable, Sendable {
        public var artistMbid: String?
        public var artistName: String?
        public var year: String?
        public var venueName: String?
        public var cityName: String?

        public init(artistMbid: String? = nil, artistName: String? = nil, year: String? = nil, venueName: String? = nil, cityName: String? = nil) {
            self.artistMbid = artistMbid; self.artistName = artistName; self.year = year
            self.venueName = venueName; self.cityName = cityName
        }

        public var isEmpty: Bool { [artistMbid, artistName, venueName, cityName].allSatisfy { ($0 ?? "").trimmingCharacters(in: .whitespaces).isEmpty } }

        func parameters(page: Int) -> [String: String] {
            var q: [String: String] = ["p": String(page)]
            let put = { (key: String, value: String?) in
                if let v = value?.trimmingCharacters(in: .whitespaces), !v.isEmpty { q[key] = v }
            }
            if let mbid = artistMbid, !mbid.isEmpty { put("artistMbid", mbid) } else { put("artistName", artistName) }
            put("year", year)
            put("venueName", venueName)
            put("cityName", cityName)
            return q
        }
    }

    /// Artists by name, setlist.fm's relevance order. None found is empty.
    public func artists(named name: String) async throws(APIError) -> [Artist] {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return [] }
        do {
            let answer = try await api.get("search-artists", query: ["artistName": trimmed], auth: .optional, as: ArtistsAnswer.self)
            return answer.artist ?? []
        } catch .server(status: 404, _, _) {
            return []
        }
    }

    /// One page of setlists, newest first. None found is an empty page
    /// (setlist.fm answers 404).
    public func setlists(_ query: Query, page: Int = 1) async throws(APIError) -> Page {
        guard !query.isEmpty else { return .empty }
        do {
            let answer = try await api.get("search-setlists", query: query.parameters(page: page), auth: .optional, as: JSONValue.self)
            return Self.page(from: answer)
        } catch .server(status: 404, _, _) {
            return .empty
        }
    }

    static func page(from answer: JSONValue) -> Page {
        var setlists: [Setlist] = []
        if case .array(let list)? = answer["setlist"] { setlists = list.map(Setlist.init(raw:)) }
        return Page(setlists: setlists, page: answer["page"]?.intValue ?? 1, total: answer["total"]?.intValue ?? setlists.count,
                    itemsPerPage: answer["itemsPerPage"]?.intValue ?? 20)
    }

    /// The setlist for a night (an upcoming show someone went to): the
    /// artist's shows that year, newest first, up to three pages; the same
    /// venue wins when they played twice that day (lib/upcomingShows.js
    /// findSetlistForDate). Nil when none is found or setlist.fm can't be reached.
    public func setlist(artist: String, date: String, venue: String) async -> Setlist? {
        let year = ShowDate.year(date)
        guard !artist.isEmpty, !year.isEmpty else { return nil }
        for page in 1...3 {
            guard let found = try? await setlists(Query(artistName: artist, year: year), page: page) else { return nil }
            if let match = Self.setlist(for: date, venue: venue, in: found.setlists) { return match }
            if found.setlists.isEmpty || !found.hasMore { return nil }
            try? await Task.sleep(for: .milliseconds(600))
        }
        return nil
    }

    /// `findSetlistForDate`: the setlist on that day; of two, the same venue
    /// (exact, then contained), else the first.
    public static func setlist(for date: String, venue: String, in setlists: [Setlist]) -> Setlist? {
        let target = ShowDate.isoDay(date)
        guard !target.isEmpty else { return nil }
        let sameDay = setlists.filter { $0.date == target }
        guard sameDay.count > 1 else { return sameDay.first }
        let v = venue.trimmingCharacters(in: .whitespaces).lowercased()
        return sameDay.first { $0.venue.trimmingCharacters(in: .whitespaces).lowercased() == v }
            ?? sameDay.first { !v.isEmpty && $0.venue.lowercased().contains(v) }
            ?? sameDay.first
    }

    struct ArtistsAnswer: Decodable { var artist: [Artist]? }
}
