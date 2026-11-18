import FirebaseFirestore
import Foundation
import Testing
@testable import Core

/// Stats by period (Stage 4, 4-8): the server's `years` block decodes, the
/// picker reads it, the full lists built on the phone count the bands and
/// venues the server counts, and the shows-by-year chart's timeline.
@Suite struct StatsPeriodTests {
    let decoder = Firestore.Decoder()

    private func fixture(_ name: String) throws -> (stats: UserStats, shows: [Show], expected: [String: Any]) {
        let url = try #require(try FixtureLoader.files(in: "user-stats").first { $0.lastPathComponent == "\(name).json" })
        let json = try FixtureLoader.json(url)
        let expected = try #require(json["expected"] as? [String: Any])
        let docs = json["shows"] as? [[String: Any]] ?? []
        let shows = try docs.enumerated().map { i, doc -> Show in
            var doc = doc
            doc["id"] = "s\(i)"
            return try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: doc))
        }
        return (try decoder.decode(UserStats.self, from: expected), shows, expected)
    }

    @Test func theYearsBlockDecodesAsWritten() throws {
        let (stats, _, _) = try fixture("years")
        #expect(stats.pickerYears == ["2025", "2024"])
        let y2024 = try #require(stats.years["2024"])
        #expect(y2024.showCount == 3)
        #expect(y2024.bandCount == 2)
        #expect(y2024.avgShowRating == 8.7)
        #expect(y2024.ratedShowCount == 3)
        #expect(y2024.showsByMonth == [0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1])
        #expect(y2024.topBands.map(\.name) == ["Goose", "Phish"])
        #expect(stats.years["2025"]?.showsByMonth == [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0])
    }

    @Test func eachPeriodReadsTheServersNumbers() throws {
        let (stats, _, _) = try fixture("years")
        let year = try #require(stats.numbers(for: .year("2025")))
        #expect(year.showCount == 2)
        #expect(year.avgShowRating == 8)
        #expect(year.topBands.map(\.name) == ["Billy Strings", "Phish"])
        let all = try #require(stats.numbers(for: .allTime))
        #expect(all.showCount == 6) // the undated show counts all time, in no year
        #expect(all.avgShowRating == 8.5)
        // All time's months are the years' months added up.
        #expect(all.showsByMonth == [1, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0, 1])
        #expect(stats.numbers(for: .year("1999")) == nil)
    }

    @Test func aDocumentFromBeforeTheYearsBlockStillDecodes() throws {
        let stats = try decoder.decode(UserStats.self, from: ["statsVersion": 2, "showCount": 3, "showsByYear": ["2024": 3]])
        #expect(stats.years.isEmpty)
        #expect(stats.pickerYears.isEmpty)
        #expect(stats.numbers(for: .allTime)?.showsByMonth == Array(repeating: 0, count: 12))
    }

    /// The lists built on the phone have one row per band and per venue the
    /// server counted, for all time and for every year, in every fixture.
    @Test(arguments: ["years", "top-ten", "edge-cases", "empty"])
    func theFullListsCountWhatTheServerCounts(_ name: String) throws {
        let (stats, shows, _) = try fixture(name)
        for period in [StatsPeriod.allTime] + stats.pickerYears.map(StatsPeriod.year) {
            let numbers = try #require(stats.numbers(for: period))
            let periodShows = StatsLists.shows(shows, in: period)
            #expect(periodShows.count == numbers.showCount, "\(name) \(period.label): shows")
            #expect(StatsLists.bands(periodShows).count == numbers.bandCount, "\(name) \(period.label): bands")
            #expect(StatsLists.venues(periodShows).count == numbers.venueCount, "\(name) \(period.label): venues")
            // The top of each list is the server's top list, by count.
            #expect(StatsLists.bands(periodShows).prefix(numbers.topBands.count).map(\.count) == numbers.topBands.map(\.count))
            #expect(StatsLists.venues(periodShows).prefix(numbers.topVenues.count).map(\.count) == numbers.topVenues.map(\.count))
        }
    }

    @Test func theListsCarryRatingsAndDetails() throws {
        let (_, shows, _) = try fixture("years")
        let y2024 = StatsLists.shows(shows, in: .year("2024"))
        let goose = try #require(StatsLists.bands(y2024).first)
        #expect(goose.name == "Goose") // named as first logged; "goose (US)" merged in
        #expect(goose.count == 2)
        #expect(goose.averageRating == "8.0") // 9 and 7
        #expect(goose.detail == "3 songs heard") // Arcadia, Hot Tea, Madhuvan
        #expect(goose.filter == ShowsFilter(kind: .band, title: "Goose"))
        let redRocks = try #require(StatsLists.venues(y2024).first)
        #expect(redRocks.name == "Red Rocks, Morrison")
        #expect(redRocks.detail == "1 band")
        // Unrated shows don't pull the average down.
        let y2025 = StatsLists.bands(StatsLists.shows(shows, in: .year("2025")))
        #expect(y2025.first { $0.name == "Phish" }?.averageRating == nil)
    }

    @Test func topRatedIsRatingThenNewest() throws {
        let (_, shows, _) = try fixture("years")
        let top = StatsLists.topRated(shows)
        #expect(top.map(\.rating) == [10, 9, 8, 7])
        #expect(top.first?.artist == "Phish")
        #expect(StatsLists.topRated(shows, limit: 2).count == 2)
        // A rating outside 1–10 (bad data) isn't a rating, as the server reads it.
        let (_, edge, _) = try fixture("edge-cases")
        #expect(!StatsLists.topRated(edge).contains { $0.rating == 11 })
    }

    @Test func theTimelineKeepsEmptyYears() {
        let bars = StatsYears.timeline(["2019": 4, "2022": 1, "2024": 7], currentYear: 2026)
        #expect(bars.map(\.year) == Array(2019...2026))
        #expect(bars.map(\.count) == [4, 0, 0, 1, 0, 7, 0, 0])
        #expect(StatsYears.peak(bars)?.year == 2024)
        #expect(StatsYears.caption(bars[5]) == "2024 · 7 shows")
        #expect(StatsYears.caption(StatsYears.Bar(year: 2022, count: 1)) == "2022 · 1 show")
        // A future-dated show extends the timeline past this year.
        #expect(StatsYears.timeline(["2027": 1], currentYear: 2026).map(\.year) == [2027])
        #expect(StatsYears.timeline([:], currentYear: 2026).isEmpty)
        // A typo a century back doesn't draw a hundred empty bars.
        #expect(StatsYears.timeline(["1900": 1, "2025": 3], currentYear: 2026).count <= 100)
    }

    @Test func labelsAreEveryFiveYearsPlusTheEnds() {
        func labels(_ from: Int, _ to: Int) -> [Int] {
            StatsYears.labeledYears((from...to).map { StatsYears.Bar(year: $0, count: 1) }).sorted()
        }
        #expect(labels(2026, 2026) == [2026])
        #expect(labels(2022, 2026) == [2022, 2023, 2024, 2025, 2026]) // five years: all of them
        #expect(labels(2000, 2026) == [2000, 2005, 2010, 2015, 2020, 2026])
        // A multiple of five within two years of an end would collide with it.
        #expect(labels(1999, 2024) == [1999, 2005, 2010, 2015, 2020, 2024])
        #expect(labels(1998, 2026) == [1998, 2005, 2010, 2015, 2020, 2026])
        #expect(labels(1994, 2025) == [1994, 2000, 2005, 2010, 2015, 2020, 2025])
    }

    @Test func peakIsTheLatestOnATie() {
        let bars = [StatsYears.Bar(year: 2020, count: 5), StatsYears.Bar(year: 2021, count: 0), StatsYears.Bar(year: 2022, count: 5)]
        #expect(StatsYears.peak(bars)?.year == 2022)
        #expect(StatsYears.peak([StatsYears.Bar(year: 2020, count: 0)]) == nil)
    }

    @Test func heatmapShadesMatchTheWeb() {
        #expect(StatsHeatmap.level(0, max: 10) == 0)
        #expect(StatsHeatmap.level(1, max: 10) == 1)
        #expect(StatsHeatmap.level(4, max: 10) == 2)
        #expect(StatsHeatmap.level(6, max: 10) == 3)
        #expect(StatsHeatmap.level(9, max: 10) == 4)
        #expect(StatsHeatmap.level(3, max: 0) == 1)
    }

    @Test func averagesAreTheWebsToFixed() {
        #expect(NumberText.toFixed1(8.25) == "8.3")
        #expect(NumberText.toFixed1(8.75) == "8.8")
        #expect(NumberText.toFixed1(23.0 / 20.0) == "1.1")
        #expect(NumberText.toFixed1(8) == "8.0")
        #expect(NumberText.rating(8.7) == "8.7")
        #expect(NumberText.rating(nil) == nil)
    }
}
