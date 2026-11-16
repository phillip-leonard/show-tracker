import Foundation
import Testing
@testable import Core

/// The song-edit queue: what it saves, what this device shows while edits
/// wait, and the order and rules of the replay (`SetlistEditReplay`).
@MainActor
@Suite struct SetlistEditQueueTests {
    static func song(_ id: String, rating: Int? = nil) -> JSONValue {
        var o: [String: JSONValue] = ["id": .string(id), "name": .string(id.uppercased()), "set": .string("Set I")]
        if let rating { o["rating"] = .number(Double(rating)) }
        return .object(o)
    }

    static func tempDir() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString) }

    @Test func everyFixtureEditRoundTripsThroughItsSavedForm() throws {
        for c in SetlistEditsTests.editCases {
            let raw = try #require(c.raw["edit"])
            let edit = try #require(SetlistEdit(json: raw), "\(c.testDescription)")
            #expect(SetlistEdit(json: edit.json) == edit, "\(c.testDescription)")
        }
        #expect(SetlistEdit.comment(songId: "a", comment: nil).json["comment"] == nil, "no comment key, the web's undefined")
        #expect(SetlistEdit.rate(songId: "a", rating: nil).json["rating"] == .null, "a cleared rating is stored as null")
    }

    @Test func theFileKeepsOrderIsPerPersonAndGoesWhenEmpty() throws {
        let dir = Self.tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let a = QueuedSetlistEdit(showId: "1", edit: .rate(songId: "s1", rating: 9), enqueuedAt: Date(timeIntervalSince1970: 1))
        let b = QueuedSetlistEdit(showId: "2", edit: .delete(songId: "s2"), enqueuedAt: Date(timeIntervalSince1970: 2))
        let c = QueuedSetlistEdit(showId: "1", edit: .comment(songId: "s1", comment: .string("Huge")), enqueuedAt: Date(timeIntervalSince1970: 3))
        try SetlistEditQueue.save([a, b, c], uid: "uidA", in: dir)
        #expect(SetlistEditQueue.load(uid: "uidA", in: dir) == [a, b, c])
        #expect(SetlistEditQueue.load(uid: "uidB", in: dir).isEmpty)
        try SetlistEditQueue.save([], uid: "uidA", in: dir)
        #expect(!FileManager.default.fileExists(atPath: SetlistEditQueue.url(uid: "uidA", in: dir).path), "an empty queue leaves no file")
        #expect(SetlistEditQueue.url(uid: "../x", in: dir).lastPathComponent == "setlist-edits-x.json")
    }

    @Test func anEntryWhoseEditCantBeReadIsDropped() throws {
        let dir = Self.tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        // Whole seconds: the file keeps dates to the second.
        var bad = QueuedSetlistEdit(showId: "1", edit: .delete(songId: "s1"), enqueuedAt: Date(timeIntervalSince1970: 10))
        bad.edit = .object(["type": .string("teleport")])
        let good = QueuedSetlistEdit(showId: "1", edit: .rate(songId: "s1", rating: 3), enqueuedAt: Date(timeIntervalSince1970: 11))
        try SetlistEditQueue.save([bad, good], uid: "u", in: dir)
        #expect(SetlistEditQueue.load(uid: "u", in: dir) == [good])
    }

    @Test func theOverlayIsTheStoredSetlistWithTheQueuedEditsOnTop() {
        let stored = [Self.song("a", rating: 8), Self.song("b"), Self.song("c")]
        let edits = [
            QueuedSetlistEdit(showId: "1", edit: .rate(songId: "b", rating: 6)),
            QueuedSetlistEdit(showId: "1", edit: .delete(songId: "c")),
            QueuedSetlistEdit(showId: "1", edit: .rate(songId: "b", rating: 7)),
        ]
        let overlay = SetlistEditQueue.overlay(stored, edits)
        #expect(overlay.map { SetlistEdits.songId($0) } == ["a", "b"])
        #expect(overlay[1]["rating"] == .number(7), "the later edit wins, in order")
        #expect(overlay[0]["rating"] == .number(8))
    }

    /// A fake server: a stored setlist the replay's transactions apply to.
    final class Server {
        var setlist: [JSONValue]
        var online = true
        var answers: [SetlistEditReplay.Outcome] = []
        var attempts: [String] = []
        init(_ setlist: [JSONValue]) { self.setlist = setlist }
        func attempt(_ entry: QueuedSetlistEdit) -> SetlistEditReplay.Outcome {
            attempts.append(entry.id)
            if !answers.isEmpty {
                let next = answers.removeFirst()
                if case .landed = next {} else { return next }
            }
            setlist = SetlistEdits.apply(setlist, entry.setlistEdit!).setlist
            return .landed
        }
    }

    func replay(_ queue: inout [QueuedSetlistEdit], _ server: Server, gaveUp: inout [String], sleeps: inout [Duration], onLanded: (QueuedSetlistEdit) -> Void = { _ in }) async {
        var q = queue
        var g: [String] = []
        var s: [Duration] = []
        await SetlistEditReplay.run(
            next: { q.first },
            canRun: { server.online },
            attempt: { server.attempt($0) },
            sleep: { s.append($0) },
            landed: { e in q.removeAll { $0.id == e.id }; onLanded(e) },
            gaveUp: { e, _ in q.removeAll { $0.id == e.id }; g.append(e.id) }
        )
        queue = q; gaveUp += g; sleeps += s
    }

    @Test func offlineEditsReplayInOrderAgainstANewerStoredSetlist() async {
        let server = Server([Self.song("a"), Self.song("b"), Self.song("c")])
        var queue = [
            QueuedSetlistEdit(id: "1", showId: "x", edit: .rate(songId: "a", rating: 3)),
            QueuedSetlistEdit(id: "2", showId: "x", edit: .rate(songId: "a", rating: 5)),
        ]
        // Offline: nothing is attempted, nothing is lost.
        server.online = false
        var gaveUp: [String] = [], sleeps: [Duration] = []
        await replay(&queue, server, gaveUp: &gaveUp, sleeps: &sleeps)
        #expect(server.attempts.isEmpty && queue.count == 2)
        // Meanwhile another device rates b.
        server.setlist = SetlistEdits.apply(server.setlist, .rate(songId: "b", rating: 9)).setlist
        // Back online: replayed in order; the other device's rating stays.
        server.online = true
        await replay(&queue, server, gaveUp: &gaveUp, sleeps: &sleeps)
        #expect(queue.isEmpty)
        #expect(server.attempts == ["1", "2"])
        #expect(server.setlist[0]["rating"] == .number(5), "the later edit lands last")
        #expect(server.setlist[1]["rating"] == .number(9), "another device's rating isn't overwritten")
    }

    @Test func aFailedAttemptIsRetriedOnlineAndWaitsOffline() async {
        let server = Server([Self.song("a")])
        var queue = [QueuedSetlistEdit(id: "1", showId: "x", edit: .rate(songId: "a", rating: 4))]
        server.answers = [.failed(URLError(.timedOut)), .failed(URLError(.timedOut))]
        var gaveUp: [String] = [], sleeps: [Duration] = []
        await replay(&queue, server, gaveUp: &gaveUp, sleeps: &sleeps)
        #expect(queue.isEmpty && server.attempts.count == 3, "two retries, then it lands")
        #expect(sleeps == [.seconds(1), .seconds(2)])

        var later = [QueuedSetlistEdit(id: "2", showId: "x", edit: .rate(songId: "a", rating: 6))]
        server.answers = [.wentOffline]
        await replay(&later, server, gaveUp: &gaveUp, sleeps: &sleeps)
        #expect(later.count == 1, "cut off by going offline: it stays queued")
    }

    @Test func anEditRetryingCantFixIsGivenUpAndTheQueueMovesOn() async {
        let server = Server([Self.song("a"), Self.song("b")])
        var queue = [
            QueuedSetlistEdit(id: "1", showId: "x", edit: .rate(songId: "a", rating: 4)),
            QueuedSetlistEdit(id: "2", showId: "x", edit: .rate(songId: "b", rating: 7)),
        ]
        server.answers = [.failed(SetlistTransaction.Failure.unreadableSetlist)]
        var gaveUp: [String] = [], sleeps: [Duration] = []
        await replay(&queue, server, gaveUp: &gaveUp, sleeps: &sleeps)
        #expect(gaveUp == ["1"] && queue.isEmpty)
        #expect(server.setlist[1]["rating"] == .number(7))
    }

    @Test func anEditAddedDuringTheReplayLandsAfterTheOnesBeforeIt() async {
        let server = Server([Self.song("a")])
        var queue = [QueuedSetlistEdit(id: "1", showId: "x", edit: .rate(songId: "a", rating: 2))]
        var added = false
        var q = queue
        await SetlistEditReplay.run(
            next: { q.first },
            canRun: { true },
            attempt: { server.attempt($0) },
            sleep: { _ in },
            landed: { e in
                q.removeAll { $0.id == e.id }
                if !added { added = true; q.append(QueuedSetlistEdit(id: "2", showId: "x", edit: .rate(songId: "a", rating: 8))) }
            },
            gaveUp: { _, _ in }
        )
        queue = q
        #expect(queue.isEmpty && server.attempts == ["1", "2"])
        #expect(server.setlist[0]["rating"] == .number(8))
    }
}
