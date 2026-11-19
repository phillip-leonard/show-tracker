import Foundation
import Testing
@testable import Core

/// fixtures/deep-links/links.json, the table lib/deepLinks.js runs too
/// (lib/__tests__/deepLinks.test.js): a link lands on the same route here
/// as in the web and the Capacitor app.
@Suite struct DeepLinkTests {
    struct Table: Decodable {
        let routes: [String]
        let cases: [Case]
        struct Case: Decodable {
            let url: String, expected: String?
            init(from decoder: Decoder) throws {
                var c = try decoder.unkeyedContainer()
                url = try c.decode(String.self)
                expected = try c.decodeNil() ? nil : c.decode(String.self)
            }
        }
    }

    static let table: Table = try! JSONDecoder().decode(Table.self, from: FixtureLoader.data("deep-links/links.json"))

    @Test func routesAreTheWebs() {
        #expect(DeepLink.routes == Self.table.routes)
    }

    @Test func sharedTable() {
        for row in Self.table.cases {
            let target = URL(string: row.url).flatMap(DeepLink.target)
            #expect(target == row.expected, "\(row.url)")
        }
    }

    func action(_ s: String) -> DeepLinkAction? { DeepLink.resolve(URL(string: s)!)?.action }

    @Test func screensWithAPlaceholder() {
        #expect(action("https://mysetlists.net/shows/abc") == .open(.shows, .show(id: "abc")))
        #expect(action("https://mysetlists.net/shows/?upcoming=u1") == .open(.shows, .upcomingShow(id: "u1")))
        #expect(action("https://mysetlists.net/bands/?band=goose") == .open(.shows, .band(slug: "goose")))
        #expect(action("https://mysetlists.net/bands/?band=goose&song=arcadia") == .open(.shows, .bandSong(band: "goose", song: "arcadia")))
        #expect(action("https://mysetlists.net/venues/red%20rocks::morrison/") == .open(.shows, .venue(key: "red rocks::morrison")))
        #expect(action("https://mysetlists.net/year-in-review/u1/2026") == .open(.stats, .yearInReview(user: "u1", year: "2026")))
    }

    /// Songs (Stage 4, 4-4): the song page and the list, on Stats.
    @Test func songs() {
        #expect(action("https://mysetlists.net/songs/?artist=goose&song=arcadia") == .open(.stats, .song(artist: "goose", song: "arcadia")))
        #expect(action("mysetlists://songs/?song=arcadia") == .open(.stats, .song(artist: nil, song: "arcadia")))
        #expect(action("https://mysetlists.net/stats/songs/") == .open(.stats, .songs))
        // The web's own links back, for "Open on mysetlists.net".
        #expect(AppRoute.song(artist: "goose", song: "arcadia").webURL.absoluteString == "https://mysetlists.net/songs/?artist=goose&song=arcadia")
        #expect(AppRoute.bandSong(band: "goose", song: "arcadia").webURL.absoluteString == "https://mysetlists.net/bands/?band=goose&song=arcadia")
        #expect(AppRoute.songs.webURL.absoluteString == "https://mysetlists.net/stats/songs/")
    }

    /// Runs and tours (Stage 4, 4-6): Library in Me; the runs list is on Stats too.
    @Test func runsAndTours() {
        #expect(action("https://mysetlists.net/tours/") == .open(.me, .tours))
        #expect(action("https://mysetlists.net/tours/?tour=goose%3Asummer-tour-2025") == .open(.me, .tour(key: "goose:summer-tour-2025")))
        #expect(action("mysetlists://localhost/runs/?run=x") == .open(.me, .run(key: "x")))
        #expect(action("https://mysetlists.net/runs/") == .open(.me, .runs))
        #expect(action("https://mysetlists.net/stats/runs/") == .open(.stats, .runs))
        #expect(AppRoute.tour(key: "goose:summer-tour-2025").webURL.absoluteString == "https://mysetlists.net/tours/?tour=goose%3Asummer-tour-2025")
        #expect(AppRoute.run(key: "goose:dicks:2025-08-29").webURL.absoluteString.hasPrefix("https://mysetlists.net/runs/?run=goose"))
        #expect(AppRoute.runs.webURL.absoluteString == "https://mysetlists.net/stats/runs/")
    }

    @Test func tabs() {
        #expect(action("mysetlists://") == .open(.shows, nil))
        #expect(action("https://mysetlists.net/upcoming") == .open(.shows, nil))
        #expect(action("https://mysetlists.net/friends?tab=requests") == .open(.friends, nil))
        #expect(action("https://mysetlists.net/notifications/") == .open(.friends, .notifications), "the inbox (Stage 3, Part 4)")
        #expect(action("https://mysetlists.net/stats/") == .open(.stats, nil))
        #expect(action("https://mysetlists.net/profile") == .open(.me, nil))
        #expect(action("https://mysetlists.net/search/") == .open(.search, nil))
    }

