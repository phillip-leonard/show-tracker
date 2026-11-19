import FirebaseFirestore
import Foundation
import Testing
@testable import Core

/// Community (Stage 4, 4-11): the boards from `communityStats/global` as
/// components/CommunityStatsView.jsx shows them, and the user-count rule
/// against `fixtures/user-count/threshold.json`.
struct CommunityTests {
    let decoder = Firestore.Decoder()

    private func entry(_ uid: String, _ count: Int) -> [String: Any] {
        ["userId": uid, "odubleserId": uid, "firstName": uid.uppercased(), "photoURL": "", "count": count]
    }

    private func stats(totalUsers: Any = 34) throws -> CommunityStats {
        try decoder.decode(CommunityStats.self, from: [
            "totalUsers": totalUsers, "totalShows": 1467, "totalSongs": 21745,
            "topShowsAttended": (1...10).map { entry("u\($0)", 100 - $0) },
            "topSongsRated": [entry("u1", 50), entry("me", 40), entry("u3", 30)],
            "topSongsByRating": (1...7).map { ["songName": "Song \($0)", "avgRating": "9.\(9 - $0)", "ratingCount": 2, "artists": ["Phish"]] },
            "topVenues": [["venueName": "Red Rocks", "showCount": 40, "artistCount": 12]],
        ])
    }

    @Test func boardsShowTheTopFiveWithoutBlockedPeople() throws {
        let s = try stats()
        #expect(Community.showGoers(s, blocked: []).map(\.userId) == ["u1", "u2", "u3", "u4", "u5"])
        #expect(Community.showGoers(s, blocked: ["u2", "u4"]).map(\.userId) == ["u1", "u3", "u5", "u6", "u7"],
                "someone you've blocked is left out and the next one moves up")
        #expect(Community.raters(s, blocked: ["u1"]).map(\.userId) == ["me", "u3"])
        #expect(Community.songs(s).map(\.songName) == ["Song 1", "Song 2", "Song 3", "Song 4", "Song 5"])
        #expect(Community.venues(s).map(\.venueName) == ["Red Rocks"])
    }

    @Test func addIsOfferedForStrangersOnly() {
        #expect(Community.offersAdd("u1", me: "me", friends: []))
        #expect(!Community.offersAdd("me", me: "me", friends: []), "not yourself")
        #expect(!Community.offersAdd("u1", me: "me", friends: ["u1"]), "not a friend already")
        #expect(Community.offersAdd("u1", me: nil, friends: []), "a guest sees it; tapping asks for an account")
    }

    @Test func totalsHideTheUserCountBelowAThousand() throws {
        #expect(Community.totals(try stats()).map(\.label) == ["Total Shows", "Total Songs"])
        let big = try stats(totalUsers: 1_250)
        #expect(Community.totals(big).map(\.label) == ["Total Users", "Total Shows", "Total Songs"])
        #expect(Community.totals(big).first?.value == 1_250)
        #expect(try stats(totalUsers: "1000").totalUsers == 1_000, "read as Number() reads it")
    }

    @Test func userCountMatchesTheSharedFixture() throws {
        let fixture = try FixtureLoader.json(FixtureLoader.root.appendingPathComponent("user-count/threshold.json"))
        #expect(fixture["minUsers"] as? Int == UserCount.minimumToShow)
        let cases = try #require(fixture["cases"] as? [[Any]])
        #expect(!cases.isEmpty)
        for row in cases {
            let value: Any? = row[0] is NSNull ? nil : row[0]
            let expected = try #require(row[1] as? Bool)
            #expect(UserCount.shouldShow(raw: value) == expected, "\(String(describing: value))")
            if let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.rounded() == n.doubleValue {
                #expect(UserCount.shouldShow(n.intValue) == expected, "\(n)")
            }
        }
    }

    @Test func ratingsAndCountsReadAsOnTheWeb() {
        #expect(Community.rating(9.5) == "9.5/10")
        #expect(Community.rating(9) == "9.0/10")
        #expect(Community.count(1, "show", "shows") == "1 show")
        #expect(Community.count(12, "show", "shows") == "12 shows")
    }

    @Test func updatedIsATimeTodayAndADayBefore() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/Denver"))
        let locale = Locale(identifier: "en_US")
        let now = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 19, hour: 18)))
        let earlier = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 19, hour: 15, minute: 50)))
        let before = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 14, hour: 9)))
        #expect(Community.updatedLabel(earlier, now: now, calendar: calendar, locale: locale)?.replacingOccurrences(of: "\u{202F}", with: " ") == "Updated 3:50 PM")
        #expect(Community.updatedLabel(before, now: now, calendar: calendar, locale: locale) == "Updated Nov 14")
        #expect(Community.updatedLabel(nil, now: now) == nil)
    }
}
