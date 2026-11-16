import Foundation
import Testing
@testable import Core

/// `fixtures/stats-keys/keys.json` (lib/stats/keys.js, lib/venueCount.js),
/// the tap-through lists, and `fixtures/recap-launch/window.json`.
@Suite struct StatsKeysTests {
    private var keys: [String: Any] {
        get throws { try FixtureLoader.json(FixtureLoader.root.appendingPathComponent("stats-keys/keys.json")) }
    }

    @Test func bandKeysMatchTheServer() throws {
        let rows = try #require(keys["band"] as? [[String]])
        #expect(rows.count >= 5)
        for row in rows { #expect(StatsKeys.bandKey(row[0]) == row[1], "\(row[0])") }
    }

    @Test func songKeysMatchTheServer() throws {
        let rows = try #require(keys["song"] as? [[String]])
        #expect(rows.count >= 5)
        for row in rows { #expect(StatsKeys.songKey(row[0]) == row[1], "\(row[0])") }
    }

    @Test func venueKeysMatchTheServer() throws {
        let rows = try #require(keys["venue"] as? [[Any]])
        #expect(rows.count >= 5)
        for row in rows {
            let show = try #require(row[0] as? [String: String])
            let expected = row[1] as? String // NSNull → nil: no venue name, not counted
            #expect(StatsKeys.venueKey(venue: show["venue"], city: show["city"]) == expected, "\(show)")
        }
    }

    // MARK: Tap-through lists

    private func show(_ id: String, _ artist: String, _ date: String, venue: String, city: String, songs: [String] = []) throws -> Show {
        try ShowListTests.show(id, artist, date, venue: venue, city: city, songs: songs)
    }

    @Test func aBandListsEverySpellingNewestFirst() throws {
        let all = [
            try show("1", "Goose", "2025-06-01", venue: "Red Rocks", city: "Morrison", songs: ["Arcadia"]),
            try show("2", "goose (US)", "2025-06-02", venue: "red rocks ", city: "morrison"),
            try show("3", "Phish", "2024-12-31", venue: "MSG", city: "New York", songs: ["Arcadia"]),
        ]
        #expect(ShowsFilter(kind: .band, title: "Goose").shows(in: all).map(\.id) == ["2", "1"])
        #expect(ShowsFilter(kind: .band, title: "The Phish").shows(in: all).map(\.id) == ["3"])
    }

    @Test func aSongListsThatBandsShowsWithIt() throws {
        let all = [
            try show("1", "Goose", "2025-06-01", venue: "Red Rocks", city: "Morrison", songs: ["Arcadia", "Arcadia"]),
            try show("2", "goose (US)", "2025-06-02", venue: "Red Rocks", city: "Morrison", songs: ["arcadia - Live"]),
            try show("3", "Phish", "2024-12-31", venue: "MSG", city: "New York", songs: ["Arcadia"]),
            try show("4", "Goose", "2024-01-01", venue: "MSG", city: "New York", songs: ["Hungersite"]),
        ]
        #expect(ShowsFilter(kind: .song, title: "Arcadia", artist: "Goose").shows(in: all).map(\.id) == ["2", "1"])
        #expect(ShowsFilter(kind: .song, title: "Arcadia", artist: "Phish").shows(in: all).map(\.id) == ["3"])
    }

    @Test func aVenueListsItsShowsWhateverTheSpacingOrCase() throws {
        let all = [
            try show("1", "Goose", "2025-06-01", venue: "Red Rocks Amphitheatre", city: "Morrison"),
            try show("2", "Phish", "2025-06-02", venue: "red rocks  amphitheatre ", city: "morrison"),
            try show("3", "Phish", "2024-12-31", venue: "MSG", city: "New York"),
            try show("4", "Phish", "2024-12-30", venue: "MSG", city: ""),
            try show("5", "Phish", "2024-12-29", venue: "", city: "Austin"),
        ]
        #expect(ShowsFilter(kind: .venue, title: "Red Rocks Amphitheatre, Morrison").shows(in: all).map(\.id) == ["2", "1"])
        #expect(ShowsFilter(kind: .venue, title: "MSG, New York").shows(in: all).map(\.id) == ["3"])
        #expect(ShowsFilter(kind: .venue, title: "MSG").shows(in: all).map(\.id) == ["4"], "no city is its own venue")
    }

    // MARK: Year in Review link

    @Test func recapWindowMatchesTheWeb() throws {
        let window = try FixtureLoader.json(FixtureLoader.root.appendingPathComponent("recap-launch/window.json"))
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        #expect(window["year"] as? Int == RecapWindow.year)
        #expect(window["path"] as? String == RecapWindow.path)
        #expect(iso.date(from: window["promoStartsAt"] as? String ?? "") == RecapWindow.promoStartsAt)
        #expect(iso.date(from: window["promoEndsAt"] as? String ?? "") == RecapWindow.promoEndsAt)
        let cases = try #require(window["cases"] as? [[Any]])
        #expect(cases.count >= 4)
        for c in cases {
            let at = try #require(iso.date(from: c[0] as? String ?? ""))
            #expect(RecapWindow.promoted(now: at) == (c[1] as? Bool), "\(c[0])")
        }
        #expect(RecapWindow.url.absoluteString == "https://mysetlists.net/year-in-review/?year=2026")
    }

    @Test func recapLinkIsForAccountsOnly() throws {
        let inside = RecapWindow.promoStartsAt.addingTimeInterval(3600)
        #expect(RecapWindow.shown(isAccount: true, now: inside))
        #expect(!RecapWindow.shown(isAccount: false, now: inside))
        #expect(!RecapWindow.shown(isAccount: true, now: RecapWindow.promoEndsAt))
    }
}
