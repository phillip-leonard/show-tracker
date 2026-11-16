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
    /// The signed-in person's shows, live (Stage 1, Part 2). Shown only while
    /// someone is signed in, so it stops with the shell.
    @State private var shows = ShowsStore()

    public init() {}

    public var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab("Shows", systemImage: "music.note.list", value: AppTab.shows) {
                TabStack(tab: .shows) { ShowsHome() }
            }
            Tab("Friends", systemImage: "person.2", value: AppTab.friends) {
                TabStack(tab: .friends) { FriendsHome() }
            }
            Tab("Stats", systemImage: "chart.bar", value: AppTab.stats) {
                TabStack(tab: .stats) { StatsHome() }
            }
            Tab("Me", systemImage: "person.crop.circle", value: AppTab.me) {
                TabStack(tab: .me) { MeView() }
            }
            Tab(value: AppTab.search, role: .search) {
                TabStack(tab: .search) { SearchHome() }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tint(.brand)
        .environment(shows)
        .task(id: session.user?.uid) {
            if let uid = session.user?.uid { shows.start(uid: uid, api: session.api) } else { shows.stop() }
        }
        .onDisappear { shows.stop() }
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
        case .upcomingShow(let id): UpcomingDetailPlaceholder(id: id)
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
