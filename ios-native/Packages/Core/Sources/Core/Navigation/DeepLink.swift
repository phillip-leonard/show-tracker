import Foundation

/// Which in-app route a link lands on: lib/deepLinks.js `deepLinkTarget`,
/// ported. Both run `fixtures/deep-links/links.json`, so a link opens the
/// same screen in the web, the Capacitor app and this one.
///
/// Two kinds of link reach the app: a universal link
/// (`https://mysetlists.net/<path>?<query>`, for the paths
/// public/.well-known/apple-app-site-association claims) and the custom
/// scheme (`mysetlists://<path>?<query>`). The old path shapes netlify.toml
/// 301s (`/shows/<id>`, …) are rewritten here too: no Netlify sits between a
/// link and the app (CLAUDE.md, "Routing").
public enum DeepLink {
    static let webHosts: Set<String> = ["mysetlists.net", "www.mysetlists.net"]
    static let scheme = "mysetlists"

    /// Custom-scheme links handled elsewhere (Spotify's sign-in callback).
    static let handledElsewhere = ["/spotify-callback"]

    /// lib/navRoutes.js's route table, in its order. CoreTests checks it
    /// against the shared table's `routes`.
    public static let routes = [
        "/", "/shows", "/shows/:id", "/search", "/stats", "/profile", "/songs", "/runs", "/tours", "/festivals",
        "/discover", "/wishlist", "/bucket-list", "/setlist-photos", "/scan-import", "/venues", "/venue-dashboard",
        "/bands", "/my-poster", "/stats/runs", "/stats/songs", "/stats/top-artists", "/stats/top-venues",
        "/year-in-review", "/advanced-search", "/community", "/friends", "/invite", "/activity", "/notifications",
        "/meetups", "/roadmap", "/feedback", "/how-to-use", "/release-notes", "/admin", "/admin/venue-verifications",
    ]

    /// netlify.toml's 301s, in the same order: the route and the query each adds.
    static let legacyShapes: [(pattern: [String], rewrite: @Sendable ([String]) -> (String, [(String, String)]))] = [
        (["shows", "*"], { ("/shows", [("show", $0[0])]) }),
        (["venues", "*"], { ("/venues", [("venue", $0[0])]) }),
        (["venue-dashboard", "*"], { ("/venue-dashboard", [("venue", $0[0])]) }),
        (["year-in-review", "*", "*"], { ("/year-in-review", [("user", $0[0]), ("year", $0[1])]) }),
        (["festivals", "*"], { ("/festivals", [("festival", $0[0])]) }),
        (["upcoming"], { _ in ("/shows", []) }),
    ]

    /// The in-app href for a link (`/shows/?show=abc`), or nil when the app
    /// shouldn't navigate for it.
    public static func target(_ url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let raw = linkPath(components) else { return nil }

        var path = normalize(decodeURI(raw))
        if handledElsewhere.contains(where: { path == $0 || path.hasPrefix($0 + "/") }) { return nil }

        var params = SearchParams(components.percentEncodedQuery)
        let segments = path.split(separator: "/").map(String.init)
        for shape in legacyShapes {
            guard let captured = match(shape.pattern, segments) else { continue }
            let (to, add) = shape.rewrite(captured)
            path = to
            for (key, value) in add { params.set(key, value) }
            break
        }

        guard isKnown(path) else { return nil }
        let query = params.serialized
        // The static export's shape: every route ends in a slash.
        let href = path == "/" ? "/" : path + "/"
        return query.isEmpty ? href : href + "?" + query
    }

    /// The path a link names, or nil for a link that isn't one of ours.
    static func linkPath(_ c: URLComponents) -> String? {
        let scheme = c.scheme?.lowercased()
        let host = c.host ?? ""
        if scheme == "https", webHosts.contains(host.lowercased()) {
            return c.percentEncodedPath.isEmpty ? "/" : c.percentEncodedPath
        }
        guard scheme == Self.scheme else { return nil }
        // mysetlists://shows/?show=1 parses with "shows" as the host;
        // mysetlists://localhost/shows/ was the Capacitor WebView's origin.
        if host.isEmpty || host == "localhost" { return c.percentEncodedPath.isEmpty ? "/" : c.percentEncodedPath }
        return "/" + host + c.percentEncodedPath
    }

