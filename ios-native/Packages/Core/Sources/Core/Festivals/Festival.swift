import Foundation

// Festivals (Stage 5; docs/ios-native/STAGE5-AUDIT.md). A festival is two
// documents: the shared `festivals/{festivalId}` (name, dates, location,
// the Ticketmaster or announced lineup), readable by any signed-in user and
// written only by the server, and the person's private attendance record
// `users/{uid}/festivals/{attendanceId}` (notes, a typed lineup). A show's
// `festivalId` is the attendance id.

/// One festival as the screens read it: `lib/festivalCatalog.js`
/// `joinedFestival`, checked against `fixtures/festivals/joined.json`.
/// `netlify/functions/festivals.js` answers with the same object.
public struct Festival: Hashable, Sendable, Identifiable, Decodable {
    /// The attendance id: what `/festivals/?festival=` and a show's `festivalId` name.
    public var id: String
    /// The shared festival's id; nil for a record from before 5.30.0.
    public var festivalId: String?
    public var name: String
    public var startDate: String?
    public var endDate: String?
    public var year: Int?
    public var location: String
    public var edition: String
    public var isCreator: Bool
    public var isSeeded: Bool
    public var catalogStatus: String?
    public var catalogNote: String?
    public var notes: String
    public var rating: Double?
    /// The lineup this person typed: private to them.
    public var myLineup: [String]
    /// The shared lineup, from Ticketmaster or the announced lineup file.
    public var lineup: [String]
    public var lineupSource: String?
    public var lineupUrl: String?
    /// A record from before 5.30.0: it holds its own name and dates.
    public var unmigrated: Bool
    /// The shared festival couldn't be read.
    public var unavailable: Bool

    public var isCutShort: Bool { catalogStatus == "cut_short" }

    enum CodingKeys: String, CodingKey {
        case id, festivalId, name, startDate, endDate, year, location, edition, isCreator, isSeeded,
             catalogStatus, catalogNote, notes, rating, myLineup, lineup, lineupSource, lineupUrl, unmigrated, unavailable
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        festivalId = try c.decodeIfPresent(String.self, forKey: .festivalId)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        startDate = try c.decodeIfPresent(String.self, forKey: .startDate)
        endDate = try c.decodeIfPresent(String.self, forKey: .endDate)
        year = try c.decodeIfPresent(Int.self, forKey: .year)
        location = try c.decodeIfPresent(String.self, forKey: .location) ?? ""
        edition = try c.decodeIfPresent(String.self, forKey: .edition) ?? ""
        isCreator = try c.decodeIfPresent(Bool.self, forKey: .isCreator) ?? false
        isSeeded = try c.decodeIfPresent(Bool.self, forKey: .isSeeded) ?? false
        catalogStatus = try c.decodeIfPresent(String.self, forKey: .catalogStatus)
        catalogNote = try c.decodeIfPresent(String.self, forKey: .catalogNote)
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        rating = try c.decodeIfPresent(Double.self, forKey: .rating)
        myLineup = try c.decodeIfPresent([String].self, forKey: .myLineup) ?? []
        lineup = try c.decodeIfPresent([String].self, forKey: .lineup) ?? []
        lineupSource = try c.decodeIfPresent(String.self, forKey: .lineupSource)
        lineupUrl = try c.decodeIfPresent(String.self, forKey: .lineupUrl)
        unmigrated = try c.decodeIfPresent(Bool.self, forKey: .unmigrated) ?? false
        unavailable = try c.decodeIfPresent(Bool.self, forKey: .unavailable) ?? false
    }

    public init(id: String, festivalId: String?, name: String, startDate: String? = nil, endDate: String? = nil, year: Int? = nil,
                location: String = "", edition: String = "", isCreator: Bool = false, isSeeded: Bool = false,
                catalogStatus: String? = nil, catalogNote: String? = nil, notes: String = "", rating: Double? = nil,
                myLineup: [String] = [], lineup: [String] = [], lineupSource: String? = nil, lineupUrl: String? = nil,
                unmigrated: Bool = false, unavailable: Bool = false) {
        self.id = id; self.festivalId = festivalId; self.name = name
        self.startDate = startDate; self.endDate = endDate; self.year = year
        self.location = location; self.edition = edition; self.isCreator = isCreator; self.isSeeded = isSeeded
        self.catalogStatus = catalogStatus; self.catalogNote = catalogNote; self.notes = notes; self.rating = rating
        self.myLineup = myLineup; self.lineup = lineup; self.lineupSource = lineupSource; self.lineupUrl = lineupUrl
        self.unmigrated = unmigrated; self.unavailable = unavailable
    }

