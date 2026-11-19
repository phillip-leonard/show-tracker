import Foundation
import Testing
@testable import Core

/// The festival rules against `fixtures/festivals/` (the files
/// `lib/__tests__/festivalFixtures.test.js` runs the web's modules on).
struct FestivalTests {
    private func fixture(_ name: String) throws -> Any {
        try JSONSerialization.jsonObject(with: FixtureLoader.data("festivals/\(name)"), options: [.fragmentsAllowed])
    }

    private func text(_ v: Any?) -> String? { v as? String }
    private func int(_ v: Any?) -> Int? { Festival.wholeNumber(v) }

    // MARK: dates.json

    @Test func limitsMatch() throws {
        let json = try #require(try fixture("dates.json") as? [String: Any])
        let limits = try #require(json["limits"] as? [String: Any])
        #expect(int(limits["nameMax"]) == FestivalDates.nameMax)
        #expect(int(limits["minYear"]) == FestivalDates.minYear)
        #expect(int(limits["maxYear"]) == FestivalDates.maxYear)
    }

    @Test func datesMatchTheSharedFixture() throws {
        let json = try #require(try fixture("dates.json") as? [String: Any])
        for row in try #require(json["festivals"] as? [[String: Any]]) {
            let name = try #require(row["name"] as? String)
            let f = try #require(row["festival"] as? [String: Any])
            let start = text(f["startDate"]), end = text(f["endDate"])
            // A stored year that isn't whole (2019.5) is no year.
            let year = int(f["year"])
            #expect(FestivalDates.year(startDate: start, endDate: end, year: year) == int(row["year"]), "\(name) year")
            #expect(FestivalDates.isYearOnly(startDate: start, endDate: end, year: year) == (row["yearOnly"] as? Bool), "\(name) yearOnly")
            #expect(FestivalDates.sortKey(startDate: start, endDate: end, year: year) == text(row["sortKey"]), "\(name) sortKey")
            #expect(FestivalDates.lastDay(startDate: start, endDate: end, year: year) == text(row["lastDay"]), "\(name) lastDay")
            for (date, fits) in try #require(row["fits"] as? [String: Bool]) {
                #expect(FestivalDates.showFits(date, startDate: start, endDate: end, year: year) == fits, "\(name) fits \(date)")
            }
        }
    }

    @Test func whenFieldsMatchTheSharedFixture() throws {
        let json = try #require(try fixture("dates.json") as? [String: Any])
        for row in try #require(json["whenFields"] as? [[String: Any]]) {
            let input = try #require(row["input"] as? [String: Any])
            let year: String? = switch input["year"] {
            case let s as String: s
            case let n as NSNumber: n.stringValue
            default: nil
            }
            let ours = FestivalDates.whenFields(startDate: text(input["startDate"]), endDate: text(input["endDate"]), year: year)
            if let expected = row["output"] as? [String: Any] {
                #expect(ours == FestivalDates.When(startDate: text(expected["startDate"]), endDate: text(expected["endDate"]),
                                                   year: int(expected["year"]) ?? -1), "\(input)")
            } else {
                #expect(ours == nil, "\(input)")
            }
        }
    }

    // MARK: stats.json

    @Test func statsMatchTheSharedFixture() throws {
        let cases = try #require(try fixture("stats.json") as? [[String: Any]])
        for c in cases {
            let name = try #require(c["name"] as? String)
            let items = try #require(c["shows"] as? [[String: Any]]).map { s in
                // Only a number is a rating (the web's `typeof r === 'number'`).
                let rating = (s["rating"] as? NSNumber).flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? nil : $0.doubleValue }
                return FestivalStats.Item(id: s["id"] as? String ?? "", date: s["date"] as? String ?? "",
                                          artist: s["artist"] as? String ?? "", rating: rating)
            }
            let stats = FestivalStats.build(items)
            let expected = try #require(c["expected"] as? [String: Any])
            #expect(stats.showCount == int(expected["showCount"]), "\(name)")
            #expect(stats.artists == (expected["artists"] as? [String]), "\(name)")
            #expect(stats.artistCount == int(expected["artistCount"]), "\(name)")
            #expect(stats.avgRating == (expected["avgRating"] as? NSNumber)?.doubleValue, "\(name)")
            #expect(stats.dayCount == int(expected["dayCount"]), "\(name)")
            let days = try #require(expected["days"] as? [[String: Any]]).map {
                FestivalStats.Day(date: $0["date"] as? String ?? "", showIds: $0["showIds"] as? [String] ?? [])
            }
            #expect(stats.days == days, "\(name)")
        }
    }

    // MARK: joined.json

    @Test func joinedMatchesTheSharedFixture() throws {
        let cases = try #require(try fixture("joined.json") as? [[String: Any]])
        for c in cases {
            let name = try #require(c["name"] as? String)
            let attendance = try #require(c["attendance"] as? [String: Any])
            let canonical = c["canonical"] as? [String: Any] // null and "absent" are both nil here
            let ours = Festival.joined(attendanceId: try #require(c["attendanceId"] as? String), attendance: attendance,
                                       canonical: canonical, uid: c["uid"] as? String)
            var expected = try #require(c["expected"] as? [String: Any])
            let cutShort = expected.removeValue(forKey: "cutShort") as? Bool
            let decoded = try JSONDecoder().decode(Festival.self, from: JSONSerialization.data(withJSONObject: expected))
            #expect(ours == decoded, "\(name)")
            #expect(ours.isCutShort == cutShort, "\(name)")
        }
    }

    // MARK: The list

    private func show(_ id: String, _ date: String, _ artist: String, festival: String?, venue: String = "Great Stage Park") throws -> Show {
        var json: [String: Any] = ["id": id, "date": date, "artist": artist, "venue": venue, "city": "Manchester"]
        if let festival { json["festivalId"] = festival }
        return try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: json))
    }

    @Test func listIsNewestFirstWithCounts() throws {
        let fests = [
            Festival(id: "a", festivalId: "fa", name: "Bonnaroo", startDate: "2024-06-13", endDate: "2024-06-16"),
            Festival(id: "b", festivalId: "fb", name: "Outside Lands", year: 2024),
            Festival(id: "c", festivalId: "fc", name: "Lockn", startDate: "2025-08-21", endDate: "2025-08-24"),
        ]
        let shows = try [show("1", "2024-06-13", "Goose", festival: "a"), show("2", "2024-06-14", "Phish", festival: "a"),
                         show("3", "2025-08-22", "Goose", festival: "c"), show("4", "2024-01-01", "Other", festival: nil)]
        let rows = FestivalList.rows(fests, shows: shows, query: "", year: nil)
        #expect(rows.map(\.festival.id) == ["c", "a", "b"])
        #expect(rows.map(\.showCount) == [1, 2, 0])
        // A search narrows to festivals with a matching show, and counts those.
        let phish = FestivalList.rows(fests, shows: shows, query: "phish", year: nil)
        #expect(phish.map(\.festival.id) == ["a"])
        #expect(phish.map(\.showCount) == [1])
        // Or the festival's own name.
        #expect(FestivalList.rows(fests, shows: shows, query: "outside", year: nil).map(\.festival.id) == ["b"])
        #expect(FestivalList.rows(fests, shows: shows, query: "", year: "2025").map(\.festival.id) == ["c"])
        #expect(FestivalList.years(shows: shows) == ["2025", "2024"])
    }

    @Test func attachOffersShowsInsideTheDatesUnlessAsked() throws {
        let fest = Festival(id: "a", festivalId: "fa", name: "Bonnaroo", startDate: "2024-06-13", endDate: "2024-06-16")
        let shows = try [show("1", "2024-06-13", "Goose", festival: "a"), show("2", "2024-06-14", "Phish", festival: nil),
                         show("3", "2024-06-20", "Billy Strings", festival: nil), show("4", "2024-06-15", "Moe", festival: "other")]
        #expect(FestivalList.attachCandidates(shows, festival: fest, query: "", anyDate: false).map(\.id) == ["4", "2"])
        #expect(FestivalList.attachCandidates(shows, festival: fest, query: "", anyDate: true).map(\.id) == ["3", "4", "2"])
        #expect(FestivalList.attachCandidates(shows, festival: fest, query: "phi", anyDate: false).map(\.id) == ["2"])
        #expect(FestivalList.conflicts(["2", "4"], shows: shows, festivalId: "a").map(\.id) == ["4"])
        #expect(FestivalList.hasWindow(fest))
        #expect(!FestivalList.hasWindow(Festival(id: "x", festivalId: "fx", name: "No dates")))
    }

    @Test func upcomingByLastDay() {
        let yearOnly = Festival(id: "y", festivalId: "fy", name: "Y", year: 2026)
        #expect(FestivalDates.isUpcoming(yearOnly, today: "2026-11-19"))
        #expect(!FestivalDates.isUpcoming(Festival(id: "d", festivalId: "fd", name: "D", startDate: "2026-06-11", endDate: "2026-06-14"), today: "2026-11-19"))
        #expect(!FestivalDates.isUpcoming(Festival(id: "n", festivalId: "fn", name: "N"), today: "2026-11-19"))
    }
}
