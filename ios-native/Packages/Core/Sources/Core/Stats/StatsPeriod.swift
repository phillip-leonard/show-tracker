import Foundation

// Stats by period (Stage 4, 4-8, F-15). The numbers come from the server
// (`userStats` and its `years` block); the phone only picks which ones to
// show. The full lists, which the server doesn't store, are built from the
// shows on the phone with the server's keys (`StatsKeys`), as the web's
// Stats tabs build them.

/// What the Stats tab shows: all time, or one year.
public enum StatsPeriod: Hashable, Sendable {
    case allTime
    case year(String)

    public var year: String? {
        if case .year(let y) = self { return y }
        return nil
    }

    public var label: String { year ?? "All time" }
}

/// The server's numbers for one period: all time from `userStats`, a year
/// from `userStats.years`.
public struct PeriodStats: Hashable, Sendable {
    public var showCount: Int
    public var songCount: Int
    public var uniqueSongCount: Int
    public var bandCount: Int
    public var venueCount: Int
    public var avgShowRating: Double?
    public var ratedShowCount: Int
    public var topBands: [NameCount]
    public var topVenues: [NameCount]
    public var topSongs: [SongCount]
    /// Twelve counts, January first. All time adds up the years' months
    /// (the server stores months per year only), as the web's all-time heatmap.
    public var showsByMonth: [Int]
}

public extension UserStats {
    /// The years the picker offers, newest first: those with numbers.
    var pickerYears: [String] {
        years.keys.filter { (years[$0]?.showCount ?? 0) > 0 }.sorted(by: >)
    }

    /// The numbers for a period, or nil for a year the server has no entry for.
    func numbers(for period: StatsPeriod) -> PeriodStats? {
        switch period {
        case .allTime:
            var months = Array(repeating: 0, count: 12)
            for y in years.values {
                for (i, n) in y.showsByMonth.prefix(12).enumerated() { months[i] += n }
            }
            return PeriodStats(showCount: showCount, songCount: songCount, uniqueSongCount: uniqueSongCount,
                               bandCount: bandCount, venueCount: venueCount, avgShowRating: avgShowRating,
                               ratedShowCount: ratedShowCount, topBands: topBands, topVenues: topVenues,
                               topSongs: topSongs, showsByMonth: months)
        case .year(let year):
            guard let y = years[year] else { return nil }
            return PeriodStats(showCount: y.showCount, songCount: y.songCount, uniqueSongCount: y.uniqueSongCount,
                               bandCount: y.bandCount, venueCount: y.venueCount, avgShowRating: y.avgShowRating,
                               ratedShowCount: y.ratedShowCount, topBands: y.topBands, topVenues: y.topVenues,
                               topSongs: y.topSongs, showsByMonth: y.showsByMonth)
        }
    }
}

// MARK: - Shows by year

/// The shows-by-year chart's data: every year from the first to the later
/// of the last and the current year, zeros included, so gaps show.
public enum StatsYears {
    public struct Bar: Hashable, Sendable, Identifiable {
        public var year: Int
        public var count: Int
        public var id: Int { year }
    }

    public static func timeline(_ showsByYear: [String: Int], currentYear: Int) -> [Bar] {
        let counts = Dictionary(showsByYear.compactMap { pair in Int(pair.key).map { ($0, pair.value) } }, uniquingKeysWith: +)
        guard let first = counts.keys.min(), let last = counts.keys.max() else { return [] }
        // A first year far in the past (a typo like 1900) would draw a century of empty bars.
        let start = max(first, last - 99)
        let end = max(last, min(currentYear, start + 99))
        return (start...end).map { Bar(year: $0, count: counts[$0] ?? 0) }
    }

    /// Which years get an axis label: all of them up to six years; else
    /// the first, the last, and every year divisible by 5 that's at least
    /// three years from both (closer, their labels would overlap).
    public static func labeledYears(_ bars: [Bar]) -> Set<Int> {
        guard let first = bars.first?.year, let last = bars.last?.year else { return [] }
        if bars.count <= 6 { return Set(bars.map(\.year)) }
        var out: Set<Int> = [first, last]
        for bar in bars where bar.year % 5 == 0 && bar.year - first >= 3 && last - bar.year >= 3 {
            out.insert(bar.year)
        }
        return out
    }

    /// The busiest year (the latest, on a tie), or nil with no shows.
    public static func peak(_ bars: [Bar]) -> Bar? {
        bars.filter { $0.count > 0 }.max { a, b in a.count != b.count ? a.count < b.count : a.year < b.year }
    }

    /// "2024 · 12 shows".
    public static func caption(_ bar: Bar) -> String {
        "\(bar.year) · \(bar.count.formatted()) show\(bar.count == 1 ? "" : "s")"
    }
}

// MARK: - Monthly heatmap

public enum StatsHeatmap {
    public static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    /// The web's `YearHeatmap` shade, 0 (none) to 4 (the busiest month).
    public static func level(_ n: Int, max: Int) -> Int {
        guard n > 0 else { return 0 }
        guard max > 0 else { return 1 }
        let pct = Double(n) / Double(max)
        if pct >= 0.85 { return 4 }
        if pct >= 0.6 { return 3 }
        if pct >= 0.35 { return 2 }
        return 1
    }
}

// MARK: - Full lists

/// The period's every band, venue and song, and its top-rated shows, from
/// the shows on this phone (the web's `getArtistStats`, `getVenueStats`,
/// `getTopRatedShows`), grouped by the server's keys so a band or venue
/// here is the one the headline counts count.
public enum StatsLists {
    public enum Kind: String, Hashable, Sendable, CaseIterable {
        case bands, venues, songs, topShows

