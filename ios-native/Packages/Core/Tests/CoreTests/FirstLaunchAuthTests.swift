import Foundation
import Testing
@testable import Core

/// Q-01's first-launch report: what it records, what it never records, and
/// that it's kept once.
@Suite struct FirstLaunchAuthTests {
    let app = AppInfo(version: "4.0.5", build: "140")
    let at = Date(timeIntervalSince1970: 1_800_000_000)

    func defaults() -> UserDefaults {
        let name = "FirstLaunchAuthTests-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: name)!
        d.removePersistentDomain(forName: name)
        return d
    }

    @Test func aCarriedOverGoogleSession() {
        let user = AuthSnapshot(uid: "Xy12SecretUid", isAnonymous: false, providerIDs: ["google.com"])
        let r = FirstLaunchAuth.report(user: user, keychain: .user, keychainErrorCode: nil, installedOverCapacitor: true, app: app, at: at)
        #expect(r.uidPresent && !r.isAnonymous)
        #expect(r.providers == ["google.com"])
        #expect(r.summary == "first launch 4.0.5 (140): signed in (google.com); keychain user; over the Capacitor app")
    }

    @Test func nothingCarriedOver() {
        let r = FirstLaunchAuth.report(user: nil, keychain: .empty, keychainErrorCode: nil, installedOverCapacitor: true, app: app, at: at)
        #expect(!r.uidPresent && r.providers.isEmpty)
        #expect(r.summary == "first launch 4.0.5 (140): signed out; keychain empty; over the Capacitor app")
    }

    @Test func anUnreadableKeychainKeepsItsCode() {
        let r = FirstLaunchAuth.report(user: nil, keychain: .unreadable, keychainErrorCode: -34018, installedOverCapacitor: false, app: app, at: at)
        #expect(r.keychainErrorCode == -34018)
        #expect(r.summary == "first launch 4.0.5 (140): signed out; keychain unreadable -34018; fresh install")
        let readable = FirstLaunchAuth.report(user: nil, keychain: .empty, keychainErrorCode: -34018, installedOverCapacitor: false, app: app, at: at)
        #expect(readable.keychainErrorCode == nil, "a code only means something when the keychain was unreadable")
    }

    @Test func providersAreSortedAndUnique() {
        let user = AuthSnapshot(uid: "u", isAnonymous: false, providerIDs: ["password", "apple.com", "password"])
        let r = FirstLaunchAuth.report(user: user, keychain: .user, keychainErrorCode: nil, installedOverCapacitor: true, app: app, at: at)
        #expect(r.providers == ["apple.com", "password"])
        #expect(r.summary.contains("signed in (apple.com+password)"))
    }

    @Test func aGuest() {
        let r = FirstLaunchAuth.report(user: AuthSnapshot(uid: "g", isAnonymous: true, providerIDs: []), keychain: .user,
                                       keychainErrorCode: nil, installedOverCapacitor: false, app: app, at: at)
        #expect(r.summary.contains("signed in (anonymous)"))
    }

    /// The uid never leaves the snapshot: not in the stored JSON, not in the
    /// summary that goes to the log and Crashlytics.
    @Test func noPersonalData() throws {
        let uid = "Xy12SecretUid"
        let user = AuthSnapshot(uid: uid, isAnonymous: false, providerIDs: ["password"])
        let r = FirstLaunchAuth.report(user: user, keychain: .user, keychainErrorCode: nil, installedOverCapacitor: true, app: app, at: at)
        let json = String(decoding: try JSONEncoder().encode(r), as: UTF8.self)
        #expect(!json.contains(uid))
        #expect(!r.summary.contains(uid))
        let keys = Set((try JSONSerialization.jsonObject(with: JSONEncoder().encode(r)) as? [String: Any] ?? [:]).keys)
        #expect(keys == ["appVersion", "build", "recordedAt", "uidPresent", "isAnonymous", "providers", "keychain", "installedOverCapacitor"],
                "a new field needs a look for personal data (keychainErrorCode is omitted when nil)")
    }

    @Test func keptOnTheFirstLaunchOnly() {
        let d = defaults()
        #expect(FirstLaunchAuth.stored(in: d) == nil)
        let first = FirstLaunchAuth.report(user: nil, keychain: .empty, keychainErrorCode: nil, installedOverCapacitor: true, app: app, at: at)
        #expect(FirstLaunchAuth.storeIfFirst(first, in: d) == first)
        let later = FirstLaunchAuth.report(user: AuthSnapshot(uid: "u", isAnonymous: false, providerIDs: ["google.com"]), keychain: .user,
                                           keychainErrorCode: nil, installedOverCapacitor: true, app: app, at: at.addingTimeInterval(60))
        #expect(FirstLaunchAuth.storeIfFirst(later, in: d) == nil, "a later launch doesn't overwrite it")
        #expect(FirstLaunchAuth.stored(in: d) == first)
    }
}
