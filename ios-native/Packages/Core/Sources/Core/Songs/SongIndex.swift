import Foundation

/// Your history with each song, built from your own shows: the Swift copy
/// of `lib/songIndex.js` `buildSongIndex`, checked against
/// `fixtures/song-index/` (`SongIndexTests`).
///
/// A song is the strict artist slug plus the normalized title
/// (`goose:arcadia`), so two spellings of one song share a page and the
/// same title by two bands doesn't (Stage 4 call C: "goose (US)" is its own
/// band here, unlike Stats' `bandKey`). Gaps count this person's own shows
/// of that band, oldest first; they are not the band's tour gaps.
public enum SongIndex {
    /// One time a song was played at one of your shows.
    public struct Performance: Hashable, Sendable {
        public var showId: String
        public var date: String
        public var venue: String
        public var city: String
        /// The set it was in, when the show's setlist has any set data.
        public var setLabel: String?
        /// Its place in that set, from 1.
        public var position: Int?
        public var isShowOpener: Bool
        public var isSetCloser: Bool
        public var isEncore: Bool
        /// The song before it ran into it.
        public var segueIn: Bool
        /// It ran into the next song.
        public var segueOut: Bool
        public var rating: Int?
        public var manuallyAdded: Bool
    }

    /// Where and when, for first and last seen.
    public struct Sighting: Hashable, Sendable {
        public var date: String
        public var venue: String
        public var city: String
        public var showId: String
    }

    /// Shows of the band since you last saw the song, and days since then.
    public struct Gap: Hashable, Sendable {
        public var shows: Int
        /// `nil` when a date can't be read.
        public var days: Int?
    }

    /// The most shows of the band between two times you saw the song.
    public struct LongestGap: Hashable, Sendable {
        public var shows: Int
        public var days: Int?
        public var fromDate: String
        public var toDate: String
    }

    public struct Entry: Identifiable, Hashable, Sendable {
        /// `artistSlug:normalized title`.
        public var key: String
        public var artistSlug: String
        /// The spelling you used most.
        public var artistName: String
        public var title: String
        /// Newest first. A song played twice in one show is two performances.
        public var performances: [Performance]
        /// Distinct shows.
        public var timesSeen: Int
        public var firstSeen: Sighting
        public var lastSeen: Sighting
        public var currentGap: Gap
        /// `nil` when you've seen it at one show only.
        public var longestGap: LongestGap?

        public var id: String { key }
    }

    // MARK: Keys

    /// `artistSlugFromName`: one definition with the band alerts (`BandFollows.slug`).
    public static func artistSlug(_ name: String?) -> String { BandFollows.slug(name) }

    /// `songSlugFromTitle`: the `song=` in a `/songs/?artist=&song=` link.
    public static func songSlug(_ title: String) -> String {
        StatsKeys.normalizeSongTitle(title).replacingOccurrences(of: " ", with: "-")
    }

    /// `songKeyFor`: nil without a band or a title.
    public static func key(artist: String?, title: String?) -> String? {
        let slug = artistSlug(artist)
        let normalized = StatsKeys.normalizeSongTitle(title ?? "")
        guard !slug.isEmpty, !normalized.isEmpty else { return nil }
        return "\(slug):\(normalized)"
    }

    /// `songKeyFromParams`: the key a `/songs/?artist=&song=` link names.
    public static func key(artistSlug: String?, songSlug: String?) -> String? {
        guard let artistSlug, !artistSlug.isEmpty, let songSlug, !songSlug.isEmpty else { return nil }
        return "\(artistSlug):\(songSlug.replacingOccurrences(of: "-", with: " "))"
    }

    // MARK: Building