        public var title: String {
            switch self {
            case .bands: "Bands"
            case .venues: "Venues"
            case .songs: "Songs"
            case .topShows: "Top-rated shows"
            }
        }
    }

    public struct Row: Hashable, Sendable, Identifiable {
        public var key: String
        public var name: String
        public var count: Int
        /// The average of the shows' ratings (1 to 10), one decimal as the web shows it
        /// ("8.3"), or nil with none rated.
        public var averageRating: String?
        /// "12 songs heard" for a band, "4 bands" for a venue.
        public var detail: String?
        public var filter: ShowsFilter
        public var id: String { key }
    }

    /// The period's shows: all of them, or those dated in the year
    /// (`ShowDate.year`, so a legacy date counts where the server counts it).
    public static func shows(_ shows: [Show], in period: StatsPeriod) -> [Show] {
        guard let year = period.year else { return shows }
        return shows.filter { ShowDate.year($0.date) == year }
    }

    /// Every band: shows, songs heard (titles), average show rating. Named
    /// as first logged, most shows first, then name.
    public static func bands(_ shows: [Show]) -> [Row] {
        var order: [String] = []
        var rows: [String: (name: String, count: Int, ratings: [Int], songs: Set<String>)] = [:]
        for show in ShowList.pastOrder(shows).reversed() {
            let key = StatsKeys.bandKey(show.artist)
            guard !key.isEmpty else { continue }
            if rows[key] == nil {
                order.append(key)
                rows[key] = (show.artist.trimmingCharacters(in: .whitespacesAndNewlines), 0, [], [])
            }
            rows[key]?.count += 1
            if let r = show.rating, validRating(r) { rows[key]?.ratings.append(r) }
            for song in show.setlist {
                let s = StatsKeys.songKey(song.name)
                if !s.isEmpty { rows[key]?.songs.insert(s) }
            }
        }
        return sorted(order.compactMap { key in
            guard let r = rows[key] else { return nil }
            let songs = r.songs.count
            return Row(key: key, name: r.name, count: r.count, averageRating: average(r.ratings),
                       detail: songs > 0 ? "\(songs.formatted()) song\(songs == 1 ? "" : "s") heard" : nil,
                       filter: ShowsFilter(kind: .band, title: r.name))
        })
    }

    /// Every venue ("Venue, City"): shows, bands, average show rating.
    public static func venues(_ shows: [Show]) -> [Row] {
        var order: [String] = []
        var rows: [String: (name: String, count: Int, ratings: [Int], bands: Set<String>)] = [:]
        for show in ShowList.pastOrder(shows).reversed() {
            guard let key = StatsKeys.venueKey(venue: show.venue, city: show.city) else { continue }
            if rows[key] == nil {
                order.append(key)
                rows[key] = (venueName(show), 0, [], [])
            }
            rows[key]?.count += 1
            if let r = show.rating, validRating(r) { rows[key]?.ratings.append(r) }
            let band = StatsKeys.bandKey(show.artist)
            if !band.isEmpty { rows[key]?.bands.insert(band) }
        }
        return sorted(order.compactMap { key in
            guard let r = rows[key] else { return nil }
            let bands = r.bands.count
            return Row(key: key, name: r.name, count: r.count, averageRating: average(r.ratings),
                       detail: bands > 0 ? "\(bands.formatted()) band\(bands == 1 ? "" : "s")" : nil,
                       filter: ShowsFilter(kind: .venue, title: r.name))
        })
    }

    /// The ten best-rated shows: rating, then newest first.
    public static func topRated(_ shows: [Show], limit: Int = 10) -> [Show] {
        let rated = shows.filter { $0.rating.map(validRating) ?? false }
        return Array(rated.sorted { a, b in
            if a.rating != b.rating { return (a.rating ?? 0) > (b.rating ?? 0) }
            if a.isoDate != b.isoDate { return a.isoDate > b.isoDate }
            return a.id < b.id
        }.prefix(limit))
    }

    /// The server's topVenues name: "Venue, City", or "Venue".
    static func venueName(_ show: Show) -> String {
        let venue = show.venue.trimmingCharacters(in: .whitespacesAndNewlines)
        let city = show.city.trimmingCharacters(in: .whitespacesAndNewlines)
        return city.isEmpty ? venue : "\(venue), \(city)"
    }

    /// A show rating the server counts (lib/stats `validRating`): 1 to 10.
    static func validRating(_ r: Int) -> Bool { (1...10).contains(r) }

    static func average(_ ratings: [Int]) -> String? {
        guard !ratings.isEmpty else { return nil }
        return NumberText.toFixed1(Double(ratings.reduce(0, +)) / Double(ratings.count))
    }

    private static func sorted(_ rows: [Row]) -> [Row] {
        rows.sorted { a, b in
            if a.count != b.count { return a.count > b.count }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }
}

/// Numbers written the way the web writes them.
public enum NumberText {
    /// JavaScript's `toFixed(1)`. It differs from `%.1f` only on an exact
    /// tie, which it rounds up where `%.1f` rounds to even: 4.25 is "4.3"
    /// on the web. A mean of whole numbers ties exactly only at .25 and .75.
    public static func toFixed1(_ x: Double) -> String {
        let quarters = x * 4
        if quarters == quarters.rounded(), Int(quarters) % 2 != 0 {
            return String(format: "%.1f", (x * 10).rounded(.up) / 10)
        }
        return String(format: "%.1f", x)
    }

    /// An average rating out of 10 ("8.3"), from the server's number.
    public static func rating(_ value: Double?) -> String? {
        value.map { String(format: "%.1f", $0) }
    }
}
