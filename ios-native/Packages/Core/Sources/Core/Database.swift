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
/// Firebase Auth signs out *between* the termination and the clearing
/// (`clearCache(onceTerminated:)`), never before the termination. Firestore's
/// token request retries itself when the signed-in user changes while it's
/// in flight, and that retry asserts once `terminate()` has removed
/// Firestore's Auth listener ("GetToken cannot be called after listener
/// removed", 2026-11-20): an Auth sign-out first, then `terminate()`, then a
/// token answer that was still on its way crashed the app. Terminated first,
/// the old instance no longer hears the sign-out, so a late answer just
/// completes. `ResetSequence` keeps that order; `CacheResetOrderTests` and
/// `AppTests/FirestoreTokenRaceTests.swift` (MySetlistsTests) check it.
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
        /// What `onceTerminated` (the Firebase Auth sign-out) threw.
        public var onceTerminatedFailure: String?
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

    /// Terminate, run `onceTerminated` (the Firebase Auth sign-out), clear
    /// the persisted cache, start a fresh instance with the launch settings.
    /// Pending writes that haven't reached the server are dropped with the
    /// cache (sign-out waits for them first, bounded). A second call while
    /// one is running waits for it (and doesn't run its `onceTerminated`).
    @discardableResult
    public static func clearCache(onceTerminated: @escaping @MainActor () throws -> Void = {}) async -> CacheReset {
        if let resetting { return await resetting.value }
        let old = Firestore.firestore()
        let task = Task { @MainActor () -> CacheReset in
            var outcome = await ResetSequence.run(
                terminate: { try await old.terminate() },
                onceTerminated: onceTerminated,
                clearPersistence: { try await old.clearPersistence() }
            )
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

    /// The order of a reset, apart from Firestore so it can be tested
    /// (`CacheResetOrderTests`): `onceTerminated` runs only after
    /// `terminate` has finished, and runs even when it fails (sign-out must
    /// still happen); clearing runs after both, and only on a terminated
    /// instance.
    @MainActor enum ResetSequence {
        static func run(terminate: @MainActor () async throws -> Void,
                        onceTerminated: @MainActor () throws -> Void,
                        clearPersistence: @MainActor () async throws -> Void) async -> CacheReset {
            var outcome = CacheReset()
            do {
                try await terminate()
                outcome.terminated = true
            } catch {
                outcome.failure = "\(error)"
            }
            do {
                try onceTerminated()
            } catch {
                outcome.onceTerminatedFailure = "\(error)"
            }
            guard outcome.terminated else { return outcome }
            do {
                try await clearPersistence()
                outcome.cleared = true
            } catch {
                outcome.failure = "\(error)"
            }
            return outcome
        }
    }
}
