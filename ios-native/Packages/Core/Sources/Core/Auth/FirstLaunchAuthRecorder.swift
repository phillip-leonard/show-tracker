import FirebaseAuth
import FirebaseCrashlytics
import Foundation
import os

/// Records `FirstLaunchAuthReport` once per install, from Firebase Auth's
/// first state callback (the state it restored from the keychain). Q-01:
/// docs/ios-native/Q01-SIGNIN-CARRYOVER.md.
///
/// The report goes three places, all without personal data:
/// - the system log (subsystem `com.mysetlists.app`, category `Q01`), for
///   Console.app with the phone connected;
/// - Crashlytics, as custom keys and one non-fatal in domain
///   `FirstLaunchAuthState` (code 1 signed in, 0 signed out), which Release
///   and TestFlight builds send;
/// - UserDefaults, shown in the hidden "First-launch sign-in" screen (tap the
///   version in Me five times).
@MainActor
public enum FirstLaunchAuthRecorder {
    private static var handle: AuthStateDidChangeListenerHandle?
    static let log = Logger(subsystem: "com.mysetlists.app", category: "Q01")

    /// Call right after `AppBootstrap.configureFirebase()`. Does nothing
    /// after the first launch.
    public static func start() {
        guard handle == nil, FirstLaunchAuth.stored() == nil else { return }
        // Read before anything else runs, though nothing in the native app
        // creates WebKit data.
        let overCapacitor = FirstLaunchAuth.containerHasWebKitData()
        handle = Auth.auth().addStateDidChangeListener { _, user in
            MainActor.assumeIsolated { record(user, installedOverCapacitor: overCapacitor) }
        }
    }

    private static func record(_ user: FirebaseAuth.User?, installedOverCapacitor: Bool) {
        guard let handle else { return }
        Auth.auth().removeStateDidChangeListener(handle)
        self.handle = nil

        var keychain = FirstLaunchAuthReport.Keychain.empty
        var errorCode: Int?
        do {
            keychain = try Auth.auth().getStoredUser(forAccessGroup: nil) == nil ? .empty : .user
        } catch {
            keychain = .unreadable
            let ns = error as NSError
            // Firebase wraps the keychain's OSStatus (e.g. -34018) as the underlying error.
            errorCode = (ns.userInfo[NSUnderlyingErrorKey] as? NSError)?.code ?? ns.code
        }

        let snapshot = user.map { AuthSnapshot(uid: $0.uid, isAnonymous: $0.isAnonymous, providerIDs: $0.providerData.map(\.providerID)) }
        let report = FirstLaunchAuth.report(user: snapshot, keychain: keychain, keychainErrorCode: errorCode,
                                            installedOverCapacitor: installedOverCapacitor, app: .current)
        guard let first = FirstLaunchAuth.storeIfFirst(report) else { return }

        log.notice("\(first.summary, privacy: .public)")

        let crashlytics = Crashlytics.crashlytics()
        crashlytics.setCustomValue(first.uidPresent, forKey: "first_launch_uid_present")
        crashlytics.setCustomValue(first.providers.joined(separator: ","), forKey: "first_launch_providers")
        crashlytics.setCustomValue(first.keychain.rawValue, forKey: "first_launch_keychain")
        crashlytics.setCustomValue(first.installedOverCapacitor, forKey: "first_launch_over_capacitor")
        crashlytics.log(first.summary)
        crashlytics.record(error: NSError(domain: "FirstLaunchAuthState", code: first.uidPresent ? 1 : 0, userInfo: [
            NSLocalizedDescriptionKey: first.summary,
        ]))
    }
}
