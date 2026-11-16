import FirebaseFirestore
import Foundation
import Testing
@testable import Core

/// `fixtures/user-stats/`: what the server writes to `userStats/{uid}`
/// (lib/stats computeUserStats, checked by lib/__tests__/statsFixtures.test.js)
/// decodes into `UserStats` with every number as written.
@Suite struct UserStatsFixtureTests {
    let decoder = Firestore.Decoder()

    @Test func fixturesArePresent() throws {
        #expect(try FixtureLoader.files(in: "user-stats").count >= 3)
    }

    @Test(arguments: try FixtureLoader.files(in: "user-stats"))
    func decodesAsWritten(_ url: URL) throws {
        let expected = try #require(FixtureLoader.json(url)["expected"] as? [String: Any])
        let stats = try decoder.decode(UserStats.self, from: expected)
        #expect(stats.showCount == expected["showCount"] as? Int)
        #expect(stats.bandCount == expected["bandCount"] as? Int)
        #expect(stats.venueCount == expected["venueCount"] as? Int)
        #expect(stats.uniqueSongCount == expected["uniqueSongCount"] as? Int)
        #expect(stats.topBands.map(\.name) == names(expected["topBands"]))
        #expect(stats.topVenues.map(\.name) == names(expected["topVenues"]))
        #expect(stats.topSongs.map(\.name) == names(expected["topSongs"]))
        let songs = expected["topSongs"] as? [[String: Any]] ?? []
        #expect(stats.topSongs.map(\.artist) == songs.map { $0["artist"] as? String ?? "?" })
        #expect(stats.topSongs.map(\.count) == songs.map { $0["count"] as? Int ?? -1 })
        #expect(stats.topBands.count <= 10 && stats.topVenues.count <= 10 && stats.topSongs.count <= 10)
    }

    @Test func aDocumentFromBeforeTopSongsDecodes() throws {
        let stats = try decoder.decode(UserStats.self, from: ["statsVersion": 2, "showCount": 3, "topBands": [["name": "Goose", "count": 2]]])
        #expect(stats.topSongs.isEmpty)
    }

    private func names(_ value: Any?) -> [String] {
        (value as? [[String: Any]] ?? []).map { $0["name"] as? String ?? "?" }
    }
}
