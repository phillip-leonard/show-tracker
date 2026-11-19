import Foundation
import Testing
@testable import Core

/// The secondary screens (Stage 4, F-1): Library in Me, Community on Stats,
/// and the wide-iPad sidebar, from one list.
struct LibraryDestinationTests {
    @Test func libraryIsDecisionsOrderWithCommunityOnStats() {
        #expect(LibraryDestination.meItems(isGuest: false) == [.tours, .runs, .festivals, .wishlist, .bucketList, .setlistPhotos])
        #expect(LibraryDestination.sidebarItems(isGuest: false).last == .community)
        #expect(!LibraryDestination.meItems(isGuest: false).contains(.community))
    }

    @Test func guestsDontSeeFestivalsOrSetlistPhotos() {
        #expect(LibraryDestination.meItems(isGuest: true) == [.tours, .runs, .wishlist, .bucketList])
        #expect(LibraryDestination.sidebarItems(isGuest: true) == [.tours, .runs, .wishlist, .bucketList, .community])
    }

    @Test func eachOpensItsWebPage() {
        let urls = Dictionary(uniqueKeysWithValues: LibraryDestination.allCases.map { ($0, $0.webURL.absoluteString) })
        #expect(urls[.tours] == "https://mysetlists.net/tours/")
        #expect(urls[.runs] == "https://mysetlists.net/stats/runs/", "the runs list; /runs is one run")
        #expect(urls[.festivals] == "https://mysetlists.net/festivals/")
        #expect(urls[.wishlist] == "https://mysetlists.net/wishlist/")
        #expect(urls[.bucketList] == "https://mysetlists.net/bucket-list/")
        #expect(urls[.setlistPhotos] == "https://mysetlists.net/setlist-photos/")
        #expect(urls[.community] == "https://mysetlists.net/community/")
    }

    /// Every web path is one the web serves (fixtures/deep-links `routes`,
    /// lib/navRoutes.js), so no row opens a missing page.
    @Test func everyWebPathIsAWebRoute() throws {
        let fixture = try FixtureLoader.json(FixtureLoader.root.appendingPathComponent("deep-links/links.json"))
        let routes = Set(try #require(fixture["routes"] as? [String]))
        for item in LibraryDestination.allCases {
            var path = item.webURL.path
            if path.hasSuffix("/") { path.removeLast() }
            #expect(routes.contains(path), "\(item): \(path)")
        }
    }

    @Test func nothingIsNativeYet() {
        // Each Stage 4 PR flips its own item (and this test).
        // Tours and Runs are native since 4-6, Wishlist since 4-9, Bucket
        // List since 4-10, Community since 4-11, Festivals since 5-3;
        // Setlist Photos opens the web until Stage 6 (call B).
        #expect(LibraryDestination.allCases.filter(\.native) == [.tours, .runs, .festivals, .wishlist, .bucketList, .community])
        #expect(LibraryDestination.festivals.route == .festivals)
        #expect(LibraryDestination.community.route == .community)
        #expect(LibraryDestination.bucketList.route == .bucketList)
        #expect(LibraryDestination.tours.route == .tours && LibraryDestination.runs.route == .runs)
        #expect(LibraryDestination.wishlist.route == .wishlist)
    }
}