    /// `buildSongIndex(shows, { today })`, keyed by song key.
    public static func build(_ shows: [Show], today: String = ShowDate.today()) -> [String: Entry] {
        // Pass 1: each band's shows, oldest first, so every show has a place
        // in its band's timeline. An unreadable date sorts as 1970-01-01, as
        // `parseDate` reads it; ties keep the order the shows came in.
        var bandShows: [String: [(id: String, day: String, order: Int)]] = [:]
        for (order, show) in shows.enumerated() where !show.artist.isEmpty {
            let slug = artistSlug(show.artist)
            guard !slug.isEmpty else { continue }
            let day = show.isoDate.isEmpty ? "1970-01-01" : show.isoDate
            bandShows[slug, default: []].append((show.id, day, order))
        }
        var placeInBand: [String: [String: Int]] = [:]
        var bandShowCount: [String: Int] = [:]
        for (slug, list) in bandShows {
            let sorted = list.sorted { $0.day != $1.day ? $0.day < $1.day : $0.order < $1.order }
            var places: [String: Int] = [:]
            for (i, s) in sorted.enumerated() { places[s.id] = i }
            placeInBand[slug] = places
            bandShowCount[slug] = sorted.count
        }

        // Pass 2: every setlist once, by song key.
        var performances: [String: [(perf: Performance, place: Int, order: Int)]] = [:]
        var bandOfKey: [String: String] = [:]
        var keyOrder: [String] = []
        var titleSpellings: [String: Spellings] = [:]
        var artistSpellings: [String: Spellings] = [:]
        var order = 0

        for show in shows {
            let setlist = show.setlist
            guard !show.artist.isEmpty, !setlist.isEmpty else { continue }
            let slug = artistSlug(show.artist)
            guard !slug.isEmpty else { continue }
            artistSpellings[slug, default: Spellings()].add(show.artist.trimmingCharacters(in: .whitespacesAndNewlines))

            // Set structure only when some song carries it: otherwise every
            // song would read as "Set I", which here would claim set data
            // the show doesn't have.
            var setInfo: [String: (label: String, position: Int, closer: Bool, encore: Bool)] = [:]
            if setlist.contains(where: { $0.set != nil || $0.setBreak != nil }) {
                for group in SetGroups.group(setlist) {
                    let encore = group.label.hasPrefix("Encore")
                    for (i, song) in group.songs.enumerated() {
                        setInfo[song.id] = (group.label, i + 1, i == group.songs.count - 1, encore)
                    }
                }
            }
            let place = placeInBand[slug]?[show.id] ?? 0

            for (i, song) in setlist.enumerated() {
                let title = song.name.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let key = key(artist: show.artist, title: title) else { continue }
                titleSpellings[key, default: Spellings()].add(title)
                if bandOfKey[key] == nil { bandOfKey[key] = slug; keyOrder.append(key) }
                let info = setInfo[song.id]
                let perf = Performance(
                    showId: show.id, date: show.date, venue: show.venue, city: show.city,
                    setLabel: info?.label, position: info?.position,
                    isShowOpener: i == 0, isSetCloser: info?.closer ?? false, isEncore: info?.encore ?? false,
                    // `tape` on a song means it ran into the next one.
                    segueIn: i > 0 && setlist[i - 1].tape == true, segueOut: song.tape == true,
                    rating: song.rating, manuallyAdded: song.manuallyAdded == true)
                performances[key, default: []].append((perf, place, order))
                order += 1
            }
        }

        // Pass 3: gaps and names.
        var index: [String: Entry] = [:]
        for key in keyOrder {
            guard let slug = bandOfKey[key], let list = performances[key] else { continue }
            let chrono = list.sorted { $0.place != $1.place ? $0.place < $1.place : $0.order < $1.order }
            let total = bandShowCount[slug] ?? chrono.count
            // A reprise is two performances but one show seen.
            var seen: [(perf: Performance, place: Int)] = []
            for (i, p) in chrono.enumerated() where i == 0 || p.perf.showId != chrono[i - 1].perf.showId {
                seen.append((p.perf, p.place))
            }
            guard let first = seen.first, let last = seen.last else { continue }

            var longest: LongestGap?
            for i in 0..<max(0, seen.count - 1) {
                let a = seen[i], b = seen[i + 1]
                let shows = b.place - a.place - 1
                if longest == nil || shows > longest!.shows {
                    longest = LongestGap(shows: shows, days: ShowDate.daysBetween(a.perf.date, b.perf.date),
                                         fromDate: a.perf.date, toDate: b.perf.date)
                }
            }

            index[key] = Entry(
                key: key, artistSlug: slug,
                artistName: artistSpellings[slug]?.mostCommon ?? "",
                title: titleSpellings[key]?.mostCommon ?? "",
                performances: chrono.sorted { $0.place != $1.place ? $0.place > $1.place : $0.order < $1.order }.map(\.perf),
                timesSeen: seen.count,
                firstSeen: sighting(first.perf), lastSeen: sighting(last.perf),
                currentGap: Gap(shows: (total - 1) - last.place, days: ShowDate.daysBetween(last.perf.date, today)),
                longestGap: longest)
        }
        return index
    }

    private static func sighting(_ p: Performance) -> Sighting {
        Sighting(date: p.date, venue: p.venue, city: p.city, showId: p.showId)
    }

    /// `pickMostCommon`: the most-used spelling; the first one seen wins a tie.
    struct Spellings {
        private var counts: [String: Int] = [:]
        private var order: [String] = []

        mutating func add(_ value: String) {
            guard !value.isEmpty else { return }
            if counts[value] == nil { order.append(value) }
            counts[value, default: 0] += 1
        }

        var mostCommon: String? {
            var best: String?
            var bestCount = -1
            for value in order where counts[value, default: 0] > bestCount {
                best = value
                bestCount = counts[value, default: 0]
            }
            return best
        }
    }
}
