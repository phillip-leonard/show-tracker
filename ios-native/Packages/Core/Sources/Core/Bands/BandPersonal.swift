import Foundation

/// Your side of a band (`lib/bandScreens.js` `buildBandPersonal`): your
/// shows of it, the songs you've heard and how often, "you were there" by
/// date. Built with the same song index as your song pages (`SongIndex`),
/// over just this band's shows, so "heard 7×" agrees everywhere.
public struct BandPersonal: Sendable {
    /// Your shows of the band, newest first.
    public let shows: [Show]
    /// Your song entries, most heard first, then by title.
    public let songs: [SongIndex.Entry]
    /// The band as you log it, for links to your own song pages.
    public let artistName: String
    private let byTitle: [String: SongIndex.Entry]
    private let showByDay: [String: Show]
    private let aliases: [String: (key: String, name: String)]

    /// - Parameters:
    ///   - name: the band's name ("Goose"); every show is counted under it.
    ///   - key: which shows are the band's (`StatsKeys.bandKey`, the web's
    ///     `artistNameKeyLoose`: "Goose (US)" is Goose).
    public init(shows all: [Show], name: String, key: String, today: String = ShowDate.today()) {
        let aliases = SongTitleAliases.forBand(name)
        self.aliases = aliases
        let mine = all.enumerated()
            .filter { !key.isEmpty && StatsKeys.bandKey($0.element.artist) == key }
            .sorted { a, b in
                let x = a.element.date, y = b.element.date
                if ShowDate.areInIncreasingOrder(y, x) { return true }
                if ShowDate.areInIncreasingOrder(x, y) { return false }
                return a.offset < b.offset
            }
            .map(\.element)
        shows = mine
        artistName = mine.first?.artist ?? name

        // One timeline under one name, so "Goose" and "Goose (US)" count as
        // one band; aliased titles under the band archive's spelling.
        let renamed = mine.map { show -> Show in
            var s = show
            s.artist = name
            s.setlist = show.setlist.map { song in
                var copy = song
                if let alias = aliases[StatsKeys.normalizeSongTitle(song.name)] { copy.name = alias.name }
                return copy
            }
            return s
        }
        let index = SongIndex.build(renamed, today: today)
        var byTitle: [String: SongIndex.Entry] = [:]
        for entry in index.values {
            if let colon = entry.key.firstIndex(of: ":") { byTitle[String(entry.key[entry.key.index(after: colon)...])] = entry }
        }
        self.byTitle = byTitle
        songs = index.values.sorted { a, b in
            a.timesSeen != b.timesSeen ? a.timesSeen > b.timesSeen : a.title.localizedCompare(b.title) == .orderedAscending
        }
        var showByDay: [String: Show] = [:]
        for show in mine {
            let day = show.isoDate
            if !day.isEmpty, showByDay[day] == nil { showByDay[day] = show }
        }
        self.showByDay = showByDay
    }

    /// Your entry for a song title the band's archive uses, or nil.
    public func song(titled title: String) -> SongIndex.Entry? {
        byTitle[Self.titleKey(title, aliases: aliases)]
    }

    /// Your show on that night (`YYYY-MM-DD`, or any stored form), for "You were there".
    public func show(on date: String?) -> Show? {
        let day = ShowDate.isoDay(date)
        return day.isEmpty ? nil : showByDay[day]
    }

    /// The normalized title, through the band's aliases (`titleKeyWith`).
    static func titleKey(_ title: String, aliases: [String: (key: String, name: String)]) -> String {
        let key = StatsKeys.normalizeSongTitle(title)
        return aliases[key]?.key ?? key
    }
}

/// Title → the band's song slug, for a band with song pages
/// (`songSlugIndex`, `songSlugFor`): which song page a title opens.
public struct BandSongSlugs: Sendable {
    private let slugs: [String: String]
    private let aliases: [String: (key: String, name: String)]

    public init(_ snapshot: BandSnapshot, band: PublicBand) {
        aliases = SongTitleAliases.forBand(band.name)
        var map: [String: String] = [:]
        if snapshot.artist.songPages {
            for song in snapshot.songs {
                guard let slug = song.slug else { continue }
                let key = BandPersonal.titleKey(song.name, aliases: aliases)
                if !key.isEmpty, map[key] == nil { map[key] = slug }
            }
        }
        slugs = map
    }

    public func slug(for title: String) -> String? {
        slugs[BandPersonal.titleKey(title, aliases: aliases)]
    }

    public var isEmpty: Bool { slugs.isEmpty }
}
