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
/// the tests pass fakes.
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
    private var cancel: (() -> Void)?
    private var deadline: Task<Void, Never>?
    private var fallback: Task<Void, Never>?
    private var loaded = false
    private var stopped = false

    public init(firstSnapshot: Duration = .seconds(10), readOnce: Duration = .seconds(15)) {
        self.firstSnapshot = firstSnapshot
        self.readOnceLimit = readOnce
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
        deadline = Task { [weak self, firstSnapshot] in
            try? await Task.sleep(for: firstSnapshot)
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
        fallback = Task { [weak self, readOnceLimit] in
            do {
                let value = try await withDeadline(readOnceLimit, readOnce)
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

/// `operation`'s answer, or `DeadlineError` once `limit` passes. The
/// operation isn't waited for after that (Firestore's reads can't be
/// cancelled), so its late answer is dropped.
@MainActor
public func withDeadline<T>(_ limit: Duration, _ operation: @escaping @MainActor () async throws -> T) async throws -> T {
    let once = Once()
    return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, Error>) in
        let work = Task { @MainActor in
            do {
                let value = try await operation()
                if once.claim() { continuation.resume(returning: value) }
            } catch {
                if once.claim() { continuation.resume(throwing: error) }
            }
        }
        Task { @MainActor in
            try? await Task.sleep(for: limit)
            if once.claim() {
                work.cancel()
                continuation.resume(throwing: DeadlineError(limit: limit))
            }
        }
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
