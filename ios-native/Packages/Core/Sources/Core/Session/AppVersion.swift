import Foundation

/// Is this build too old? (lib/appVersion.js.) `config/app` holds two
/// marketing versions set in Admin → App versions:
///   below `latestIosVersion`        a dismissible "Update available" banner
///   below `minSupportedIosVersion`  a screen that can't be dismissed, with
///                                   the App Store link, and account
///                                   deletion still reachable
/// The shared table `fixtures/app-version/version-status.json` runs against
/// both. Today's values are Capacitor 3.x versions, which every native 4.x
/// build is above.
public enum AppVersion {
    public enum Status: String, Sendable { case ok, update, blocked }

    public static let appStoreURL = URL(string: "https://apps.apple.com/us/app/mysetlists-concert-tracker/id6760633144")!

    /// "3.13.10" → [3, 13, 10]; nil when it isn't a version (1–4 numeric parts).
    public static func parse(_ v: String?) -> [Int]? {
        let s = (v ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.wholeMatch(of: #/[0-9]+(\.[0-9]+){0,3}/#) != nil else { return nil }
        return s.split(separator: ".").compactMap { Int($0) }
    }

    /// -1, 0 or 1 part by part (missing parts are 0); nil when either is invalid.
    public static func compare(_ a: String?, _ b: String?) -> Int? {
        guard let x = parse(a), let y = parse(b) else { return nil }
        for i in 0..<max(x.count, y.count) {
            let d = (i < x.count ? x[i] : 0) - (i < y.count ? y[i] : 0)
            if d != 0 { return d < 0 ? -1 : 1 }
        }
        return 0
    }

    /// Anything missing or unreadable is `.ok`: a bad config must never lock people out.
    public static func status(current: String?, min: String?, latest: String?) -> Status {
        guard parse(current) != nil else { return .ok }
        if compare(current, min) == -1 { return .blocked }
        if compare(current, latest) == -1 { return .update }
        return .ok
    }

    public static func status(current: String, config: AppConfig?) -> Status {
        status(current: current, min: config?.minSupportedIosVersion, latest: config?.latestIosVersion)
    }
}
