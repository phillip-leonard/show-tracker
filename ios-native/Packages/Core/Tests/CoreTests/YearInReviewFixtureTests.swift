import Foundation
import Testing
@testable import Core

/// Every file in `fixtures/year-in-review/`: the stored shows decode, and
/// `expected.yearInReview` (what the server writes to
/// `yearInReviews/{uid}_{year}.stats`) and `expected.recap` decode and
/// re-encode to the same JSON.
@Suite struct YearInReviewFixtureTests {
    static let files: [URL] = (try? FixtureLoader.files(in: "year-in-review")) ?? []

    struct Fixture: Decodable {
        let year: Int
        let shows: [Show]
        let expected: Expected
        struct Expected: Decodable {
            let yearInReview: YearInReviewStats?
            let recap: YearRecap?
        }
    }

    @Test func fixturesArePresent() {
        #expect(Self.files.count >= 7, "fixtures/year-in-review wasn't bundled")
    }

    @Test(arguments: files)
    func decodesAndRoundTrips(_ url: URL) throws {
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let raw = try #require(FixtureLoader.json(url)["expected"] as? [String: Any])


        let encoded: [(String, Any?)] = [
            ("yearInReview", try fixture.expected.yearInReview.map { try JSONCompare.encode($0) }),
            ("recap", try fixture.expected.recap.map { try JSONCompare.encode($0) }),
        ]
        for (key, decoded) in encoded {
            let expectedValue = raw[key]
            if expectedValue == nil || expectedValue is NSNull {
                #expect(decoded == nil, "\(url.lastPathComponent): \(key) should be null")
                continue
            }
            let model = try #require(decoded, "\(url.lastPathComponent): \(key) didn't decode")
            let diff = JSONCompare.difference(JSONCompare.normalized(model), JSONCompare.normalized(expectedValue!))
            #expect(diff == nil, "\(url.lastPathComponent) \(key): \(diff ?? "")")
        }

        // Read the same way the server counts: the year's shows by ShowDate,
        // ISO and DD-MM-YYYY alike. An unreadable date ("sometime in 2025",
        // dates-legacy-and-new-year.json) belongs to no year.
        if let stats = fixture.expected.yearInReview {
            let inYear = fixture.shows.filter { ShowDate.year($0.date) == String(fixture.year) }
            #expect(stats.totalShows == inYear.count, "\(url.lastPathComponent): \(stats.totalShows) vs \(inYear.count) shows dated \(fixture.year)")
            #expect(stats.year == fixture.year)
        }
    }
}
