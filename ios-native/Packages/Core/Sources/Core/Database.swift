import FirebaseCrashlytics
import FirebaseFirestore
import Foundation

/// The one way the app reaches Firestore.
///
/// Sign-out clears Firestore's offline cache (docs/ios-native/DECISIONS.md,
/// "Data export and the offline cache"), so the next person on the device
/// never sees the last one's shows: terminate the instance, delete its
/// persisted data with `clearPersistence()`, then start a fresh instance
/// with the same settings.
///
/// Terminating removes the instance from Firebase's registry
/// (`FIRFirestore terminateWithCompletion` → `removeInstanceWithDatabase`),
/// so the next `Firestore.firestore()` builds a new one in the same process.
/// `MySetlistsTests` checks that on a real SDK.
///
/// Every read goes through `ready()`, which waits for a reset in flight.
/// Without that, a sign-in during the reset could start the new instance
/// with default settings before they're applied, and setting them on a
/// started instance raises an exception Swift can't catch.
@MainActor
public enum Database {
    private static var settings: FirestoreSettings?
    private static var resetting: Task<CacheReset, Never>?

    /// What a reset did, for the sign-out report and the tests.
    public struct CacheReset: Equatable, Sendable {
        public var terminated = false
        public var cleared = false
        /// A different instance from the one that was terminated.
        public var freshInstance = false
        public var failure: String?
    }

    /// Once, at launch (`AppBootstrap`) or by a test host, before any read.
    public static func configure(_ settings: FirestoreSettings) {
        self.settings = settings.copy() as? FirestoreSettings
        Firestore.firestore().settings = settings
    }

    /// The current instance, once any cache reset in flight has finished.
    public static func ready() async -> Firestore {
        if let resetting { _ = await resetting.value }
        return Firestore.firestore()
    }

    /// Writes the server hasn't acknowledged yet (`UnsyncedWrites`), on the
    /// current instance.
    public static func hasUnsyncedWrites(within limit: Duration = UnsyncedWrites.defaultLimit) async -> Bool {
        await UnsyncedWrites.exist(within: limit) { @MainActor in
            try await ready().waitForPendingWrites()
        }
    }

    /// Terminate, clear the persisted cache, start a fresh instance with the
    /// launch settings. Pending writes that haven't reached the server are
    /// dropped with the cache (sign-out waits for them first, bounded).
    /// A second call while one is running waits for it.
    @discardableResult
    public static func clearCache() async -> CacheReset {
        if let resetting { return await resetting.value }
        let old = Firestore.firestore()
        let task = Task { @MainActor () -> CacheReset in
            var outcome = CacheReset()
            do {
                try await old.terminate()
                outcome.terminated = true
                try await old.clearPersistence()
                outcome.cleared = true
            } catch {
                outcome.failure = "\(error)"
            }
            let fresh = Firestore.firestore()
            outcome.freshInstance = fresh !== old
            // Only a new, unstarted instance takes settings: on the old one
            // (terminate failed) it would throw.
            if outcome.freshInstance, let settings { fresh.settings = settings }
            if !outcome.cleared || !outcome.freshInstance {
                Crashlytics.crashlytics().record(error: NSError(domain: "Database.clearCache", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "Offline cache not cleared on sign-out",
                    "terminated": outcome.terminated, "cleared": outcome.cleared,
                    "freshInstance": outcome.freshInstance, "failure": outcome.failure ?? "",
                ]))
            }
            return outcome
        }
        resetting = task
        let outcome = await task.value
        resetting = nil
        return outcome
    }
}
