import Foundation

/// Every rule about a show's stored date, ported from `lib/showDate.js`
/// (the readers only; the app never builds a show document, so it never
/// writes one). The shared golden table `fixtures/dates/show-dates.json`
/// is run against both, so a date reads the same in both apps.
///
/// Stored dates are ISO `YYYY-MM-DD`. Readers also accept the legacy forms
/// still in Firestore: unpadded `YYYY-M-D`, ISO with a time after it (the
/// date part is taken literally, never shifted by a time zone) and
/// setlist.fm's `DD-MM-YYYY`, which is always read day-first. Anything else
/// is unreadable: no `DateFormatter` guessing.
public enum ShowDate {
    /// The stored value as ISO `YYYY-MM-DD`, or `""` when it can't be read
    /// (`toIsoDate`).
    public static func isoDay(_ value: String?) -> String {
        guard let value else { return "" }
        let s = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return "" }
        if let m = s.wholeMatch(of: isoPattern) {
            return iso(year: String(m.1), month: String(m.2), day: String(m.3)) ?? ""
        }
        if let m = s.wholeMatch(of: dayFirstPattern) {
            return iso(year: String(m.3), month: String(m.2), day: String(m.1)) ?? ""
        }
        return ""
    }

    /// Which legacy shape a stored value has (`storedDateShape`).
    public enum Shape: String, Sendable {
        case iso
        case ddmmyyyy = "dd-mm-yyyy"
        case ambiguous
        case isoVariant = "iso-variant"
        case missing
        case other
    }

    public static func shape(_ value: String?) -> Shape {
        guard let value, !value.isEmpty else { return .missing }
        if value.wholeMatch(of: strictIsoPattern) != nil { return .iso }
        if let m = value.wholeMatch(of: dayFirstPattern), let a = Int(m.1), let b = Int(m.2) {
            return a != b && a <= 12 && b <= 12 ? .ambiguous : .ddmmyyyy
        }
        return isoDay(value).isEmpty ? .other : .isoVariant
    }

    /// `"YYYY"`, or `""` (`showYear`).
    public static func year(_ value: String?) -> String {
        String(isoDay(value).prefix(4))
    }

    /// `"MM-DD"`, for "on this day", or `""` (`monthDay`).
    public static func monthDay(_ value: String?) -> String {
        let iso = isoDay(value)
        return iso.isEmpty ? "" : String(iso.dropFirst(5))
    }

    /// Calendar-day order, oldest first; unreadable dates after readable ones
    /// (`compareShowDates`).
    public static func areInIncreasingOrder(_ a: String?, _ b: String?) -> Bool {
        let x = isoDay(a)
        let y = isoDay(b)
        if x == y { return false }
        if x.isEmpty { return false }
        if y.isEmpty { return true }
        return x < y
    }

    /// Both are the same calendar day, and readable (`sameShowDate`).
    public static func isSameDay(_ a: String?, _ b: String?) -> Bool {
        let x = isoDay(a)
        return !x.isEmpty && x == isoDay(b)
    }

    /// Whole days from `a` to `b` (later `b` is positive), or `nil` when
    /// either can't be read (`daysBetweenDates`).
    public static func daysBetween(_ a: String?, _ b: String?) -> Int? {
        guard let x = dayNumber(isoDay(a)), let y = dayNumber(isoDay(b)) else { return nil }
        return y - x
    }

    /// setlist.fm's `DD-MM-YYYY` `eventDate` as ISO, or `""` (`fromSetlistfmDate`).
    public static func fromSetlistfm(_ eventDate: String?) -> String {
        guard let eventDate, let m = eventDate.wholeMatch(of: dayFirstPattern) else { return "" }
        return iso(year: String(m.3), month: String(m.2), day: String(m.1)) ?? ""
    }

    /// The device's own calendar day, `YYYY-MM-DD` (`today`). Never the UTC
    /// date: at 8pm in California that is already tomorrow (B-02).
    public static func today(now: Date = Date(), timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return iso(year: String(c.year ?? 0), month: String(c.month ?? 0), day: String(c.day ?? 0)) ?? ""
    }

    /// On a day before `today` (`isPast`).
    public static func isPast(_ value: String?, today: String) -> Bool {
        let iso = isoDay(value)
        return !iso.isEmpty && iso < today
    }

    /// On a day after `today` (`isUpcoming`).
    public static func isUpcoming(_ value: String?, today: String) -> Bool {
        let iso = isoDay(value)
        return !iso.isEmpty && iso > today
    }

    // MARK: - Internals

    nonisolated(unsafe) private static let isoPattern = #/([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:[T ].*)?/#
    nonisolated(unsafe) private static let strictIsoPattern = #/[0-9]{4}-[0-9]{2}-[0-9]{2}/#
    nonisolated(unsafe) private static let dayFirstPattern = #/([0-9]{1,2})-([0-9]{1,2})-([0-9]{4})/#

    /// A real calendar day between 1900 and 2100, built from its parts
    /// (`isoOf`). Two-digit years read as 1950–2049, as the web does.
    static func iso(year: String, month: String, day: String) -> String? {
        guard var y = Int(year), let m = Int(month), let d = Int(day) else { return nil }
        if year.count <= 2 { y += y < 50 ? 2000 : 1900 }
        guard (1900...2100).contains(y), (1...12).contains(m), d >= 1, d <= daysIn(month: m, year: y) else { return nil }
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    private static func daysIn(month: Int, year: Int) -> Int {
        switch month {
        case 2: return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }

    /// Days since 1970-01-01 for an ISO day, with no time zone involved.
    private static func dayNumber(_ iso: String) -> Int? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        // Howard Hinnant's days_from_civil.
        let y = parts[1] <= 2 ? parts[0] - 1 : parts[0]
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (parts[1] + 9) % 12
        let doy = (153 * mp + 2) / 5 + parts[2] - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }
}
