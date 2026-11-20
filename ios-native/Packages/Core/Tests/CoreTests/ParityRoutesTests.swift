import Foundation
import Testing
@testable import Core

/// The parity check (Stage 6, 6-12): every page the app claims from
/// mysetlists.net opens a native screen, except the ones decided to stay on
/// the web. A new route that opens the web fails here until it's built or
/// added to the decided list (and to PARITY-AUDIT).
struct ParityRoutesTests {
    /// Decided web pages: Discover (F-4, hidden), the screenshot import
    /// link (the add sheet isn't a route, 6-7), venue owner tools (F-6),
    /// meetups (left out, 2026-11-19), release notes (F-5) and the admin
    /// portal (excluded).
    static let decidedWeb: Set<String> = [
        "/discover", "/scan-import", "/venue-dashboard", "/meetups", "/release-notes", "/admin", "/admin/venue-verifications",
    ]

    /// A typical link for each route, with the query its detail view needs.
    static func sample(_ route: String) -> String {
        switch route {
        case "/shows/:id": "/shows/abc"
        case "/songs": "/songs/?artist=goose&song=arcadia"
        case "/bands": "/bands/?band=goose"
        case "/venues": "/venues/?venue=red-rocks"
        case "/my-poster": "/my-poster/?artist=Goose"
        case "/year-in-review": "/year-in-review/?year=2025"
        default: route == "/" ? "/" : "\(route)/"
        }
    }

    @Test func everyClaimedRouteOpensNativeOrIsDecided() {
        var web: [String] = []
        for route in DeepLink.routes {
            guard let action = DeepLink.resolve(URL(string: "https://mysetlists.net\(Self.sample(route))")!)?.action else {
                Issue.record("\(route) isn't claimed"); continue
            }
            if case .web = action { web.append(route) }
        }
        #expect(Set(web) == Self.decidedWeb, "opens the web: \(web.sorted())")
    }

    @Test func inviteOpensFriends() {
        #expect(DeepLink.resolve(URL(string: "https://mysetlists.net/invite/")!)?.action == .open(.friends, nil))
    }
}
