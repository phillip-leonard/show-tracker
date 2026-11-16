import Foundation

/// The app's tabs (DECISIONS.md, "Navigation"): Shows · Friends · Stats · Me,
/// plus the system Search tab.
public enum AppTab: String, CaseIterable, Hashable, Sendable {
    case shows, friends, stats, me, search
}

/// A screen pushed on a tab's stack. Each is a placeholder until its
/// feature is built (DECISIONS.md, "Build order").
public enum AppRoute: Hashable, Sendable {
    case show(id: String)
    case upcomingShow(id: String)
    case band(slug: String)
    case song(band: String?, song: String)
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
                if let song = value("song") { return .open(.shows, .song(band: band, song: song)) }
                return .open(.shows, .band(slug: band))
            }
        case "/songs":
            if let song = value("song") { return .open(.shows, .song(band: value("artist"), song: song)) }
        case "/venues":
            if let key = value("venue") { return .open(.shows, .venue(key: key)) }
        case "/year-in-review":
            if let user = value("user"), let year = value("year") { return .open(.stats, .yearInReview(user: user, year: year)) }
        case "/stats":
            return .open(.stats, nil)
        case "/friends":
            return .open(.friends, nil)
        case "/notifications":
            return .open(.friends, .notifications)
        case "/profile":
            return .open(.me, nil)
        case "/search":
            return .open(.search, nil)
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
        case .song(let band?, let song): path = "/bands"; params.set("band", band); params.set("song", song)
        case .song(nil, let song): path = "/songs"; params.set("song", song)
        case .venue(let key): path = "/venues"; params.set("venue", key)
        case .yearInReview(let user, let year): path = "/year-in-review"; params.set("user", user); params.set("year", year)
        case .myShows: path = "/stats"
        case .notifications: path = "/notifications"
        }
        return DeepLink.webURL(path: path, params: params)
    }
}
