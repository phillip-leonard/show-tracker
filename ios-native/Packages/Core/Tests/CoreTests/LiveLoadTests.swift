import Foundation
import Testing
@testable import Core

/// A clock the test moves by hand. Sleepers wake only when `advance` passes
/// their time, so a test never depends on how busy the machine is.
@MainActor
final class ManualClock: DeadlineClock {
    private struct Sleeper {
        let id: Int
        let wake: Duration
        let continuation: CheckedContinuation<Void, Error>
    }

    private(set) var now: Duration = .zero
    private var sleepers: [Sleeper] = []
    private var nextID = 0
    private var countWaiters: [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []
    private var idleWaiters: [CheckedContinuation<Void, Never>] = []

    /// Sleepers waiting now.
    var pending: Int { sleepers.count }

    func sleep(for duration: Duration) async throws {
        try Task.checkCancellation()
        let id = nextID
        nextID += 1
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                sleepers.append(Sleeper(id: id, wake: now + duration, continuation: continuation))
                wakeCountWaiters()
            }
        } onCancel: {
            Task { @MainActor in self.cancel(id) }
        }
    }

    /// Moves time on and wakes every sleeper whose time has come, earliest first.
    func advance(by duration: Duration) {
        now += duration
        let due = sleepers.filter { $0.wake <= now }.sorted { $0.wake < $1.wake }
        sleepers.removeAll { $0.wake <= now }
        for sleeper in due { sleeper.continuation.resume() }
    }

    /// Returns once at least `count` sleepers are waiting: the code under
    /// test has reached its deadline, so advancing now means something.
    func waitForSleepers(_ count: Int) async {
        if sleepers.count >= count { return }
        await withCheckedContinuation { countWaiters.append((count, $0)) }
    }

    /// Returns once no sleeper is waiting (a cancelled one has left).
    func waitUntilIdle() async {
        if sleepers.isEmpty { return }
        await withCheckedContinuation { idleWaiters.append($0) }
    }

    private func cancel(_ id: Int) {
        guard let index = sleepers.firstIndex(where: { $0.id == id }) else { return }
        sleepers.remove(at: index).continuation.resume(throwing: CancellationError())
        if sleepers.isEmpty {
            let waiting = idleWaiters
            idleWaiters = []
            for waiter in waiting { waiter.resume() }
        }
    }

    private func wakeCountWaiters() {
        let ready = countWaiters.filter { $0.count <= sleepers.count }
        countWaiters.removeAll { $0.count <= sleepers.count }
        for waiter in ready { waiter.continuation.resume() }
    }
}

