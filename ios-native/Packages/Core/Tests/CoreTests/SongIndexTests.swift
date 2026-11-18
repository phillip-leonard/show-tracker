import Foundation
import Testing
@testable import Core

/// The song page's numbers against `fixtures/song-index/` (the same files
/// `lib/__tests__/libraryFixtures.test.js` runs `lib/songIndex.js` on).
struct SongIndexTests {
    private func gapsFixture() throws -> (shows: [Show], today: String, expected: [String: Any]) {
        let url = try FixtureLoader.root.appendingPathComponent("song-index/gaps.json")
        let json = try FixtureLoader.json(url)
        let rawShows = try #require(json["shows"] as? [[String: Any]])
        let shows = try rawShows.map { try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: $0)) }
        return (shows, try #require(json["today"] as? String), try #require(json["expected"] as? [String: Any]))
    }

    private func plain(_ entry: SongIndex.Entry) -> [String: Any] {
        func opt(_ v: Any?) -> Any { v ?? NSNull() }
        func sighting(_ s: SongIndex.Sighting) -> [String: Any] {
            ["date": s.date, "venue": s.venue, "city": s.city, "showId": s.showId]
        }
        return [
            "key": entry.key,
            "artistSlug": entry.artistSlug,
            "artistName": entry.artistName,
            "title": entry.title,
            "performances": entry.performances.map { p -> [String: Any] in
                ["showId": p.showId, "date": p.date, "venue": p.venue, "city": p.city,
                 "setLabel": opt(p.setLabel), "position": opt(p.position), "isShowOpener": p.isShowOpener,
                 "isSetCloser": p.isSetCloser, "isEncore": p.isEncore, "segueIn": p.segueIn, "segueOut": p.segueOut,
                 "rating": opt(p.rating), "manuallyAdded": p.manuallyAdded]
            },
            "timesSeen": entry.timesSeen,
            "firstSeen": sighting(entry.firstSeen),
            "lastSeen": sighting(entry.lastSeen),
            "currentGap": ["shows": entry.currentGap.shows, "days": opt(entry.currentGap.days)],
            "longestGap": entry.longestGap.map { g -> Any in
                ["shows": g.shows, "days": opt(g.days), "fromDate": g.fromDate, "toDate": g.toDate]
            } ?? NSNull(),
        ]
    }

    @Test func theIndexMatchesTheSharedFixture() throws {
        let fixture = try gapsFixture()
        let index = SongIndex.build(fixture.shows, today: fixture.today)
        #expect(Set(index.keys) == Set(fixture.expected.keys))
        for (key, expected) in fixture.expected {
            let entry = try #require(index[key], "\(key)")
            let ours = plain(entry) as NSDictionary
            #expect(ours.isEqual(to: try #require(expected as? [String: Any])), "\(key): \(ours) vs \(expected)")
        }
    }

    @Test func keysMatchTheSharedFixture() throws {
        let fixture = try FixtureLoader.json(FixtureLoader.root.appendingPathComponent("song-index/keys.json"))
        for row in try #require(fixture["songSlug"] as? [[String]]) {
            #expect(SongIndex.songSlug(row[0]) == row[1], "\(row[0])")
        }
        for row in try #require(fixture["songKey"] as? [[Any]]) {
            let expected = row[2] as? String
            #expect(SongIndex.key(artist: row[0] as? String, title: row[1] as? String) == expected, "\(row)")
        }
        for row in try #require(fixture["songKeyFromParams"] as? [[Any]]) {
            let expected = row[2] as? String
            #expect(SongIndex.key(artistSlug: row[0] as? String, songSlug: row[1] as? String) == expected, "\(row)")
        }
    }

    /// A link the song list or a setlist row builds finds its own song.
    @Test func aSongsLinkFindsIt() throws {
        let fixture = try gapsFixture()
        let index = SongIndex.build(fixture.shows, today: fixture.today)
        for row in SongList.rows(index) {
            #expect(SongIndex.key(artistSlug: row.artistSlug, songSlug: row.songSlug) == row.key, "\(row.key)")
        }
    }

    // MARK: The page's wording (SongDetailView.jsx)

    @Test func whatThePageSays() throws {
        let fixture = try gapsFixture()
        let index = SongIndex.build(fixture.shows, today: fixture.today)
        let arcadia = try #require(index["goose:arcadia"])
        let date = { (s: String) in s }

        #expect(SongHistory.gapSentence(arcadia, date: date) == "You saw this at your most recent show: Dick's, Commerce City, 2025-08-29.")
        let hungersite = try #require(index["goose:hungersite"])
        #expect(SongHistory.gapSentence(hungersite, date: date)
                == "You haven't seen this in 4 shows: 2 years, 5 months since Red Rocks, Morrison, 2024-06-14.")
        #expect(SongHistory.longestGapLine(try #require(arcadia.longestGap), date: date)
                == "Longest gap: 2 shows (1 year, 2 months), 2024-06-15 to 2025-08-29")

        // A reprise counts twice by year, as the web draws it.
        #expect(SongHistory.byYear(arcadia.performances).map { "\($0.year):\($0.count)" } == ["2024:3", "2025:1"])
        // Opened g5 and g1; closed Set I at g2 and Set II at g2.
        #expect(SongHistory.whereItLands(arcadia.performances) == "Opened the show 2×, Closed Set I once, Closed Set II once.")
        // An encore's last song isn't also "closed the encore".
        #expect(SongHistory.whereItLands(try #require(index["goose:madhuvan"]).performances) == "Played in the encore once.")
        // No set data at all: nothing to say.
        #expect(SongHistory.whereItLands(try #require(index["phish:arcadia"]).performances) == nil)

        #expect(SongHistory.bestVersions(arcadia.performances).map(\.showId) == ["g1"])
        #expect(SongHistory.averageRating(arcadia.performances) == 9)
        #expect(SongHistory.averageRating(hungersite.performances) == nil)
    }

    @Test func durationsReadLikeTheWeb() {
        #expect(SongHistory.duration(days: nil) == nil)
        #expect(SongHistory.duration(days: 0) == nil)
        #expect(SongHistory.duration(days: 1) == "1 day")
        #expect(SongHistory.duration(days: 12) == "12 days")
        #expect(SongHistory.duration(days: 31) == "1 month")
        #expect(SongHistory.duration(days: 365) == "11 months")
        #expect(SongHistory.duration(days: 366) == "1 year")
        #expect(SongHistory.duration(days: 446) == "1 year, 2 months")
    }

    @Test func theListSortsAndSearches() throws {
        let fixture = try gapsFixture()
        let rows = SongList.rows(SongIndex.build(fixture.shows, today: fixture.today))
        #expect(rows.count == 6)
        let bySeen = SongList.sorted(rows, by: .timesSeen)
        #expect(bySeen.first?.key == "goose:arcadia")
        // Same title by two bands: two rows, Goose before Phish on a tie of name.
        #expect(SongList.sorted(rows, by: .title).filter { $0.title == "Arcadia" }.map(\.artistName) == ["Goose", "Phish"])
        #expect(SongList.sorted(rows, by: .rating).first?.key == "goose:arcadia", "rated first, unrated after")
        #expect(SongList.sorted(rows, by: .gap).first?.key == "goose:hungersite")
        #expect(SongList.filtered(rows, query: "phish").map(\.key) == ["phish:arcadia"])
        #expect(SongList.filtered(rows, query: "TEA").map(\.key) == ["goose:hot tea"])
    }
}

