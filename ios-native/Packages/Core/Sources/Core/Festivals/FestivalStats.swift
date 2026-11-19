import Foundation

/// One festival's tiles and days, from the person's own shows attached to
/// it: `lib/festivalGrouping.js` `buildFestivalStats` on the shared keys
/// (Stage 5 call C), checked against `fixtures/festivals/stats.json`.
///
///   artists   by `StatsKeys.bandKey`: "Goose" and "goose" are one artist,
///             shown with the first spelling in date order
///   average   over ratings from 1 to 10 only
///   days      by the show's ISO day; a show whose date can't be read is
///             grouped last, under "", and isn't a day
public struct FestivalStats: Equatable, Sendable {
    /// What the stats read from a show.
    public struct Item: Equatable, Sendable {
        public var id: String
        public var date: String
        public var artist: String
        public var rating: Double?

        public init(id: String, date: String, artist: String, rating: Double?) {
            self.id = id; self.date = date; self.artist = artist; self.rating = rating
        }

        public init(_ show: Show) {
            self.init(id: show.id, date: show.date, artist: show.artist, rating: show.rating.map(Double.init))
        }
    }

    public struct Day: Equatable, Sendable, Identifiable {
        /// ISO, or "" for the shows whose date can't be read.
        public var date: String
        public var showIds: [String]
        public var id: String { date }
    }

    public var showCount: Int
    public var artists: [String]
    public var artistCount: Int
    public var avgRating: Double?
    public var dayCount: Int
    public var days: [Day]

    public static func build(_ items: [Item]) -> FestivalStats {
        let withDay = items.enumerated().map { (i: $0.offset, item: $0.element, day: ShowDate.isoDay($0.element.date)) }
        // Readable days first, oldest first; same-day shows keep their order.
        let sorted = withDay.sorted { a, b in
            if a.day != b.day {
                if a.day.isEmpty { return false }
                if b.day.isEmpty { return true }
                return a.day < b.day
            }
            return a.i < b.i
        }

        var artistKeys: [String: String] = [:]
        for entry in sorted {
            let name = entry.item.artist.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = StatsKeys.bandKey(name)
            if !key.isEmpty, artistKeys[key] == nil { artistKeys[key] = name }
        }

        let ratings = sorted.compactMap(\.item.rating).filter { $0.isFinite && $0 >= 1 && $0 <= 10 }
        let average = ratings.isEmpty ? nil : ratings.reduce(0, +) / Double(ratings.count)

        var order: [String] = []
        var byDay: [String: [String]] = [:]
        for entry in sorted {
            if byDay[entry.day] == nil { order.append(entry.day) }
            byDay[entry.day, default: []].append(entry.item.id)
        }
        let days = order.map { Day(date: $0, showIds: byDay[$0] ?? []) }

        return FestivalStats(
            showCount: items.count,
            artists: artistKeys.values.sorted { $0.localizedCompare($1) == .orderedAscending },
            artistCount: artistKeys.count,
            avgRating: average,
            dayCount: days.filter { !$0.date.isEmpty }.count,
            days: days)
    }

    public static func build(shows: [Show]) -> FestivalStats { build(shows.map(Item.init)) }
}

/// The festivals list (`FestivalListView`): newest first, each with its
/// show count; a filter on the shows narrows it to festivals with a
/// matching show, as the web's shared show filter does.
public enum FestivalList {
    public struct Row: Identifiable, Hashable, Sendable {
        public var festival: Festival
        public var showCount: Int
        public var id: String { festival.id }
    }

    /// Newest first by start (`festivalSortKey`), then by name.
    public static func sorted(_ festivals: [Festival]) -> [Festival] {
        festivals.sorted { a, b in
            let x = FestivalDates.sortKey(a), y = FestivalDates.sortKey(b)
            if x != y { return x > y }
            return a.name.localizedCompare(b.name) == .orderedAscending
        }
    }

    /// The rows for a search (band or venue of an attached show, as the
    /// web's filter reads, or the festival's own name) and a year (of an
    /// attached show). With no filter, every festival.
    public static func rows(_ festivals: [Festival], shows: [Show], query: String, year: String?) -> [Row] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let filtering = !q.isEmpty || year != nil
        func matches(_ text: String) -> Bool { text.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
        let attached = shows.filter { $0.festivalId != nil }
        let matching = attached.filter { show in
            (q.isEmpty || matches(show.artist) || matches(show.venue)) && (year == nil || ShowDate.year(show.date) == year)
        }
        var counts: [String: Int] = [:]
        for show in (filtering ? matching : attached) { counts[show.festivalId!, default: 0] += 1 }
        return sorted(festivals).compactMap { festival in
            let named = !q.isEmpty && year == nil && matches(festival.name)
            if filtering, counts[festival.id] == nil, !named { return nil }
            // A name match with no matching show still counts every show of it.
            let count = counts[festival.id] ?? (named ? attached.filter { $0.festivalId == festival.id }.count : 0)
            return Row(festival: festival, showCount: count)
        }
    }

    /// The years of the shows attached to festivals, newest first: the year filter's choices.
    public static func years(shows: [Show]) -> [String] {
        Array(Set(shows.filter { $0.festivalId != nil }.map { ShowDate.year($0.date) }.filter { !$0.isEmpty })).sorted(by: >)
    }

    /// Shows to offer in "Pick from my shows": not already here, inside the
    /// festival's dates (or its year) unless `anyDate`, matching the search
    /// on band, venue or date, newest first (`AttachShowsModal`).
    public static func attachCandidates(_ shows: [Show], festival: Festival, query: String, anyDate: Bool) -> [Show] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return shows
            .filter { $0.festivalId != festival.id }
            .filter { anyDate || FestivalDates.showFits($0.date, festival) }
            .filter { q.isEmpty || $0.artist.lowercased().contains(q) || $0.venue.lowercased().contains(q) || $0.date.contains(q) }
            .sorted { $0.date > $1.date }
    }

    /// The festival has dates or a year to narrow the picker to.
    public static func hasWindow(_ festival: Festival) -> Bool {
        (festival.startDate?.isEmpty == false) || FestivalDates.year(festival) != nil
    }

    /// Shows already in another festival, which attaching would move.
    public static func conflicts(_ showIds: [String], shows: [Show], festivalId: String) -> [Show] {
        let ids = Set(showIds)
        return shows.filter { ids.contains($0.id) && $0.festivalId != nil && $0.festivalId != festivalId }
    }
}
