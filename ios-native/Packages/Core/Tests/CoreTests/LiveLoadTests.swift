import Foundation
import Testing
@testable import Core

/// `LiveLoad`: loading always ends, exactly once (lib/liveShows.js; the
/// web's 5.36.4 hang). Short deadlines stand in for 10 s and 15 s.
@MainActor
@Suite struct LiveLoadTests {
    struct Boom: Error {}

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

    final class Record {
        var values: [Int] = []
        var outcomes: [LiveLoad<Int>.Outcome] = []
        var stages: [String] = []
        var reads = 0
    }

    func start(_ load: LiveLoad<Int>, _ listener: FakeListener, _ record: Record,
               readOnce: @escaping @MainActor () async throws -> Int) {
        load.start(subscribe: listener.subscribe, readOnce: readOnce,
                   onValue: { record.values.append($0) },
                   onLoaded: { record.outcomes.append($0) },
                   onError: { _, stage in record.stages.append(stage) })
    }

    @Test func aListenerInTimeIsLive() async throws {
        let load = LiveLoad<Int>(firstSnapshot: .milliseconds(200), readOnce: .milliseconds(200))
        let listener = FakeListener(), record = Record()
        start(load, listener, record) { record.reads += 1; return 0 }
        listener.next?(5)
        listener.next?(6)
        try await Task.sleep(for: .milliseconds(300))
        #expect(record.values == [5, 6])
        #expect(record.outcomes == [.live])
        #expect(record.reads == 0, "no read once")
    }

    @Test func noSnapshotByTheDeadlineReadsOnce() async throws {
        let load = LiveLoad<Int>(firstSnapshot: .milliseconds(50), readOnce: .milliseconds(200))
        let listener = FakeListener(), record = Record()
        start(load, listener, record) { 42 }
        try await Task.sleep(for: .milliseconds(150))
        #expect(record.values == [42])
        #expect(record.outcomes == [.readOnce])
        #expect(record.stages == ["first-snapshot"])
        // A listener that answers late is still used.
        listener.next?(43)
        #expect(record.values == [42, 43])
        #expect(record.outcomes == [.readOnce], "loaded once")
    }

    @Test func aFailingListenerReadsOnceAtOnce() async throws {
        let load = LiveLoad<Int>(firstSnapshot: .seconds(5), readOnce: .milliseconds(200))
        let listener = FakeListener(), record = Record()
        start(load, listener, record) { 7 }
        listener.fail?(Boom())
        try await Task.sleep(for: .milliseconds(50))
        #expect(record.outcomes == [.readOnce])
        #expect(record.values == [7])
        #expect(record.stages == ["listener"])
    }

    @Test func aReadThatNeverAnswersStillEndsLoading() async throws {
        let load = LiveLoad<Int>(firstSnapshot: .milliseconds(30), readOnce: .milliseconds(60))
        let listener = FakeListener(), record = Record()
        start(load, listener, record) {
            try await Task.sleep(for: .seconds(30)) // the 5.36.4 shape: a read that never settles
            return 1
        }
        try await Task.sleep(for: .milliseconds(250))
        #expect(record.outcomes.count == 1)
        if case .failed = record.outcomes.first {} else { Issue.record("expected .failed, got \(record.outcomes)") }
        #expect(record.values.isEmpty)
        #expect(record.stages == ["first-snapshot", "read-once"])
    }

    @Test func aFailedReadEndsLoadingWithTheError() async throws {
        let load = LiveLoad<Int>(firstSnapshot: .milliseconds(30), readOnce: .milliseconds(200))
        let listener = FakeListener(), record = Record()
        start(load, listener, record) { throw Boom() }
        try await Task.sleep(for: .milliseconds(150))
        #expect(record.outcomes.count == 1)
        if case .failed = record.outcomes.first {} else { Issue.record("expected .failed") }
    }

    @Test func stopSilencesEverything() async throws {
        let load = LiveLoad<Int>(firstSnapshot: .milliseconds(30), readOnce: .milliseconds(100))
        let listener = FakeListener(), record = Record()
        start(load, listener, record) { 1 }
        load.stop()
        listener.next?(9)
        try await Task.sleep(for: .milliseconds(150))
        #expect(listener.stopped)
        #expect(record.values.isEmpty && record.outcomes.isEmpty)
    }

    @Test func withDeadlineReturnsOrGivesUp() async throws {
        let fast = try await withDeadline(.milliseconds(200)) { 3 }
        #expect(fast == 3)
        do {
            _ = try await withDeadline(.milliseconds(30)) { () async throws -> Int in
                try? await Task.sleep(for: .seconds(5))
                return 4
            }
            Issue.record("expected a DeadlineError")
        } catch let error as DeadlineError {
            #expect(error.limit == .milliseconds(30))
        }
    }
}
