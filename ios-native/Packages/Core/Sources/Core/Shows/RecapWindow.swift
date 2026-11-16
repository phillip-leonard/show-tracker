import Foundation

/// When Stats links to the year's recap (Stage 2, C-9): the dates
/// `lib/recapLaunch.js` uses for the web's Stats card (`recapPromoActive`),
/// Dec 2 – Jan 15, Pacific. `fixtures/recap-launch/window.json` pins them
/// to the web's (`RecapWindowTests`), so a change there fails here until
/// this file follows.
public enum RecapWindow {
    public static let year = 2026
    /// 2026-12-02 00:00 Pacific (08:00 UTC), inclusive.
    public static let promoStartsAt = Date(timeIntervalSince1970: 1_796_198_400)
    /// The end of 2027-01-15 Pacific (2027-01-16 08:00 UTC), exclusive.
    public static let promoEndsAt = Date(timeIntervalSince1970: 1_800_086_400)
    public static let path = "/year-in-review/?year=\(year)"

    /// The web page: it opens signed out until the person signs in there
    /// once (SFSafariViewController doesn't share the app's sign-in).
    public static var url: URL { URL(string: "https://mysetlists.net\(path)")! }

    /// Stats shows the link for accounts, inside the window. Guests have no
    /// Year in Review (DECISIONS.md, "Guests").
    public static func shown(isAccount: Bool, now: Date = Date()) -> Bool {
        isAccount && promoted(now: now)
    }

    public static func promoted(now: Date = Date()) -> Bool {
        now >= promoStartsAt && now < promoEndsAt
    }
}
