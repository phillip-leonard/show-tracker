import Foundation

/// The Shows tab's rules, without Firebase or UI, so they can be tested
/// (docs/ios-native/STAGE1-AUDIT.md §1).
///
/// - Past is every document in `users/{uid}/shows`, newest first, as the
///   web's My Shows: same count, same order. Ties (two shows on one day)
///   keep Firestore's order, the document id, which is what the web's
///   stable sort over the snapshot gives.
/// - Upcoming is `users/{uid}/upcomingShows`, soonest first, then band
///   (lib/upcomingShows.js sortUpcoming).
/// - Dates are read with `ShowDate` (lib/showDate.js), never `Date`.
public enum ShowList {

    // MARK: Order and sections

    /// Newest first; a date that can't be read sorts last; ties by id.
    public static func pastOrder(_ shows: [Show]) -> [Show] {
        shows.sorted { a, b in
            let da = a.isoDate, db = b.isoDate
            if da != db {
                if da.isEmpty { return false }
                if db.isEmpty { return true }
                return da > db
            }
            return a.id < b.id
        }
    }

    /// Soonest first, then band; a date that can't be read sorts last.
    public static func upcomingOrder(_ shows: [UpcomingShow]) -> [UpcomingShow] {
        shows.sorted { a, b in
            let da = ShowDate.isoDay(a.date), db = ShowDate.isoDay(b.date)
            if da != db {
                if da.isEmpty { return false }
                if db.isEmpty { return true }
                return da < db
            }
            let byBand = a.artist.localizedCompare(b.artist)
            if byBand != .orderedSame { return byBand == .orderedAscending }
            return a.id < b.id
        }
    }

    /// A year and its shows, in the order given.
    public struct YearSection: Identifiable, Hashable, Sendable {
        /// "2026", or "" for shows whose date can't be read.
        public let year: String
        public let shows: [Show]
        public var id: String { year }
    }

    /// Past shows grouped by year, newest year first (`pastOrder` within).
    public static func byYear(_ shows: [Show]) -> [YearSection] {
        var order: [String] = []
        var groups: [String: [Show]] = [:]
        for show in pastOrder(shows) {
            let year = ShowDate.year(show.date)
            if groups[year] == nil { order.append(year) }
            groups[year, default: []].append(show)
        }
        return order.map { YearSection(year: $0, shows: groups[$0] ?? []) }
    }

    // MARK: Search and filters

    /// What narrows the Past list. Empty means everything.
    public struct Filter: Equatable, Hashable, Sendable {
        /// Matches band, venue, city or a song title.
        public var text: String
        public var year: String?
        public var band: String?
        public var venue: String?

        public init(text: String = "", year: String? = nil, band: String? = nil, venue: String? = nil) {
            self.text = text
            self.year = year
            self.band = band
            self.venue = venue
        }

        public var trimmedText: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
        public var isEmpty: Bool { trimmedText.isEmpty && year == nil && band == nil && venue == nil }
        /// The menu filters (year, band, venue) that are set.
        public var activeCount: Int { [year, band, venue].compactMap { $0 }.count }
    }

    /// Case- and accent-insensitive "contains", as a person searching expects.
    static func contains(_ haystack: String?, _ needle: String) -> Bool {
        guard let haystack, !haystack.isEmpty else { return false }
        return haystack.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }

    static func same(_ a: String, _ b: String) -> Bool {
        a.trimmingCharacters(in: .whitespaces).compare(b.trimmingCharacters(in: .whitespaces),
                                                       options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
    }

    public static func matches(_ show: Show, _ filter: Filter) -> Bool {
        if let year = filter.year, ShowDate.year(show.date) != year { return false }
        if let band = filter.band, !same(show.artist, band) { return false }
        if let venue = filter.venue, !same(show.venue, venue) { return false }
        let text = filter.trimmedText
        if text.isEmpty { return true }
        return contains(show.artist, text) || contains(show.venue, text) || contains(show.city, text)
            || show.setlist.contains { contains($0.name, text) }
    }

    public static func filter(_ shows: [Show], _ filter: Filter) -> [Show] {
        filter.isEmpty ? shows : shows.filter { matches($0, filter) }
    }

    /// Upcoming shows match the text on band, venue or city.
    public static func matches(_ show: UpcomingShow, text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return true }
        return contains(show.artist, t) || contains(show.venue, t) || contains(show.city, t)
    }

    // MARK: Filter options

    /// Years with shows, newest first (lib/showFilters.js availableYearsFor).
    public static func years(_ shows: [Show]) -> [String] {
        Set(shows.map { ShowDate.year($0.date) }.filter { !$0.isEmpty }).sorted(by: >)
    }

    /// A name and how many shows have it.
    public struct Option: Identifiable, Hashable, Sendable {
        public let name: String
        public let count: Int
        public var id: String { name }
    }

    /// Bands, most shows first, then by name. Spellings that differ only by
    /// case or accents are one band, shown as first seen in the list.
    public static func bands(_ shows: [Show]) -> [Option] { options(pastOrder(shows).map(\.artist)) }

    /// Venues by name, most shows first.
    public static func venues(_ shows: [Show]) -> [Option] { options(pastOrder(shows).map(\.venue)) }

    static func options(_ names: [String]) -> [Option] {
        var display: [String: String] = [:]
        var counts: [String: Int] = [:]
        var order: [String] = []
        for raw in names {
            let name = raw.trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty else { continue }
            let key = name.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
            if display[key] == nil { display[key] = name; order.append(key) }
            counts[key, default: 0] += 1
        }
        return order
            .map { Option(name: display[$0] ?? $0, count: counts[$0] ?? 0) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    // MARK: Setlist status

    /// What the row says about a show's setlist.
    public enum SetlistStatus: Equatable, Sendable {
        case songs(Int)
        case missing
        /// A stored proposal (the Internet Archive backfill) waits for Accept or Keep current.
        case proposalWaiting
    }

    public static func setlistStatus(_ show: Show) -> SetlistStatus {
        if show.setlistProposal?.status == "pending" { return .proposalWaiting }
        return show.setlist.isEmpty ? .missing : .songs(show.setlist.count)
    }

    /// A show in `shows` dated after today. Production has none; the row
    /// marks one rather than hiding it, so the count still matches the web.
    public static func isFutureDated(_ show: Show, today: String) -> Bool {
        ShowDate.isUpcoming(show.date, today: today)
    }
}
