import Foundation
import Testing
@testable import Core

/// Runs and tours against `fixtures/runs/runs-and-tours.json`, the file
/// `lib/__tests__/libraryFixtures.test.js` runs `lib/runIndex.js` on.
struct RunIndexTests {
    private struct Fixture {
        var shows: [Show]
        var today: String
        var json: [String: Any]
        var expected: [String: Any]
    }

    private func fixture() throws -> Fixture {
        let json = try FixtureLoader.json(FixtureLoader.root.appendingPathComponent("runs/runs-and-tours.json"))
        let raw = try #require(json["shows"] as? [[String: Any]])
        let shows = try raw.map { try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: $0)) }
        return Fixture(shows: shows, today: try #require(json["today"] as? String), json: json,
                       expected: try #require(json["expected"] as? [String: Any]))
    }

    private func opt(_ v: Any?) -> Any { v ?? NSNull() }

    @Test func venuePairsMatchTheWeb() throws {
        let f = try fixture()
        let pairs = try #require(f.json["venuePairs"] as? [[Any]])
        #expect(!pairs.isEmpty)
        for pair in pairs {
            let a = pair[0] as? String ?? "", b = pair[1] as? String ?? "", expected = pair[2] as? Bool ?? false
            #expect(VenueNames.fuzzyMatch(a, b) == expected, "\(a) / \(b)")
        }
    }

    @Test func runsMatchTheSharedFixture() throws {
        let f = try fixture()
        let expected = try #require(f.expected["runs"] as? [String: [String: Any]])
        let runs = RunIndex.build(f.shows)
        #expect(Set(runs.map(\.key)) == Set(expected.keys))
        for run in runs {
            let e = try #require(expected[run.key], "\(run.key)")
            #expect(run.artistName == e["artistName"] as? String)
            #expect(run.artistSlug == e["artistSlug"] as? String)
            #expect(run.venueName == e["venueName"] as? String, "\(run.key)")
            #expect(run.city == e["city"] as? String)
            #expect(run.nightCount == e["nightCount"] as? Int)
            let range = try #require(e["dateRange"] as? [String: String])
            #expect(run.start == range["start"] && run.end == range["end"], "\(run.key)")
            #expect(run.totalSongs == e["totalSongs"] as? Int, "\(run.key)")
            #expect(run.uniqueSongs == e["uniqueSongs"] as? Int, "\(run.key)")
            #expect(run.hasIncompleteData == e["hasIncompleteData"] as? Bool)
            #expect((opt(run.noRepeat) as AnyObject).isEqual(opt(e["noRepeat"])), "\(run.key)")
            #expect((opt(run.avgRating) as AnyObject).isEqual(opt(e["avgRating"])), "\(run.key)")
            #expect((opt(run.bestNightIndex) as AnyObject).isEqual(opt(e["bestNightIndex"])), "\(run.key)")
            let songs = { (list: [RunIndex.RunSong]) in list.map { ["key": $0.key, "title": $0.title, "nightNumbers": $0.nightNumbers] as NSDictionary } }
            #expect(songs(run.combinedSetlist) as NSArray == (e["combinedSetlist"] as? NSArray ?? []), "\(run.key)")
            #expect(songs(run.repeats) as NSArray == (e["repeats"] as? NSArray ?? []), "\(run.key)")
            let nights = try #require(e["nights"] as? [[String: Any]])
            #expect(run.nights.map(\.showId) == nights.compactMap { $0["showId"] as? String })
            #expect(run.nights.map(\.venue) == nights.compactMap { $0["venue"] as? String })
            #expect(run.nights.map(\.hasSetlist) == nights.compactMap { $0["hasSetlist"] as? Bool })
            #expect(run.nights.map { $0.rating.map { $0 as Any } ?? NSNull() } as NSArray == nights.map { $0["rating"] ?? NSNull() } as NSArray)
        }
        // Newest first, as the web lists them.
        #expect(runs.map(\.key) == runs.sorted { RunIndex.dayNumber($0.start) > RunIndex.dayNumber($1.start) }.map(\.key))
    }

    @Test func toursMatchTheSharedFixture() throws {
        let f = try fixture()
        let expected = try #require(f.expected["tours"] as? [String: [String: Any]])
        let tours = TourIndex.build(f.shows)
        #expect(Set(tours.keys) == Set(expected.keys))
        for (key, tour) in tours {
            let e = try #require(expected[key], "\(key)")
            #expect(tour.artistName == e["artistName"] as? String)
            #expect(tour.artistSlug == e["artistSlug"] as? String)
            #expect(tour.tourName == e["tourName"] as? String)
            #expect(tour.stopCount == e["stopCount"] as? Int)
            let range = try #require(e["dateRange"] as? [String: String])
            #expect(tour.start == range["start"] && tour.end == range["end"], "\(key)")
            #expect(tour.uniqueSongs == e["uniqueSongs"] as? Int, "\(key)")
            #expect((opt(tour.avgRating) as AnyObject).isEqual(opt(e["avgRating"])), "\(key)")
            #expect(tour.venuesCount == e["venuesCount"] as? Int, "\(key)")
            #expect(tour.countriesVisited == e["countriesVisited"] as? Int, "\(key)")
            #expect(tour.years == e["years"] as? [String])
            let stops = try #require(e["stops"] as? [[String: Any]])
            let ours = tour.stops.map { s -> NSDictionary in
                ["showId": s.showId, "date": s.date, "venue": s.venue, "city": s.city, "country": s.country,
                 "rating": s.rating.map { $0 as Any } ?? NSNull()]
            }
            #expect(ours as NSArray == stops as NSArray, "\(key)")
        }
    }

    @Test func newSongsOnEachTourMatchTheSharedFixture() throws {
        let f = try fixture()
        let expected = try #require(f.expected["newSongsOnTour"] as? [String: [[String: Any]]])
        let songIndex = SongIndex.build(f.shows, today: f.today)
        for (key, tour) in TourIndex.build(f.shows) {
            let ours = TourIndex.newSongs(on: tour, songIndex: songIndex).map { s -> NSDictionary in
                ["key": s.key, "title": s.title, "timesSeen": s.timesSeen,
                 "firstSeen": ["date": s.firstSeen.date, "venue": s.firstSeen.venue, "city": s.firstSeen.city, "showId": s.firstSeen.showId]]
            }
            #expect(ours as NSArray == (expected[key] ?? []) as NSArray, "\(key)")
        }
    }

    @Test func keysAndTheRunAShowIsIn() throws {
        #expect(RunIndex.key(artist: "Goose", venue: "Dick's Sporting Goods Park", firstDate: "2025-08-29") == "goose:dicks-sporting-goods-park:2025-08-29")
        #expect(RunIndex.key(artist: "", venue: "x", firstDate: "2025-01-01") == nil)
        #expect(TourIndex.key(artist: "Goose", tour: "Summer Tour 2025") == "goose:summer-tour-2025")
        #expect(VenueNames.venueKey(name: " Red Rocks ", city: "Morrison") == "red rocks::morrison")
        #expect(VenueNames.venueKey(name: "", city: "") == nil)
        let f = try fixture()
        let run = try #require(RunIndex.build(f.shows).first { $0.key == "goose:dicks-sporting-goods-park:2025-08-29" })
        #expect(run.nightNumber(of: "d2") == 2)
        #expect(run.nightNumber(of: "nope") == nil)
    }
}
