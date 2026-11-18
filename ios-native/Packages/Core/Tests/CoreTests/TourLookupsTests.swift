import FirebaseFirestore
import Foundation
import Testing
@testable import Core

/// Favorite tours' write and the setlist.fm tour lookups (Stage 4, 4-6).
struct TourLookupsTests {
    private func show(_ id: String, _ artist: String, _ date: String, mbid: String? = nil, setlistfmId: String? = nil) throws -> Show {
        var json: [String: Any] = ["id": id, "artist": artist, "venue": "V", "city": "C", "date": date, "setlist": []]
        if let mbid { json["artistMbid"] = mbid }
        if let setlistfmId { json["setlistfmId"] = setlistfmId }
        return try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: json))
    }

    @Test func aStarWritesTheWebsShape() throws {
        let shows = [try show("a", "Goose", "2025-06-06")].map { s -> Show in var s = s; s.tour = "Summer Tour 2025"; return s }
        let tour = try #require(TourIndex.build(shows)["goose:summer-tour-2025"])
        let data = FavoriteToursStore.starData(uid: "u1", tour: tour, now: Date(timeIntervalSince1970: 0))
        #expect(data["userId"] as? String == "u1")
        let entry = try #require((data["tours"] as? [String: Any])?["goose:summer-tour-2025"] as? [String: String])
        #expect(entry == ["tourName": "Summer Tour 2025", "artistName": "Goose", "addedAt": "1970-01-01T00:00:00.000Z"])
        #expect(data["updatedAt"] is FieldValue)
    }

    @Test func artistToursDecodeAndTheActiveOneIsWithinAMonth() throws {
        let json = #"""
        {"mbid":"m","artistName":"Goose","totalShows":120,"truncated":true,
         "tours":[{"name":"Fall Tour 2026","untagged":false,"showCount":12,"startDate":"2026-09-01","endDate":"2026-11-01","avgSongCount":14,
                   "shows":[{"date":"2026-11-01","venue":"MSG","city":"New York","country":"US","songCount":15,"tourName":"Fall Tour 2026"}]},
                  {"name":"No Tour Listed","untagged":true,"showCount":30,"startDate":"2019-01-01","endDate":"2026-10-01","avgSongCount":10,"shows":[]}]}
        """#
        let tours = try JSONDecoder().decode(ArtistTours.self, from: Data(json.utf8))
        #expect(tours.tours.count == 2 && tours.truncated)
        #expect(tours.tours.map(\.isBrowsable) == [true, false])
        #expect(tours.activeTour(today: "2026-11-18")?.name == "Fall Tour 2026")
        #expect(tours.activeTour(today: "2026-12-15") == nil, "ended more than 30 days ago")
    }

    @Test func songStatsDecode() throws {
        let json = #"{"songs":[{"name":"Arcadia","count":12,"plays":[{"date":"14-11-2026","venue":"Mohegan Sun Arena","city":"Uncasville","country":"US","setlistUrl":"https://x"}]}],"totalSetlistsFetched":60,"totalSetlistsAvailable":853}"#
        let stats = try JSONDecoder().decode(ArtistSongStats.self, from: Data(json.utf8))
        #expect(stats.songs.first?.count == 12)
        #expect(ShowDate.isoDay(stats.songs.first?.plays.first?.date) == "2026-11-14")
    }

    @Test func tourNightsKnowWhichAreYours() throws {
        let json = #"""
        {"artistMbid":"m","tourName":"Summer Tour 2025","truncated":false,"shows":[
          {"setlistfmId":"s1","date":"2025-06-06","artist":"Goose","venue":"Red Rocks","city":"Morrison","state":"CO","country":"US","songCount":16,"sets":{"set":[]}},
          {"setlistfmId":"s2","date":"2025-06-13","artist":"Goose","venue":"Red Rocks","city":"Morrison","state":"CO","country":"US","songCount":0},
          {"setlistfmId":"s3","date":"2025-08-29","artist":"Goose","venue":"Dick's","city":"Commerce City","state":"CO","country":"US","songCount":18}]}
        """#
        let tour = try JSONDecoder().decode(TourShows.self, from: Data(json.utf8))
        #expect(tour.shows.map(\.id) == ["s1", "s2", "s3"])
        #expect(tour.shows[0].city == "Morrison, CO" && tour.shows[0].songCount == 16)
        // The raw row goes to normalize-show unchanged.
        #expect(tour.shows[0].raw["sets"] != nil)
        let mine = [try show("a", "Goose", "2025-06-06", setlistfmId: "s1"), try show("b", "goose (US)", "29-08-2025")]
        #expect(tour.shows.map { TourShows.isYours($0, in: mine) } == [true, false, true], "by setlist.fm id, then band and day")
    }

    @Test func theArtistIdComesFromYourOwnShows() throws {
        let mine = [try show("a", "Goose", "2025-06-06", mbid: "m1"), try show("b", "goose (US)", "2025-06-07", mbid: "m1"),
                    try show("c", "Goose", "2025-06-08", mbid: "m2"), try show("d", "Phish", "2025-06-09", mbid: "p")]
        #expect(TourLookups.mbid(forArtist: "Goose", in: mine) == "m1")
        #expect(TourLookups.mbid(forArtist: "Eggy", in: mine) == nil)
    }

    @Test func rateLimitsAndTimeoutsReadPlainly() {
        #expect(TourLookups.message(APIError.rateLimited(message: "rate_limited", retryAfter: nil)).contains("rate limiting"))
        #expect(TourLookups.message(APIError.server(status: 504, message: "timeout", code: nil)).contains("too long"))
        #expect(TourLookups.message(APIError.offline).contains("offline"))
    }
}
