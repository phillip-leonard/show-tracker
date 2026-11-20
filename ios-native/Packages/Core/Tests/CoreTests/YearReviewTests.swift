import Foundation
import Testing
@testable import Core

/// Year in Review (Stage 6, 6-10): year-recap's answer, the recap card's
/// request (the web's `recapPayload`), the year list, the 2026 window, the
/// reload signature, a year's shows for a top band, and the links.
struct YearReviewTests {
    /// fixtures/year-in-review/basic-year.json's recap as plain JSON.
    static func fixtureRecap() throws -> [String: Any] {
        let url = try FixtureLoader.root.appendingPathComponent("year-in-review/basic-year.json")
        let expected = try #require(FixtureLoader.json(url)["expected"] as? [String: Any])
        return try #require(expected["recap"] as? [String: Any])
    }

    static var rarity: [String: Any] { [
        "rarest": ["band": "Goose", "slug": "goose", "name": "Factory Fiction", "timesPlayed": 3, "date": "2025-06-21"],
        "bustOuts": [["band": "Goose", "slug": "goose", "name": "Tumble", "timesPlayed": 40, "gap": 120,
                      "date": "2025-06-20", "venue": "Red Rocks Amphitheatre"]],
    ] }
    static var buddy: [String: Any] { ["uid": "bobUid00000001", "name": "Bob Builder", "firstName": "Bob", "shows": 2] }

    static func answer(rarity: Any = rarity, buddy: Any = buddy) throws -> YearRecapAnswer {
        let json: [String: Any] = ["year": 2025, "recap": try fixtureRecap(), "rarity": rarity, "buddy": buddy]
        return try JSONDecoder().decode(YearRecapAnswer.self, from: JSONSerialization.data(withJSONObject: json))
    }

    @Test func decodesYearRecapsAnswer() throws {
        let a = try Self.answer()
        let recap = try #require(a.recap)
        #expect(a.year == 2025 && recap.totalShows == 4 && recap.topBands.map(\.name) == ["Goose", "Phish"])
        #expect(a.rarity.rarest?.name == "Factory Fiction" && a.rarity.rarest?.timesPlayed == 3)
        #expect(a.rarity.bustOuts.first?.gap == 120 && a.rarity.bustOuts.first?.venue == "Red Rocks Amphitheatre")
        #expect(a.buddy == ShowBuddy(uid: "bobUid00000001", name: "Bob Builder", firstName: "Bob", shows: 2))
    }

