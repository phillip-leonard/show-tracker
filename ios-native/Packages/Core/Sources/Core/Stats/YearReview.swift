import Foundation

// Year in Review (Stage 6, 6-10; the web's YearRecapView). One layout, from
// the recap, for every year (call F). The recap, the rare ones and the show
// buddy come from `year-recap` (6-2c, call D), computed on the server from
// your stored shows; the recap card is `my-poster`'s image (call E). Accounts
// only, like `year-recap` and the Stats card (DECISIONS, "Guests").

/// `year-recap`'s answer: `{ year, recap, rarity, buddy }`.
public struct YearRecapAnswer: Decodable, Hashable, Sendable {
    public var year: Int
    /// The review document's `recap`, else computed; `nil` for a year with
    /// no shows.
    public var recap: YearRecap?
    public var rarity: YearRarity
    /// The friend at the most of the year's shows, or `nil`.
    public var buddy: ShowBuddy?

    enum CodingKeys: String, CodingKey { case year, recap, rarity, buddy }

    public init(year: Int, recap: YearRecap?, rarity: YearRarity = .none, buddy: ShowBuddy? = nil) {
        self.year = year
        self.recap = recap
        self.rarity = rarity
        self.buddy = buddy
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        year = try c.decode(Int.self, forKey: .year)
        recap = try c.decodeIfPresent(YearRecap.self, forKey: .recap)
        rarity = (try? c.decodeIfPresent(YearRarity.self, forKey: .rarity)) ?? .none
        buddy = try? c.decodeIfPresent(ShowBuddy.self, forKey: .buddy)
    }
}

/// The rarest catch and the bust-outs witnessed (`lib/yearRecapRarity.js`),
/// for the bands with a full setlist archive.
public struct YearRarity: Codable, Hashable, Sendable {
    public var rarest: Rarest?
    public var bustOuts: [BustOut]

    public static let none = YearRarity(rarest: nil, bustOuts: [])
    public var isEmpty: Bool { rarest == nil && bustOuts.isEmpty }

    public init(rarest: Rarest?, bustOuts: [BustOut]) {
        self.rarest = rarest
        self.bustOuts = bustOuts
    }

    /// The song the band has played the fewest times ever, of the ones you
    /// heard; `date` is the last time you heard it.
    public struct Rarest: Codable, Hashable, Sendable {
        public var band: String
        public var slug: String
        public var name: String
        public var timesPlayed: Int
        public var date: String?
    }

    /// A song back after `gap` shows, at a show you were at.
    public struct BustOut: Codable, Hashable, Sendable, Identifiable {
        public var band: String
        public var slug: String
        public var name: String
        public var timesPlayed: Int?
        public var gap: Int
        public var date: String
        public var venue: String?
        public var id: String { "\(slug)|\(name)|\(date)" }
    }
}

/// `computeShowBuddy`'s friend: `{ uid, name, firstName, shows }`.
public struct ShowBuddy: Codable, Hashable, Sendable {
    public var uid: String
    public var name: String
    public var firstName: String
    public var shows: Int
}

/// What the recap card and its share link are drawn from (YearRecapView's
/// `recapPayload`): no ids, notes or names. The buddy goes as a uid; the
/// server adds their first name only for a friend with a public profile.
public struct RecapCardRequest: Encodable, Hashable, Sendable {
    public var recap: Payload
    public var buddyUid: String?
    public var buddyShows: Int?

    public struct Payload: Encodable, Hashable, Sendable {
        public var year: Int
        public var shows: Int
        public var bands: Int
        public var venues: Int
        public var songsHeard: Int
        public var newBands: Int
        public var topBands: [YearRecap.BandShows]
        public var topSongs: [YearRecap.TopSong]
        public var rarest: Rarest?
        public var bustOuts: [BustOut]
        public var busiestMonth: Month
        public var longestRun: Run?
        public var updatedThrough: String

        public struct Rarest: Encodable, Hashable, Sendable { public var name: String; public var band: String; public var timesPlayed: Int }
        public struct BustOut: Encodable, Hashable, Sendable { public var name: String; public var band: String; public var gap: Int }
        public struct Month: Encodable, Hashable, Sendable { public var month: Int; public var shows: Int }
        public struct Run: Encodable, Hashable, Sendable { public var artist: String; public var venue: String; public var nights: Int }
    }