    static func normalize(_ path: String) -> String {
        var p = path
        while p.hasSuffix("/") { p.removeLast() }
        return p.isEmpty ? "/" : p
    }

    static func isKnown(_ path: String) -> Bool {
        let segments = path.split(separator: "/").map(String.init)
        return routes.contains { route in
            let pattern = route.split(separator: "/").map { $0.hasPrefix(":") ? "*" : String($0) }
            return match(pattern, segments) != nil
        }
    }

    /// The segments a `*` matched, or nil.
    static func match(_ pattern: [String], _ segments: [String]) -> [String]? {
        guard pattern.count == segments.count else { return nil }
        var captured: [String] = []
        for (p, s) in zip(pattern, segments) {
            if p == "*" { captured.append(s) } else if p != s { return nil }
        }
        return captured
    }

    /// JavaScript's `decodeURI`: decodes escapes except those for the
    /// reserved characters, and returns the input unchanged when the
    /// escapes aren't valid UTF-8 (lib/deepLinks.js `safeDecode`).
    static func decodeURI(_ s: String) -> String {
        let reserved = Set(";/?:@&=+$,#".utf8)
        let bytes = Array(s.utf8)
        var out: [UInt8] = []
        var i = 0
        while i < bytes.count {
            if bytes[i] == UInt8(ascii: "%"), i + 2 < bytes.count, let byte = UInt8(String(decoding: bytes[i + 1...i + 2], as: UTF8.self), radix: 16) {
                if byte < 0x80, reserved.contains(byte) {
                    out.append(contentsOf: bytes[i...i + 2])
                } else {
                    out.append(byte)
                }
                i += 3
            } else {
                out.append(bytes[i])
                i += 1
            }
        }
        return String(validating: out, as: UTF8.self) ?? s
    }
}

/// `URLSearchParams`, as much of it as the router needs: parse a query the
/// WHATWG way (`+` is a space), `set`, and serialize as
/// application/x-www-form-urlencoded.
public struct SearchParams: Equatable, Sendable {
    public private(set) var items: [(String, String)]

    public init(_ percentEncodedQuery: String?) {
        items = (percentEncodedQuery ?? "").split(separator: "&", omittingEmptySubsequences: true).map { pair in
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let decode = { (s: Substring) in (String(s).replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? String(s)) }
            return (decode(parts[0]), parts.count > 1 ? decode(parts[1]) : "")
        }
    }

    public func get(_ key: String) -> String? { items.first { $0.0 == key }?.1 }

    /// Replaces the first value for `key` and drops the rest, or appends.
    public mutating func set(_ key: String, _ value: String) {
        if let first = items.firstIndex(where: { $0.0 == key }) {
            items[first].1 = value
            items = items.enumerated().filter { $0.offset == first || $0.element.0 != key }.map(\.element)
        } else {
            items.append((key, value))
        }
    }

    public mutating func remove(_ key: String) { items.removeAll { $0.0 == key } }

    public var serialized: String {
        items.map { Self.encode($0.0) + "=" + Self.encode($0.1) }.joined(separator: "&")
    }

    /// The urlencoded serializer: letters, digits and `*-._` stay; a space is `+`.
    static func encode(_ s: String) -> String {
        var out = ""
        for byte in s.utf8 {
            switch byte {
            case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "0")...UInt8(ascii: "9"),
                 UInt8(ascii: "*"), UInt8(ascii: "-"), UInt8(ascii: "."), UInt8(ascii: "_"):
                out.append(Character(UnicodeScalar(byte)))
            case UInt8(ascii: " "):
                out.append("+")
            default:
                out += String(format: "%%%02X", byte)
            }
        }
        return out
    }

    public static func == (a: SearchParams, b: SearchParams) -> Bool {
        a.items.map { [$0.0, $0.1] } == b.items.map { [$0.0, $0.1] }
    }
}
