import Foundation
import Testing
@testable import Core

/// `setlist-source`'s answer as the show page reads it, and the outbox file
/// the "Waiting to sync" page reads.
@Suite struct SetlistSourceAndOutboxTests {
    @Test func decodesTheFunctionsAnswer() throws {
        // tests/setlists/setlistSource.test.js's shape (5.60.22).
        let json = #"""
        {"ok":true,"artist":"Goose",
         "source":{"id":"elgoose","label":"El Goose","homeUrl":"https://elgoose.net","isBandSource":true,"requiresReview":false,"matchedOn":"name"},
         "resync":{"offered":true,"action":"resync","label":"Get setlist from El Goose","busyLabel":"Asking El Goose...","hint":"This setlist came from setlist.fm."},
         "stored":{"id":"setlistfm","label":"setlist.fm","homeUrl":"https://www.setlist.fm"}}
        """#
        let answer = try JSONDecoder().decode(SetlistSourceAnswer.self, from: Data(json.utf8))
        #expect(answer.resync.offered)
        #expect(answer.resync.action == .resync)
        #expect(answer.resync.label == "Get setlist from El Goose")
        #expect(answer.stored?.label == "setlist.fm")

        let none = #"{"ok":true,"artist":"X","source":{"id":"setlistfm","label":"setlist.fm","homeUrl":null,"isBandSource":false,"requiresReview":false,"matchedOn":null},"resync":{"offered":false,"action":null,"label":null,"busyLabel":null,"hint":null}}"#
        let plain = try JSONDecoder().decode(SetlistSourceAnswer.self, from: Data(none.utf8))
        #expect(!plain.resync.offered)
        #expect(plain.resync.action == nil)
    }

    @Test func asksWithTheShowsBandMbidAndSource() throws {
        var doc: [String: Any] = ["artist": "Goose", "venue": "V", "city": "C", "date": "2026-06-12", "setlist": []]
        var show = try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: doc))
        #expect(SetlistSourceAnswer.query(for: show) == ["artist": "Goose"])
        doc["artistMbid"] = "b2c1"; doc["setlistSource"] = "elgoose"
        show = try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: doc))
        #expect(SetlistSourceAnswer.query(for: show) == ["artist": "Goose", "mbid": "b2c1", "setlistSource": "elgoose"])
    }

    @Test func outboxRoundTripsAndIsPerPerson() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let entry = QueuedShow(
            showId: "1763200000000",
            input: ShowInput(.manual(.init(artist: "Goose", venue: "Red Rocks", city: "Morrison", date: "2026-06-12"), .none), showId: "1763200000000"),
            display: .init(artist: "Goose", venue: "Red Rocks", city: "Morrison", date: "2026-06-12"),
            enqueuedAt: Date(timeIntervalSince1970: 1_763_200_000))
        try ShowOutbox.save([entry], uid: "uidA", in: dir)
        #expect(ShowOutbox.load(uid: "uidA", in: dir) == [entry])
        #expect(ShowOutbox.load(uid: "uidB", in: dir).isEmpty, "another person's outbox is another file")
        #expect(ShowOutbox.url(uid: "../x", in: dir).lastPathComponent == "outbox-x.json")
    }

    @Test func aMissingOrBrokenOutboxIsEmpty() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        #expect(ShowOutbox.load(uid: "u", in: dir).isEmpty)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: ShowOutbox.url(uid: "u", in: dir))
        #expect(ShowOutbox.load(uid: "u", in: dir).isEmpty)
    }
}
