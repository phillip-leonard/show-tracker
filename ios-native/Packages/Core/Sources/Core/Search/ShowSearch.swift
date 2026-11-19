import Foundation

// The Search tab (Stage 4, 4-12; PARITY F-2): advanced search over your own
// shows, as the web's /advanced-search (lib/advancedSearch.js,
// components/search/AdvancedSearchView.jsx), with saved and recent searches
// (lib/savedSearches.js) and the Shows page's "By artist" view. It reads the
// shows already on this device; nothing is sent anywhere.

/// The filters (`EMPTY_FILTERS`). Empty strings and a 0 rating mean "any".
public struct ShowSearchFilters: Codable, Hashable, Sendable {
    public var artist = ""
    public var venue = ""
    public var city = ""
    public var country = ""
    /// `YYYY-MM-DD`, inclusive.
    public var dateFrom = ""
    public var dateTo = ""
    /// A tour key (`TourIndex.key`).
    public var tourKey = ""
    /// A festival id (`show.festivalId`).
    public var festivalKey = ""
    public var minRating = 0
    public var notes = ""
    public var friendUid = ""
    public var song = ""

    public init() {}

    /// `hasActiveFilters`: any field set.
    public var isActive: Bool {
        minRating > 0 || ![artist, venue, city, country, dateFrom, dateTo, tourKey, festivalKey, notes, friendUid, song]
            .allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    // Saved searches written by an older build may miss a field: read it as "any".
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func s(_ k: CodingKeys) -> String { (try? c.decodeIfPresent(String.self, forKey: k)) ?? "" }
        artist = s(.artist); venue = s(.venue); city = s(.city); country = s(.country)
        dateFrom = s(.dateFrom); dateTo = s(.dateTo); tourKey = s(.tourKey); festivalKey = s(.festivalKey)
        notes = s(.notes); friendUid = s(.friendUid); song = s(.song)
        minRating = (try? c.decodeIfPresent(Int.self, forKey: .minRating)) ?? 0
    }
}

public enum ShowSearch {
    /// A filter that helped a show match (`matchedFields`).
    public enum Field: String, Sendable {
        case artist, venue, city, country, tour, festival, notes, friend, song
    }

    public struct Match: Hashable, Sendable, Identifiable {
        public var show: Show
        public var fields: [Field]
        public var id: String { show.id }
    }

    /// `includesCI`: a case-insensitive "contains" (the web's toLowerCase).
    static func includes(_ haystack: String?, _ needle: String) -> Bool {
        (haystack ?? "").lowercased().contains(needle.lowercased())
    }

    /// `matchShow`: the fields that matched, or nil when the show doesn't.
    /// The tour and festival filters take the show ids the caller worked
    /// out (`tourShowIds`, `festivalShowIds`).
    public static func match(_ show: Show, _ f: ShowSearchFilters,
                             tourShowIds: Set<String>? = nil, festivalShowIds: Set<String>? = nil) -> [Field]? {
        var fields: [Field] = []
        let text: [(String, String?, Field)] = [
            (f.artist, show.artist, .artist), (f.venue, show.venue, .venue),
            (f.city, show.city, .city), (f.country, show.country, .country),
        ]
        for (needle, haystack, field) in text where !needle.isEmpty {
            guard includes(haystack, needle) else { return nil }
            fields.append(field)
        }
        let day = show.isoDate
        if !f.dateFrom.isEmpty, day.isEmpty || day < f.dateFrom { return nil }
        if !f.dateTo.isEmpty, day.isEmpty || day > f.dateTo { return nil }
        if !f.tourKey.isEmpty {
            guard tourShowIds?.contains(show.id) == true else { return nil }
            fields.append(.tour)
        }
        if !f.festivalKey.isEmpty {
            guard festivalShowIds?.contains(show.id) == true else { return nil }
            fields.append(.festival)
        }
        if f.minRating > 0 {
            guard let rating = show.rating, rating >= f.minRating else { return nil }
        }
        if !f.notes.isEmpty {
            guard includes(show.comment, f.notes) else { return nil }
            fields.append(.notes)
        }
        if !f.friendUid.isEmpty {
            guard show.taggedFriendUids.contains(f.friendUid) else { return nil }
            fields.append(.friend)
        }
        if !f.song.isEmpty {
            guard show.setlist.contains(where: { includes($0.name, f.song) }) else { return nil }
            fields.append(.song)
        }
        return fields
    }

