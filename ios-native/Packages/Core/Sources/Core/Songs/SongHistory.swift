import Foundation

/// What the song page says about one song (`components/songs/SongDetailView.jsx`):
/// the gap sentence, by year, where it lands in the set, your best versions.
/// Dates are formatted by the caller (`date`), so the wording is testable.
public enum SongHistory {
    /// `humanizeGapDuration`: "1 year, 2 months", "3 months", "12 days";
    /// nil for no days.
    public static func duration(days: Int?) -> String? {
        guard let days, days > 0 else { return nil }
        let years = Int((Double(days) / 365.25).rounded(.down))
        let remaining = Double(days) - Double(years) * 365.25
        let months = Int((remaining / 30.44).rounded(.down))
        var parts: [String] = []
        if years > 0 { parts.append("\(years) year\(years == 1 ? "" : "s")") }
        if months > 0 { parts.append("\(months) month\(months == 1 ? "" : "s")") }
        if parts.isEmpty { parts.append("\(days) day\(days == 1 ? "" : "s")") }
        return parts.joined(separator: ", ")
    }

    /// "You saw this at your most recent show: Red Rocks, Morrison, Jun 14, 2024."
    /// or "You haven't seen this in 4 shows, 1 year, 2 months since …".
    public static func gapSentence(_ song: SongIndex.Entry, date: (String) -> String) -> String {
        let last = song.lastSeen
        let place = venueLabel(venue: last.venue, city: last.city)
        let when = date(last.date)
        if song.currentGap.shows == 0 {
            return "You saw this at your most recent show\(place.map { ": \($0), \(when)" } ?? " (\(when))")."
        }
        let shows = "\(song.currentGap.shows) show\(song.currentGap.shows == 1 ? "" : "s")"
        let since = place.map { "since \($0), \(when)" } ?? "since \(when)"
        let span = duration(days: song.currentGap.days).map { "\($0) " } ?? ""
        return "You haven't seen this in \(shows): \(span)\(since)."
    }

    /// "Longest gap: 2 shows (1 year, 2 months), Jun 15, 2024 to Aug 29, 2025".
    public static func longestGapLine(_ gap: SongIndex.LongestGap, date: (String) -> String) -> String {
        let span = duration(days: gap.days) ?? "\(gap.days ?? 0) days"
        return "Longest gap: \(gap.shows) show\(gap.shows == 1 ? "" : "s") (\(span)), \(date(gap.fromDate)) to \(date(gap.toDate))"
    }

    /// Performances per year, oldest year first (a reprise counts twice, as on the web).
    public static func byYear(_ performances: [SongIndex.Performance]) -> [(year: String, count: Int)] {
        var counts: [String: Int] = [:]
        for p in performances {
            let year = ShowDate.year(p.date)
            if !year.isEmpty { counts[year, default: 0] += 1 }
        }
        return counts.keys.sorted().map { ($0, counts[$0] ?? 0) }
    }

    /// `positionBreakdown`: "Opened the show once, Closed Set I 2×, Played in
    /// the encore once." Nil when no performance has set data.
    public static func whereItLands(_ performances: [SongIndex.Performance]) -> String? {
        guard performances.contains(where: { $0.setLabel != nil }) else { return nil }
        let phrase = { (n: Int) in n == 1 ? "once" : "\(n)×" }
        let openers = performances.filter(\.isShowOpener).count
        let encores = performances.filter(\.isEncore).count
        var closers: [(label: String, count: Int)] = []
        for p in performances where p.isSetCloser && !p.isEncore {
            guard let label = p.setLabel else { continue }
            if let i = closers.firstIndex(where: { $0.label == label }) { closers[i].count += 1 } else { closers.append((label, 1)) }
        }
        var parts: [String] = []
        if openers > 0 { parts.append("Opened the show \(phrase(openers))") }
        parts += closers.map { "Closed \($0.label) \(phrase($0.count))" }
        if encores > 0 { parts.append("Played in the encore \(phrase(encores))") }
        return parts.isEmpty ? nil : parts.joined(separator: ", ") + "."
    }

    /// Your three best-rated performances, best first; ties keep newest first.
    public static func bestVersions(_ performances: [SongIndex.Performance]) -> [SongIndex.Performance] {
        let rated = performances.enumerated().filter { ($0.element.rating ?? 0) > 0 }
        return rated.sorted { a, b in
            let x = a.element.rating ?? 0, y = b.element.rating ?? 0
            return x != y ? x > y : a.offset < b.offset
        }.prefix(3).map(\.element)
    }

    /// The mean of the ratings you gave its performances, or nil.
    public static func averageRating(_ performances: [SongIndex.Performance]) -> Double? {
        let ratings = performances.compactMap(\.rating).filter { $0 > 0 }
        guard !ratings.isEmpty else { return nil }
        return Double(ratings.reduce(0, +)) / Double(ratings.count)
    }

    /// "Red Rocks, Morrison", "Red Rocks", or nil without a venue.
    public static func venueLabel(venue: String, city: String) -> String? {
        let v = venue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty else { return nil }
        let c = city.trimmingCharacters(in: .whitespacesAndNewlines)
        return c.isEmpty ? v : "\(v), \(c)"
    }
}

/// Every song you've seen, for the song list: one row per song page.
public enum SongList {
    public enum Sort: String, CaseIterable, Identifiable, Sendable {
        case timesSeen, rating, gap, title
        public var id: String { rawValue }
        public var label: String {
            switch self {
            case .timesSeen: "Times seen"
            case .rating: "Average rating"
            case .gap: "Longest since seen"
            case .title: "Name"
            }
        }
    }

    public struct Row: Identifiable, Hashable, Sendable {
        public var key: String
        public var title: String
        public var artistName: String
        public var artistSlug: String
        public var timesSeen: Int
        public var averageRating: Double?
        public var currentGap: Int
        public var id: String { key }
        /// `/songs/?artist=&song=` (the song page).
        public var songSlug: String { SongIndex.songSlug(title) }
    }

    public static func rows(_ index: [String: SongIndex.Entry]) -> [Row] {
        index.values.map {
            Row(key: $0.key, title: $0.title, artistName: $0.artistName, artistSlug: $0.artistSlug,
                timesSeen: $0.timesSeen, averageRating: SongHistory.averageRating($0.performances),
                currentGap: $0.currentGap.shows)
        }
    }

    /// Sorted, then by name and band so the order never jumps.
    public static func sorted(_ rows: [Row], by sort: Sort) -> [Row] {
        rows.sorted { a, b in
            switch sort {
            case .timesSeen where a.timesSeen != b.timesSeen: return a.timesSeen > b.timesSeen
            case .rating where a.averageRating != b.averageRating:
                // Unrated last.
                return (a.averageRating ?? -1) > (b.averageRating ?? -1)
            case .gap where a.currentGap != b.currentGap: return a.currentGap > b.currentGap
            default: break
            }
            let byTitle = a.title.localizedStandardCompare(b.title)
            if byTitle != .orderedSame { return byTitle == .orderedAscending }
            return a.artistName.localizedStandardCompare(b.artistName) == .orderedAscending
        }
    }

    /// Rows whose song or band contains the text (case and accents ignored).
    public static func filtered(_ rows: [Row], query: String) -> [Row] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return rows }
        return rows.filter { $0.title.localizedStandardContains(q) || $0.artistName.localizedStandardContains(q) }
    }
}
