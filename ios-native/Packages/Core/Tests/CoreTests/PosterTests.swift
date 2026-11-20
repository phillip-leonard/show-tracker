import Foundation
import Testing
@testable import Core

/// Posters (Stage 6, 6-9): my-poster's record answer, the songs' orders,
/// "Make my poster"'s rule, the Songs I've heard links, and saving a heard
/// selection as typed shows with their setlists.
struct PosterTests {
    /// What my-poster `record` answers (lib/myPoster.js buildMyPoster on
    /// three Widespread Panic shows, one with no setlist).
    static let answer = #"""
{"ok":true,"record":{"personal":true,"name":"Widespread Panic","shows":3,"showsWithSetlist":2,"years":3,"venues":3,"uniqueSongs":3,"totalSongs":4,"firstShow":{"date":"2019-04-01","venue":"Georgia Theatre","city":"Athens, GA"},"lastShow":{"date":"2022-06-01","venue":"Red Rocks Amphitheatre","city":"Athens, GA"},"songs":[{"name":"Chilly Water","count":2,"firstHeard":"2019-04-01","lastHeard":"2021-10-31"},{"name":"Ain't Life Grand","count":1,"firstHeard":"2019-04-01","lastHeard":"2019-04-01"},{"name":"Porch Song","count":1,"firstHeard":"2021-10-31","lastHeard":"2021-10-31"}],"top":[{"name":"Chilly Water","count":2,"firstHeard":"2019-04-01","lastHeard":"2021-10-31"},{"name":"Ain't Life Grand","count":1,"firstHeard":"2019-04-01","lastHeard":"2019-04-01"},{"name":"Porch Song","count":1,"firstHeard":"2021-10-31","lastHeard":"2021-10-31"}]},"eligible":true,"name":"Widespread Panic","archive":null,"shows":3,"noSetlist":[{"id":"c","date":"2022-06-01","venue":"Red Rocks Amphitheatre","city":"Athens, GA"}]}
"""#

    @Test func decodesTheRecordAnswer() throws {
        let a = try JSONDecoder().decode(PosterAnswer.self, from: Data(Self.answer.utf8))
        #expect(a.eligible && a.name == "Widespread Panic" && a.archive == nil && a.shows == 3)
        let r = try #require(a.record)
        #expect(r.shows == 3 && r.showsWithSetlist == 2 && r.uniqueSongs == 3 && r.totalSongs == 4)
        #expect(r.top.first?.name == "Chilly Water" && r.top.first?.count == 2)
        #expect(r.yearSpan == "2019–2022")
        #expect(a.noSetlist.map(\.id) == ["c"])
    }

    @Test func songsSortAsTheWebSorts() throws {
        let songs = try #require(try JSONDecoder().decode(PosterAnswer.self, from: Data(Self.answer.utf8)).record?.songs)
        #expect(PosterSort.mostHeard.sorted(songs).map(\.name) == ["Chilly Water", "Ain't Life Grand", "Porch Song"])
        #expect(PosterSort.name.sorted(songs).map(\.name) == ["Ain't Life Grand", "Chilly Water", "Porch Song"])
        #expect(PosterSort.firstHeard.sorted(songs).map(\.name) == ["Ain't Life Grand", "Chilly Water", "Porch Song"], "ties by name")
        #expect(PosterSort.lastHeard.sorted(songs).map(\.name) == ["Chilly Water", "Porch Song", "Ain't Life Grand"])
    }

    @Test func makeMyPosterNeedsTwoShowsWithASetlist() throws {
        let one = try ShowListTests.show("a", "Widespread Panic", "2019-04-01", songs: ["Chilly Water"])
        let two = try ShowListTests.show("b", "Widespread Panic (US)", "2021-10-31", songs: ["Porch Song"])
        let none = try ShowListTests.show("c", "Widespread Panic", "2022-06-01")
        #expect(!MyPoster.canMake([one, none], artist: "Widespread Panic"))
        #expect(MyPoster.canMake([one, two, none], artist: "widespread panic"), "one band however it's spelled")
    }

    @Test func heardToolBandsAndLinks() throws {
        #expect(HeardTool.bands.map(\.slug) == ["goose", "phish", "umphreys-mcgee", "king-gizzard-and-the-lizard-wizard"])
        #expect(HeardTool.band(forArtist: "Goose (US)")?.slug == "goose")
        #expect(HeardTool.band(forArtist: "Widespread Panic") == nil)

        let shows = [
            try ShowListTests.show("p1", "Phish", "1997-12-31", venue: "Madison Square Garden"),
            try ShowListTests.show("g1", "Goose", "2024-07-31", venue: "Red Rocks"),
            try ShowListTests.show("g2", "Goose", "31-12-2023", venue: "MSG"),
        ]
        let bands = HeardTool.bandsFor(shows)
        #expect(bands.map(\.band.slug) == ["goose", "phish"], "most shows first")
        #expect(bands[0].shows.map(\.date) == ["2024-07-31", "2023-12-31"], "a legacy date read as its ISO day")

        let url = HeardTool.url(slug: "goose", shows: bands[0].shows)
        #expect(url.absoluteString.hasPrefix("https://mysetlists.net/heard/goose/?mine=1#mine="))
        var fragment = try #require(url.fragment).replacingOccurrences(of: "mine=", with: "")
            .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while fragment.count % 4 != 0 { fragment += "=" }
        let pairs = try JSONDecoder().decode([[String]].self, from: try #require(Data(base64Encoded: fragment)))
        #expect(pairs == [["2024-07-31", "Red Rocks"], ["2023-12-31", "MSG"]], "the shows travel in the fragment")
        #expect(HeardTool.url(slug: "phish", shows: []).absoluteString == "https://mysetlists.net/heard/phish/?mine=1")
    }

    @Test func aHeardSelectionBecomesTypedShowsWithSetlists() throws {
        #expect(HeardSelection.parts("goose.Ab3_x")?.slug == "goose")
        #expect(HeardSelection.parts("goose") == nil)
        #expect(HeardSelection.parts("../etc.x") == nil)
        let json = #"{"ok":true,"artist":{"slug":"goose","name":"Goose","sourceName":"El Goose"},"shows":[{"id":"1","date":"2024-07-31","venue":"Red Rocks Amphitheatre","city":"Morrison, CO","tour":"","url":"","setlist":[{"name":"Arcadia","set":"Set I","cover":null},{"name":"Rosalita","set":"Encore","cover":"Bruce Springsteen"}]}],"missing":0}"#
        let selection = try JSONDecoder().decode(HeardSelection.self, from: Data(json.utf8))
        let items = selection.inputs()
        #expect(items.count == 1)
        #expect(items[0].display == QueuedShow.Display(artist: "Goose", venue: "Red Rocks Amphitheatre", city: "Morrison, CO", date: "2024-07-31"))
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(items[0].input)) as! [String: Any]
        #expect(body["kind"] as? String == "manual")
        #expect(body["tour"] == nil, "an empty tour isn't sent")
        let setlist = try #require(body["setlist"] as? [[String: Any]])
        #expect(setlist.map { $0["name"] as? String } == ["Arcadia", "Rosalita"])
        #expect(setlist[1]["cover"] as? String == "Bruce Springsteen" && setlist[1]["set"] as? String == "Encore")
        #expect(setlist[0]["tape"] as? Bool == false)
    }

    @Test func manualInputRoundTripsItsSetlist() throws {
        let input = ShowInput(.manual(.init(artist: "Goose", venue: "X", date: "2024-07-31", setlist: [.object(["name": .string("Arcadia")])]), .none),
                              showId: "1")
        let back = try JSONDecoder().decode(ShowInput.self, from: JSONEncoder().encode(input))
        #expect(back == input)
        let plain = ShowInput(.manual(.init(artist: "Goose", venue: "X", date: "2024-07-31"), .none), showId: "2")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(plain)) as! [String: Any]
        #expect(json["setlist"] == nil, "the form's add sends no setlist, as before")
    }

    @Test func posterAndHeardLinks() {
        func action(_ s: String) -> DeepLinkAction? { DeepLink.resolve(URL(string: s)!)?.action }
        #expect(action("https://mysetlists.net/my-poster/?artist=Widespread%20Panic") == .open(.stats, .myPoster(artist: "Widespread Panic")))
        #expect(action("https://mysetlists.net/shows/?signup=1&heard=goose.Ab3") == .open(.shows, .heardSave("goose.Ab3")))
        #expect(AppRoute.myPoster(artist: "Goose").webURL.absoluteString == "https://mysetlists.net/my-poster/?artist=Goose")
    }
}
