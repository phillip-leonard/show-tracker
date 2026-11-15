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
                .navigationDestination(for: AppRoute.self) { RoutePlaceholder(route: $0).brandScreen() }
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