    /// `joinedFestival(attendanceId, attendance, canonical, uid)`: the
    /// attendance record joined to its shared festival. `canonical` is the
    /// shared document's data, or nil when it can't be read; a record
    /// without `festivalId` (before 5.30.0) ignores it.
    public static func joined(attendanceId: String, attendance: [String: Any], canonical: [String: Any]?, uid: String?) -> Festival {
        let a = attendance
        let notes = (a["notes"] as? String) ?? ""
        let rating = (a["rating"] as? NSNumber).flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? nil : $0.doubleValue }
        let myLineup = (a["myLineup"] as? [Any])?.compactMap { $0 as? String } ?? []

        func when(_ src: [String: Any]) -> (String?, String?, Int?) {
            var start: String?, end: String?
            if let s = src["startDate"] as? String, !s.isEmpty {
                start = s
                let e = src["endDate"] as? String
                end = (e?.isEmpty == false) ? e : s
            }
            return (start, end, wholeNumber(src["year"]))
        }

        guard let festivalId = (a["festivalId"] as? String), !festivalId.isEmpty else {
            let (start, end, year) = when(a)
            return Festival(id: attendanceId, festivalId: nil, name: nonEmpty(a["name"]) ?? "Untitled festival",
                            startDate: start, endDate: end, year: year,
                            location: (a["location"] as? String) ?? "", edition: (a["edition"] as? String) ?? "",
                            isCreator: true, notes: notes, rating: rating, myLineup: myLineup, unmigrated: true)
        }
        guard let canonical else {
            return Festival(id: attendanceId, festivalId: festivalId, name: nonEmpty(a["name"]) ?? "Unavailable festival",
                            notes: notes, rating: rating, myLineup: myLineup, unavailable: true)
        }
        let (start, end, year) = when(canonical)
        let source = canonical["source"] as? String
        return Festival(
            id: attendanceId, festivalId: festivalId, name: (canonical["name"] as? String) ?? "",
            startDate: start, endDate: end, year: year,
            location: (canonical["location"] as? String) ?? "", edition: (canonical["edition"] as? String) ?? "",
            isCreator: uid != nil && (canonical["createdBy"] as? String) == uid,
            isSeeded: source == "seed",
            catalogStatus: nonEmpty(canonical["status"]), catalogNote: nonEmpty(canonical["notes"]),
            notes: notes, rating: rating, myLineup: myLineup,
            lineup: (canonical["lineup"] as? [Any])?.compactMap { $0 as? String } ?? [],
            lineupSource: nonEmpty(canonical["lineupSource"]), lineupUrl: nonEmpty(canonical["lineupUrl"]))
    }

    /// A JS truthy string, or nil (`x || null`).
    static func nonEmpty(_ value: Any?) -> String? {
        guard let s = value as? String, !s.isEmpty else { return nil }
        return s
    }

    /// `Number.isInteger`: a whole number, from Firestore's or JSON's numbers.
    static func wholeNumber(_ value: Any?) -> Int? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        guard d.isFinite, d.rounded() == d, abs(d) < 1e15 else { return nil }
        return Int(d)
    }
}

// MARK: - When a festival happened

/// `lib/festivalDates.js` and the year rules of `lib/festivalMatch.js`,
/// checked against `fixtures/festivals/dates.json`.
public enum FestivalDates {
    public static let minYear = 1900
    public static let maxYear = 2100
    public static let nameMax = 120
    /// No festival runs for a month: a wider span is a mistyped year.
    static let maxDays = 30

    /// `parseDay`: a yyyy-MM-dd day from 1900 to 2100, as a day number.
    static func parseDay(_ value: String?) -> Int? {
        guard let value, value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
              let year = Int(value.prefix(4)), (minYear...maxYear).contains(year) else { return nil }
        return ShowDate.dayNumber(value)
    }

    /// `windowOf`: the festival's first and last day, or nil without a
    /// readable start (or with a span over a month).
    static func window(_ startDate: String?, _ endDate: String?) -> (start: Int, end: Int)? {
        guard let start = parseDay(startDate) else { return nil }
        guard let end = parseDay(endDate), end >= start else { return (start, start) }
        if end - start > maxDays { return nil }
        return (start, end)
    }

