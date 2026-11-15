import Foundation
import Testing
@testable import Core

/// `fixtures/dates/show-dates.json`, the table `lib/showDate.js` is checked
/// against too (lib/__tests__/showDateGolden.test.js).
@Suite struct ShowDateGoldenTests {
    struct Table: Decodable {
        let toIsoDate: [[String]]
        let storedDateShape: [[String]]
        let showYear: [[String]]
        let monthDay: [[String]]
        let compareShowDates: Ordering
        let sameShowDate: [SamePair]
        let daysBetweenDates: [DaysRow]
        let fromSetlistfmDate: [[String]]
        let relativeToToday: [Relative]
        let today: [TodayRow]

        struct Ordering: Decodable { let input: [String]; let sorted: [String] }
        struct Relative: Decodable { let today: String; let date: String; let isPast: Bool; let isUpcoming: Bool }
        struct TodayRow: Decodable { let instant: String; let timeZone: String; let expected: String }
        struct SamePair: Decodable {
            let a: String, b: String, same: Bool
            init(from decoder: Decoder) throws {
                var c = try decoder.unkeyedContainer()
                a = try c.decode(String.self); b = try c.decode(String.self); same = try c.decode(Bool.self)
            }
        }
        struct DaysRow: Decodable {
            let a: String, b: String, days: Int?
            init(from decoder: Decoder) throws {
                var c = try decoder.unkeyedContainer()
                a = try c.decode(String.self); b = try c.decode(String.self); days = try c.decodeNil() ? nil : c.decode(Int.self)
            }
        }
    }

    let table: Table

    init() throws {
        table = try JSONDecoder().decode(Table.self, from: FixtureLoader.data("dates/show-dates.json"))
    }

    @Test func isoDay() {
        for row in table.toIsoDate { #expect(ShowDate.isoDay(row[0]) == row[1], "toIsoDate(\(row[0]))") }
        #expect(ShowDate.isoDay(nil) == "")
    }

    @Test func shape() {
        for row in table.storedDateShape { #expect(ShowDate.shape(row[0]).rawValue == row[1], "storedDateShape(\(row[0]))") }
        #expect(ShowDate.shape(nil) == .missing)
    }

    @Test func yearAndMonthDay() {
        for row in table.showYear { #expect(ShowDate.year(row[0]) == row[1]) }
        for row in table.monthDay { #expect(ShowDate.monthDay(row[0]) == row[1]) }
    }

    @Test func ordering() {
        #expect(table.compareShowDates.input.sorted(by: ShowDate.areInIncreasingOrder) == table.compareShowDates.sorted)
        for p in table.sameShowDate { #expect(ShowDate.isSameDay(p.a, p.b) == p.same, "sameShowDate(\(p.a), \(p.b))") }
    }

    @Test func daysBetween() {
        for r in table.daysBetweenDates { #expect(ShowDate.daysBetween(r.a, r.b) == r.days, "daysBetween(\(r.a), \(r.b))") }
    }

    @Test func fromSetlistfm() {
        for row in table.fromSetlistfmDate { #expect(ShowDate.fromSetlistfm(row[0]) == row[1]) }
    }

    @Test func pastAndUpcoming() {
        for r in table.relativeToToday {
            #expect(ShowDate.isPast(r.date, today: r.today) == r.isPast, "isPast(\(r.date))")
            #expect(ShowDate.isUpcoming(r.date, today: r.today) == r.isUpcoming, "isUpcoming(\(r.date))")
        }
    }

    @Test func todayIsTheLocalCalendarDay() throws {
        for r in table.today {
            let instant = try #require(ISO8601DateFormatter().date(from: r.instant))
            let zone = try #require(TimeZone(identifier: r.timeZone))
            #expect(ShowDate.today(now: instant, timeZone: zone) == r.expected, "\(r.instant) in \(r.timeZone)")
        }
    }
}