    @Test func aYearWithNothingToSay() throws {
        let empty = #"{"year":2019,"recap":null,"rarity":{"rarest":null,"bustOuts":[]},"buddy":null}"#
        let a = try JSONDecoder().decode(YearRecapAnswer.self, from: Data(empty.utf8))
        #expect(a.recap == nil && a.rarity.isEmpty && a.buddy == nil)
        let bare = try JSONDecoder().decode(YearRecapAnswer.self, from: Data(#"{"year":2019,"recap":null}"#.utf8))
        #expect(bare.rarity == .none, "a missing rarity reads as none")
    }

    /// The same body YearRecapView's `recapPayload` builds (with the buddy
    /// as uid and count), from the same answer.
    @Test func recapCardRequestIsTheWebsPayload() throws {
        let a = try Self.answer()
        let card = RecapCardRequest(recap: try #require(a.recap), rarity: a.rarity, buddy: a.buddy)
        let expected = #"""
        {"recap":{"year":2025,"shows":4,"bands":2,"venues":3,"songsHeard":6,"newBands":2,"topBands":[{"name":"Goose","shows":2},{"name":"Phish","shows":2}],"topSongs":[{"name":"Arcadia","artist":"Goose","count":2},{"name":"Tweezer","artist":"Phish","count":2},{"name":"Harry Hood","artist":"Phish","count":1},{"name":"Hot Tea","artist":"Goose","count":1},{"name":"Madhuvan","artist":"Goose","count":1},{"name":"Tumble","artist":"Goose","count":1}],"rarest":{"name":"Factory Fiction","band":"Goose","timesPlayed":3},"bustOuts":[{"name":"Tumble","band":"Goose","gap":120}],"busiestMonth":{"month":5,"shows":2},"longestRun":{"artist":"Goose","venue":"Red Rocks Amphitheatre","nights":2},"updatedThrough":"2025-12-30"},"buddyUid":"bobUid00000001","buddyShows":2}
        """#
        let want = try JSONSerialization.jsonObject(with: Data(expected.utf8))
        let diff = JSONCompare.difference(try JSONCompare.encode(card), want)
        #expect(diff == nil, "\(diff ?? "")")

        // The image body is the card with the action and size.
        let body = try JSONCompare.encode(PosterClient.RecapBody(action: "image", kind: "story", card: card)) as? [String: Any]
        #expect(body?["action"] as? String == "image" && body?["kind"] as? String == "story")
        #expect(body?["buddyUid"] as? String == "bobUid00000001" && body?["recap"] != nil)
    }

    @Test func noBuddyNoRarityLeavesThemOff() throws {
        let a = try Self.answer(rarity: ["rarest": NSNull(), "bustOuts": []], buddy: NSNull())
        let card = RecapCardRequest(recap: try #require(a.recap), rarity: a.rarity, buddy: a.buddy)
        let json = try #require(try JSONCompare.encode(card) as? [String: Any])
        #expect(json["buddyUid"] == nil && json["buddyShows"] == nil)
        let recap = try #require(json["recap"] as? [String: Any])
        #expect(recap["rarest"] == nil, "the server reads a missing rarest as none")
        #expect((recap["bustOuts"] as? [Any])?.isEmpty == true)
    }

    @Test func yearsNewestFirstWithTheOneShown() throws {
        let shows = [
            try ShowListTests.show("a", "Goose", "2025-06-20"),
            try ShowListTests.show("b", "Phish", "31-12-2023"),
            try ShowListTests.show("c", "Goose", "2025-07-01"),
        ]
        #expect(YearReview.years(shows) == [2025, 2023])
        #expect(YearReview.years(shows, including: 2019) == [2025, 2023, 2019])
    }

    @Test func twentyTwentySixIsNativeFromJanuarySixteenth() {
        #expect(!YearReview.isNative(year: 2026, now: RecapWindow.promoEndsAt.addingTimeInterval(-1)))
        #expect(YearReview.isNative(year: 2026, now: RecapWindow.promoEndsAt))
        #expect(YearReview.isNative(year: 2025, now: RecapWindow.promoStartsAt), "other years at once")
    }

    @Test func signatureFollowsTheYearsShows() throws {
        let a = try ShowListTests.show("a", "Goose", "2025-06-20", songs: ["Arcadia"])
        let other = try ShowListTests.show("z", "Phish", "2024-01-01")
        let before = YearReview.signature([a, other], year: 2025)
        #expect(before == YearReview.signature([other, a], year: 2025), "order doesn't matter")
        #expect(before == YearReview.signature([a], year: 2025), "another year's show doesn't count")
        let more = try ShowListTests.show("a", "Goose", "2025-06-20", songs: ["Arcadia", "Tumble"])
        #expect(before != YearReview.signature([more], year: 2025), "a setlist change asks again")
    }

    @Test func aTopBandOpensThatYearsShows() throws {
        let shows = [
            try ShowListTests.show("a", "Goose", "2025-06-20"),
            try ShowListTests.show("b", "Goose (US)", "2024-06-20"),
            try ShowListTests.show("c", "Phish", "2025-07-01"),
        ]
        #expect(ShowsFilter(kind: .band, title: "Goose", year: 2025).shows(in: shows).map(\.id) == ["a"])
        #expect(ShowsFilter(kind: .band, title: "Goose").shows(in: shows).map(\.id) == ["a", "b"], "every year without one")
    }

    @Test func yearInReviewLinks() {
        func action(_ s: String) -> DeepLinkAction? { DeepLink.resolve(URL(string: s)!)?.action }
        #expect(action("https://mysetlists.net/year-in-review/?year=2025") == .open(.stats, .yearInReview(user: "", year: "2025")),
                "the year-end email's link is your own")
        #expect(action("https://mysetlists.net/year-in-review/?user=u1&year=2025") == .open(.stats, .yearInReview(user: "u1", year: "2025")))
        #expect(AppRoute.yearInReview(user: "", year: "2026").webURL.absoluteString == "https://mysetlists.net/year-in-review/?year=2026")
        #expect(AppRoute.yearInReview(user: "u1", year: "2025").webURL.absoluteString
                == "https://mysetlists.net/year-in-review/?user=u1&year=2025")
    }
}