    public init(recap: YearRecap, rarity: YearRarity, buddy: ShowBuddy?) {
        self.recap = Payload(
            year: recap.year,
            shows: recap.totalShows,
            bands: recap.totalBands,
            venues: recap.totalVenues,
            songsHeard: recap.songsHeard,
            newBands: recap.newBands,
            topBands: recap.topBands,
            topSongs: recap.topSongs,
            rarest: rarity.rarest.map { .init(name: $0.name, band: $0.band, timesPlayed: $0.timesPlayed) },
            bustOuts: rarity.bustOuts.map { .init(name: $0.name, band: $0.band, gap: $0.gap) },
            busiestMonth: .init(month: recap.highlights.busiestMonth.month, shows: recap.highlights.busiestMonth.shows),
            longestRun: recap.highlights.longestRun.map { .init(artist: $0.artist, venue: $0.venue, nights: $0.nights) },
            updatedThrough: recap.updatedThrough
        )
        buddyUid = buddy?.uid
        buddyShows = buddy?.shows
    }
}

public enum YearReview {
    /// The years you've logged a show in, plus `year`, newest first (the
    /// web's YearSelector).
    public static func years(_ shows: [Show], including year: Int? = nil) -> [Int] {
        var set = Set(shows.compactMap { Int(ShowDate.year($0.date)) })
        if let year { set.insert(year) }
        return set.filter { $0 > 0 }.sorted(by: >)
    }

    /// Whether the native screen shows a year: every year but 2026 until the
    /// promo ends (Jan 16, 2027, `RecapWindow`); until then the Stats card
    /// opens the web for 2026 (C-9).
    public static func isNative(year: Int, now: Date = Date()) -> Bool {
        year != RecapWindow.year || now >= RecapWindow.promoEndsAt
    }

    /// What the year's answer depends on, so it's asked again when one of
    /// the year's shows changes: the ids, days, bands and setlist sizes.
    public static func signature(_ shows: [Show], year: Int) -> String {
        let y = String(year)
        return shows.filter { ShowDate.year($0.date) == y }
            .map { "\($0.id)|\(ShowDate.isoDay($0.date))|\($0.artist)|\($0.setlist.count)" }
            .sorted()
            .joined(separator: "\n")
    }

    /// The title the card and the share sheet use.
    public static func title(year: Int) -> String { "My \(year) in live music" }
}

/// `year-recap` and the recap card.
public struct YearRecapClient: Sendable {
    let api: APIClient
    public init(api: APIClient) { self.api = api }

    struct Ask: Encodable, Sendable { let year: Int }

    public func answer(year: Int) async throws(APIError) -> YearRecapAnswer {
        try await api.post("year-recap", Ask(year: year), as: YearRecapAnswer.self)
    }
}

extension PosterClient {
    struct RecapBody: Encodable, Sendable {
        let action: String
        var kind: String?
        let recap: RecapCardRequest.Payload
        let buddyUid: String?
        let buddyShows: Int?

        init(action: String, kind: String? = nil, card: RecapCardRequest) {
            self.action = action
            self.kind = kind
            recap = card.recap
            buddyUid = card.buddyUid
            buddyShows = card.buddyShows
        }
    }

    /// The recap card as a PNG (`my-poster` with `recap`).
    public func recapImage(_ card: RecapCardRequest, kind: Kind) async throws(APIError) -> Data {
        try await api.send("my-poster", body: RecapBody(action: "image", kind: kind.rawValue, card: card), auth: .required,
                           timeout: .seconds(45))
    }

    /// A public page with the recap and its card (`/p/<code>/`).
    public func recapShareLink(_ card: RecapCardRequest) async throws(APIError) -> URL {
        let answer = try await api.post("my-poster", RecapBody(action: "share", card: card), as: Shared.self)
        guard let raw = answer.url, let url = URL(string: raw) else { throw .invalidResponse("my-poster share: no url") }
        return url
    }
}

extension ShowsStore {
    public var yearRecaps: YearRecapClient? { api.map(YearRecapClient.init(api:)) }
}
