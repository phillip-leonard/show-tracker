import Core
import DesignSystem
import SafariServices
import SwiftUI

/// The signed-in app: Shows · Friends · Stats · Me, and the system Search
/// tab (DECISIONS.md, "Navigation"). Each tab is its own NavigationStack.
/// `.sidebarAdaptable` makes the tabs a sidebar on a wide iPad window and a
/// tab bar everywhere else; system bars get Liquid Glass on iOS 26.
public struct AppShell: View {
    @Environment(AppRouter.self) private var router
    @Environment(SessionStore.self) private var session
    /// The signed-in person's shows, live (Stage 1, Part 2). Owned by
    /// `AppRootView` (the adoption sheet sends a guest's queue through it);
    /// started and stopped here, with the shell.
    @Environment(ShowsStore.self) private var shows
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    /// Lets the Library tabs stay out of the tab bar (`defaultVisibility`).
    @State private var tabCustomization = TabViewCustomization()
    /// Friends, requests, invites and blocks (Stage 3, Part 2b): accounts
    /// only, so a guest never starts it.
    @State private var friends = FriendsStore()
    /// The inbox (Stage 3, Part 4): guests too, since band alerts reach them.
    @State private var inbox = NotificationsStore()
    /// Starred tours (Stage 4, 4-6): guests too, on their own document.
    @State private var favoriteTours = FavoriteToursStore()

    public init() {}

    /// A window where `.sidebarAdaptable` can show its sidebar (by size
    /// class, not by device: CLAUDE.md, "iPad and wide layouts").
    private var sidebarPossible: Bool { horizontalSizeClass == .regular && verticalSizeClass == .regular }

    public var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab("Shows", systemImage: "music.note.list", value: AppTab.shows) {
                TabStack(tab: .shows) { ShowsHome() }
            }
            .customizationID("shows")
            Tab("Friends", systemImage: "person.2", value: AppTab.friends) {
                TabStack(tab: .friends) { FriendsHome() }
            }
            .badge(friends.waitingCount + inbox.unreadCount)
            .customizationID("friends")
            Tab("Stats", systemImage: "chart.bar", value: AppTab.stats) {
                TabStack(tab: .stats) { StatsHome() }
            }
            .customizationID("stats")
            Tab("Me", systemImage: "person.crop.circle", value: AppTab.me) {
                TabStack(tab: .me) { MeView() }
            }
            .customizationID("me")
            Tab(value: AppTab.search, role: .search) {
                TabStack(tab: .search) { SearchHome() }
            }
            .customizationID("search")
            // The secondary screens in the sidebar (Stage 4, F-1), never in
            // the tab bar: on a phone they're in Me (Library) and on Stats
            // (Community). Only when a sidebar can exist, regular width and
            // height (an iPad window; a Max iPhone in landscape is regular
            // width but compact height and has no sidebar). An iPhone ignores
            // `.defaultVisibility(.hidden, for: .tabBar)` and puts the tabs in
            // its tab bar, pushing Search into "More"; iPad honors it in its
            // own tab bar mode, given the TabView's customization.
            if sidebarPossible {
                TabSection("Library") {
                    ForEach(LibraryDestination.sidebarItems(isGuest: session.user?.isAnonymous == true)) { item in
                        Tab(item.title, systemImage: item.systemImage, value: AppTab.library(item)) {
                            TabStack(tab: .library(item)) { LibraryTabRoot(item: item) }
                        }
                        .customizationID("library.\(item.rawValue)")
                        .defaultVisibility(.hidden, for: .tabBar)
                    }
                }
                .customizationID("library")
                .defaultVisibility(.hidden, for: .tabBar)
            }
        }
        .tabViewCustomization($tabCustomization)
        .environment(friends)
        .environment(inbox)
        .environment(favoriteTours)
        .tabViewStyle(.sidebarAdaptable)
        .tint(.brand)
        // A window made narrow while a Library item is open: the sidebar is
        // gone, so go to Me, where Library is.
        .onChange(of: sidebarPossible) { _, possible in
            if !possible, case .library = router.tab { router.tab = .me }
        }
        .task(id: session.user?.uid) {
            if let uid = session.user?.uid { shows.start(uid: uid, api: session.api) } else { shows.stop() }
        }
        // A guest who creates an account keeps their uid, so the key includes
        // whether it's still a guest.
        .task(id: "\(session.user?.uid ?? "")|\(session.user?.isAnonymous == true)") {
            if let user = session.user, !user.isAnonymous { friends.start(uid: user.uid, api: session.api, email: user.email) } else { friends.stop() }
        }
        .task(id: session.user?.uid) {
            if let uid = session.user?.uid { inbox.start(uid: uid) } else { inbox.stop() }
        }
        .task(id: session.user?.uid) {
            if let uid = session.user?.uid { favoriteTours.start(uid: uid) } else { favoriteTours.stop() }
        }
        // Registers this device for push for whoever is signed in (guests
        // too), when notifications are allowed (Stage 3, Part 5).
        .task(id: session.user?.uid) { await PushCenter.shared.signedIn(uid: session.user?.uid) }
        .onDisappear { shows.stop(); friends.stop(); inbox.stop(); favoriteTours.stop() }
        .sheet(item: $router.web) { page in
            SafariView(url: page.url).ignoresSafeArea()
        }
    }
}

/// One tab's NavigationStack, its path kept in the router so a link can
/// set it.
struct TabStack<Root: View>: View {
    @Environment(AppRouter.self) private var router
    let tab: AppTab
    let root: Root

    init(tab: AppTab, @ViewBuilder root: () -> Root) {
        self.tab = tab
        self.root = root()
    }

    var body: some View {
        NavigationStack(path: Binding(get: { router.paths[tab, default: []] }, set: { router.paths[tab] = $0 })) {
            root
                .brandScreen()
                .navigationDestination(for: AppRoute.self) { RouteScreen(route: $0).brandScreen() }
        }
    }
}

/// The screen for a route: the ones built so far, a placeholder for the rest.
struct RouteScreen: View {
    let route: AppRoute

    var body: some View {
        switch route {
        case .show(let id): ShowDetailScreen(id: id)
        case .upcomingShow(let id): UpcomingDetail(id: id)
        case .myShows(let filter): MyShowsList(filter: filter)
        case .notifications: NotificationsView()
        case .band(let slug): BandScreen(slug: slug)
        case .bandSong(let band, let song): BandSongScreen(band: band, song: song)
        case .song(let artist, let song): SongScreen(artist: artist, song: song)
        case .songs: SongListView()
        case .runs: RunListView()
        case .run(let key): RunScreen(key: key)
        case .tours: ToursListView()
        case .tour(let key): TourScreen(key: key)
        case .venue(let key): VenueScreen(key: key)
        case .statsList(let kind, let year): StatsListScreen(kind: kind, year: year)
        default: RoutePlaceholder(route: route)
        }
    }
}

/// A web page in the app (claimed links without a native screen yet, and
/// the placeholders' "Open on mysetlists.net").
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredControlTintColor = BrandColor.brand.uiColor()
        controller.dismissButtonStyle = .close
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
