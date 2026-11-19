import Foundation

/// The app's tabs (DECISIONS.md, "Navigation"): Shows · Friends · Stats · Me,
/// plus the system Search tab. `library` items are tabs only in a wide iPad
/// window's sidebar (Stage 4, F-1); the tab bar never shows them.
public enum AppTab: Hashable, Sendable {
    case shows, friends, stats, me, search
    case library(LibraryDestination)
}

/// A screen pushed on a tab's stack. Each is a placeholder until its
/// feature is built (DECISIONS.md, "Build order").
public enum AppRoute: Hashable, Sendable {
    case show(id: String)
    case upcomingShow(id: String)
    case band(slug: String)
    /// Your history with one song: `/songs/?artist=<slug>&song=<slug>`
    /// (Stage 4, 4-4). `artist` is the strict artist slug (`SongIndex`).
    case song(artist: String?, song: String)
    /// The band's own song page from its public snapshot:
    /// `/bands/?band=&song=` (Stage 4, 4-5; the web until then).
    case bandSong(band: String, song: String)
    /// Every song you've seen (Stage 4, 4-4): `/stats/songs`.
    case songs
    /// Your runs and one run (Stage 4, 4-6): `/stats/runs`, `/runs/?run=`.
    case runs
    case run(key: String)
    /// Your tours and one tour (Stage 4, 4-6): `/tours`, `/tours/?tour=`.
    case tours
    case tour(key: String)
    /// One of the period's full lists on Stats (Stage 4, 4-8): every band
    /// (`/stats/top-artists`), venue (`/stats/top-venues`) or song, or the
    /// top-rated shows, for a year or (nil) all time.
    case statsList(StatsLists.Kind, year: String?)
    /// Your song wishlists (Stage 4, 4-9): `/wishlist`, and one band's.
    /// The web has no link for a band's own wishlist.
    case wishlist
    case wishlistArtist(WishlistArtist)
    /// Your bucket list, shows and venues (Stage 4, 4-10): `/bucket-list`.
    case bucketList
    /// The community boards (Stage 4, 4-11): `/community`, on Stats.
    case community
    /// Your festivals and one festival (Stage 5, 5-3): `/festivals`,
    /// `/festivals/?festival=<attendance id>`, in Me's Library.
    case festivals
    case festival(id: String)
    /// Setlist photos from every concert (Stage 6, 6-4): `/setlist-photos`,
    /// in Me's Library.
    case setlistPhotos
    /// Advanced search over your shows (Stage 4, 4-12): `/advanced-search`,
    /// on the Search tab.
    case advancedSearch
    case venue(key: String)
    case yearInReview(user: String, year: String)
    /// Your shows for one band, song or venue, from Stats (Stage 2). Not a
    /// link target: nothing on the web opens it.
    case myShows(ShowsFilter)
    /// The inbox (Stage 3, Part 4), on the Friends tab: `/notifications`,
    /// and the link band-alert pushes carry.
    case notifications
}

/// What opening a link does (FOUNDATION-AUDIT.md §1.4).
public enum DeepLinkAction: Equatable, Sendable {
    /// Switch to a tab and, if given, show that screen on top of its root.
    case open(AppTab, AppRoute?)
    /// A claimed path without a native screen: the same page in
    /// SFSafariViewController, so no link dead-ends. Also our own pages the
    /// app doesn't claim (`/reset/*` stays on the web).
    case web(URL)
}

public extension DeepLink {
    struct Resolved: Equatable, Sendable {
        public let action: DeepLinkAction
        /// A `?ref=` (D-6): kept for `friends.js` `referral` after sign-in.
        public let referral: String?
    }

    static let webOrigin = URL(string: "https://mysetlists.net")!

    /// What the app does for a link, or nil to ignore it (not ours, or
    /// handled elsewhere, like Spotify's callback).
    static func resolve(_ url: URL) -> Resolved? {
        guard let href = target(url) else {
            // One of our web pages the app doesn't claim: show it, don't drop it.
            if url.scheme?.lowercased() == "https", webHosts.contains(url.host?.lowercased() ?? "") {
                return Resolved(action: .web(url), referral: nil)
            }
            return nil
        }
        let parts = href.split(separator: "?", maxSplits: 1)
        let path = normalize(String(parts[0]))
        var params = SearchParams(parts.count > 1 ? String(parts[1]) : nil)
        let referral = params.get("ref").flatMap { $0.isEmpty ? nil : $0 }
        params.remove("ref")
        return Resolved(action: action(path: path, params: params), referral: referral)
    }

