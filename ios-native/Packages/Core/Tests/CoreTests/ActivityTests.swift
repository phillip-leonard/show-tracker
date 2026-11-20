import Foundation
import Testing
@testable import Core

/// The friend activity feed (Stage 6, 6-6): friends.js `activity`'s answer,
/// the rows' words, the filters and paging.
struct ActivityTests {
    static func page(_ json: String) throws -> ActivityPage {
        try JSONDecoder().decode(ActivityPage.self, from: Data(json.utf8))
    }

    static func item(_ id: String, by uid: String = "ben", _ action: ActivityItem.Action = .addedShow, at seconds: TimeInterval = 0) -> ActivityItem {
        ActivityItem(id: id, userId: uid, userName: "Ben", action: action, artist: "Phish", timestamp: Date(timeIntervalSince1970: seconds))
    }

    @Test func decodesTheServersPage() throws {
        let page = try Self.page(#"""
        {"items":[
          {"id":"a1","userId":"ben","userName":"Ben Friend","action":"rated_show","showId":"s1","artist":"Phish","venue":"MSG","rating":9,"handle":"benf","timestamp":1795131311227},
          {"id":"a2","userId":"cam","userName":"  ","action":"shared_media","showId":null,"artist":"Goose","venue":null,"mediaCategory":"poster","handle":null,"timestamp":1795131000000},
          {"id":"a3","userId":"dee","userName":"Dee","action":"went_backstage","artist":"Phish","timestamp":1795130000000}
        ],"next":1795130000000}
        """#)
        #expect(page.items.map(\.id) == ["a1", "a2"], "an action this build doesn't know is skipped, not the page")
        #expect(page.next == 1_795_130_000_000)
        let rated = page.items[0]
        #expect(rated.action == .ratedShow && rated.rating == 9 && rated.handle == "benf")
        #expect(rated.timestamp == Date(timeIntervalSince1970: 1_795_131_311.227))
        #expect(page.items[1].userName == "A friend", "a blank name reads as the server's fallback")
    }

    @Test func aLastPageHasNoNext() throws {
        #expect(try Self.page(#"{"items":[],"next":null}"#).next == nil)
    }

    @Test func rowsSayWhatTheWebSays() {
        var item = Self.item("x")
        item.venue = "Madison Square Garden"
        #expect(item.summary == "added Phish at Madison Square Garden")
        item.venue = nil
        #expect(item.summary == "added Phish")
        item.action = .ratedShow; item.rating = 9
        #expect(item.summary == "rated Phish 9/10")
        item.rating = 8.5
        #expect(item.summary == "rated Phish 8.5/10")
        item.action = .commented
        #expect(item.summary == "commented on Phish")
        item.action = .sharedMedia
        for (category, noun) in [("photo", "a photo"), ("poster", "a poster"), ("setlist", "a setlist photo"), (nil, "a photo")] as [(String?, String)] {
            item.mediaCategory = category
            #expect(item.summary == "shared \(noun) from Phish")
        }
    }

    @Test func publicShowPageOnlyWithAHandle() {
        var item = Self.item("x")
        item.showId = "s1"
        #expect(item.publicShowURL == nil)
        item.handle = "BenF"
        #expect(item.publicShowURL?.absoluteString == "https://mysetlists.net/u/benf/shows/s1/")
        item.showId = nil
        #expect(item.publicShowURL == nil)
    }

    @Test func filtersAndBlocks() {
        let items = [Self.item("a", .addedShow), Self.item("b", .ratedShow), Self.item("c", by: "rude", .commented),
                     Self.item("d", .commented), Self.item("e", .sharedMedia)]
        #expect(ActivityFeed.visible(items, hiding: ["rude"]).map(\.id) == ["a", "b", "d", "e"])
        #expect(ActivityFeed.visible(items, hiding: [], filter: .comments).map(\.id) == ["c", "d"])
        #expect(ActivityFeed.visible(items, hiding: [], filter: .ratings).map(\.id) == ["b"])
        #expect(ActivityFeed.visible(items, hiding: [], filter: .photos).map(\.id) == ["e"])
        #expect(ActivityFilter.allCases.map(\.label) == ["All", "Shows", "Ratings", "Comments", "Photos"])
    }

    @Test func anOlderPageAddsWithoutRepeats() {
        let shown = [Self.item("a", at: 30), Self.item("b", at: 20)]
        let older = [Self.item("b", at: 20), Self.item("c", at: 10)]
        #expect(ActivityFeed.appending(older, to: shown).map(\.id) == ["a", "b", "c"])
    }

    @Test func shareActivityIsOneField() {
        #expect(ProfileSettings.Field.shareActivity(false).data as NSDictionary == ["shareActivity": false])
    }
}
