import Foundation
import Testing
@testable import Core

@Suite struct AppVersionTests {
    struct Table: Decodable {
        let compare: [Row]
        let status: [StatusRow]
        struct Row: Decodable {
            let a: String, b: String, expected: Int?
            init(from decoder: Decoder) throws {
                var c = try decoder.unkeyedContainer()
                a = try c.decode(String.self); b = try c.decode(String.self); expected = try c.decodeNil() ? nil : c.decode(Int.self)
            }
        }
        struct StatusRow: Decodable { let current: String?; let min: String?; let latest: String?; let expected: String }
    }

    /// fixtures/app-version/version-status.json, the table lib/appVersion.js runs too.
    @Test func sharedTable() throws {
        let table = try JSONDecoder().decode(Table.self, from: FixtureLoader.data("app-version/version-status.json"))
        for r in table.compare { #expect(AppVersion.compare(r.a, r.b) == r.expected, "compare(\(r.a), \(r.b))") }
        for r in table.status {
            #expect(AppVersion.status(current: r.current, min: r.min, latest: r.latest).rawValue == r.expected, "status(\(r.current ?? "nil"), \(r.min ?? "nil"), \(r.latest ?? "nil"))")
        }
    }
}

@Suite struct AccountGateTests {
    func gate(_ signedIn: Bool?, _ profile: AccountGate.ProfileState, accepted: Bool = false, version: AppVersion.Status = .ok) -> AccountGate {
        AccountGate.compute(signedIn: signedIn, profile: profile, acceptedOnThisDevice: accepted, version: version)
    }

    @Test func updateRequiredCoversEverything() {
        #expect(gate(nil, .unknown, version: .blocked) == .updateRequired)
        #expect(gate(false, .unknown, version: .blocked) == .updateRequired)
        #expect(gate(true, .loaded(banned: true, termsAcceptedVersion: nil), version: .blocked) == .updateRequired)
        #expect(gate(true, .loaded(banned: false, termsAcceptedVersion: 1), version: .update) == .ready, "a banner, not a gate")
    }

    @Test func neverAGateBeforeTheProfileIsRead() {
        #expect(gate(nil, .unknown) == .loading)
        #expect(gate(true, .unknown) == .loading, "an accepted account never sees the terms gate flash")
        #expect(gate(false, .unknown) == .signedOut)
    }

    @Test func suspendedComesBeforeTheTerms() {
        #expect(gate(true, .loaded(banned: true, termsAcceptedVersion: nil)) == .suspended)
        #expect(gate(true, .loaded(banned: true, termsAcceptedVersion: 1)) == .suspended)
    }

    @Test func termsAcceptedHereOrOnTheProfile() {
        #expect(gate(true, .loaded(banned: false, termsAcceptedVersion: nil)) == .termsRequired)
        #expect(gate(true, .loaded(banned: false, termsAcceptedVersion: 0)) == .termsRequired)
        #expect(gate(true, .loaded(banned: false, termsAcceptedVersion: Terms.version)) == .ready)
        #expect(gate(true, .loaded(banned: false, termsAcceptedVersion: nil), accepted: true) == .ready)
        #expect(gate(true, .missing) == .termsRequired, "a brand-new account that didn't tick here")
        #expect(gate(true, .missing, accepted: true) == .ready)
        #expect(gate(true, .unreadable) == .termsRequired, "fails closed for the terms")
    }
}

@Suite struct SignOutRunnerTests {
    actor Log { var names: [String] = []; func add(_ n: String) { names.append(n) } }

    @Test func everyStepRunsInOrderWhateverEarlierOnesDo() async {
        let log = Log()
        let runner = SignOutRunner(timeout: .milliseconds(200))
        let start = ContinuousClock.now
        let report = await runner.run([
            .init("push token") { await log.add("push"); try await Task.sleep(for: .seconds(30)) }, // hangs
            .init("firebase") { await log.add("firebase"); throw URLError(.notConnectedToInternet) }, // throws
            .init("google") { await log.add("google") },
            .init("local") { await log.add("local") },
        ])
        #expect(await log.names == ["push", "firebase", "google", "local"])
        #expect(report.map(\.0) == ["push token", "firebase", "google", "local"])
        #expect(report[0].1 == .timedOut)
        if case .failed = report[1].1 {} else { Issue.record("a throwing step is reported, not fatal") }
        #expect(report[2].1 == .done && report[3].1 == .done)
        #expect(ContinuousClock.now - start < .seconds(2), "a hang costs the timeout, never more")
    }
}

@Suite struct AppleNonceTests {
    @Test func sha256IsLowercaseHex() {
        #expect(AppleNonce.sha256("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    @Test func randomNoncesDiffer() {
        let a = AppleNonce.random(), b = AppleNonce.random()
        #expect(a.count == 32 && a != b)
    }

