import Foundation
import Testing
@testable import Core

/// The inbox (Stage 3, Part 4): every type decodes, an unknown one too;
/// where each goes; the show-match key the server writes as `concertKey`.
struct NotificationsTests {
    private func note(_ json: String, id: String = "n1") throws -> AppNotification {
        var n = try JSONDecoder().decode(AppNotification.self, from: Data(json.utf8))
        n.id = id
        return n
    }

    // MARK: Decoding

    @Test func everyKindDecodes() throws {
        let reply = try note(#"{"uid":"me","type":"comment_reply","message":"Ben replied to your comment on Phish","concertKey":"phish|msg|2025-12-31","fromUid":"b","fromName":"Ben","read":false,"createdAt":"2026-11-16T10:00:00Z"}"#)
        #expect(reply.kind == .commentReply && reply.kind.isEngagement && !reply.read && reply.createdAt != nil)

        let tour = try note(#"{"type":"followed_band_tour","message":"Goose announced 12 new dates.","artist":"Goose","dates":[{"date":"2027-03-01","venue":"Red Rocks","city":"Morrison","url":"https://tm.example/1"},{"date":null,"venue":"X","city":null,"url":null}],"dateCount":12,"read":true}"#)
        #expect(tour.kind.isBandAlert && tour.dates.count == 2 && tour.dateCount == 12 && tour.dates[0].url == "https://tm.example/1")

        let onsale = try note(#"{"type":"onsale_alert","message":"Goose is going on sale…","artist":"Goose","windows":[{"label":"Presale","when":"Fri, Nov 21, 10:00 AM PST"}],"presaleCode":"GOOSE24","codeSource":"From Goose's newsletter","signupUrl":null,"portalUrl":"https://portal.example","url":"https://tm.example/e"}"#)
        #expect(onsale.windows.first?.label == "Presale" && onsale.presaleCode == "GOOSE24" && onsale.portalUrl != nil && !onsale.read)

        let anniversary = try note(#"{"type":"anniversary","message":"5 years ago today…","showId":"s1","concertKey":"k","read":false}"#)
        #expect(anniversary.kind == .anniversary && anniversary.showId == "s1")

        let roadmap = try note(#"{"type":"roadmap_published","message":"Your idea is on the roadmap","itemId":"r1","itemTitle":"Dark mode","read":false}"#)
        #expect(roadmap.kind == .roadmapPublished && roadmap.itemTitle == "Dark mode")
    }

    @Test func anUnknownTypeStillDecodesAndGoesNowhere() throws {
        let n = try note(#"{"type":"something_new","message":"Something new happened","read":false,"extra":{"nested":[1,2]}}"#)
        #expect(n.kind == .other)
        #expect(n.message == "Something new happened")
        #expect(NotificationDestination.of(n, myShows: []) == .none)
    }

    @Test func oddShapesDontBreakDecoding() throws {
        // No read flag (treated as unread), dates that aren't a list, a string count.
        let n = try note(#"{"type":"followed_band_tour","message":"m","dates":"oops","dateCount":"3","windows":null}"#)
        #expect(!n.read && n.dates.isEmpty && n.dateCount == nil && n.windows.isEmpty)
    }

    // MARK: The show key

    @Test func matchKeyIsTheServers() {
        #expect(ShowMatchKey.of(artist: " Phish ", venue: "Madison Square Garden", date: "2025-12-31", setlistfmId: nil)
                == "phish|madison square garden|2025-12-31")
        #expect(ShowMatchKey.of(artist: "Phish", venue: "MSG", date: "31-12-2025", setlistfmId: nil) == "phish|msg|2025-12-31",
                "setlist.fm's day-first date reads as ISO")
        #expect(ShowMatchKey.of(artist: "Phish", venue: "MSG", date: "2025-12-31", setlistfmId: "63de4613") == "63de4613")
        #expect(ShowMatchKey.of(artist: "A", venue: nil, date: "Sometime", setlistfmId: "") == "a||sometime")
    }

    // MARK: Destinations

    @Test func destinations() throws {
        let mine = [
            try ShowListTests.show("s1", "Phish", "2025-12-31", venue: "MSG"),
            try ShowListTests.show("s2", "Goose", "2025-08-10", venue: "The Capitol Theatre"),
        ]
        let like = try note(#"{"type":"comment_like","message":"m","concertKey":"phish|msg|2025-12-31"}"#)
        #expect(NotificationDestination.of(like, myShows: mine) == .web(URL(string: "https://mysetlists.net/shows/?show=s1")!),
                "comments are on the web (C-4)")
        let stray = try note(#"{"type":"photo_like","message":"m","concertKey":"nobody|nowhere|2020-01-01"}"#)
        #expect(NotificationDestination.of(stray, myShows: mine) == .none)

        let byId = try note(#"{"type":"anniversary","message":"m","showId":"s2","concertKey":"x"}"#)
        #expect(NotificationDestination.of(byId, myShows: mine) == .route(.shows, .show(id: "s2")))
        let byKey = try note(#"{"type":"anniversary","message":"m","concertKey":"goose|the capitol theatre|2025-08-10"}"#)
        #expect(NotificationDestination.of(byKey, myShows: mine) == .route(.shows, .show(id: "s2")))

        let venue = try note(#"{"type":"venue_bucket_list_match","message":"m","venueKey":"red rocks::morrison"}"#)
        #expect(NotificationDestination.of(venue, myShows: []) == .route(.shows, .venue(key: "red rocks::morrison")))

        let meetup = try note(#"{"type":"meetup_join","message":"m","concertKey":"Phish|MSG|2025-12-31"}"#)
        #expect(NotificationDestination.of(meetup, myShows: []) == .web(URL(string: "https://mysetlists.net/meetups/?id=phish_msg_2025_12_31")!))

        let tour = try note(#"{"type":"followed_band_tour","message":"m"}"#)
        #expect(NotificationDestination.of(tour, myShows: mine) == .none, "its dates carry the links")
        let roadmap = try note(#"{"type":"roadmap_published","message":"m"}"#)
        #expect(NotificationDestination.of(roadmap, myShows: []) == .web(URL(string: "https://mysetlists.net/roadmap/")!))
    }

    @Test func meetupIdIsTheWebs() {
        // meetupIdFor (lib/meetups.js): lowercased, runs of anything else one underscore, none at the ends.
        #expect(NotificationDestination.meetupId("--Phish | MSG | 2025-12-31!!") == "phish_msg_2025_12_31")
        #expect(NotificationDestination.meetupId("") == nil)
        #expect(NotificationDestination.meetupId("!!!") == nil)
    }

    // MARK: Lists

    @Test func newestFirstAndBandAlerts() throws {
        let a = try note(#"{"type":"comment_like","message":"a","createdAt":"2026-11-01T00:00:00Z"}"#, id: "a")
        let b = try note(#"{"type":"onsale_alert","message":"b","createdAt":"2026-11-10T00:00:00Z"}"#, id: "b")
        let pending = try note(#"{"type":"venue_bucket_list_match","message":"c"}"#, id: "c")
        #expect(NotificationLists.sorted([a, b, pending]).map(\.id) == ["c", "b", "a"], "one still waiting for its server time goes first")
        #expect(NotificationLists.bandAlerts([a, b, pending]).map(\.id) == ["b", "c"])
    }

    @Test func theInboxLinkOpensTheInbox() {
        #expect(DeepLink.resolve(URL(string: "https://mysetlists.net/notifications/")!)?.action == .open(.friends, .notifications))
        #expect(AppRoute.notifications.webURL.absoluteString == "https://mysetlists.net/notifications/")
    }
}
