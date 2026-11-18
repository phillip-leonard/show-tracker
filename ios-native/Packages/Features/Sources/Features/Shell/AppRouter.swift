import Core
import Foundation
import Observation

/// Which tab is showing, each tab's stack, and the web page on top, if any.
/// Links (universal links, `mysetlists://`) come in through `handle(_:)`;
/// `DeepLink` (Core) decides where they go, from the table lib/deepLinks.js
/// shares.
@MainActor
@Observable
public final class AppRouter {
    public var tab: AppTab = .shows
    public var paths: [AppTab: [AppRoute]] = [:]
    /// A page shown in SFSafariViewController.
    public var web: WebPage?

    public struct WebPage: Identifiable, Equatable {
        public let url: URL
        public var id: URL { url }
    }

    public init() {}

    /// Follows a link. Returns false for one that isn't ours. Works while
    /// signed out too: the shell opens where the link pointed once someone
    /// signs in.
    @discardableResult
    public func handle(_ url: URL) -> Bool {
        guard let resolved = DeepLink.resolve(url) else { return false }
        if let ref = resolved.referral { Referral.remember(ref) }
        apply(resolved.action)
        return true
    }

    public func apply(_ action: DeepLinkAction) {
        switch action {
        case .open(let tab, let route):
            self.tab = tab
            // A link starts a fresh trail on its tab, so back goes to the
            // tab's root, not to wherever it was (DeepLinkListener.jsx).
            paths[tab] = route.map { [$0] } ?? []
        case .web(let url):
            web = WebPage(url: url)
        }
    }

    public func show(_ url: URL) { web = WebPage(url: url) }

    /// Pushes a screen on the tab that's showing, for a tap that can't be a
    /// `NavigationLink` (a context menu item).
    public func push(_ route: AppRoute) { paths[tab, default: []].append(route) }

    /// A different person signed in, or nobody: start from Shows.
    public func reset() {
        tab = .shows
        paths = [:]
        web = nil
    }
}
