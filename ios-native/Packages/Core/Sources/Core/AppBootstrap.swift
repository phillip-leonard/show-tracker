import FirebaseCore
import FirebaseCrashlytics
import FirebaseFirestore

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
        let settings = Firestore.firestore().settings
        settings.cacheSettings = PersistentCacheSettings()
        Firestore.firestore().settings = settings

        // Crash reports from release builds only: a crash while developing
        // is in front of you already.
        #if DEBUG
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(false)
        #else
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(true)
        #endif
    }
}
