import Foundation
import Testing
@testable import Core

/// `SetlistEdits` against every case in `fixtures/setlist-edits/` and the
/// editor operations in `fixtures/setlist-grouping/` (`move`, `reorder`,
/// `options`), the files `lib/setlistEdits.js` and `lib/setlistGrouping.js`
/// generate. Each `survives` entry (a song that must still carry its rating
/// and comment) is checked on its own, as the JS test does, so a changed
/// expected value can't quietly accept an edit that drops a rating.
@Suite struct SetlistEditsTests {
    struct Case: Sendable, CustomTestStringConvertible {
        let file: String
        let raw: JSONValue
        var name: String { raw["name"]?.stringValue ?? "?" }
        var testDescription: String { "\(file): \(name)" }
        var setlist: [JSONValue] { raw["setlist"].flatMap { if case .array(let a) = $0 { a } else { nil } } ?? [] }
    }

    static func cases(_ folder: String, _ files: [String]? = nil) -> [Case] {
        let urls = (try? FixtureLoader.files(in: folder)) ?? []
        return urls.filter { files?.contains($0.deletingPathExtension().lastPathComponent) ?? true }.flatMap { url -> [Case] in
            guard let data = try? Data(contentsOf: url),
                  let root = try? JSONDecoder().decode(JSONValue.self, from: data),
                  case .array(let list)? = root["cases"] else { return [] }
            return list.map { Case(file: url.lastPathComponent, raw: $0) }
        }
    }

    static let editCases = cases("setlist-edits")
    static let moveCases = cases("setlist-grouping", ["move"])
    static let reorderCases = cases("setlist-grouping", ["reorder"])
    static let optionCases = cases("setlist-grouping", ["options"])

    /// `checkSurvives` in lib/__tests__/setlistFixtures.test.js.
    static func checkSurvives(_ setlist: [JSONValue], _ c: Case) {
        guard case .array(let survives)? = c.raw["survives"] else { return }
        for s in survives {
            guard let id = s["songId"]?.stringValue else { continue }
            guard let song = setlist.first(where: { SetlistEdits.songId($0) == id }) else {
                Issue.record("\(c.testDescription): \(id) is gone"); continue
            }
            if case .object(let o) = s {
                if let rating = o["rating"] { #expect((song["rating"] ?? .null) == rating, "\(c.testDescription): \(id)'s rating") }
                if let comment = o["comment"] { #expect(song["comment"] == comment, "\(c.testDescription): \(id)'s comment") }
            }
        }
    }

    @Test func fixturesArePresent() {
        #expect(Self.editCases.count == 24, "every case in fixtures/setlist-edits")
        #expect(!Self.moveCases.isEmpty && !Self.reorderCases.isEmpty && !Self.optionCases.isEmpty)
    }

    @Test(arguments: editCases)
    func edits(_ c: Case) throws {
        let edit = try #require(c.raw["edit"].flatMap(SetlistEdit.init(json:)), "the edit reads")
        let before = c.setlist
        let result = SetlistEdits.apply(before, edit)
        #expect(before == c.setlist, "the input isn't changed in place")
        let expected = try #require(c.raw["expected"])
        #expect(JSONValue.array(result.setlist) == expected["setlist"], "setlist")
        #expect(JSONValue.bool(result.changed) == expected["changed"], "changed")
        if let removed = expected["removed"] { #expect((result.removed ?? .null) == removed, "removed") }
        if let index = expected["index"] { #expect(result.index.map { JSONValue.number(Double($0)) } == index, "index") }
        Self.checkSurvives(result.setlist, c)
    }

    @Test(arguments: moveCases)
    func moveToSet(_ c: Case) throws {
        let id = try #require(c.raw["songId"]?.stringValue)
        let label = try #require(c.raw["label"]?.stringValue)
        let out = SetlistEdits.moveSong(c.setlist, songId: id, toSet: label)
        #expect(JSONValue.array(out) == c.raw["expected"])
        Self.checkSurvives(out, c)
    }

    @Test(arguments: reorderCases)
    func reorderWithinSet(_ c: Case) throws {
        let label = try #require(c.raw["label"]?.stringValue)
        let index = try #require(c.raw["index"]?.intValue)
        let direction = try #require(c.raw["direction"]?.intValue)
        let out = SetlistEdits.moveSong(c.setlist, inSet: label, at: index, by: direction)
        #expect(JSONValue.array(out) == c.raw["expected"])
        Self.checkSurvives(out, c)
    }

    @Test(arguments: optionCases)
    func setOptions(_ c: Case) {
        #expect(JSONValue.array(SetlistEdits.setOptions(c.setlist).map(JSONValue.string)) == c.raw["expected"])
    }

    /// The editor's result, sent as a reorder edit against a newer stored
    /// copy, keeps a rating made elsewhere meanwhile.
    @Test func aMoveSentAsReorderKeepsANewerRating() throws {
        let stored: [JSONValue] = [
            .object(["id": .string("a"), "name": .string("A"), "set": .string("Set I"), "rating": .number(9)]),
            .object(["id": .string("b"), "name": .string("B"), "set": .string("Set I")]),
        ]
        let stale: [JSONValue] = [
            .object(["id": .string("a"), "name": .string("A"), "set": .string("Set I")]),
            .object(["id": .string("b"), "name": .string("B"), "set": .string("Set I")]),
        ]
        let moved = SetlistEdits.moveSong(stale, songId: "a", toSet: "Encore")
        let result = SetlistEdits.apply(stored, .reorder(setlist: moved))
        #expect(result.changed)
        #expect(result.setlist.map { SetlistEdits.songId($0) } == ["b", "a"])
        #expect(result.setlist[1]["rating"] == .number(9))
        #expect(result.setlist[1]["set"] == .string("Encore"))
    }
}
