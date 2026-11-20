import Foundation

// Profile extras (Stage 6, 6-11; the web's Profile page): achievements, your
// notes, the public profile preview and the guest rescue banner's rule.

/// One achievement tile (app/profile/page.jsx's list).
public struct Achievement: Hashable, Sendable, Identifiable {
    public enum Tone: String, Sendable { case green, amber, purple, blue }
    public let id: String
    public let name: String
    public let description: String
    /// An SF Symbol standing in for the web's icon.
    public let symbol: String
    public let tone: Tone
}

public enum Achievements {
    /// The tiles earned, in the web's order, at most four. The web counts
    /// shows on the device; native counts the server's `userStats` (CLAUDE.md,
    /// "the numbers people see"), plus friends and followed bands.
    public static func earned(shows: Int, bands: Int, venues: Int, friends: Int, follows: Int) -> [Achievement] {
        let all: [(Bool, Achievement)] = [
            (shows >= 1, .init(id: "first-show", name: "First show", description: "Tracked your first show", symbol: "music.note", tone: .green)),
            (shows >= 10, .init(id: "getting-into-it", name: "Getting into it", description: "10+ shows tracked", symbol: "star", tone: .amber)),
            (shows >= 50, .init(id: "dedicated-fan", name: "Dedicated fan", description: "50+ shows tracked", symbol: "trophy", tone: .amber)),
            (shows >= 100, .init(id: "centurion", name: "Centurion", description: "100+ shows tracked", symbol: "trophy.fill", tone: .amber)),
            (bands >= 10, .init(id: "eclectic", name: "Eclectic", description: "10+ different artists", symbol: "music.mic", tone: .green)),
            (venues >= 10, .init(id: "venue-hopper", name: "Venue hopper", description: "10+ different venues", symbol: "mappin.and.ellipse", tone: .purple)),
            (friends >= 1, .init(id: "connected", name: "Connected", description: "Made a friend on the app", symbol: "person.2", tone: .blue)),
            (friends >= 5, .init(id: "social-butterfly", name: "Social butterfly", description: "5+ friends", symbol: "person.3", tone: .blue)),
            (follows >= 1, .init(id: "fan-club", name: "Fan club", description: "Followed a band", symbol: "bell", tone: .amber)),
        ]
        return Array(all.filter(\.0).map(\.1).prefix(4))
    }
}

/// A note you wrote: on a show (its `comment`) or on a song in its setlist
/// (ProfileView.js "My Comments").
public struct MyNote: Hashable, Sendable, Identifiable {
    public let showId: String
    public let artist: String
    public let venue: String
    public let date: String
    /// `nil` for the show's own note.
    public let songName: String?
    public let text: String
    public var id: String { "\(showId)|\(songName ?? "")|\(text.hashValue)" }
}

public enum MyNotes {
    /// Every note, newest show first; within a show, its own note first,
    /// then songs in setlist order.
    public static func list(_ shows: [Show]) -> [MyNote] {
        let ordered = shows.sorted { ShowDate.areInIncreasingOrder($1.date, $0.date) }
        var out: [MyNote] = []
        for show in ordered {
            func note(_ text: String?, song: String?) {
                let trimmed = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                out.append(MyNote(showId: show.id, artist: show.artist, venue: show.venue, date: show.date, songName: song, text: trimmed))
            }
            note(show.comment, song: nil)
            for song in show.setlist { note(song.comment, song: song.name) }
        }
        return out
    }
}

/// What strangers would see at mysetlists.net/u/<handle> (ProfileView.js's
/// preview): the counts and the five most recent shows; never notes, photos,
/// wishlists or friends. The counts are the server's.
public struct PublicProfilePreview: Hashable, Sendable {
    public let shows: Int
    public let bands: Int
    public let venues: Int
    public let years: Int
    public let recent: [Show]

    public init(stats: UserStats?, shows: [Show]) {
        self.shows = stats?.showCount ?? shows.count
        bands = stats?.bandCount ?? Set(shows.map { StatsKeys.bandKey($0.artist) }).count
        venues = stats?.venueCount ?? 0
        years = stats?.yearsActive ?? Set(shows.map { ShowDate.year($0.date) }.filter { !$0.isEmpty }).count
        recent = Array(ShowList.pastOrder(shows).prefix(5))
    }
}

/// The "keep your shows" banner (GuestRescueBanner.jsx, `shouldShowRescue`):
/// for a guest with a show, unless dismissed in the last seven days.
public enum GuestRescue {
    public static let snooze: TimeInterval = 7 * 24 * 60 * 60
    public static let dismissedKey = "guestRescueDismissedAt"

    public static func shows(isGuest: Bool, showCount: Int, dismissedAt: Date?, now: Date = Date()) -> Bool {
        guard isGuest, showCount > 0 else { return false }
        guard let dismissedAt else { return true }
        return now.timeIntervalSince(dismissedAt) >= snooze
    }
}
