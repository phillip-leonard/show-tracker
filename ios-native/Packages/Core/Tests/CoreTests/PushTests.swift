import Foundation
import Testing
import UserNotifications
@testable import Core

/// Push (Stage 3, Part 5): what a push carries, the token document the
/// rules allow, who counts as allowing push, and the test-push body.
@MainActor
struct PushTests {
    @Test func aPushCarriesItsLinkAndNotification() {
        // lib/pushDelivery.js fcmMessage: data { link, notificationId } at the top of userInfo.
        let info: [AnyHashable: Any] = ["link": "https://mysetlists.net/shows/?show=s1", "notificationId": "anniversary_u_s1_2026",
                                        "aps": ["alert": ["title": "t", "body": "b"]]]
        #expect(PushPayload.link(info) == "https://mysetlists.net/shows/?show=s1")
        #expect(PushPayload.notificationId(info) == "anniversary_u_s1_2026")
        // A test push sends an empty notificationId; a push from elsewhere may have no link.
        #expect(PushPayload.notificationId(["notificationId": ""]) == nil)
        #expect(PushPayload.link(["aps": [:]]) == nil)
    }

    @Test func aPushLinkRoutesLikeAnyLink() {
        let url = URL(string: PushPayload.link(["link": "https://mysetlists.net/shows/?show=s1"])!)!
        #expect(DeepLink.resolve(url)?.action == .open(.shows, .show(id: "s1")))
    }

    @Test func theTokenDocumentHasOnlyWhatTheRulesAllow() {
        // firestore.rules pushTokens: keys().hasOnly(['userId', 'platform', 'updatedAt']).
        let fields = PushTokenDocument.fields(uid: "u1")
        #expect(Set(fields.keys) == ["userId", "platform", "updatedAt"])
        #expect(fields["userId"] as? String == "u1")
        #expect(fields["platform"] as? String == "ios")
    }

    @Test func whoAllowsPush() {
        #expect(PushCenter.allowed(.authorized))
        #expect(PushCenter.allowed(.provisional))
        #expect(PushCenter.allowed(.ephemeral))
        #expect(!PushCenter.allowed(.denied))
        #expect(!PushCenter.allowed(.notDetermined))
    }

    @Test func noAskingWhileTheOfferIsOff() async {
        // iosPushOfferEnabled off: nothing is asked, so no system prompt.
        #expect(await PushCenter.shared.requestPermission(offerEnabled: false) == false)
    }

    @Test func testPushBody() throws {
        let data = try JSONEncoder().encode(SendTestPushRequest(link: "/notifications/"))
        #expect(try JSONSerialization.jsonObject(with: data) as? NSDictionary == ["link": "/notifications/"])
        let r = try JSONDecoder().decode(SendTestPushResponse.self, from: Data(#"{"devices":2,"reached":true,"dead":1}"#.utf8))
        #expect(r.devices == 2 && r.reached && r.dead == 1)
    }
}