    /// `filterShows`, in the order given.
    public static func filter(_ shows: [Show], _ f: ShowSearchFilters,
                              tourShowIds: Set<String>? = nil, festivalShowIds: Set<String>? = nil) -> [Match] {
        shows.compactMap { show in
            match(show, f, tourShowIds: tourShowIds, festivalShowIds: festivalShowIds).map { Match(show: show, fields: $0) }
        }
    }

    /// The results' order (the web's sort menu).
    public enum Sort: String, CaseIterable, Identifiable, Sendable {
        case newest, oldest, rating, artist
        public var id: String { rawValue }
        public var title: String {
            switch self {
            case .newest: "Newest first"
            case .oldest: "Oldest first"
            case .rating: "Highest rated"
            case .artist: "Artist A–Z"
            }
        }
    }

    /// Sorted as the web sorts, ties keeping the order given.
    public static func sorted(_ matches: [Match], by sort: Sort) -> [Match] {
        matches.enumerated().sorted { a, b in
            let x = a.element.show, y = b.element.show
            let order: ComparisonResult
            switch sort {
            case .newest: order = compare(y.isoDate, x.isoDate)
            case .oldest: order = compare(x.isoDate, y.isoDate)
            case .rating: order = compare(y.rating ?? 0, x.rating ?? 0)
            case .artist: order = x.artist.localizedCompare(y.artist)
            }
            return order == .orderedSame ? a.offset < b.offset : order == .orderedAscending
        }
        .map { $0.element }
    }

    private static func compare<T: Comparable>(_ a: T, _ b: T) -> ComparisonResult {
        a < b ? .orderedAscending : a > b ? .orderedDescending : .orderedSame
    }

    /// "matched your notes · matched a song in the setlist": why a show is
    /// here when the row doesn't show it. nil when the row does.
    public static func hint(_ fields: [Field]) -> String? {
        let words = fields.compactMap { field -> String? in
            switch field {
            case .notes: "matched your notes"
            case .song: "matched a song in the setlist"
            case .friend: "matched tagged friend"
            default: nil
            }
        }
        return words.isEmpty ? nil : words.joined(separator: " · ")
    }

    /// "1 show", "12 shows": the count above the results.
    public static func countLine(_ n: Int) -> String { "\(n) show\(n == 1 ? "" : "s")" }

    // MARK: Chips

    /// One active filter, shown above the results as a chip that removes it.
    /// The two dates are one chip.
    public enum ChipField: String, CaseIterable, Sendable {
        case artist, venue, city, country, dates, tour, festival, rating, notes, friend, song
    }

    public struct Chip: Hashable, Sendable, Identifiable {
        public var field: ChipField
        public var label: String
        public var id: String { field.rawValue }
    }