    @Test func claimedPathsWithoutAScreenOpenTheWeb() {
        #expect(action("https://mysetlists.net/roadmap") == .web(URL(string: "https://mysetlists.net/roadmap/")!))
        #expect(action("https://mysetlists.net/festivals/f9") == .web(URL(string: "https://mysetlists.net/festivals/?festival=f9")!))
        #expect(action("https://mysetlists.net/shows/?venueKey=k") == .web(URL(string: "https://mysetlists.net/shows/?venueKey=k")!))
        #expect(action("https://mysetlists.net/bands/") == .web(URL(string: "https://mysetlists.net/bands/")!), "no band named")
    }

    /// Every /stats/* page is native (Stage 4, 4-8): songs and runs since
    /// 4-4 and 4-6, top artists and venues as the full lists.
    @Test func statsPagesOpenNatively() {
        #expect(action("mysetlists://stats/top-artists") == .open(.stats, .statsList(.bands, year: nil)))
        #expect(action("https://mysetlists.net/stats/top-venues/") == .open(.stats, .statsList(.venues, year: nil)))
        #expect(action("https://mysetlists.net/stats/songs/") == .open(.stats, .songs))
        #expect(action("https://mysetlists.net/stats/runs/") == .open(.stats, .runs))
        #expect(AppRoute.statsList(.bands, year: "2024").webURL.absoluteString == "https://mysetlists.net/stats/top-artists/")
        #expect(AppRoute.statsList(.venues, year: nil).webURL.absoluteString == "https://mysetlists.net/stats/top-venues/")
    }

    /// The wishlist (Stage 4, 4-9) is in Me's Library.
    @Test func theWishlistOpensNatively() {
        #expect(action("https://mysetlists.net/wishlist/") == .open(.me, .wishlist))
        #expect(AppRoute.wishlist.webURL.absoluteString == "https://mysetlists.net/wishlist/")
        #expect(AppRoute.wishlistArtist(WishlistArtist(name: "Goose", mbid: "m")).webURL.absoluteString == "https://mysetlists.net/wishlist/")
    }

    /// The bucket list (Stage 4, 4-10) is in Me's Library.
    @Test func theBucketListOpensNatively() {
        #expect(action("https://mysetlists.net/bucket-list/") == .open(.me, .bucketList))
        #expect(AppRoute.bucketList.webURL.absoluteString == "https://mysetlists.net/bucket-list/")
    }

    /// Community (Stage 4, 4-11) is on Stats.
    @Test func communityOpensNatively() {
        #expect(action("https://mysetlists.net/community/") == .open(.stats, .community))
        #expect(action("mysetlists://community") == .open(.stats, .community))
        #expect(AppRoute.community.webURL.absoluteString == "https://mysetlists.net/community/")
    }

    @Test func ourUnclaimedPagesStayOnTheWeb() {
        let reset = URL(string: "https://mysetlists.net/reset/abc123")!
        #expect(DeepLink.resolve(reset)?.action == .web(reset), "password reset is a web page")
        #expect(DeepLink.resolve(URL(string: "mysetlists://spotify-callback?code=x")!) == nil)
        #expect(DeepLink.resolve(URL(string: "https://example.com/shows/")!) == nil)
        #expect(DeepLink.resolve(URL(string: "com.googleusercontent.apps.x:/oauth2redirect")!) == nil)
    }

    @Test func referralIsKeptAndStripped() {
        let home = DeepLink.resolve(URL(string: "https://mysetlists.net/?ref=signed.tok")!)
        #expect(home == .init(action: .open(.shows, nil), referral: "signed.tok"))
        let show = DeepLink.resolve(URL(string: "https://mysetlists.net/shows/?show=a&ref=r1")!)
        #expect(show == .init(action: .open(.shows, .show(id: "a")), referral: "r1"))
        let web = DeepLink.resolve(URL(string: "https://mysetlists.net/roadmap/?ref=r2&x=1")!)
        #expect(web == .init(action: .web(URL(string: "https://mysetlists.net/roadmap/?x=1")!), referral: "r2"))
        #expect(DeepLink.resolve(URL(string: "https://mysetlists.net/?ref=")!)?.referral == nil)
    }

    @Test func decodeURIKeepsReservedEscapes() {
        #expect(DeepLink.decodeURI("/a%20b%2Fc%3A") == "/a b%2Fc%3A")
        #expect(DeepLink.decodeURI("/caf%C3%A9") == "/café")
        #expect(DeepLink.decodeURI("/bad%C3") == "/bad%C3", "invalid UTF-8 is left alone")
    }
}
