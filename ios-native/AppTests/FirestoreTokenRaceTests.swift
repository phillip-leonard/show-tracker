import FirebaseAuth
import FirebaseFirestore
import Foundation
import Testing
import Core

/// The race that crashed sign-out (2026-11-20), against the real SDK and
/// the Auth emulator. Part of `AuthEmulatorTests` (an extension), so it
/// runs serialized with the other tests that sign in and out.
///
/// Firestore asks Auth for a token on every RPC. If the signed-in user
/// changes while that request is in flight, the answer is thrown away and
/// the request retried (`FirebaseAuthCredentialsProvider::GetToken`), and
/// the retry hard-asserts when `terminate()` has already removed
/// Firestore's Auth listener: "GetToken cannot be called after listener
/// removed". Auth delivers both the answer and the user change on the main
/// queue (`DispatchQueue.main.async`), so their order there decides it:
/// crash = user change heard, then the listener removed, then the answer.
/// On the simulator a slow token refresh put the answer last.
///
/// The test holds the main thread and lines the queue up by hand.
/// Sign-out's order (`Database.clearCache(onceTerminated:)`): terminate,
/// wait for it, then sign out of Auth. The listener is gone before the user
/// change is posted, so Firestore never hears it and the answer just
/// completes.
///
/// The old order, reproduced by hand on 2026-11-20 on the iPhone 18 Pro Max
/// simulator (kept out of the suite: a hard assertion can't be caught, it
/// kills the test host): with the main thread held, `Auth.signOut()`
/// (queues the user change), then `DispatchQueue.main.async { terminate;
/// hold 0.5 s }`, then an RPC (Auth, now signed out, queues its answer
/// last). Queue: user change → termination → answer, and the test host
/// dies with the same assertion as the crash report.
extension AuthEmulatorTests {
    @Test func aTokenAnswerArrivingAfterSignOutDoesNotCrash() async throws {
        store.termsTicked = true
        try await store.continueAsGuest()
        try await waitFor { store.user?.isAnonymous == true }
        let old = await Database.ready()
        // Starts the client (a cache read needs no token).
        _ = try? await old.document("tokenRace/start").getDocument(source: .cache)

        // Main queue, in order: [sign-out's reset] [the token answer] [the user change].
        nonisolated(unsafe) let terminating = old
        DispatchQueue.main.async {
            terminating.terminate { _ in }
            // Terminating removes the Auth listener on Firestore's own queue.
            Self.holdTheMainThread(seconds: 0.5)
            try? Auth.auth().signOut()
        }
        // An RPC (the server here is a dead address, which doesn't matter:
        // the token is asked for before connecting), started before the
        // reset runs. Auth's answer is queued behind it.
        old.collection("tokenRace").count.getAggregation(source: .server) { _, _ in }
        Self.holdTheMainThread(seconds: 0.5)

        // Now the main queue runs.
        try await waitFor { store.signedIn == false }
        try await Task.sleep(for: .milliseconds(300))

        // The reset still finishes: cleared, and a fresh instance.
        let reset = await Database.clearCache()
        #expect(reset.freshInstance, "\(reset)")
    }

    /// The same race through the app's own sign-out: an RPC's token answer
    /// in flight when "Sign out" runs.
    @Test func signingOutWithATokenRequestInFlight() async throws {
        store.termsTicked = true
        try await store.continueAsGuest()
        try await waitFor { store.user?.isAnonymous == true }
        let before = await Database.ready()
        before.collection("tokenRace").count.getAggregation(source: .server) { _, _ in }

        let report = await store.signOut()
        #expect(report.first { $0.0 == "offline cache" }?.1 == .done, "\(report)")
        #expect(report.first { $0.0 == "firebase" }?.1 == .done, "\(report)")
        try await waitFor { store.signedIn == false }
        #expect(Auth.auth().currentUser == nil)
        #expect(await Database.ready() !== before)
    }

    /// Keeps the main thread (no run loop turn, no main-queue blocks) for a
    /// while. Synchronous, so it can sit inside an async test.
    static func holdTheMainThread(seconds: TimeInterval) {
        Thread.sleep(forTimeInterval: seconds)
    }
}
