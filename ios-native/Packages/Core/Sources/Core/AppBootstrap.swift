import FirebaseAuth
import FirebaseCore
import FirebaseCrashlytics
import FirebaseFirestore
import FirebaseStorage

/// Starts Firebase once, at launch, before anything else touches it.
///
/// Reads `GoogleService-Info.plist` from the app bundle: the same iOS
/// Firebase app (and bundle ID) as the Capacitor app, so an existing
/// Firebase Auth session in the keychain can carry over (Q-01).
public enum AppBootstrap {
    /// Call from `application(_:didFinishLaunchingWithOptions:)`.
    @MainActor
    public static func configureFirebase() {
        guard FirebaseApp.app() == nil else { return }
        FirebaseApp.configure()

        // Offline persistence is on in the native app (the web keeps it off):
        // the shows list works on a plane, and writes queue until online.
        // Sign-out clears that cache and starts a fresh instance with these
        // same settings (`Database`).
        let settings = FirestoreSettings()
        settings.cacheSettings = PersistentCacheSettings()
        #if DEBUG
        useLocalEmulators(settings)
        #endif
        Database.configure(settings)

        // Crash reports from release builds only: a crash while developing
        // is in front of you already.
        #if DEBUG
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(false)
        #else
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(true)
        #endif
    }

    #if DEBUG
    /// Debug builds only: with `MYSETLISTS_EMULATORS=<host>` in the launch
    /// environment, Auth uses the emulator at `<host>:9099`, Firestore the
    /// one at `<host>:8080` and Storage the one at `<host>:9199`
    /// (firebase.json's ports). With no Firestore
    /// emulator running, Firestore just stays offline, so nothing touches
    /// production. For trying sign-in, guests and the shell without real
    /// accounts:
    ///
    ///   npx firebase emulators:start --only auth --project demo-native-auth
    ///   SIMCTL_CHILD_MYSETLISTS_EMULATORS=127.0.0.1 xcrun simctl launch booted com.mysetlists.app
    private static func useLocalEmulators(_ settings: FirestoreSettings) {
        guard let host = ProcessInfo.processInfo.environment["MYSETLISTS_EMULATORS"], !host.isEmpty else { return }
        Auth.auth().useEmulator(withHost: host, port: 9099)
        settings.host = "\(host):8080"
        settings.isSSLEnabled = false
        Storage.storage().useEmulator(withHost: host, port: 9199)
        MediaURLs.emulatorHost = host
    }
    #endif
}
