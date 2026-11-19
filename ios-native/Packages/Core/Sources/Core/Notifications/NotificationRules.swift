import Foundation

/// `showMatchKey` (lib/showIdentity.js): the setlist.fm id, else band,
/// venue and day, trimmed and lowercased. A notification about a show
/// carries this as `concertKey`, never a show id, because the key isn't
/// any one person's (lib/notifications.js).
public enum ShowMatchKey {
    public static func of(artist: String?, venue: String?, date: String?, setlistfmId: String?) -> String {
        if let setlistfmId, !setlistfmId.isEmpty { return setlistfmId }
        let iso = ShowDate.isoDay(date)
        let day = iso.isEmpty ? norm(date) : iso
        return "\(norm(artist))|\(norm(venue))|\(day)"
    }

    public static func of(_ show: Show) -> String {
        of(artist: show.artist, venue: show.venue, date: show.date, setlistfmId: show.setlistfmId)
    }

    private static func norm(_ value: String?) -> String {
        (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

/// Where tapping a notification goes (the web's NotificationCenter):
/// - a meetup join: the meetup page (meetups stay on the web, Stage 3 C-4);
/// - a bucket-list venue: its venue page (Stage 4, 4-7);
/// - an anniversary: your show;
/// - a reply, mention or like: your show's page on the web, where comments
///   and photos are (C-4);
/// - the roadmap notice: the roadmap;
/// - a tour or on-sale alert: nowhere (its dates and links are on the row).
public enum NotificationDestination: Equatable, Sendable {
    case route(AppTab, AppRoute)
    case web(URL)
    case none

    /// `myShows`: the reader's own shows, to find the one a notification is about.
    public static func of(_ n: AppNotification, myShows: [Show]) -> NotificationDestination {
        let ownShow: () -> Show? = {
            if let id = n.showId, let show = myShows.first(where: { $0.id == id }) { return show }
            guard let key = n.concertKey, !key.isEmpty else { return nil }
            return myShows.first { ShowMatchKey.of($0) == key }
        }
        switch n.kind {
        case .meetupJoin:
            guard let id = meetupId(n.concertKey) else { return .none }
            return .web(DeepLink.webURL(path: "/meetups", params: SearchParams("id=\(id)")))
        case .venueBucketListMatch:
            guard let key = n.venueKey else { return .none }
            return .route(.shows, .venue(key: key))
        case .anniversary:
            guard let show = ownShow() else { return .none }
            return .route(.shows, .show(id: show.id))
        case .commentReply, .commentLike, .commentMention, .photoLike:
            guard let show = ownShow() else { return .none }
            return .web(AppRoute.show(id: show.id).webURL)
        case .roadmapPublished:
            return .web(DeepLink.webURL(path: "/roadmap", params: SearchParams(nil)))
        case .followedBandTour, .onsaleAlert:
            // The band's page (Stage 4, 4-5); the dates and ticket links
            // stay in the row.
            guard let artist = n.artist?.trimmingCharacters(in: .whitespacesAndNewlines), !artist.isEmpty else { return .none }
            return .route(.shows, .band(slug: BandDirectory.slug(forArtist: artist)))
        case .other:
            return .none
        }
    }

    /// `meetupIdFor` (lib/meetups.js): the concert key, lowercased, every run
    /// of other characters one underscore, none at the ends.
    static func meetupId(_ concertKey: String?) -> String? {
        ConcertKeys.meetupId(concertKey)
    }
}

public enum NotificationLists {
    /// Newest first (the listener's order, kept for documents still
    /// waiting for their server timestamp).
    public static func sorted(_ list: [AppNotification]) -> [AppNotification] {
        list.sorted { ($0.createdAt ?? .distantFuture) > ($1.createdAt ?? .distantFuture) }
    }

    public static func bandAlerts(_ list: [AppNotification]) -> [AppNotification] {
        list.filter { $0.kind.isBandAlert }
    }
}
