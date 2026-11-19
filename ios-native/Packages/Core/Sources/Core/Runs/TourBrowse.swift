import Foundation

// "Add shows from a tour" (Stage 4, 4-12): lib/tourBrowse.js, the pure half
// of the web's TourBrowseModal. Tour-name matching, the free-text
// "Goose Summer Tour 2025" parse, and which nights are already yours. The
// network half is `TourLookups` (get-artist-tours, get-tour-shows).

public enum TourBrowse {
    /// How many leading words of a free-text query are tried as a band name
    /// (`MAX_ARTIST_TOKENS`): each try is one setlist.fm artist search.
    public static let maxArtistTokens = 3
    /// Picking more nights than this at once gets a word of warning.
    public static let bulkWarnThreshold = 20
    /// A tour this long is listed by month.
    public static let groupByMonthThreshold = 12

    /// `normalizeTourName`: case, spacing and surrounding punctuation only;
    /// the year stays ("Summer Tour 2024" isn't "Summer Tour 2025").
    public static func normalizeTourName(_ name: String?) -> String {
        guard var s = name?.lowercased(), !s.isEmpty else { return "" }
        s = s.replacingOccurrences(of: "[‘’“”]", with: "'", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: "^[^a-z0-9]+|[^a-z0-9]+$", with: "", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespaces)
    }

    public static func tourNamesMatch(_ a: String?, _ b: String?) -> Bool {
        let x = normalizeTourName(a)
        return !x.isEmpty && x == normalizeTourName(b)
    }

    /// `tourOptionLabel`: the name, with its year when another tour in the
    /// list has the same name.
    public static func optionLabel(_ tour: ArtistTours.Tour, in all: [ArtistTours.Tour]) -> String {
        guard all.filter({ tourNamesMatch($0.name, tour.name) }).count > 1 else { return tour.name }
        let year = ShowDate.year(tour.startDate)
        return year.isEmpty ? tour.name : "\(tour.name) (\(year))"
    }

    /// One way to split a free-text query: the band, then the tour.
    public struct Split: Hashable, Sendable {
        public var artistQuery: String
        public var tourQuery: String
    }

    /// `splitCandidates`: "Goose Summer Tour 2025" → ("Goose", "Summer
    /// Tour 2025") and the longer band names first, up to three words. A
    /// single word is a band name only: no splits.
    public static func splitCandidates(_ input: String) -> [Split] {
        let tokens = input.split(whereSeparator: \.isWhitespace).map(String.init)
        guard tokens.count >= 2 else { return [] }
        let maxLead = min(maxArtistTokens, tokens.count - 1)
        return stride(from: maxLead, through: 1, by: -1).map { lead in
            Split(artistQuery: tokens[..<lead].joined(separator: " "), tourQuery: tokens[lead...].joined(separator: " "))
        }
    }

    /// `exactArtistMatches`: the results named exactly this (any case).
    /// A relevance match ("Goose Creek Symphony") never skips a step.
    public static func exactMatches(_ artists: [SetlistfmSearch.Artist], _ query: String) -> [SetlistfmSearch.Artist] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return artists.filter { $0.name.trimmingCharacters(in: .whitespaces).lowercased() == q }
    }

    /// `resolveTourQuery`: the one tour the text names (exactly, else the one
    /// tour that starts with it), or nil when that isn't one tour.
    public static func resolveTourQuery(_ query: String, in tours: [ArtistTours.Tour]) -> ArtistTours.Tour? {
        let q = normalizeTourName(query)
        guard !q.isEmpty else { return nil }
        let browsable = tours.filter(\.isBrowsable)
        let exact = browsable.filter { normalizeTourName($0.name) == q }
        if exact.count == 1 { return exact[0] }
        if exact.count > 1 { return nil }
        let prefixed = browsable.filter { normalizeTourName($0.name).hasPrefix(q) }
        return prefixed.count == 1 ? prefixed[0] : nil
    }

    /// Whether a night is already in your shows (`existingShowStatus`, the
    /// one duplicate rule, `classifyDuplicate`).
    public enum Status: Sendable, Equatable {
        /// Not in your shows.
        case new
        /// Same band and day at a venue spelled differently or blank: maybe
        /// the same night. It can still be picked; the row says so.
        case possible
        /// The same setlist.fm setlist, or the same band, day and venue.
        case added
    }

    public static func status(_ night: TourShows.Night, in shows: [Show]) -> Status {
        if let id = night.setlistfmId, !id.isEmpty, shows.contains(where: { $0.setlistfmId == id }) { return .added }
        let day = night.date
        let artist = night.artist.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !day.isEmpty, !artist.isEmpty else { return .new }
        let sameNight = shows.filter {
            $0.artist.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == artist && $0.isoDate == day
        }
        guard !sameNight.isEmpty else { return .new }
        let venue = VenueNames.normalize(night.venue)
        if !venue.isEmpty, sameNight.contains(where: { VenueNames.normalize($0.venue) == venue }) { return .added }
        return .possible
    }

    /// The nights matching a venue or place filter.
    public static func filter(_ nights: [TourShows.Night], _ query: String) -> [TourShows.Night] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return nights }
        return nights.filter { $0.venue.lowercased().contains(q) || $0.city.lowercased().contains(q) }
    }

    /// A month of nights ("June 2025").
    public struct MonthGroup: Hashable, Sendable, Identifiable {
        public var label: String?
        public var nights: [TourShows.Night]
        public var id: String { label ?? "all" }
    }

    /// One list for a short tour; by month, in the order given, for a long one.
    public static func grouped(_ nights: [TourShows.Night], locale: Locale = Locale(identifier: "en_US")) -> [MonthGroup] {
        guard nights.count >= groupByMonthThreshold else { return [MonthGroup(label: nil, nights: nights)] }
        var order: [String] = []
        var byMonth: [String: [TourShows.Night]] = [:]
        for night in nights {
            let label = monthLabel(night.date, locale: locale)
            if byMonth[label] == nil { order.append(label) }
            byMonth[label, default: []].append(night)
        }
        return order.map { MonthGroup(label: $0, nights: byMonth[$0] ?? []) }
    }

    static func monthLabel(_ day: String, locale: Locale) -> String {
        let parts = day.split(separator: "-")
        guard parts.count >= 2, let y = Int(parts[0]), let m = Int(parts[1]), (1...12).contains(m) else { return "Unknown date" }
        var c = DateComponents()
        c.year = y; c.month = m; c.day = 1
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard let date = calendar.date(from: c) else { return "Unknown date" }
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = calendar.timeZone
        f.setLocalizedDateFormatFromTemplate("MMMMyyyy")
        return f.string(from: date)
    }

    /// What adding the picked nights came to, in words.
    public static func resultLine(added: Int, waiting: Int, skipped: Int, failed: Int) -> String? {
        var parts: [String] = []
        if added > 0 { parts.append("Added \(added) show\(added == 1 ? "" : "s")") }
        if waiting > 0 { parts.append("\(waiting) saved on this iPhone, added when you're online") }
        if skipped > 0 { parts.append("\(skipped) already in your shows") }
        if failed > 0 { parts.append("\(failed) couldn't be added") }
        return parts.isEmpty ? nil : parts.joined(separator: ". ") + "."
    }
}