    @Test func jwtSubject() {
        // header.{"sub":"001234.abcd","iss":"https://appleid.apple.com"}.sig
        let payload = Data(#"{"sub":"001234.abcd","iss":"https://appleid.apple.com"}"#.utf8).base64EncodedString()
            .replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        #expect(AppleNonce.jwtSubject("eyJhbGciOiJSUzI1NiJ9.\(payload).sig") == "001234.abcd")
        #expect(AppleNonce.jwtSubject("not a jwt") == nil)
    }
}

@Suite struct APIErrorTests {
    @Test func messagesForPeople() {
        #expect(APIError.offline.message != nil)
        #expect(APIError.accountRequired(message: "Create an account to add friends.").message == "Create an account to add friends.")
    }
}

@Suite struct SignOutPromptTests {
    @Test func aGuestIsAlwaysAsked() {
        #expect(SignOutPrompt.decide(isGuest: true, hasUnsyncedWrites: false) == .guestLosesEverything)
        #expect(SignOutPrompt.decide(isGuest: true, hasUnsyncedWrites: true) == .guestLosesEverything)
    }

    @Test func anAccountIsAskedOnlyWithUnsyncedWrites() {
        #expect(SignOutPrompt.decide(isGuest: false, hasUnsyncedWrites: false) == .signOut)
        #expect(SignOutPrompt.decide(isGuest: false, hasUnsyncedWrites: true) == .unsyncedChanges)
    }

    @Test func syncedWhenTheWaitFinishesInTime() async {
        #expect(await UnsyncedWrites.exist(within: .milliseconds(200)) {} == false)
    }

    @Test func unsyncedWhenTheWaitDoesNot() async {
        let start = ContinuousClock.now
        #expect(await UnsyncedWrites.exist(within: .milliseconds(200)) { try await Task.sleep(for: .seconds(30)) } == true)
        #expect(ContinuousClock.now - start < .seconds(2), "answers at the limit, never waits for the sync")
    }

    @Test func aFailedWaitIsNotAWarning() async {
        struct UserChanged: Error {}
        #expect(await UnsyncedWrites.exist(within: .milliseconds(200)) { throw UserChanged() } == false)
    }
}

/// The terms version this phone has seen an account accept.
@Suite struct TermsAcceptanceRecordTests {
    func record() -> TermsAcceptanceRecord {
        let name = "TermsAcceptanceRecordTests.\(UUID().uuidString)"
        return TermsAcceptanceRecord(defaults: UserDefaults(suiteName: name)!)
    }

    @Test func perAccountAndCurrentVersionOnly() {
        let r = record()
        #expect(!r.hasAcceptedCurrent(uid: "a"))
        r.record(Terms.version, uid: "a")
        #expect(r.hasAcceptedCurrent(uid: "a"))
        #expect(!r.hasAcceptedCurrent(uid: "b"), "another account on this phone isn't let through")
        r.record(Terms.version - 1, uid: "b")
        #expect(!r.hasAcceptedCurrent(uid: "b"), "an older version doesn't count after a terms bump")
    }

    @Test func neverLowersAndForgets() {
        let r = record()
        r.record(Terms.version, uid: "a")
        r.record(Terms.version - 1, uid: "a")
        #expect(r.version(uid: "a") == Terms.version)
        r.forget(uid: "a")
        #expect(r.version(uid: "a") == nil)
    }

    @Test func aRecordedAcceptanceOpensTheGateWhateverTheProfileSays() {
        // SessionStore passes the record in as acceptance on this phone.
        for profile: AccountGate.ProfileState in [.missing, .unreadable, .loaded(banned: false, termsAcceptedVersion: nil)] {
            #expect(AccountGate.compute(signedIn: true, profile: profile, acceptedOnThisDevice: true, version: .ok) == .ready)
        }
        #expect(AccountGate.compute(signedIn: true, profile: .loaded(banned: true, termsAcceptedVersion: nil), acceptedOnThisDevice: true, version: .ok)
                == .suspended, "suspension still comes first")
    }
}
