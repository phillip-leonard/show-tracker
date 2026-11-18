import Foundation
import Testing
@testable import Core

/// The band page (Stage 4, 4-5): which band a name or link means, the Phish
/// rule, the snapshot JSON, your side of a band, artist info.
struct BandsTests {
    private func show(_ id: String, _ artist: String, _ date: String, _ songs: [String]) throws -> Show {
        let setlist = songs.enumerated().map { ["id": "\(id)-\($0.offset)", "name": $0.element, "set": "Set I"] }
        let json: [String: Any] = ["id": id, "artist": artist, "venue": "Venue \(id)", "city": "City", "date": date, "setlist": setlist]
        return try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: json))
    }

    // MARK: The directory

    @Test func theBundledConfigIsTheRepos() throws {
        // The repo's file, next to these sources (the app bundles it through the Config symlink).
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("config/public-artists.json")
        let data = try Data(contentsOf: file)
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let artists = try #require(json["artists"] as? [[String: Any]])
        #expect(BandDirectory.configured.map(\.slug) == artists.compactMap { $0["slug"] as? String })
        #expect(BandDirectory.configured.count >= 20)
        #expect(BandDirectory.configured.first { $0.slug == "goose" }?.songPages == true)
        #expect(BandDirectory.configured.first { $0.slug == "billy-strings" }?.songPages == false)
    }

    @Test func aNameFindsItsPublicBandTheWayTheWebDoes() {
        #expect(BandDirectory.band(forArtist: "Goose")?.slug == "goose")
        #expect(BandDirectory.band(forArtist: "goose (US)")?.slug == "goose", "artistNameKeyLoose")
        #expect(BandDirectory.band(forArtist: "String Cheese Incident")?.slug == "string-cheese-incident", "the article")
        #expect(BandDirectory.band(forArtist: "  Phish ")?.slug == "phish")
        #expect(BandDirectory.band(forArtist: "Some Local Band") == nil)
        #expect(BandDirectory.band(forArtist: "") == nil)
    }

    @Test func aLinkFindsItsBandByEitherSlug() {
        #expect(BandDirectory.band(forSlug: "king-gizzard-and-the-lizard-wizard")?.name == "King Gizzard & the Lizard Wizard")
        // The app's own slug of the name (BandFollows.slug) drops the "&".
        #expect(BandDirectory.band(forSlug: "king-gizzard-the-lizard-wizard")?.slug == "king-gizzard-and-the-lizard-wizard")
        #expect(BandDirectory.band(forSlug: "the-string-cheese-incident")?.slug == "string-cheese-incident")
        #expect(BandDirectory.band(forSlug: "nobody") == nil)
        #expect(BandDirectory.slug(forArtist: "King Gizzard & the Lizard Wizard") == "king-gizzard-and-the-lizard-wizard")
        #expect(BandDirectory.slug(forArtist: "Some Local Band") == "some-local-band")
    }

    @Test func phishNetDataIsShownForADay() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let iso = { (d: Date) in ISO8601DateFormatter().string(from: d) }
        #expect(BandDirectory.isShowable(source: "phishnet", fetchedAt: iso(now.addingTimeInterval(-23 * 3600)), now: now))
        #expect(!BandDirectory.isShowable(source: "phishnet", fetchedAt: iso(now.addingTimeInterval(-25 * 3600)), now: now))
        #expect(!BandDirectory.isShowable(source: "phishnet", fetchedAt: nil, now: now))
        #expect(BandDirectory.isShowable(source: "songfish", fetchedAt: nil, now: now), "only phish.net expires")
        #expect(BandDirectory.parseInstant("2026-11-18T00:20:38.660Z") != nil)
        #expect(BandDirectory.parseInstant("2026-11-18T00:20:38Z") != nil)
    }

    // MARK: The snapshot

    @Test func theBandAnswerDecodes() throws {
        let json = #"""
        {"ok":true,"schemaVersion":2,
         "artist":{"slug":"goose","name":"Goose","source":"songfish","sourceName":"elgoose.net",
                   "attribution":{"text":"Setlist data from elgoose.net","url":"https://elgoose.net/"},
                   "fetchedAt":"2026-11-18T00:20:38.660Z","songPages":true,"coverage":{"kind":"full","shows":685,"fullHistory":true}},
         "band":{"totalShows":853,
                 "firstShow":{"date":"2014-09-27","venue":"Jimmy's Seaside Tavern","city":"Stamford, CT","url":"https://elgoose.net/a"},
                 "lastShow":{"date":"2026-11-16","venue":"Ridgefield Playhouse","city":"Ridgefield, CT"},
                 "recentShows":[{"date":"2026-11-16","venue":"Ridgefield Playhouse","city":"Ridgefield, CT"}],
                 "songCount":369,
                 "mostPlayed":[{"slug":"arcadia","name":"Arcadia","isOriginal":true,"timesPlayed":223,"currentGap":2,"lastPlayed":"2026-11-14","hasPage":true}],
                 "originalGapLeaders":[],"coverGapLeaders":[],
                 "overdueOriginals":[{"slug":"life-on-the-shelf","name":"Life On The Shelf","isOriginal":true,"timesPlayed":9,"currentGap":309,"lastPlayed":"2022-10-14"}],
                 "overdueCovers":[],"notPlayedSince":[],
                 "bustOuts":[{"slug":"it-burns-within","name":"It Burns Within","timesPlayed":12,"longestGap":416,
                              "gapStart":{"date":"2015-02-20","venue":"V","city":"C"},"gapEnd":{"date":"2020-11-06","venue":"South Farms","city":"Morris, CT"}}]},
         "songs":[{"slug":"same-old-shenanigans","name":"Same Old Shenanigans","isOriginal":true,"timesPlayed":40,"currentGap":4,"gapStart":"2021-10-08","gapEnd":"2021-12-31"},
                  {"slug":"arcadia","name":"Arcadia","isOriginal":true,"timesPlayed":223,"currentGap":2}]}
        """#
        let s = try JSONDecoder().decode(BandSnapshot.self, from: Data(json.utf8))
        #expect(s.artist.songPages && s.artist.attribution?.url.absoluteString == "https://elgoose.net/")
        #expect(s.band.totalShows == 853 && s.band.firstShow?.venue == "Jimmy's Seaside Tavern")
        #expect(s.band.mostPlayed.first?.timesPlayed == 223)
        #expect(s.band.overdueOriginals?.count == 1, "present: the page splits overdue from long gone")
        #expect(s.band.bustOuts.first?.gapEnd?.date == "2020-11-06")
        #expect(s.songs.first?.gapStart == nil, "the song list's gap ends are dates, not nights")
        #expect(!s.band.isWindowed(s.artist))
    }

    @Test func aSetlistFmBandWithoutSongsDecodes() throws {
        let json = #"""
        {"artist":{"slug":"billy-strings","name":"Billy Strings","source":"setlistfm","songPages":false,
                   "coverage":{"kind":"window","shows":298,"from":"2023-02-16","to":"2026-10-31"}},
         "band":{"totalShows":1028,"lastShow":{"date":"2026-10-31","venue":"CFG Bank Arena","city":"Baltimore, MD"},
                 "songCount":690,"mostPlayed":[],"bustOuts":null},
         "songs":[]}
        """#
        let s = try JSONDecoder().decode(BandSnapshot.self, from: Data(json.utf8))
        #expect(s.band.firstShow == nil && s.band.bustOuts.isEmpty && s.band.overdueOriginals == nil)
        #expect(s.band.isWindowed(s.artist), "298 recent setlists of 1,028 shows")
    }

    @Test func theSongAnswerDecodes() throws {
        let json = #"""
        {"artist":{"slug":"goose","name":"Goose","source":"songfish","songPages":true},
         "song":{"name":"2021","isOriginal":false,"originalArtist":"Vampire Weekend","timesPlayed":2,
                 "firstPlayed":{"date":"2021-10-08","venue":"V","city":"C"},"lastPlayed":{"date":"2021-12-31","venue":"MSG","city":"New York, NY"},
                 "currentGap":379,"averageGap":3.8,"longestGap":19,
                 "recentPerformances":[{"date":"2021-12-31","venue":"MSG","city":"New York, NY"}],
                 "sourceUrl":"https://elgoose.net/songs/2021.html"}}
        """#
        let s = try JSONDecoder().decode(BandSongSnapshot.self, from: Data(json.utf8))
        #expect(s.song.kind == "Cover (Vampire Weekend)")
        #expect(s.song.recentPerformances.count == 1 && s.song.sourceUrl != nil && s.song.gapStart == nil)
    }

    // MARK: Your side

    @Test func yourSideCountsEverySpellingOfTheBandAndItsAliases() throws {
        let shows = [
            try show("a", "Goose", "2024-06-14", ["Arcadia", "SOS"]),
            try show("b", "goose (US)", "2024-12-31", ["Arcadia", "Same Old Shenanigans"]),
            try show("c", "Goose", "2025-08-29", ["Hot Tea"]),
            try show("p", "Phish", "2024-12-31", ["Arcadia"]),
        ]
        let p = BandPersonal(shows: shows, name: "Goose", key: StatsKeys.bandKey("Goose"), today: "2026-11-18")
        #expect(p.shows.map(\.id) == ["c", "b", "a"], "newest first, both spellings, not Phish")
        #expect(p.songs.first?.title == "Arcadia" && p.songs.first?.timesSeen == 2)
        // setlist.fm's "SOS" is El Goose's "Same Old Shenanigans" (config/song-title-aliases.json).
        #expect(p.song(titled: "Same Old Shenanigans")?.timesSeen == 2)
        #expect(p.song(titled: "SOS")?.timesSeen == 2)
        #expect(p.song(titled: "Hot Tea")?.currentGap.shows == 0)
        #expect(p.song(titled: "Arcadia")?.currentGap.shows == 1)
        #expect(p.song(titled: "Madhuvan") == nil)
        #expect(p.show(on: "2024-12-31")?.id == "b")
        #expect(p.show(on: "31-12-2024")?.id == "b", "any stored form of the date")
        #expect(p.show(on: "2020-01-01") == nil)
        #expect(p.artistName == "Goose")
    }

    @Test func aSongTitleFindsItsSongPage() throws {
        let json = #"""
        {"artist":{"slug":"goose","name":"Goose","songPages":true},"band":{"totalShows":1},
         "songs":[{"slug":"same-old-shenanigans","name":"Same Old Shenanigans"},{"slug":"arcadia","name":"Arcadia"}]}
        """#
        let snapshot = try JSONDecoder().decode(BandSnapshot.self, from: Data(json.utf8))
        let goose = try #require(BandDirectory.band(forSlug: "goose"))
        let slugs = BandSongSlugs(snapshot, band: goose)
        #expect(slugs.slug(for: "arcadia") == "arcadia")
        #expect(slugs.slug(for: "SOS") == "same-old-shenanigans")
        #expect(slugs.slug(for: "Tumble") == nil)
    }

    // MARK: Artist info

    @Test func artistInfoReadsLikeTheWebsPanel() throws {
        let wiki = try JSONDecoder().decode(ArtistInfo.Wiki.self, from: Data(#"""
        {"found":true,"name":"Goose (American band)","summary":"Goose is an American rock band.","description":"American jam band",
         "image":"https://upload.wikimedia.org/g.jpg","url":"https://en.wikipedia.org/wiki/Goose_(American_band)"}
        """#.utf8))
        let enrich = try JSONDecoder().decode(ArtistInfo.Enrich.self, from: Data(#"""
        {"found":true,"name":"Goose","mbid":"b925a474","country":"US","activeYears":{"begin":"2014","end":null,"ended":false},
         "genres":["jam band","rock"],"discogsId":408581,"profile":"A Belgian band.","image":null,
         "members":[{"name":"Rick Mitarotonda","active":true},{"name":"Ben Atkind","active":false}],
         "urls":[{"type":"official homepage","url":"https://goosetheband.com"},{"type":"streaming","url":"https://open.spotify.com/artist/x"},
                 {"type":"free streaming","url":"https://www.deezer.com/artist/139786222"},{"type":"free streaming","url":"https://www.deezer.com/artist/15718"},
                 {"type":"social network","url":"https://www.instagram.com/goosetheband"},{"type":"wikidata","url":"https://www.wikidata.org/x"}],
         "sources":{"musicbrainz":true,"discogs":true}}
        """#.utf8))
        let info = ArtistInfo(wiki: wiki, enrich: enrich)
        #expect(info.found && info.summary == "Goose is an American rock band.", "Wikipedia first")
        #expect(info.image?.host == "upload.wikimedia.org")
        #expect(enrich.countryAndYears == "US · 2014–present")
        #expect(enrich.members.map(\.active) == [true, false])
        #expect(enrich.shownLinks.map(\.label) == ["Website", "Deezer", "Instagram"],
                "no Spotify while playlists are off, one Deezer, no wikidata")
        #expect(enrich.musicBrainzURL?.absoluteString == "https://musicbrainz.org/artist/b925a474")
        #expect(enrich.discogsURL?.absoluteString == "https://www.discogs.com/artist/408581")
        #expect(ArtistInfo(wiki: nil, enrich: enrich).summary == "A Belgian band.", "the Discogs profile without a summary")
        let notFound = try JSONDecoder().decode(ArtistInfo.Wiki.self, from: Data(#"{"found":false,"name":"x","type":"artist"}"#.utf8))
        #expect(!ArtistInfo(wiki: notFound, enrich: nil).found)
    }
}
