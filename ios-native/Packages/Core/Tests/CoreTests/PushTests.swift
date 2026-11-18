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

    // MARK: Registration (4.0.24: "Registered token: None yet", silently)

    @Test func eachStepSaysWhereItStands() {
        var r = PushRegistration()
        #expect(r.apnsStatus == "No: not asked")
        r.apnsRequested(at: Date())
        #expect(r.apnsStatus == "No: asked, no answer yet")
        #expect(!r.apnsReceived, "no FCM token is asked for before APNs answers")
        r.apnsRegistered(at: Date())
        #expect(r.apnsReceived && r.apnsStatus == "Yes")
        r.fcmArrived("fcm-token-abc123")
        #expect(r.fcmToken == "fcm-token-abc123" && r.fcmError == nil)
    }

    @Test func aFailureIsKeptWithItsDomainAndCode() throws {
        // What iOS gives a build signed without the push entitlement.
        let refused = NSError(domain: NSCocoaErrorDomain, code: 3000, userInfo: [
            NSLocalizedDescriptionKey: "no valid \u{201C}aps-environment\u{201D} entitlement string found for application"])
        var r = PushRegistration()
        r.apnsRequested(at: Date())
        r.apnsFailed(refused)
        #expect(r.apnsStatus == "No: iOS refused")
        let error = try #require(r.apnsError)
        #expect(error.hasSuffix("(NSCocoaErrorDomain 3000)"))
        #expect(PushRegistration.hint(forAPNsError: error)?.contains("entitlement") == true)

        // FCM's failure is its own line; a later success clears it.
        r.fcmFailed(NSError(domain: "com.google.fcm", code: 505, userInfo: [NSLocalizedDescriptionKey: "No APNS token specified"]))
        #expect(r.fcmError == "No APNS token specified (com.google.fcm 505)")
        r.apnsRegistered(at: Date())
        r.fcmArrived("t")
        #expect(r.apnsError == nil && r.fcmError == nil)
    }

    @Test func registerAgainStartsAfreshAndSignOutForgetsTheToken() {
        var r = PushRegistration()
        r.apnsFailed(NSError(domain: NSCocoaErrorDomain, code: 3010))
        r.fcmFailed(NSError(domain: "com.google.fcm", code: 1))
        #expect(PushRegistration.hint(forAPNsError: r.apnsError!) != nil)
        r.clearErrors()
        #expect(r.apnsError == nil && r.fcmError == nil)
        r.fcmArrived("t")
        r.fcmForgotten()
        #expect(r.fcmToken == nil)
        #expect(PushRegistration.hint(forAPNsError: "The request timed out. (NSURLErrorDomain -1001)") == nil)
    }

    @Test func testPushBody() throws {
        let data = try JSONEncoder().encode(SendTestPushRequest(link: "/notifications/"))
        #expect(try JSONSerialization.jsonObject(with: data) as? NSDictionary == ["link": "/notifications/"])
        let r = try JSONDecoder().decode(SendTestPushResponse.self, from: Data(#"{"devices":2,"reached":true,"dead":1}"#.utf8))
        #expect(r.devices == 2 && r.reached && r.dead == 1)
    }
}