/// `LiveLoad`: loading always ends, exactly once (lib/liveShows.js; the
/// web's 5.36.4 hang). Time is a `ManualClock`, so every step happens when
/// the test says and nothing waits on the wall clock. (The time limit is
/// only a backstop for a broken test.)
@MainActor
@Suite(.timeLimit(.minutes(1))) struct LiveLoadTests {
    struct Boom: Error {}

    static let firstSnapshot: Duration = .seconds(10)
    static let readOnce: Duration = .seconds(15)

    /// A fake listener the test drives.
    final class FakeListener {
        var next: (@MainActor (Int) -> Void)?
        var fail: (@MainActor (Error) -> Void)?
        var stopped = false
        func subscribe(_ next: @escaping @MainActor (Int) -> Void, _ fail: @escaping @MainActor (Error) -> Void) -> () -> Void {
            self.next = next
            self.fail = fail
            return { self.stopped = true }
        }
    }

    @MainActor
    final class Record {
        var values: [Int] = []
        var stages: [String] = []
        var reads = 0
        var outcomes: [LiveLoad<Int>.Outcome] = [] {
            didSet {
                guard !outcomes.isEmpty else { return }
                let waiting = loadedWaiters
                loadedWaiters = []
                for waiter in waiting { waiter.resume() }
            }
        }
        private var loadedWaiters: [CheckedContinuation<Void, Never>] = []

        /// Returns once loading has ended (an outcome arrived).
        func untilLoaded() async {
            if !outcomes.isEmpty { return }
            await withCheckedContinuation { loadedWaiters.append($0) }
        }
    }

    func start(_ load: LiveLoad<Int>, _ listener: FakeListener, _ record: Record,
               readOnce: @escaping @MainActor () async throws -> Int) {
        load.start(subscribe: listener.subscribe, readOnce: readOnce,
                   onValue: { record.values.append($0) },
                   onLoaded: { record.outcomes.append($0) },
                   onError: { _, stage in record.stages.append(stage) })
    }

    func load(_ clock: ManualClock) -> LiveLoad<Int> {
        LiveLoad<Int>(firstSnapshot: Self.firstSnapshot, readOnce: Self.readOnce, clock: clock)
    }

    @Test func aListenerInTimeIsLive() async {
        let clock = ManualClock()
        let load = load(clock), listener = FakeListener(), record = Record()
        start(load, listener, record) { record.reads += 1; return 0 }
        await clock.waitForSleepers(1) // the first-snapshot deadline is set
        listener.next?(5)
        listener.next?(6)
        #expect(record.values == [5, 6])
        #expect(record.outcomes == [.live])
        // Long past both deadlines: nothing more happens.
        clock.advance(by: .seconds(60))
        #expect(record.reads == 0, "no read once")
        #expect(record.outcomes == [.live])
    }

    @Test func noSnapshotByTheDeadlineReadsOnce() async {
        let clock = ManualClock()
        let load = load(clock), listener = FakeListener(), record = Record()
        start(load, listener, record) { 42 }
        await clock.waitForSleepers(1)
        clock.advance(by: Self.firstSnapshot - .milliseconds(1))
        #expect(record.outcomes.isEmpty, "not before the deadline")
        clock.advance(by: .milliseconds(1))
        await record.untilLoaded()
        #expect(record.values == [42])
        #expect(record.outcomes == [.readOnce])
        #expect(record.stages == ["first-snapshot"])
        // A listener that answers late is still used.
        listener.next?(43)
        #expect(record.values == [42, 43])
        #expect(record.outcomes == [.readOnce], "loaded once")
    }

    @Test func aFailingListenerReadsOnceAtOnce() async {
        let clock = ManualClock()
        let load = load(clock), listener = FakeListener(), record = Record()
        start(load, listener, record) { 7 }
        listener.fail?(Boom())
        await record.untilLoaded()
        #expect(clock.now == .zero, "no time passed")
        #expect(record.outcomes == [.readOnce])
        #expect(record.values == [7])
        #expect(record.stages == ["listener"])
    }

    @Test func aReadThatNeverAnswersStillEndsLoading() async {
        let clock = ManualClock()
        let load = load(clock), listener = FakeListener(), record = Record()
        start(load, listener, record) {
            try await clock.sleep(for: .seconds(3600)) // the 5.36.4 shape: a read that never settles
            return 1
        }
        await clock.waitForSleepers(1)
        clock.advance(by: Self.firstSnapshot)
        await clock.waitForSleepers(2) // the read is waiting, and so is its deadline
        clock.advance(by: Self.readOnce)
        await record.untilLoaded()
        #expect(record.outcomes.count == 1)
        if case .failed = record.outcomes.first {} else { Issue.record("expected .failed, got \(record.outcomes)") }
        #expect(record.values.isEmpty)
        #expect(record.stages == ["first-snapshot", "read-once"])
    }

    @Test func aFailedReadEndsLoadingWithTheError() async {
        let clock = ManualClock()
        let load = load(clock), listener = FakeListener(), record = Record()
        start(load, listener, record) { throw Boom() }
        await clock.waitForSleepers(1)
        clock.advance(by: Self.firstSnapshot)
        await record.untilLoaded()
        #expect(record.outcomes.count == 1)
        if case .failed = record.outcomes.first {} else { Issue.record("expected .failed") }
        #expect(record.stages == ["first-snapshot", "read-once"])
    }

    @Test func stopSilencesEverything() async {
        let clock = ManualClock()
        let load = load(clock), listener = FakeListener(), record = Record()
        start(load, listener, record) { record.reads += 1; return 1 }
        await clock.waitForSleepers(1)
        load.stop()
        listener.next?(9)
        clock.advance(by: .seconds(3600))
        #expect(listener.stopped)
        #expect(record.values.isEmpty && record.outcomes.isEmpty)
        #expect(record.reads == 0)
    }

    @Test func withDeadlineReturnsAndCancelsItsTimer() async throws {
        let clock = ManualClock()
        let fast = try await withDeadline(.seconds(10), clock: clock) { 3 }
        #expect(fast == 3)
        // The timer was cancelled, not left waiting out its 10 s (time never
        // moves here, so without the cancel this would never return).
        await clock.waitUntilIdle()
        #expect(clock.pending == 0 && clock.now == .zero)
    }

    @Test func withDeadlineGivesUpWhenTimeRunsOut() async {
        let clock = ManualClock()
        let attempt = Task { @MainActor in
            try await withDeadline(.seconds(30), clock: clock) { () async throws -> Int in
                try await clock.sleep(for: .seconds(3600))
                return 4
            }
        }
        await clock.waitForSleepers(2) // the operation and the timer
        clock.advance(by: .seconds(30))
        do {
            _ = try await attempt.value
            Issue.record("expected a DeadlineError")
        } catch let error as DeadlineError {
            #expect(error.limit == .seconds(30))
        } catch {
            Issue.record("unexpected \(error)")
        }
    }
}
