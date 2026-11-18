import Foundation

/// "About <band>" (`components/EntityInfoPanel.jsx`): the Wikipedia summary
/// from `get-entity-info`, and members, genres, country, years and links
/// from `enrich-artist` (MusicBrainz and Discogs). Both are public, cached
/// on the server and counted against its metadata limit; asked for only
/// when the panel is opened, as on the web.
public struct ArtistInfo: Sendable, Equatable {
    public var wiki: Wiki?
    public var enrich: Enrich?

    /// Something to show: a summary, or anything from MusicBrainz/Discogs.
    public var found: Bool { wiki?.found == true || enrich?.found == true }

    /// The picture: Wikipedia's, else Discogs'.
    public var image: URL? { wiki?.image ?? enrich?.image }

    /// The text: Wikipedia's summary, else the Discogs profile.
    public var summary: String? {
        if let s = wiki?.summary, !s.isEmpty { return s }
        if let p = enrich?.profile, !p.isEmpty { return p }
        return nil
    }

    public struct Wiki: Decodable, Sendable, Equatable {
        public var found: Bool
        public var summary: String?
        public var description: String?
        public var image: URL?
        public var url: URL?

        enum CodingKeys: String, CodingKey { case found, summary, description, image, url }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            found = try c.decodeIfPresent(Bool.self, forKey: .found) ?? false
            summary = try c.optionalText(.summary)
            description = try c.optionalText(.description)
            image = try c.optionalText(.image).flatMap(URL.init(string:))
            url = try c.optionalText(.url).flatMap(URL.init(string:))
        }
    }

    public struct Enrich: Decodable, Sendable, Equatable {
        public var found: Bool
        public var mbid: String?
        public var discogsId: Int?
        public var country: String?
        public var activeYears: Years?
        public var genres: [String]
        public var profile: String?
        public var image: URL?
        public var members: [Member]
        public var urls: [Link]
        public var sources: Sources?

        public struct Years: Decodable, Sendable, Equatable {
            public var begin: String?
            public var end: String?
            public var ended: Bool?
        }

        public struct Member: Decodable, Sendable, Equatable, Hashable {
            public var name: String
            public var active: Bool
            enum CodingKeys: String, CodingKey { case name, active }
            public init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
                active = try c.decodeIfPresent(Bool.self, forKey: .active) ?? true
            }
        }

        public struct Link: Decodable, Sendable, Equatable, Hashable {
            public var type: String
            public var url: String
        }

        public struct Sources: Decodable, Sendable, Equatable {
            public var musicbrainz: Bool?
            public var discogs: Bool?
        }

        enum CodingKeys: String, CodingKey { case found, mbid, discogsId, country, activeYears, genres, profile, image, members, urls, sources }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            found = try c.decodeIfPresent(Bool.self, forKey: .found) ?? false
            mbid = try c.optionalText(.mbid)
            discogsId = try? c.decodeIfPresent(Int.self, forKey: .discogsId)
            country = try c.optionalText(.country)
            activeYears = try? c.decodeIfPresent(Years.self, forKey: .activeYears)
            genres = (try? c.decodeIfPresent([String].self, forKey: .genres)) ?? []
            profile = try c.optionalText(.profile)
            image = try c.optionalText(.image).flatMap(URL.init(string:))
            members = ((try? c.decodeIfPresent([Lenient<Member>].self, forKey: .members)) ?? []).compactMap(\.value).filter { !$0.name.isEmpty }
            urls = ((try? c.decodeIfPresent([Lenient<Link>].self, forKey: .urls)) ?? []).compactMap(\.value)
            sources = try? c.decodeIfPresent(Sources.self, forKey: .sources)
        }

        /// "US · 2014–present".
        public var countryAndYears: String? {
            var parts: [String] = []
            if let country { parts.append(country) }
            if let begin = activeYears?.begin {
                parts.append("\(begin)–\(activeYears?.ended == true ? (activeYears?.end ?? "") : "present")")
            }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        }

        public var musicBrainzURL: URL? {
            guard sources?.musicbrainz == true, let mbid else { return nil }
            return URL(string: "https://musicbrainz.org/artist/\(mbid)")
        }

        public var discogsURL: URL? {
            guard sources?.discogs == true, let discogsId else { return nil }
            return URL(string: "https://www.discogs.com/artist/\(discogsId)")
        }

        /// The links the web shows: website, socials, Bandcamp, YouTube,
        /// SoundCloud; never Spotify or Apple Music while playlist creation
        /// is off (F-9: left out of native). At most five, as on the web,
        /// except that two links with the same label show once (MusicBrainz
        /// often lists two Deezer pages, which the web shows as two "free
        /// streaming" links).
        public var shownLinks: [(label: String, url: URL)] {
            let kinds = ["official homepage", "social network", "bandcamp", "streaming", "youtube", "soundcloud"]
            var seen = Set<String>()
            return urls
                .filter { u in kinds.contains { u.type.contains($0) || u.url.contains($0) } }
                .filter { $0.url.range(of: #"spotify\.com|music\.apple\.com"#, options: [.regularExpression, .caseInsensitive]) == nil }
                .prefix(5)
                .compactMap { u in URL(string: u.url).map { (Self.label(u), $0) } }
                .filter { seen.insert($0.0).inserted }
        }

        /// `getLinkLabel`.
        static func label(_ u: Link) -> String {
            if u.type == "official homepage" { return "Website" }
            for (needle, name) in [("bandcamp", "Bandcamp"), ("instagram", "Instagram"), ("twitter", "X"), ("x.com", "X"),
                                   ("facebook", "Facebook"), ("spotify", "Spotify"), ("youtube", "YouTube"), ("soundcloud", "SoundCloud")]
            where u.url.contains(needle) { return name }
            // A streaming service by its site ("Deezer", "Tidal"), not "free streaming".
            if u.type.contains("streaming"), let host = URL(string: u.url)?.host?.lowercased() {
                let parts = host.split(separator: ".").filter { $0 != "www" && $0 != "open" && $0 != "music" }
                if let name = parts.dropLast().last ?? parts.first { return name.prefix(1).uppercased() + name.dropFirst() }
            }
            return u.type.prefix(1).uppercased() + u.type.dropFirst()
        }
    }

    public init(wiki: Wiki?, enrich: Enrich?) {
        self.wiki = wiki
        self.enrich = enrich
    }

    /// Both lookups at once. nil only when neither answered (offline).
    public static func load(name: String, api: APIClient) async -> ArtistInfo? {
        let band = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !band.isEmpty else { return nil }
        async let wiki = try? api.get("get-entity-info", query: ["name": band, "type": "artist"], auth: .none, as: Wiki.self)
        async let enrich = try? api.get("enrich-artist", query: ["name": band], auth: .none, as: Enrich.self)
        let (w, e) = await (wiki, enrich)
        if w == nil, e == nil { return nil }
        return ArtistInfo(wiki: w, enrich: e?.found == true ? e : nil)
    }
}
