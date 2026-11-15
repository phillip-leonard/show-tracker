import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing
import Core

/// `SessionStore` against the Firebase Auth emulator, with the real SDK:
/// a guest, a guest upgrading to an email account (same uid), the
/// credential-in-use path (D-4) up to the server call, the error mapping,
/// and sign-out clearing Firestore's offline cache. Runs only when the emulator's address is passed in:
///
///   npm run test:native-auth-emulator
///
/// (firebase emulators:exec --only auth, then xcodebuild test with
/// TEST_RUNNER_FIREBASE_AUTH_EMULATOR_HOST in its environment.) Hosted in
/// the app (MySetlistsTests), not a package test: Firebase Auth needs the
/// app's keychain entitlement, and Messaging an app bundle.
///
/// Nothing reaches production: the API client points at an address that
/// refuses connections, and Firestore at an emulator that isn't running.
@MainActor
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["FIREBASE_AUTH_EMULATOR_HOST"] != nil))
struct AuthEmulatorTests {
    static let configured: Bool = MainActor.assumeIsolated {
        let host = ProcessInfo.processInfo.environment["FIREBASE_AUTH_EMULATOR_HOST"] ?? "127.0.0.1:9099"
        let parts = host.split(separator: ":")
        if FirebaseApp.app() == nil {
            let options = FirebaseOptions(googleAppID: "1:1234567890:ios:abcdef0123456789", gcmSenderID: "1234567890")
            options.apiKey = "AIzaSyFakeKeyForTheLocalEmulatorOnly000"
            options.projectID = "demo-native-auth"
            options.bundleID = "com.mysetlists.app"
            FirebaseApp.configure(options: options)
        }
        Auth.auth().useEmulator(withHost: String(parts[0]), port: Int(parts[1]) ?? 9099)
        // Persistent, like the app, so sign-out's cache clearing is real.
        let settings = FirestoreSettings()
        settings.host = "127.0.0.1:65530"
        settings.isSSLEnabled = false
        settings.cacheSettings = PersistentCacheSettings()
        Database.configure(settings)
        return true
    }

    let store: SessionStore

    init() async throws {
        _ = Self.configured
        // A dead address: account-linked, adopt-guest-shows and friends fail fast.
        store = SessionStore(api: APIClient(baseURL: URL(string: "http://127.0.0.1:9")!, tokens: FirebaseIDTokens()), appVersion: "4.0.2")
        store.start()
        try await waitFor { store.signedIn != nil }
        if store.signedIn == true { await store.signOut() }
        try await waitFor { store.signedIn == false }
    }

    func waitFor(_ condition: @MainActor () -> Bool, timeout: Duration = .seconds(10)) async throws {
        let deadline = ContinuousClock.now + timeout
        while !condition() {
            guard ContinuousClock.now < deadline else { throw CancellationError() }
            try await Task.sleep(for: .milliseconds(50))
        }
    }

    func newEmail() -> String { "native-\(UUID().uuidString.prefix(8).lowercased())@example.com" }

    @Test func nothingWithoutTheTermsTicked() async throws {
        store.termsTicked = false
        await #expect(throws: AuthFailure.self) { try await store.continueAsGuest() }
        #expect(store.signedIn == false)
    }

    @Test func aGuestUpgradesToEmailKeepingTheirUid() async throws {
        store.termsTicked = true
        try await store.continueAsGuest()
        try await waitFor { store.user?.isAnonymous == true }
        let guestUid = try #require(store.user?.uid)
        #expect(store.gate == .loading || store.gate == .termsRequired || store.gate == .ready, "no profile store here: never signed out")

        try await store.createAccount(email: newEmail(), password: "correct-horse-9")
        #expect(store.user?.uid == guestUid, "same account: every show stays")
        #expect(store.user?.isAnonymous == false)
        #expect(store.user?.providerIDs == ["password"])
        let token = try #require(try await Auth.auth().currentUser?.getIDTokenResult(forcingRefresh: true))
        #expect(token.signInProvider == "password", "the server sees an account at once (isAnonymous is false)")

        await store.signOut()
        try await waitFor { store.signedIn == false }
    }

    @Test func aGuestLinkingAnEmailThatHasAnAccountAdoptsIt() async throws {
        let email = newEmail()
        store.termsTicked = true
        try await store.createAccount(email: email, password: "correct-horse-9")
        try await waitFor { store.user?.isAnonymous == false }
        let accountUid = try #require(store.user?.uid)
        await store.signOut()
        try await waitFor { store.signedIn == false }

        store.termsTicked = true
        try await store.continueAsGuest()
        try await waitFor { store.user?.isAnonymous == true }
        let guestUid = try #require(store.user?.uid)

        await #expect(throws: AuthFailure.credentialInUse) { try await store.createAccount(email: email, password: "correct-horse-9") }
        let adoption = try #require(store.adoption)
        #expect(adoption.guestIdToken != nil, "kept before switching: the proof for adopt-guest-shows")
        #expect(store.user?.uid == guestUid, "still the guest until they agree")

        // Signs in to the existing account, then asks the server for the
        // preview, which fails here (no server): the sign-in has happened.
        await #expect(throws: AuthFailure.self) { try await store.startAdoption() }
        try await waitFor { store.user?.uid == accountUid }
        #expect(store.adoption == nil)

        await store.signOut()
        try await waitFor { store.signedIn == false }
    }

    @Test func wrongPasswordAndUsedEmailReadAsSuch() async throws {
        let email = newEmail()
        store.termsTicked = true
        try await store.createAccount(email: email, password: "correct-horse-9")
        try await waitFor { store.signedIn == true }
        await store.signOut()
        try await waitFor { store.signedIn == false }

        store.termsTicked = true
        await #expect(throws: AuthFailure.wrongCredentials) { try await store.signIn(email: email, password: "wrong-password") }
        await #expect(throws: AuthFailure.emailInUse) { try await store.createAccount(email: email, password: "correct-horse-9") }
        await #expect(throws: AuthFailure.weakPassword) { try await store.createAccount(email: newEmail(), password: "123") }
        #expect(store.signedIn == false)
    }

    /// Sign-out terminates Firestore, clears its persisted cache and starts a
    /// fresh instance in the same process, with the launch settings.
    @Test func signOutClearsTheOfflineCache() async throws {
        store.termsTicked = true
        try await store.continueAsGuest()
        try await waitFor { store.user?.isAnonymous == true }
        let uid = try #require(store.user?.uid)

        let before = await Database.ready()
        // The server address is dead, so this write lives only in the cache.
        let probe = before.document("cacheProbe/\(uid)")
        probe.setData(["guest": true], completion: { _ in })
        #expect(try await probe.getDocument(source: .cache).exists)

        let report = await store.signOut()
        #expect(report.first { $0.0 == "offline cache" }?.1 == .done, "\(report)")
        try await waitFor { store.signedIn == false }

        let after = await Database.ready()
        #expect(after !== before, "a new instance, in the same process")
        #expect(after.settings.host == "127.0.0.1:65530", "with the settings it launched with")
        #expect(after.settings.cacheSettings is PersistentCacheSettings)
        let leftover = try? await after.document("cacheProbe/\(uid)").getDocument(source: .cache)
        #expect(leftover?.exists != true, "the last session's data is gone from the cache")

        // And the fresh instance works: the next session can use it.
        after.document("cacheProbe/next").setData(["ok": true], completion: { _ in })
        #expect(try await after.document("cacheProbe/next").getDocument(source: .cache).exists)
    }
}