    /// The active filters as chips, in the filter sheet's order. `day`
    /// formats a `YYYY-MM-DD` for display.
    public static func chips(_ f: ShowSearchFilters, tourName: String? = nil, festivalName: String? = nil,
                             friendName: String? = nil, day: (String) -> String = { $0 }) -> [Chip] {
        func set(_ value: String) -> Bool { !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        var chips: [Chip] = []
        if set(f.artist) { chips.append(Chip(field: .artist, label: f.artist)) }
        if set(f.venue) { chips.append(Chip(field: .venue, label: "@ \(f.venue)")) }
        if set(f.city) { chips.append(Chip(field: .city, label: f.city)) }
        if set(f.country) { chips.append(Chip(field: .country, label: f.country)) }
        switch (set(f.dateFrom), set(f.dateTo)) {
        case (true, true): chips.append(Chip(field: .dates, label: "\(day(f.dateFrom)) – \(day(f.dateTo))"))
        case (true, false): chips.append(Chip(field: .dates, label: "From \(day(f.dateFrom))"))
        case (false, true): chips.append(Chip(field: .dates, label: "Until \(day(f.dateTo))"))
        case (false, false): break
        }
        if set(f.tourKey) { chips.append(Chip(field: .tour, label: tourName ?? "Tour")) }
        if set(f.festivalKey) { chips.append(Chip(field: .festival, label: festivalName ?? "Festival")) }
        if f.minRating > 0 { chips.append(Chip(field: .rating, label: "\(f.minRating)★ and up")) }
        if set(f.notes) { chips.append(Chip(field: .notes, label: "Notes: “\(f.notes)”")) }
        if set(f.friendUid) { chips.append(Chip(field: .friend, label: "With \(friendName ?? "friend")")) }
        if set(f.song) { chips.append(Chip(field: .song, label: "Song: “\(f.song)”")) }
        return chips
    }

    /// The filters with one chip's filter set back to "any".
    public static func clearing(_ field: ChipField, in filters: ShowSearchFilters) -> ShowSearchFilters {
        var f = filters
        switch field {
        case .artist: f.artist = ""
        case .venue: f.venue = ""
        case .city: f.city = ""
        case .country: f.country = ""
        case .dates: f.dateFrom = ""; f.dateTo = ""
        case .tour: f.tourKey = ""
        case .festival: f.festivalKey = ""
        case .rating: f.minRating = 0
        case .notes: f.notes = ""
        case .friend: f.friendUid = ""
        case .song: f.song = ""
        }
        return f
    }

    // MARK: Presets

    public enum Preset: String, CaseIterable, Identifiable, Sendable {
        case thisMonth, thisYear, lastYear
        public var id: String { rawValue }
        public var title: String {
            switch self {
            case .thisMonth: "This month"
            case .thisYear: "This year"
            case .lastYear: "Last year"
            }
        }
    }

    /// The dates a preset sets (`applyQuickFilter`), from today on this device.
    public static func apply(_ preset: Preset, to filters: ShowSearchFilters, today: String = ShowDate.today()) -> ShowSearchFilters {
        var f = filters
        let year = Int(today.prefix(4)) ?? 1970
        switch preset {
        case .thisMonth:
            f.dateFrom = String(today.prefix(7)) + "-01"
            f.dateTo = today
        case .thisYear:
            f.dateFrom = "\(year)-01-01"
            f.dateTo = "\(year)-12-31"
        case .lastYear:
            f.dateFrom = "\(year - 1)-01-01"
            f.dateTo = "\(year - 1)-12-31"
        }
        return f
    }

    // MARK: Summary

    /// `summarizeFilters`: one line for "Recent searches".
    public static func summary(_ f: ShowSearchFilters, tourName: String? = nil, festivalName: String? = nil,
                               friendName: String? = nil) -> String {
        var parts: [String] = []
        if !f.artist.isEmpty { parts.append(f.artist) }
        if !f.venue.isEmpty { parts.append("@ \(f.venue)") }
        if !f.city.isEmpty { parts.append(f.city) }
        if !f.country.isEmpty { parts.append(f.country) }
        if !f.dateFrom.isEmpty || !f.dateTo.isEmpty {
            parts.append("\(f.dateFrom.isEmpty ? "…" : f.dateFrom) → \(f.dateTo.isEmpty ? "…" : f.dateTo)")
        }
        if !f.tourKey.isEmpty, let tourName { parts.append("tour: \(tourName)") }
        if !f.festivalKey.isEmpty, let festivalName { parts.append("festival: \(festivalName)") }
        if f.minRating > 0 { parts.append("\(f.minRating)★+") }
        if !f.notes.isEmpty { parts.append("notes: \"\(f.notes)\"") }
        if !f.friendUid.isEmpty { parts.append("with \(friendName ?? "friend")") }
        if !f.song.isEmpty { parts.append("song: \"\(f.song)\"") }
        return parts.joined(separator: " · ")
    }

    // MARK: Choices

    /// Every distinct non-empty value, A–Z (the web's datalists).
    public static func options(_ values: [String]) -> [String] {
        Array(Set(values.filter { !$0.isEmpty })).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    /// A festival a show of yours is at: id and name.
    public struct FestivalOption: Hashable, Sendable, Identifiable {
        public var id: String
        public var name: String
    }

    /// The festivals your shows are at, A–Z (from the shows' own
    /// `festivalId` and `festivalName`).
    public static func festivals(_ shows: [Show]) -> [FestivalOption] {
        var names: [String: String] = [:]
        for show in shows {
            guard let id = show.festivalId, !id.isEmpty else { continue }
            if names[id] == nil || names[id]!.isEmpty { names[id] = show.festivalName ?? "" }
        }
        return names.map { FestivalOption(id: $0.key, name: $0.value.isEmpty ? "Festival" : $0.value) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    /// The show ids a festival filter matches.
    public static func festivalShowIds(_ shows: [Show], festivalId: String) -> Set<String>? {
        festivalId.isEmpty ? nil : Set(shows.filter { $0.festivalId == festivalId }.map(\.id))
    }

    // MARK: By artist

    /// One row of "By artist" (`artistGroups`, `ArtistShowsRow`).
    public struct ArtistGroup: Hashable, Sendable, Identifiable {
        public var artist: String
        /// Newest first.
        public var shows: [Show]
        /// The average of the rated shows, nil when none is rated.
        public var averageRating: Double?
        public var id: String { artist }
    }

    public enum GroupSort: String, CaseIterable, Identifiable, Sendable {
        case mostShows, rating, name
        public var id: String { rawValue }
        public var title: String {
            switch self {
            case .mostShows: "Most shows"
            case .rating: "Highest rated"
            case .name: "A–Z"
            }
        }
    }

    /// Your shows grouped by band as stored (the web groups on the exact
    /// name), each band's shows newest first.
    public static func artistGroups(_ shows: [Show], sort: GroupSort) -> [ArtistGroup] {
        var order: [String] = []
        var byArtist: [String: [Show]] = [:]
        for show in ShowList.pastOrder(shows) where !show.artist.isEmpty {
            if byArtist[show.artist] == nil { order.append(show.artist) }
            byArtist[show.artist, default: []].append(show)
        }
        let groups = order.map { artist -> ArtistGroup in
            let list = byArtist[artist] ?? []
            let rated = list.compactMap(\.rating)
            return ArtistGroup(artist: artist, shows: list,
                               averageRating: rated.isEmpty ? nil : Double(rated.reduce(0, +)) / Double(rated.count))
        }
        return groups.enumerated().sorted { a, b in
            let x = a.element, y = b.element
            switch sort {
            case .name:
                let o = x.artist.localizedCompare(y.artist)
                return o == .orderedSame ? a.offset < b.offset : o == .orderedAscending
            case .rating:
                let p = x.averageRating ?? 0, q = y.averageRating ?? 0
                return p == q ? a.offset < b.offset : p > q
            case .mostShows:
                return x.shows.count == y.shows.count ? a.offset < b.offset : x.shows.count > y.shows.count
            }
        }
        .map { $0.element }
    }

    /// "8.3/10", or nil.
    public static func average(_ value: Double?) -> String? {
        value.map { String(format: "%.1f/10", $0) }
    }
}

// MARK: - Saved and recent searches

/// A search kept by name (`addSavedSearch`).
public struct SavedSearch: Codable, Hashable, Sendable, Identifiable {
    public var name: String
    public var filters: ShowSearchFilters
    /// Milliseconds, as the web stores it.
    public var savedAt: Double
    public var id: String { name }
}

/// A search run (`pushSearchHistory`).
public struct RecentSearch: Codable, Hashable, Sendable, Identifiable {
    public var summary: String
    public var filters: ShowSearchFilters?
    public var at: Double
    public var id: String { "\(at)|\(summary)" }
}

/// Saved and recent searches, per person, on this device (lib/savedSearches.js
/// keeps them in localStorage: conveniences, not data that syncs).
public struct SavedSearches {
    public static let maxSaved = 20
    public static let maxRecent = 8

    let defaults: UserDefaults
    let uid: String

    public init(uid: String, defaults: UserDefaults = .standard) {
        self.uid = uid
        self.defaults = defaults
    }

    var savedKey: String { "advSearch:\(uid):saved" }
    var historyKey: String { "advSearch:\(uid):history" }

    private func read<T: Decodable>(_ key: String) -> [T] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([T].self, from: data)) ?? []
    }

    private func write<T: Encodable>(_ value: [T], _ key: String) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }

    public var saved: [SavedSearch] { read(savedKey) }
    public var recent: [RecentSearch] { read(historyKey) }

    /// Saves (or replaces) a search by name, newest first, 20 at most.
    @discardableResult
    public func save(name: String, filters: ShowSearchFilters, now: Date = Date()) -> [SavedSearch] {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return saved }
        let next = Array(([SavedSearch(name: name, filters: filters, savedAt: now.timeIntervalSince1970 * 1000)]
                          + saved.filter { $0.name != name }).prefix(Self.maxSaved))
        write(next, savedKey)
        return next
    }

    @discardableResult
    public func delete(name: String) -> [SavedSearch] {
        let next = saved.filter { $0.name != name }
        write(next, savedKey)
        return next
    }

    /// Records a search run, newest first, 8 at most; the same summary
    /// moves to the top rather than repeating.
    @discardableResult
    public func push(summary: String, filters: ShowSearchFilters, now: Date = Date()) -> [RecentSearch] {
        guard !summary.isEmpty else { return recent }
        let next = Array(([RecentSearch(summary: summary, filters: filters, at: now.timeIntervalSince1970 * 1000)]
                          + recent.filter { $0.summary != summary }).prefix(Self.maxRecent))
        write(next, historyKey)
        return next
    }

    public func clearRecent() { defaults.removeObject(forKey: historyKey) }
}
