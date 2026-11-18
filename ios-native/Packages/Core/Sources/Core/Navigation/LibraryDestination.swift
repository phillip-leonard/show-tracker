import Foundation

/// The secondary screens (Stage 4, F-1; DECISIONS.md "Parity before
/// launch"): the Capacitor app's menu drawer, without a drawer. Library is a
/// section at the top of Me; Community is on Stats; a wide iPad window lists
/// them all in its sidebar. One list drives all three, so a later Stage 4
/// PR moves an item to its native screen in one place (`native`).
public enum LibraryDestination: String, CaseIterable, Hashable, Sendable, Identifiable {
    case tours, runs, festivals, wishlist, bucketList, setlistPhotos, community

    public var id: String { rawValue }

    /// Library in Me, in the order DECISIONS lists them. Community is on
    /// Stats instead.
    public static let meOrder: [LibraryDestination] = [.tours, .runs, .festivals, .wishlist, .bucketList, .setlistPhotos]

    /// What a guest sees (DECISIONS.md "Guests"): festivals (joining and
    /// creating) and user content, reading included, need an account, so
    /// those rows are left out rather than shown and refused.
    public var needsAccount: Bool {
        switch self {
        case .festivals, .setlistPhotos: true
        case .tours, .runs, .wishlist, .bucketList, .community: false
        }
    }

    /// The Library rows for this person.
    public static func meItems(isGuest: Bool) -> [LibraryDestination] {
        meOrder.filter { !isGuest || !$0.needsAccount }
    }

    /// The wide-iPad sidebar: Library, then Community.
    public static func sidebarItems(isGuest: Bool) -> [LibraryDestination] {
        meItems(isGuest: isGuest) + [.community]
    }

    public var title: String {
        switch self {
        case .tours: "Tours"
        case .runs: "Runs"
        case .festivals: "Festivals"
        case .wishlist: "Wishlist"
        case .bucketList: "Bucket List"
        case .setlistPhotos: "Setlist Photos"
        case .community: "Community"
        }
    }

    /// One line under the title.
    public var detail: String {
        switch self {
        case .tours: "Every tour you caught, stop by stop"
        case .runs: "Nights in a row at one venue"
        case .festivals: "Festivals you went to, and their lineups"
        case .wishlist: "Songs you're hoping to hear"
        case .bucketList: "Shows and venues you want to get to"
        case .setlistPhotos: "Photos of setlists from the shows"
        case .community: "Top show-goers, raters, songs and venues"
        }
    }

    public var systemImage: String {
        switch self {
        case .tours: "map"
        case .runs: "calendar.day.timeline.left"
        case .festivals: "tent"
        case .wishlist: "star"
        case .bucketList: "checklist"
        case .setlistPhotos: "photo.on.rectangle"
        case .community: "person.3"
        }
    }

    /// The same page on the web (lib/navRoutes.js). The runs list is
    /// `/stats/runs`; `/runs` is one run's page.
    public var webURL: URL {
        let path = switch self {
        case .tours: "/tours/"
        case .runs: "/stats/runs/"
        case .festivals: "/festivals/"
        case .wishlist: "/wishlist/"
        case .bucketList: "/bucket-list/"
        case .setlistPhotos: "/setlist-photos/"
        case .community: "/community/"
        }
        return URL(string: DeepLink.webOrigin.absoluteString + path)!
    }

    /// Built natively yet. Until its PR, an item opens its web page
    /// (Stage 4 call B for Festivals and Setlist Photos, which wait for
    /// Stages 5 and 6; the rest until their Stage 4 PRs).
    public var native: Bool { route != nil }

    /// Its native screen, once built: Tours and Runs since 4-6.
    public var route: AppRoute? {
        switch self {
        case .tours: .tours
        case .runs: .runs
        case .festivals, .wishlist, .bucketList, .setlistPhotos, .community: nil
        }
    }
}
