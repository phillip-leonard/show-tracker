import Foundation
import Testing
@testable import Core

/// Sign-out's cache reset (`Database.ResetSequence`): Firebase Auth signs
/// out only once Firestore is terminated. Signed out first, a Firestore
/// token request still in flight retries for the new user and asserts in
/// the SDK, since `terminate()` has removed its Auth listener ("GetToken
/// cannot be called after listener removed", 2026-11-20).
/// `AppTests/FirestoreTokenRaceTests.swift` (MySetlistsTests) shows the SDK side.
@MainActor
@Suite struct CacheResetOrderTests {
    struct Failed: Error {}

    @Test func signsOutOnlyAfterTerminatingAndClearsAfterBoth() async {
        var log: [String] = []
        let outcome = await Database.ResetSequence.run(
            terminate: {
                log.append("terminate started")
                await Task.yield()
                log.append("terminated")
            },
            onceTerminated: { log.append("auth sign-out") },
            clearPersistence: { log.append("cleared") }
        )
        #expect(log == ["terminate started", "terminated", "auth sign-out", "cleared"])
        #expect(outcome.terminated && outcome.cleared)
        #expect(outcome.failure == nil && outcome.onceTerminatedFailure == nil)
    }

    /// Sign-out never waits on Firestore: a failed termination still signs
    /// out of Auth, and the cache isn't cleared (it can't be, on a running
    /// instance), which `Database.clearCache` reports.
    @Test func aFailedTerminationStillSignsOutButDoesNotClear() async {
        var log: [String] = []
        let outcome = await Database.ResetSequence.run(
            terminate: { throw Failed() },
            onceTerminated: { log.append("auth sign-out") },
            clearPersistence: { log.append("cleared") }
        )
        #expect(log == ["auth sign-out"])
        #expect(!outcome.terminated && !outcome.cleared)
        #expect(outcome.failure != nil)
    }

    @Test func aFailedAuthSignOutIsReportedAndTheCacheIsStillCleared() async {
        var log: [String] = []
        let outcome = await Database.ResetSequence.run(
            terminate: { log.append("terminated") },
            onceTerminated: { throw Failed() },
            clearPersistence: { log.append("cleared") }
        )
        #expect(log == ["terminated", "cleared"])
        #expect(outcome.cleared)
        #expect(outcome.onceTerminatedFailure != nil)
    }
}
