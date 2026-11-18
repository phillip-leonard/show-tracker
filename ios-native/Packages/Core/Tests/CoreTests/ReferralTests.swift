import Foundation
import Testing
@testable import Core

/// Referral attribution (D-6, Stage 3): a `/?ref=` link is kept from the
/// moment it opens the app until the server has credited it, and a failed
/// attempt is retried instead of lost.
@MainActor
@Suite(.serialized)
struct ReferralTests {
    init() {
        let suite = UserDefaults(suiteName: "ReferralTests")!
        suite.removePersistentDomain(forName: "ReferralTests")
        Referral.defaults = suite
    }

    @Test func aLinkOpenedSignedOutIsKept() throws {
        // What AppRouter.handle does with a link at launch.
        let resolved = try #require(DeepLink.resolve(URL(string: "https://mysetlists.net/?ref=uidBen.sig123")!))
        let ref = try #require(resolved.referral)
        Referral.remember(ref)
        #expect(Referral.pending == "uidBen.sig123")
        // The custom scheme carries it too.
        #expect(DeepLink.resolve(URL(string: "mysetlists:///?ref=uidCal.sig9")!)?.referral == "uidCal.sig9")
    }

    @Test func aNewerLinkReplacesAnOlderOneAndBlanksAreIgnored() {
        Referral.remember("old.sig")
        Referral.remember("new.sig")
        Referral.remember("   ")
        #expect(Referral.pending == "new.sig")
        Referral.remember(String(repeating: "x", count: 3000))
        #expect(Referral.pending?.count == 2000)
    }

    @Test func creditedOnceThenForgotten() async {
        Referral.remember("uidBen.sig")
        var sent: [String] = []
        let used = await Referral.use { (ref: String) throws(APIError) in sent.append(ref) }
        #expect(used && sent == ["uidBen.sig"])
        #expect(Referral.pending == nil)
        // Nothing left to send on the next sign-in.
        #expect(await Referral.use { (_: String) throws(APIError) in Issue.record("sent twice") } == false)
    }

    @Test func offlineOrAServerErrorKeepsItForTheNextTry() async {
        Referral.remember("uidBen.sig")
        for failure: APIError in [.offline, .server(status: 502, message: nil, code: nil), .rateLimited(message: nil, retryAfter: nil),
                                  .signInRequired(message: nil), .accountRequired(message: nil)] {
            await Referral.use { (_: String) throws(APIError) in throw failure }
            #expect(Referral.pending == "uidBen.sig", "\(failure)")
        }
        // The next launch's sign-in sends it again, and then it's gone.
        var sent = 0
        await Referral.use { (_: String) throws(APIError) in sent += 1 }
        #expect(sent == 1 && Referral.pending == nil)
    }

    @Test func aRefusedLinkIsDropped() async {
        // A link the server won't take (malformed, 4xx) won't ever succeed.
        for failure: APIError in [.server(status: 400, message: "bad", code: nil), .forbidden(message: nil, code: nil), .invalidResponse("x")] {
            Referral.remember("bad.link")
            await Referral.use { (_: String) throws(APIError) in throw failure }
            #expect(Referral.pending == nil, "\(failure)")
        }
    }

    @Test func aNewerLinkOpenedDuringASendSurvivesIt() async {
        Referral.remember("first.sig")
        await Referral.use { (_: String) throws(APIError) in
            Referral.remember("second.sig") // opened while the first was on its way
        }
        #expect(Referral.pending == "second.sig")
    }

    @Test func theUpgradeCarriesItToAccountLinked() throws {
        // A guest's upgrade sends the kept referral in account-linked's body.
        Referral.remember("uidBen.sig")
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(AccountLinkedRequest(ref: Referral.pending))) as? NSDictionary
        #expect(body == ["ref": "uidBen.sig"])
        #expect(try JSONSerialization.jsonObject(with: JSONEncoder().encode(FriendsRequest.referral(ref: "uidBen.sig"))) as? NSDictionary
                == ["action": "referral", "ref": "uidBen.sig"])
    }
}
