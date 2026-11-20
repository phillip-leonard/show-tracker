import Foundation

// The show extras (Stage 6, 6-8): "Relive this night", the upcoming
// anniversaries list, and the Internet Archive backfill. The two date rules
// are lib/reliveThisNight.js and lib/anniversaries.js, kept the same by
// fixtures/anniversaries/cases.json (AnniversaryTests on this side,
// lib/__tests__/anniversaryFixtures.test.js on the web's).

/// The upcoming anniversaries list (AnniversaryCalendar.jsx).
public enum Anniversaries {
    public struct Entry: Identifiable, Hashable, Sendable {
        public let show: Show
        /// The next ISO day with the show's month and day, today included.
        public let occurrence: String
        public let yearsAgo: Int
        public var id: String { show.id }
    }

    /// The next day with this date's month and day, on or after `today`:
    /// this year if it hasn't passed, else next year.
    public static func nextOccurrence(_ date: String?, today: String) -> String? {
        let iso = ShowDate.isoDay(date)
        guard !iso.isEmpty, let year = Int(today.prefix(4)) else { return nil }
        let monthDay = String(iso.dropFirst(5))
        let thisYear = "\(year)-\(monthDay)"
        return thisYear >= today ? thisYear : "\(year + 1)-\(monthDay)"
    }

    /// One entry per show that has had an anniversary already, soonest
    /// first (shows on the same day keep their order). Unreadable dates are
    /// left out.
    public static func upcoming(_ shows: [Show], today: String = ShowDate.today()) -> [Entry] {
        shows.enumerated().compactMap { index, show -> (Int, Entry)? in
            let iso = ShowDate.isoDay(show.date)
            guard !iso.isEmpty, let occurrence = nextOccurrence(iso, today: today),
                  let occurrenceYear = Int(occurrence.prefix(4)), let showYear = Int(iso.prefix(4)) else { return nil }
            let years = occurrenceYear - showYear
            return years > 0 ? (index, Entry(show: show, occurrence: occurrence, yearsAgo: years)) : nil
        }
        .sorted { ($0.1.occurrence, $0.0) < ($1.1.occurrence, $1.0) }
        .map(\.1)
    }
}

/// "Relive this night's magic" (ReliveThisNightCard.jsx): the show from
/// today's month and day in an earlier year, at the top of the shows list,
/// offered once a day per person on this device.
public enum ReliveThisNight {
    /// The newest show on today's month and day from an earlier year. A
    /// Feb 29 show matches only on Feb 29.
    public static func pick(_ shows: [Show], today: String = ShowDate.today()) -> Show? {
        let year = String(today.prefix(4))
        let monthDay = String(today.dropFirst(5))
        var best: Show?
        var bestDate = ""
        for show in shows {
            let iso = ShowDate.isoDay(show.date)
            guard !iso.isEmpty, String(iso.dropFirst(5)) == monthDay, String(iso.prefix(4)) < year else { continue }
            if iso > bestDate { best = show; bestDate = iso }
        }
        return best
    }

    public static func yearsAgo(_ show: Show, today: String = ShowDate.today()) -> Int {
        (Int(today.prefix(4)) ?? 0) - (Int(ShowDate.year(show.date)) ?? 0)
    }

    // Once a day: the day the card was last offered, per person, on this
    // device. Within one run of the app the decision is kept, so opening
    // the show and coming back still finds the card, until it's dismissed.
    @MainActor private static var session: (uid: String, date: String, showId: String?, dismissed: Bool)?

    static func seenKey(_ uid: String) -> String { "reliveThisNight.\(uid)" }

    /// The show to offer now, or nil. Call once the person's shows have
    /// loaded: the first call of the day settles it.
    @MainActor
    public static func show(for uid: String, shows: [Show], today: String = ShowDate.today(), defaults: UserDefaults = .standard) -> Show? {
        if session == nil || session?.uid != uid || session?.date != today {
            var showId: String?
            if defaults.string(forKey: seenKey(uid)) != today, let show = pick(shows, today: today) {
                showId = show.id
                defaults.set(today, forKey: seenKey(uid))
            }
            session = (uid, today, showId, false)
        }
        guard let session, !session.dismissed, let id = session.showId else { return nil }
        // Deleted since: nothing to offer.
        return shows.first { $0.id == id }
    }

    @MainActor public static func dismiss() { session?.dismissed = true }

    /// Tests only.
    @MainActor static func reset() { session = nil }
}

/// The Internet Archive backfill (ArchiveBackfillCard.jsx): shows by the
/// Archive's bands that have no setlist, looked up one at a time with
/// `propose-setlist` and saved only after review, only while still empty
/// (`accept-proposal` `onlyIfEmpty`).
public enum ArchiveBackfill {
    /// The Archive's bands from the bundled config/internet-archive.json:
    /// a loose name (letters and digits) and the MusicBrainz ids. Only a
    /// shortlist: `setlist-source` decides, so this never needs the web's
    /// full registry rules.
    public struct Bands: Sendable {
        let names: Set<String>
        let mbids: Set<String>

