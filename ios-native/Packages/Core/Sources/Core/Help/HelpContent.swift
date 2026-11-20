import Foundation

// How to Use (F-7) and What's New (F-5) for the native app (Stage 6, 6-11):
// content written for this app, in `public/native/how-to-use.json` and
// `public/native/whats-new.json`. The website serves them, so they can
// change without a release; the app reads mysetlists.net first and falls
// back to the copy bundled at build time (`NativeContent`, a symlink to
// `public/native/`), so both work offline.

/// `how-to-use.json`: sections of short topics.
public struct HowToUse: Codable, Hashable, Sendable {
    public var updated: String?
    public var sections: [Section]

    public struct Section: Codable, Hashable, Sendable, Identifiable {
        public var id: String
        public var title: String
        /// An SF Symbol.
        public var symbol: String?
        public var topics: [Topic]
    }

    public struct Topic: Codable, Hashable, Sendable, Identifiable {
        public var title: String
        public var body: String
        public var id: String { title }
    }
}

/// `whats-new.json`: a short list per native release, newest first, and an
/// optional one-off announcement (call H: in place of the web's popups).
public struct WhatsNew: Codable, Hashable, Sendable {
    public var releases: [Release]
    public var announcement: Announcement?

    public struct Release: Codable, Hashable, Sendable, Identifiable {
        /// The native `MARKETING_VERSION` it shipped in ("4.0.56").
        public var version: String
        public var title: String
        public var items: [String]
        public var id: String { version }
    }

    public struct Announcement: Codable, Hashable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var body: String
        public var link: URL?
    }
}

public enum NativeContent {
    public static let base = URL(string: "https://mysetlists.net/native/")!

    /// The website's copy, else the bundled one.
    public static func load<T: Decodable & Sendable>(_ name: String, as type: T.Type,
                                                     session: URLSession = .shared) async -> T? {
        var request = URLRequest(url: base.appendingPathComponent("\(name).json"))
        request.timeoutInterval = 8
        request.cachePolicy = .reloadRevalidatingCacheData
        if let (data, response) = try? await session.data(for: request),
           (response as? HTTPURLResponse)?.statusCode == 200,
           let value = try? JSONDecoder().decode(T.self, from: data) {
            return value
        }
        return bundled(name, as: type)
    }

    /// The copy bundled at build time.
    public static func bundled<T: Decodable>(_ name: String, as type: T.Type) -> T? {
        bundled(name, as: type, bundle: .module)
    }

    static func bundled<T: Decodable>(_ name: String, as type: T.Type, bundle: Bundle) -> T? {
        guard let url = bundle.url(forResource: name, withExtension: "json", subdirectory: "NativeContent"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

/// When What's New opens by itself: once after an update to a version that
/// has a release in the file. Never on a first install (nothing is "new"),
/// and never twice for one version.
public enum WhatsNewGate {
    public static let seenKey = "whatsNewSeenVersion"
    public static let announcementKey = "whatsNewSeenAnnouncement"

    /// The release to show now, if any. `lastSeen` is nil on a first install.
    public static func release(for current: String, lastSeen: String?, in whatsNew: WhatsNew) -> WhatsNew.Release? {
        guard let lastSeen, compare(current, lastSeen) == .orderedDescending else { return nil }
        return whatsNew.releases.first { $0.version == current }
    }

    /// The announcement, unless it's been seen.
    public static func announcement(in whatsNew: WhatsNew, seen: String?) -> WhatsNew.Announcement? {
        guard let a = whatsNew.announcement, a.id != seen else { return nil }
        return a
    }

    /// Dotted versions compared number by number ("4.0.10" > "4.0.9").
    public static func compare(_ a: String, _ b: String) -> ComparisonResult {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p < q ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }
}
