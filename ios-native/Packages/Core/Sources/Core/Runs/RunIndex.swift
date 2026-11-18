import Foundation

/// Venue names as `lib/showIdentity.js` compares them: case, punctuation and
/// spacing don't make a different venue.
public enum VenueNames {
    /// `normalizeVenueName`.
    public static func normalize(_ name: String?) -> String {
        guard let name, !name.isEmpty else { return "" }
        var s = name.lowercased()
        s = s.replacingOccurrences(of: #"[^a-z0-9\s]"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `venuesFuzzyMatch`: one name contains the other once normalized
    /// ("Dick's" and "Dick's Sporting Goods Park"; not "MSG" and "Madison
    /// Square Garden").
    public static func fuzzyMatch(_ a: String?, _ b: String?) -> Bool {
        let na = normalize(a), nb = normalize(b)
        guard !na.isEmpty, !nb.isEmpty else { return false }
        return na.contains(nb) || nb.contains(na)
    }

    /// `venueSlug` (lib/runIndex.js): run and tour keys use it.
    static func slug(_ name: String?) -> String {
        var s = (name ?? "").lowercased()
        s = s.replacingOccurrences(of: #"[^a-z0-9\s]"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+"#, with: "-", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `venueKeyFor` (lib/venues.js): `name::city`, trimmed and lowercased;
    /// nil with neither. The `/venues/?venue=` key.
    public static func venueKey(name: String?, city: String?) -> String? {
        let key = "\((name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased())::\((city ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased())"
        return key == "::" ? nil : key
    }
}

/// Runs: two or more nights of one artist at one venue with at most a day
/// between nights. The Swift copy of `lib/runIndex.js` `buildRunIndex`,
/// checked against `fixtures/runs/runs-and-tours.json` (`RunIndexTests`).
///
/// The artist is the exact stored string, as on the web ("phish" and
/// "Phish" are two artists here); the venue is `VenueNames.fuzzyMatch`, so a
/// sponsor rename doesn't split a run, and "MSG" against "Madison Square
/// Garden" does (post-launch: venue aliases).
public enum RunIndex {
    /// The most days allowed between one night and the next.
    public static let maxNightGapDays = 1

    public struct Night: Hashable, Sendable, Identifiable {
        public var showId: String
        public var date: String
        public var venue: String
        public var city: String
        public var rating: Int?
        public var setlist: [Song]
        public var hasSetlist: Bool { !setlist.isEmpty }
        public var id: String { showId }
    }

    /// One song across the run, and the nights (from 1) it was played on.
    public struct RunSong: Hashable, Sendable, Identifiable {
        public var key: String
        public var title: String
        public var nightNumbers: [Int]
        public var id: String { key }
    }

    public struct Run: Hashable, Sendable, Identifiable {
        public var key: String
        public var artistName: String
        public var artistSlug: String
        public var venueName: String
        public var city: String
        public var nights: [Night]
        public var nightCount: Int { nights.count }
        public var start: String
        public var end: String
        public var totalSongs: Int
        public var uniqueSongs: Int
        /// A night has no setlist, so repeats can't be known.
        public var hasIncompleteData: Bool
        /// nil when that can't be known.
        public var noRepeat: Bool?
        public var repeats: [RunSong]
        public var combinedSetlist: [RunSong]
        public var avgRating: Double?
        /// The one night with the top rating; nil when none or a tie.
        public var bestNightIndex: Int?
        public var id: String { key }

        /// "Night 2 of 3", for a show that's one of its nights.
        public func nightNumber(of showId: String) -> Int? {
            nights.firstIndex { $0.showId == showId }.map { $0 + 1 }
        }
    }

    /// `runKeyFor`: `artistSlug:venueSlug:firstDate`, or nil.
    public static func key(artist: String, venue: String, firstDate: String) -> String? {
        let a = BandFollows.slug(artist), v = VenueNames.slug(venue)
        guard !a.isEmpty, !v.isEmpty, !firstDate.isEmpty else { return nil }
        return "\(a):\(v):\(firstDate)"
    }

    /// `buildRunIndex`, newest run first (the web's order).
    public static func build(_ shows: [Show]) -> [Run] {
        var artistOrder: [String] = []
        var byArtist: [String: [(show: Show, order: Int)]] = [:]
        for (i, show) in shows.enumerated() where !show.artist.isEmpty && !show.venue.isEmpty && !show.date.isEmpty {
            if byArtist[show.artist] == nil { artistOrder.append(show.artist) }
            byArtist[show.artist, default: []].append((show, i))
        }
        var runs: [(run: Run, order: Int)] = []
        for artist in artistOrder {
            let sorted = (byArtist[artist] ?? []).sorted { a, b in
                let x = dayNumber(a.show.date), y = dayNumber(b.show.date)
                return x != y ? x < y : a.order < b.order
            }.map(\.show)
            for cluster in clusters(sorted) where cluster.count >= 2 {
                runs.append((buildRun(cluster), runs.count))
            }
        }
        return runs.sorted { a, b in
            let x = dayNumber(a.run.start), y = dayNumber(b.run.start)
            return x != y ? x > y : a.order < b.order
        }.map(\.run)
    }

    /// Calendar days since 1970 (`parseDate`: an unreadable date is 1970-01-01).
    public static func dayNumber(_ date: String) -> Int {
        ShowDate.daysBetween("1970-01-01", date) ?? 0
    }

    static func clusters(_ sorted: [Show]) -> [[Show]] {
        var out: [[Show]] = []
        var current: [Show] = []
        for show in sorted {
            guard let prev = current.last else { current = [show]; continue }
            let gap = dayNumber(show.date) - dayNumber(prev.date)
            if gap <= maxNightGapDays, VenueNames.fuzzyMatch(prev.venue, show.venue) {
                current.append(show)
            } else {
                out.append(current)
                current = [show]
            }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    static func buildRun(_ cluster: [Show]) -> Run {
        let nights = cluster.map { Night(showId: $0.id, date: $0.date, venue: $0.venue, city: $0.city, rating: $0.rating, setlist: $0.setlist) }
        let artist = cluster[0].artist
        let venueName = mostCommon(cluster.map(\.venue)) ?? cluster[0].venue
        let incomplete = nights.contains { !$0.hasSetlist }

        // key -> title (the last spelling seen) and nights; key order is first appearance.
        var keyOrder: [String] = []
        var titles: [String: String] = [:]
        var nightSets: [String: Set<Int>] = [:]
        var performances: [String: Int] = [:]
        var total = 0
        for (i, night) in nights.enumerated() {
            for song in night.setlist {
                let title = song.name.trimmingCharacters(in: .whitespacesAndNewlines)
                let key = StatsKeys.normalizeSongTitle(title)
                guard !key.isEmpty else { continue }
                total += 1
                if titles[key] == nil { keyOrder.append(key) }
                titles[key] = title
                nightSets[key, default: []].insert(i + 1)
                performances[key, default: 0] += 1
            }
        }
        let unsorted: [RunSong] = keyOrder.map { key in
            let numbers: [Int] = (nightSets[key] ?? []).sorted()
            return RunSong(key: key, title: titles[key] ?? key, nightNumbers: numbers)
        }
        let combined: [RunSong] = unsorted.sorted { (a: RunSong, b: RunSong) -> Bool in
            let x = a.nightNumbers[0], y = b.nightNumbers[0]
            if x != y { return x < y }
            return a.title.localizedCompare(b.title) == .orderedAscending
        }
        let repeats = combined.filter { (performances[$0.key] ?? 0) > 1 }
        let unique = performances.count

        var rated: [(index: Int, rating: Int)] = []
        for (i, night) in nights.enumerated() { if let r = night.rating { rated.append((i, r)) } }
        let ratingSum = rated.reduce(0) { $0 + $1.rating }
        let avg: Double? = rated.isEmpty ? nil : Double(ratingSum) / Double(rated.count)
        var best: Int?
        if let top = rated.map(\.rating).max() {
            let tops = rated.filter { $0.rating == top }
            if tops.count == 1 { best = tops[0].index }
        }

        let first = nights[0].date
        let fallback = "\(BandFollows.slug(artist)):\(VenueNames.slug(venueName)):\(first):\(cluster[0].id)"
        return Run(
            key: key(artist: artist, venue: venueName, firstDate: first) ?? fallback,
            artistName: artist, artistSlug: BandFollows.slug(artist), venueName: venueName, city: nights[0].city,
            nights: nights, start: first, end: nights[nights.count - 1].date,
            totalSongs: total, uniqueSongs: unique, hasIncompleteData: incomplete,
            noRepeat: incomplete ? nil : (unique > 0 && repeats.isEmpty),
            repeats: repeats, combinedSetlist: combined, avgRating: avg, bestNightIndex: best)
    }

    /// `pickMostCommon`: the most frequent value; the first seen wins a tie.
    static func mostCommon(_ values: [String]) -> String? {
        var order: [String] = []
        var counts: [String: Int] = [:]
        for v in values {
            if counts[v] == nil { order.append(v) }
            counts[v, default: 0] += 1
        }
        var best: String?
        var bestCount = -1
        for v in order where counts[v, default: 0] > bestCount { best = v; bestCount = counts[v, default: 0] }
        return best
    }
}

/// Tours: one artist's shows with one setlist.fm tour name (`buildTourIndex`).
/// A show with no tour name is in no tour; there is no "No Tour" bucket.
public enum TourIndex {
    public struct Stop: Hashable, Sendable, Identifiable {
        public var showId: String
        public var date: String
        public var venue: String
        public var city: String
        public var country: String
        public var rating: Int?
        public var id: String { showId }
    }

    public struct Tour: Hashable, Sendable, Identifiable {
        public var key: String
        public var artistName: String
        public var artistSlug: String
        public var tourName: String
        public var stops: [Stop]
        public var stopCount: Int { stops.count }
        public var start: String
        public var end: String
        public var uniqueSongs: Int
        public var avgRating: Double?
        public var venuesCount: Int
        public var countriesVisited: Int
        /// Every year the tour touched, ascending.
        public var years: [String]
        public var id: String { key }
    }

    /// `tourKeyFor`: `artistSlug:tourSlug`, or nil.
    public static func key(artist: String, tour: String) -> String? {
        let a = BandFollows.slug(artist), t = VenueNames.slug(tour)
        guard !a.isEmpty, !t.isEmpty else { return nil }
        return "\(a):\(t)"
    }

    /// `buildTourIndex`, keyed by tour key.
    public static func build(_ shows: [Show]) -> [String: Tour] {
        var keyOrder: [String] = []
        var byKey: [String: [(show: Show, order: Int)]] = [:]
        for (i, show) in shows.enumerated() {
            guard !show.artist.isEmpty, let tour = show.tour, !tour.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let key = key(artist: show.artist, tour: tour) else { continue }
            if byKey[key] == nil { keyOrder.append(key) }
            byKey[key, default: []].append((show, i))
        }
        var index: [String: Tour] = [:]
        for key in keyOrder {
            let sorted = (byKey[key] ?? []).sorted { a, b in
                let x = RunIndex.dayNumber(a.show.date), y = RunIndex.dayNumber(b.show.date)
                return x != y ? x < y : a.order < b.order
            }.map(\.show)
            var songKeys = Set<String>()
            for show in sorted {
                for song in show.setlist {
                    let k = StatsKeys.normalizeSongTitle(song.name.trimmingCharacters(in: .whitespacesAndNewlines))
                    if !k.isEmpty { songKeys.insert(k) }
                }
            }
            let ratings = sorted.compactMap(\.rating)
            let venues = Set(sorted.map { VenueNames.slug($0.venue) }.filter { !$0.isEmpty })
            let countries = Set(sorted.map { ($0.country ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty })
            let years = Array(Set(sorted.map { ShowDate.year($0.date) }.filter { !$0.isEmpty })).sorted()
            index[key] = Tour(
                key: key, artistName: sorted[0].artist, artistSlug: BandFollows.slug(sorted[0].artist),
                tourName: RunIndex.mostCommon(sorted.compactMap(\.tour)) ?? "",
                stops: sorted.map { Stop(showId: $0.id, date: $0.date, venue: $0.venue, city: $0.city, country: $0.country ?? "", rating: $0.rating) },
                start: sorted[0].date, end: sorted[sorted.count - 1].date, uniqueSongs: songKeys.count,
                avgRating: ratings.isEmpty ? nil : Double(ratings.reduce(0, +)) / Double(ratings.count),
                venuesCount: venues.count, countriesVisited: countries.count, years: years)
        }
        return index
    }

    /// `newSongsOnTour`: songs you heard for the first time ever at one of
    /// the tour's stops, read off the song index's own first-seen, so a tour
    /// never disagrees with the song's page. Oldest first, then by title.
    public static func newSongs(on tour: Tour, songIndex: [String: SongIndex.Entry]) -> [SongIndex.Entry] {
        let showIds = Set(tour.stops.map(\.showId))
        return songIndex.values
            .filter { $0.artistSlug == tour.artistSlug && showIds.contains($0.firstSeen.showId) }
            .sorted { a, b in
                if ShowDate.areInIncreasingOrder(a.firstSeen.date, b.firstSeen.date) { return true }
                if ShowDate.areInIncreasingOrder(b.firstSeen.date, a.firstSeen.date) { return false }
                return a.title.localizedCompare(b.title) == .orderedAscending
            }
    }
}