        public init(names: Set<String>, mbids: Set<String>) {
            self.names = names
            self.mbids = mbids
        }

        public func mayBeArchive(_ show: Show) -> Bool {
            if let mbid = show.artistMbid, mbids.contains(mbid) { return true }
            return names.contains(Self.loose(show.artist))
        }

        static func loose(_ name: String) -> String {
            var s = name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
            if s.hasPrefix("the ") { s.removeFirst(4) }
            return s.replacingOccurrences(of: "&", with: "and").filter { $0.isLetter || $0.isNumber }
        }

        struct ConfigFile: Decodable {
            struct Artist: Decodable { let name: String; let aliases: [String]?; let mbids: [String]? }
            let enabled: Bool?
            let artists: [Artist]?
        }

        public static func load() -> Bands { load(bundle: .module) }

        static func load(bundle: Bundle) -> Bands {
            guard let url = bundle.url(forResource: "internet-archive", withExtension: "json", subdirectory: "Config"),
                  let data = try? Data(contentsOf: url),
                  let file = try? JSONDecoder().decode(ConfigFile.self, from: data), file.enabled == true else {
                return Bands(names: [], mbids: [])
            }
            let artists = file.artists ?? []
            return Bands(names: Set(artists.flatMap { [$0.name] + ($0.aliases ?? []) }.map(loose)),
                         mbids: Set(artists.flatMap { $0.mbids ?? [] }))
        }
    }

    /// Shows with no setlist whose band may be the Archive's, not already
    /// looked up on this device.
    public static func shortlist(_ shows: [Show], bands: Bands, checked: Set<String>) -> [Show] {
        shows.filter { $0.setlist.isEmpty && !checked.contains($0.id) && bands.mayBeArchive($0) }
    }

    /// "3 Keller Williams shows with no setlist. The Internet Archive may have them."
    public static func summary(_ shows: [Show]) -> String {
        let n = shows.count
        let bands = Set(shows.map(\.artist))
        let who = bands.count == 1 ? "\(bands.first!) " : ""
        return "\(n) \(who)show\(n == 1 ? "" : "s") with no setlist. The Internet Archive may have \(n == 1 ? "it" : "them")."
    }

    // Shows looked up and not saved (nothing found, skipped, already the
    // same, a setlist since), remembered per person on this device so the
    // card doesn't keep offering them. Losing it only offers them again.
    static func checkedKey(_ uid: String) -> String { "archiveBackfillChecked.\(uid)" }

    public static func checked(uid: String, defaults: UserDefaults = .standard) -> Set<String> {
        Set(defaults.stringArray(forKey: checkedKey(uid)) ?? [])
    }

    public static func remember(_ showId: String, uid: String, defaults: UserDefaults = .standard) {
        var set = checked(uid: uid, defaults: defaults)
        set.insert(showId)
        defaults.set(Array(set).sorted(), forKey: checkedKey(uid))
    }

    /// One show's place in the review (ArchiveSetlistReview.jsx).
    public enum Status: Sendable {
        case queued
        case loading
        case found(SetlistOpAnswer)
        case notFound(noSongs: Bool)
        case unchanged
        case saving(SetlistOpAnswer)
        case saved
        case skipped
        case hasSetlist
        case error(String)

        /// What happened, including when nothing did.
        public var message: String {
            switch self {
            case .loading: "Looking on the Internet Archive…"
            case .queued: "Waiting…"
            case .saved: "Saved."
            case .skipped: "Skipped. Nothing was changed."
            case .notFound(let noSongs):
                noSongs ? "The Internet Archive has recordings of this show, but none of them lists a setlist."
                    : "No setlist for this date on the Internet Archive."
            case .unchanged: "Already matches the Internet Archive. Nothing to change."
            case .hasSetlist: "This show has a setlist now, so it was left as it is."
            case .error(let detail):
                "Couldn't reach the Internet Archive\(detail.isEmpty ? "" : " (\(detail))"). Nothing was changed. Try again later."
            case .found, .saving: ""
            }
        }

        /// A lookup that won't be saved: remembered so it isn't offered again.
        public var isSettledWithoutSaving: Bool {
            switch self {
            case .notFound, .skipped, .unchanged, .hasSetlist: true
            default: false
            }
        }

        /// `propose-setlist`'s answer as a status (statusFromProposal).
        public static func from(proposal answer: SetlistOpAnswer) -> Status {
            if answer.ok { return .found(answer) }
            switch answer.reason {
            case "no-show", "ambiguous-date": return .notFound(noSongs: false)
            case "no-songs": return .notFound(noSongs: true)
            case "nothing-to-change": return .unchanged
            default: return .error(answer.detail ?? answer.message ?? "")
            }
        }

        /// `accept-proposal`'s answer, `onlyIfEmpty`.
        public static func from(save answer: SetlistOpAnswer) -> Status {
            if answer.ok { return .saved }
            switch answer.reason {
            case "has-setlist": return .hasSetlist
            case "nothing-to-change": return .unchanged
            default: return .error(answer.detail ?? answer.message ?? "")
            }
        }
    }
}
