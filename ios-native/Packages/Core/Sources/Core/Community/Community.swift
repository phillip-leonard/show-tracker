import FirebaseFirestore
import Foundation

// Community (Stage 4, 4-11): the web's /community page
// (components/CommunityStatsView.jsx) from `communityStats/global`, which
// the 6-hourly `community-stats` job writes (rules: anyone reads, nobody
// writes). The boards are the same for everyone; someone you've blocked is
// left out of your copy. Guests can look too.

public enum Community {
    /// Each board shows its top five, as on the web (the job stores ten).
    public static let boardSize = 5

    /// Top show-goers, without anyone you've blocked.
    public static func showGoers(_ stats: CommunityStats, blocked: Set<String>) -> [CommunityStats.LeaderboardEntry] {
        visible(stats.topShowsAttended, blocked: blocked)
    }

    /// Top raters, without anyone you've blocked.
    public static func raters(_ stats: CommunityStats, blocked: Set<String>) -> [CommunityStats.LeaderboardEntry] {
        visible(stats.topSongsRated, blocked: blocked)
    }

    public static func songs(_ stats: CommunityStats) -> [CommunityStats.SongRating] {
        Array(stats.topSongsByRating.prefix(boardSize))
    }

    public static func venues(_ stats: CommunityStats) -> [CommunityStats.VenueTotal] {
        Array(stats.topVenues.prefix(boardSize))
    }

    private static func visible(_ list: [CommunityStats.LeaderboardEntry], blocked: Set<String>) -> [CommunityStats.LeaderboardEntry] {
        Array(list.filter { !$0.userId.isEmpty && !blocked.contains($0.userId) }.prefix(boardSize))
    }

    /// An entry's "Add" button: not you, and not already a friend. A guest
    /// sees it too; tapping it asks them to make an account, as on the web.
    public static func offersAdd(_ uid: String, me: String?, friends: Set<String>) -> Bool {
        !uid.isEmpty && uid != me && !friends.contains(uid)
    }

    /// One of the totals under the boards.
    public struct Total: Hashable, Sendable, Identifiable {
        public var label: String
        public var value: Int
        public var id: String { label }
    }

    /// Total Users (only from 1,000, `UserCount.shouldShow`; below that it
    /// isn't there at all), Total Shows and Total Songs.
    public static func totals(_ stats: CommunityStats) -> [Total] {
        var out: [Total] = []
        if UserCount.shouldShow(stats.totalUsers) { out.append(Total(label: "Total Users", value: stats.totalUsers)) }
        out.append(Total(label: "Total Shows", value: stats.totalShows))
        out.append(Total(label: "Total Songs", value: stats.totalSongs))
        return out
    }

    /// "9.5/10": the job's average, to one place as it stores it.
    public static func rating(_ average: Double) -> String {
        String(format: "%.1f/10", average)
    }

    /// When the job last rebuilt the boards: "Updated 3:50 PM" today,
    /// "Updated Nov 14" before. nil when unknown.
    public static func updatedLabel(_ updatedAt: Date?, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String? {
        guard let updatedAt else { return nil }
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = calendar.timeZone
        if calendar.isDate(updatedAt, inSameDayAs: now) {
            f.setLocalizedDateFormatFromTemplate("jmm")
        } else {
            f.setLocalizedDateFormatFromTemplate("MMMd")
        }
        return "Updated \(f.string(from: updatedAt))"
    }

    /// "12 shows", "1 rating".
    public static func count(_ n: Int, _ one: String, _ many: String) -> String {
        "\(n.formatted()) \(n == 1 ? one : many)"
    }
}

/// Reads `communityStats/global`, kept for the session so going back to
/// the screen doesn't wait again (it changes every six hours).
@MainActor
public enum CommunityService {
    static let deadline: Duration = .seconds(10)
    private static var cached: CommunityStats?

    public static var last: CommunityStats? { cached }

    /// The boards, or nil when the document isn't there yet (a brand-new
    /// project before the job's first run).
    public static func load() async throws -> CommunityStats? {
        let db = await Database.ready()
        let ref = db.collection("communityStats").document("global")
        let snap = try await withDeadline(deadline) { try await ref.getDocument() }
        guard snap.exists else { return nil }
        let stats = try snap.data(as: CommunityStats.self)
        cached = stats
        return stats
    }
}
