import Foundation
import Synchronization

/// Signing out in an order nothing can block (lib/signOutFlow.js, the
/// lesson of 3.11–3.13.13, when an await that never settled stopped logout
/// and account deletion):
///
///   1. cleanup that needs the session (the push token's document)
///   2. the Firebase sign-out
///   3. provider sign-outs (Google)
///   4. local cleanup (listeners, stores, per-user caches)
///
/// Every step is bounded: a throw is recorded and skipped, a hang is cut
/// off after `timeout` (the step keeps running unobserved). The run always
/// finishes, so the screen always reaches the signed-out state.
public struct SignOutRunner: Sendable {
    public struct Step: Sendable {
        public let name: String
        public let run: @Sendable () async throws -> Void
        public init(_ name: String, _ run: @escaping @Sendable () async throws -> Void) { self.name = name; self.run = run }
    }

    public enum Outcome: Equatable, Sendable { case done, failed(String), timedOut }

    public let timeout: Duration
    public init(timeout: Duration = .seconds(4)) { self.timeout = timeout }

    /// Runs every step in order; never throws, never waits longer than
    /// `timeout` for any one step.
    public func run(_ steps: [Step]) async -> [(String, Outcome)] {
        var report: [(String, Outcome)] = []
        for step in steps {
            report.append((step.name, await bounded(step.run)))
        }
        return report
    }

    func bounded(_ work: @escaping @Sendable () async throws -> Void) async -> Outcome {
        let finished = Mutex(false)
        return await withCheckedContinuation { (continuation: CheckedContinuation<Outcome, Never>) in
            let finish: @Sendable (Outcome) -> Void = { outcome in
                let first = finished.withLock { done -> Bool in
                    if done { return false }
                    done = true
                    return true
                }
                if first { continuation.resume(returning: outcome) }
            }
            Task {
                do { try await work(); finish(.done) } catch { finish(.failed("\(error)")) }
            }
            let limit = timeout
            Task {
                try? await Task.sleep(for: limit)
                finish(.timedOut)
            }
        }
    }
}
