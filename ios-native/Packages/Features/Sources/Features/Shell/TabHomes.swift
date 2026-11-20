import Core
import DesignSystem
import SwiftUI

// Each tab's root, until its feature is built (DECISIONS.md, "Build order").

// ShowsHome is Features/Shows/ShowsHome.swift (Stage 1, Part 2).

// FriendsHome is Features/Friends/FriendsHome.swift (Stage 3, Part 2b).

// SearchHome is Features/Search/SearchViews.swift (Stage 4, 4-12).

/// A screen a link or a tap can reach before it's built: what it will be,
/// and the same page on the web meanwhile.
struct RoutePlaceholder: View {
    @Environment(AppRouter.self) private var router
    let route: AppRoute

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            Text(detail)
        } actions: {
            Button("Open on mysetlists.net") { router.show(route.webURL) }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    var title: String {
        switch route {
        case .show, .upcomingShow: "Show"
        case .band: "Band"
        case .song, .bandSong: "Song"
        case .songs: "Songs"
        case .runs, .run: "Runs"
        case .tours, .tour: "Tours"
        case .statsList(let kind, _): kind.title
        case .wishlist, .wishlistArtist: "Wishlist"
        case .bucketList: "Bucket List"
        case .community: "Community"
        case .festivals, .festival: "Festivals"
        case .setlistPhotos: "Setlist Photos"
        case .advancedSearch: "Advanced search"
        case .venue: "Venue"
        case .yearInReview(_, let year): "\(year) in Review"
        case .myShows(let filter): filter.title
        case .notifications: "Notifications"
        case .activity: "Activity"
        }
    }

    var symbol: String {
        switch route {
        case .show: "music.mic"
        case .upcomingShow: "calendar"
        case .band: "guitars"
        case .song, .bandSong, .songs: "music.note"
        case .runs, .run: "calendar.day.timeline.left"
        case .tours, .tour: "map"
        case .statsList: "list.number"
        case .wishlist, .wishlistArtist: "star"
        case .bucketList: "checklist"
        case .community: "person.3"
        case .festivals, .festival: "tent"
        case .setlistPhotos: "photo.on.rectangle"
        case .advancedSearch: "line.3.horizontal.decrease.circle"
        case .venue: "building.columns"
        case .yearInReview: "sparkles"
        case .myShows: "list.bullet"
        case .notifications: "bell"
        case .activity: "bolt.heart"
        }
    }

    var detail: String {
        switch route {
        case .show(let id), .upcomingShow(let id): "Show \(id)"
        case .band(let slug): slug
        case .song(let band, let song): [band, song].compactMap { $0 }.joined(separator: " · ")
        case .bandSong(let band, let song): "\(band) · \(song)"
        case .songs, .runs, .tours: ""
        case .run(let key), .tour(let key): key
        case .statsList(_, let year): year ?? "All time"
        case .wishlist: ""
        case .wishlistArtist(let artist): artist.name
        case .bucketList, .community, .advancedSearch, .festivals, .setlistPhotos: ""
        case .festival(let id): id
        case .venue(let key): key
        case .yearInReview: "A year of shows"
        case .myShows(let filter): filter.artist ?? ""
        case .notifications, .activity: ""
        }
    }
}