    internal static func action(path: String, params: SearchParams) -> DeepLinkAction {
        let value = { (key: String) in params.get(key).flatMap { $0.isEmpty ? nil : $0 } }
        switch path {
        case "/":
            return .open(.shows, nil)
        case "/shows":
            if let id = value("show") { return .open(.shows, .show(id: id)) }
            if let id = value("upcoming") { return .open(.shows, .upcomingShow(id: id)) }
            if value("venueKey") == nil { return .open(.shows, nil) } // ?venueKey= is web-only for now
        case "/bands":
            if let band = value("band") {
                if let song = value("song") { return .open(.shows, .bandSong(band: band, song: song)) }
                return .open(.shows, .band(slug: band))
            }
        case "/songs":
            if let song = value("song") { return .open(.stats, .song(artist: value("artist"), song: song)) }
        case "/venues":
            if let key = value("venue") { return .open(.shows, .venue(key: key)) }
        case "/year-in-review":
            if let user = value("user"), let year = value("year") { return .open(.stats, .yearInReview(user: user, year: year)) }
        case "/stats":
            return .open(.stats, nil)
        case "/stats/songs":
            return .open(.stats, .songs)
        case "/stats/runs":
            return .open(.stats, .runs)
        case "/stats/top-artists":
            return .open(.stats, .statsList(.bands, year: nil))
        case "/stats/top-venues":
            return .open(.stats, .statsList(.venues, year: nil))
        // Library in Me (Stage 4, 4-6).
        case "/runs":
            if let key = value("run") { return .open(.me, .run(key: key)) }
            return .open(.me, .runs)
        case "/tours":
            if let key = value("tour") { return .open(.me, .tour(key: key)) }
            return .open(.me, .tours)
        case "/wishlist":
            return .open(.me, .wishlist)
        case "/bucket-list":
            return .open(.me, .bucketList)
        case "/festivals":
            if let id = value("festival") { return .open(.me, .festival(id: id)) }
            return .open(.me, .festivals)
        case "/setlist-photos":
            return .open(.me, .setlistPhotos)
        case "/community":
            return .open(.stats, .community)
        case "/friends":
            return .open(.friends, nil)
        case "/notifications":
            return .open(.friends, .notifications)
        case "/profile":
            return .open(.me, nil)
        case "/search":
            return .open(.search, nil)
        case "/advanced-search":
            return .open(.search, .advancedSearch)
        default:
            break
        }
        return .web(webURL(path: path, params: params))
    }

    static func webURL(path: String, params: SearchParams) -> URL {
        let href = path == "/" ? "/" : path + "/"
        let query = params.serialized
        return URL(string: href + (query.isEmpty ? "" : "?" + query), relativeTo: webOrigin)!.absoluteURL
    }
}

public extension AppRoute {
    /// The same screen on the web (lib/showRouting.js's hrefs), for the
    /// placeholders' "Open on mysetlists.net" until each screen is built.
    var webURL: URL {
        var params = SearchParams(nil)
        let path: String
        switch self {
        case .show(let id): path = "/shows"; params.set("show", id)
        case .upcomingShow(let id): path = "/shows"; params.set("upcoming", id)
        case .band(let slug): path = "/bands"; params.set("band", slug)
        case .song(let artist, let song):
            path = "/songs"
            if let artist { params.set("artist", artist) }
            params.set("song", song)
        case .bandSong(let band, let song): path = "/bands"; params.set("band", band); params.set("song", song)
        case .songs: path = "/stats/songs"
        case .runs: path = "/stats/runs"
        case .run(let key): path = "/runs"; params.set("run", key)
        case .tours: path = "/tours"
        case .tour(let key): path = "/tours"; params.set("tour", key)
        case .statsList(let kind, _):
            switch kind {
            case .bands: path = "/stats/top-artists"
            case .venues: path = "/stats/top-venues"
            case .songs: path = "/stats/songs"
            case .topShows: path = "/stats"
            }
        case .wishlist, .wishlistArtist: path = "/wishlist"
        case .bucketList: path = "/bucket-list"
        case .community: path = "/community"
        case .festivals: path = "/festivals"
        case .festival(let id): path = "/festivals"; params.set("festival", id)
        case .setlistPhotos: path = "/setlist-photos"
        case .advancedSearch: path = "/advanced-search"
        case .venue(let key): path = "/venues"; params.set("venue", key)
        case .yearInReview(let user, let year): path = "/year-in-review"; params.set("user", user); params.set("year", year)
        case .myShows: path = "/stats"
        case .notifications: path = "/notifications"
        }
        return DeepLink.webURL(path: path, params: params)
    }
}