/// `archival-audio-lookup`'s answer (5.60.32 shape: recordings and `streaming`).
struct ListeningTests {
    @Test func theAnswerDecodes() throws {
        let json = """
        {"found":true,"recordings":[
          {"id":"u1","label":"SBD","isSoundboard":true,"taper":null,"transferrer":"Charlie","lineage":"SBD > DAT","avgRating":4.6,"numReviews":12,"url":"https://relisten.net/phish/1997/12/31","linkLabel":"Listen on Relisten"},
          {"id":"u2","label":"AUD","isSoundboard":false,"taper":"Jane","transferrer":null,"lineage":null,"avgRating":null,"numReviews":0,"url":null,"linkLabel":"Listen"}],
         "streaming":[
          {"name":"nugs.net","url":"https://www.nugs.net/search?q=Phish","label":"Listen on nugs.net","icon":"🎵","description":"Official high-quality recordings"},
          {"name":"broken","url":null,"label":"x"}]}
        """
        let answer = try JSONDecoder().decode(Listening.self, from: Data(json.utf8))
        #expect(answer.found)
        #expect(answer.recordings.map(\.title) == ["Soundboard", "AUD"])
        #expect(answer.recordings[0].credit == "Transfer: Charlie")
        #expect(answer.recordings[1].credit == "Taper: Jane")
        #expect(answer.recordings[1].url == nil)
        #expect(answer.streaming.map(\.name) == ["nugs.net"], "a platform without a link is left out")
        #expect(answer.selected(pick: "u2")?.id == "u2")
        #expect(answer.selected(pick: "gone")?.id == "u1", "a pick no longer listed falls back to the first")
        #expect(answer.selected(pick: nil)?.id == "u1")
    }

    @Test func nothingFoundStillCarriesTheStreamingList() throws {
        let json = #"{"found":false,"reason":"artist_not_carried","streaming":[{"name":"archive.org","url":"https://archive.org/search.php?query=Goose%202024-06-14","label":"Browse on Archive.org"}]}"#
        let answer = try JSONDecoder().decode(Listening.self, from: Data(json.utf8))
        #expect(answer.shownRecordings.isEmpty)
        #expect(answer.selected(pick: nil) == nil)
        #expect(answer.streaming.count == 1)
    }

    /// Three rows until "Show all", keeping the picked one in view.
    @Test func aLongListShowsThreeAndThePick() throws {
        let rows = (1...6).map { #"{"id":"r\#($0)","label":"L\#($0)"}"# }.joined(separator: ",")
        let answer = try JSONDecoder().decode(Listening.self, from: Data(#"{"found":true,"recordings":[\#(rows)]}"#.utf8))
        #expect(answer.listed(pick: nil, showAll: false).map(\.id) == ["r1", "r2", "r3"])
        #expect(answer.listed(pick: "r2", showAll: false).map(\.id) == ["r1", "r2", "r3"])
        #expect(answer.listed(pick: "r5", showAll: false).map(\.id) == ["r1", "r2", "r3", "r5"])
        #expect(answer.listed(pick: "r5", showAll: true).count == 6)
    }

    /// The function refuses anything but ISO (`isoDay`), so the stored date is converted.
    @Test func theQueryIsAlwaysAnISODay() {
        #expect(Listening.query(artist: "Phish", date: "1997-12-31") == ["artist": "Phish", "date": "1997-12-31"])
        #expect(Listening.query(artist: " Phish ", date: "31-12-1997") == ["artist": "Phish", "date": "1997-12-31"])
        #expect(Listening.query(artist: "Phish", date: "someday") == nil)
        #expect(Listening.query(artist: "", date: "1997-12-31") == nil)
    }
}
