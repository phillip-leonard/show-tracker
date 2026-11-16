import Foundation

/// A listener that fails loudly and never hangs: `lib/liveShows.js`
/// `startShowsListener`, for the native app.
///
/// 1. The first snapshot has a deadline (10 s). If it hasn't come by then,
///    or the listener fails first, the data is read once instead, with a
///    deadline of its own (15 s).
/// 2. However that goes, `onLoaded` is called exactly once, so a screen
///    waiting on it always stops waiting (the 5.36.4 hang the web had).
/// 3. A listener that answers late is still used: every snapshot goes to
///    `onValue`, before or after loading ended.
///
/// No Firebase here; `ShowsStore` passes Firestore's listener and read, and
/// the tests pass fakes. Every wait goes through a `DeadlineClock`: the app
/// sleeps on real time, the tests move a manual clock, so no test waits on
/// the wall clock.
@MainActor
public final class LiveLoad<Value> {
    public enum Outcome: Equatable, Sendable {
        /// The listener answered in time.
        case live
        /// The listener didn't; the one-time read did.
        case readOnce
        /// Neither did; `message` says what went wrong.
        case failed(String)
    }

    public typealias Subscribe = (_ next: @escaping @MainActor (Value) -> Void, _ fail: @escaping @MainActor (Error) -> Void) -> (() -> Void)

    private let firstSnapshot: Duration
    private let readOnceLimit: Duration
    private let clock: any DeadlineClock
    private var cancel: (() -> Void)?
    private var deadline: Task<Void, Never>?
    private var fallback: Task<Void, Never>?
    private var loaded = false
    private var stopped = false

    public init(firstSnapshot: Duration = .seconds(10), readOnce: Duration = .seconds(15),
                clock: any DeadlineClock = SystemDeadlineClock()) {
        self.firstSnapshot = firstSnapshot
        self.readOnceLimit = readOnce
        self.clock = clock
    }

    /// - Parameters:
    ///   - subscribe: starts the listener; returns what stops it.
    ///   - readOnce: one read of the same data.
    ///   - onValue: every value, from the listener or the read.
    ///   - onLoaded: once, however loading ends.
    ///   - onError: every failure, with where it happened (`listener`,
    ///     `first-snapshot`, `read-once`), for the log.
    public func start(subscribe: Subscribe,
                      readOnce: @escaping @MainActor () async throws -> Value,
                      onValue: @escaping @MainActor (Value) -> Void,
                      onLoaded: @escaping @MainActor (Outcome) -> Void,
                      onError: @escaping @MainActor (Error, String) -> Void = { _, _ in }) {
        cancel = subscribe({ [weak self] value in
            guard let self, !self.stopped else { return }
            onValue(value)
            if !self.loaded { self.finish(.live, onLoaded) }
        }, { [weak self] error in
            guard let self, !self.stopped else { return }
            onError(error, "listener")
            if !self.loaded { self.readInstead(readOnce, onValue, onLoaded, onError) }
        })
        deadline = Task { [weak self, firstSnapshot, clock] in
            do { try await clock.sleep(for: firstSnapshot) } catch { return } // cancelled: loading ended or stopped
            guard let self, !Task.isCancelled, !self.stopped, !self.loaded else { return }
            onError(DeadlineError(limit: firstSnapshot), "first-snapshot")
            self.readInstead(readOnce, onValue, onLoaded, onError)
        }
    }

    public func stop() {
        stopped = true
        cancel?()
        cancel = nil
        deadline?.cancel()
        fallback?.cancel()
    }

    private func readInstead(_ readOnce: @escaping @MainActor () async throws -> Value,
                             _ onValue: @escaping @MainActor (Value) -> Void,
                             _ onLoaded: @escaping @MainActor (Outcome) -> Void,
                             _ onError: @escaping @MainActor (Error, String) -> Void) {
        guard fallback == nil else { return }
        deadline?.cancel()
        fallback = Task { [weak self, readOnceLimit, clock] in
            do {
                let value = try await withDeadline(readOnceLimit, clock: clock, readOnce)
                guard let self, !self.stopped else { return }
                // The listener may have answered while the read ran; its
                // value is newer, so the read's isn't applied over it.
                if !self.loaded { onValue(value) }
                self.finish(.readOnce, onLoaded)
            } catch {
                guard let self, !self.stopped else { return }
                onError(error, "read-once")
                self.finish(.failed(Self.describe(error)), onLoaded)
            }
        }
    }

    private func finish(_ outcome: Outcome, _ onLoaded: @MainActor (Outcome) -> Void) {
        guard !loaded else { return }
        loaded = true
        deadline?.cancel()
        onLoaded(outcome)
    }

    static func describe(_ error: Error) -> String {
        (error as? DeadlineError).map { "No answer in \($0.limit)" } ?? error.localizedDescription
    }
}

/// An operation that didn't finish within its time limit.
public struct DeadlineError: Error, Equatable, Sendable {
    public let limit: Duration
}

/// What deadlines wait on. The app uses `SystemDeadlineClock` (real time);
/// the tests use a manual clock they advance, so they never depend on how
/// busy the machine is. A sleep that's cancelled throws.
@MainActor
public protocol DeadlineClock: AnyObject {
    func sleep(for duration: Duration) async throws
}

/// Real time: `Task.sleep`.
public final class SystemDeadlineClock: DeadlineClock {
    public nonisolated init() {}
    public nonisolated func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: duration)
    }
}

/// `operation`'s answer, or `DeadlineError` once `limit` passes on `clock`.
/// The operation isn't waited for after that (Firestore's reads can't be
/// cancelled), so its late answer is dropped. When the operation answers
/// first, the timer is cancelled rather than left running out its limit.
@MainActor
public func withDeadline<T>(_ limit: Duration, clock: any DeadlineClock = SystemDeadlineClock(),
                            _ operation: @escaping @MainActor () async throws -> T) async throws -> T {
    let race = Race()
    return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, Error>) in
        let work = Task { @MainActor in
            do {
                let value = try await operation()
                if race.claim() { race.timer?.cancel(); continuation.resume(returning: value) }
            } catch {
                if race.claim() { race.timer?.cancel(); continuation.resume(throwing: error) }
            }
        }
        race.timer = Task { @MainActor in
            do { try await clock.sleep(for: limit) } catch { return } // cancelled: the operation answered
            if race.claim() {
                work.cancel()
                continuation.resume(throwing: DeadlineError(limit: limit))
            }
        }
    }
}

/// Which of two racing answers resumes (`claim` is true the first time
/// only), and the timer to cancel when the work wins.
@MainActor
final class Race {
    private var done = false
    var timer: Task<Void, Never>?
    func claim() -> Bool {
        if done { return false }
        done = true
        return true
    }
}

/// True the first time only: which of two racing answers resumes.
@MainActor
final class Once {
    private var done = false
    func claim() -> Bool {
        if done { return false }
        done = true
        return true
    }
}