    /// `festivalYear`: the start date's year, else a stored year in range.
    public static func year(startDate: String?, endDate: String?, year: Int?) -> Int? {
        if window(startDate, endDate) != nil, let startDate, let y = Int(startDate.prefix(4)) { return y }
        guard let year, (minYear...maxYear).contains(year) else { return nil }
        return year
    }

    public static func year(_ f: Festival) -> Int? { year(startDate: f.startDate, endDate: f.endDate, year: f.year) }

    /// A year but no readable dates: added knowing only the year.
    public static func isYearOnly(startDate: String?, endDate: String?, year: Int?) -> Bool {
        window(startDate, endDate) == nil && self.year(startDate: startDate, endDate: endDate, year: year) != nil
    }

    public static func isYearOnly(_ f: Festival) -> Bool { isYearOnly(startDate: f.startDate, endDate: f.endDate, year: f.year) }

    /// Sorts by start, newest first when descending; a year-only festival
    /// as "2024-00-00", after that year's dated festivals.
    public static func sortKey(startDate: String?, endDate: String?, year: Int?) -> String {
        if let startDate, !startDate.isEmpty { return startDate }
        return self.year(startDate: startDate, endDate: endDate, year: year).map { "\($0)-00-00" } ?? ""
    }

    public static func sortKey(_ f: Festival) -> String { sortKey(startDate: f.startDate, endDate: f.endDate, year: f.year) }

    /// The last day it could have run: 31 December for a year-only festival.
    public static func lastDay(startDate: String?, endDate: String?, year: Int?) -> String {
        if let startDate, !startDate.isEmpty { return (endDate?.isEmpty == false ? endDate : nil) ?? startDate }
        return self.year(startDate: startDate, endDate: endDate, year: year).map { "\($0)-12-31" } ?? ""
    }

    public static func lastDay(_ f: Festival) -> String { lastDay(startDate: f.startDate, endDate: f.endDate, year: f.year) }

    /// Still to come (or on now): its last day is today or later.
    public static func isUpcoming(_ f: Festival, today: String) -> Bool {
        let last = lastDay(f)
        return !last.isEmpty && last >= today
    }

    /// `showFitsFestival`: inside its dates, or anywhere in its year; a
    /// festival with neither, or a show with no date, fits.
    public static func showFits(_ showDate: String?, startDate: String?, endDate: String?, year: Int?) -> Bool {
        let iso = ShowDate.isoDay(showDate)
        let date = iso.isEmpty ? (showDate ?? "") : iso
        if date.isEmpty { return true }
        if let startDate, !startDate.isEmpty {
            let end = (endDate?.isEmpty == false ? endDate : nil) ?? startDate
            return date >= startDate && date <= end
        }
        guard let y = self.year(startDate: startDate, endDate: endDate, year: year) else { return true }
        return ShowDate.year(date) == String(y)
    }

    public static func showFits(_ showDate: String?, _ f: Festival) -> Bool {
        showFits(showDate, startDate: f.startDate, endDate: f.endDate, year: f.year)
    }

    public struct When: Equatable, Sendable {
        public var startDate: String?
        public var endDate: String?
        public var year: Int
    }

    /// `festivalWhenFields`: what a festival is written with, from a form:
    /// both dates and their year, or only the year; nil when neither reads.
    /// `year` is the text typed (or a number as text).
    public static func whenFields(startDate: String?, endDate: String?, year: String?) -> When? {
        if let startDate, !startDate.isEmpty {
            let start = ShowDate.isoDay(startDate)
            let end = (endDate?.isEmpty == false) ? ShowDate.isoDay(endDate) : start
            guard !start.isEmpty, !end.isEmpty, end >= start, start == startDate else { return nil }
            if let endDate, !endDate.isEmpty, end != endDate { return nil }
            guard let y = Int(ShowDate.year(start)), (minYear...maxYear).contains(y) else { return nil }
            return When(startDate: start, endDate: end, year: y)
        }
        guard let text = year?.trimmingCharacters(in: .whitespacesAndNewlines), let d = Double(text),
              d.rounded() == d, d >= Double(minYear), d <= Double(maxYear) else { return nil }
        return When(startDate: nil, endDate: nil, year: Int(d))
    }
}
