import FirebaseFirestore
import Foundation
import Testing
@testable import Core

/// `ShowFieldEdit` against `fixtures/show-edits/fields.json`, the file
/// `lib/showFieldEdits.js` generates: the same write for every case, and
/// the stored show after it with every other field untouched (R-06).
@Suite struct ShowFieldEditTests {
    struct Case: Decodable, Sendable, CustomTestStringConvertible {
        var name: String
        var field: String
        var value: JSONValue
        var show: [String: JSONValue]
        var expected: Expected
        var testDescription: String { name }

        struct Expected: Decodable, Sendable {
            var edit: Edit
            var show: [String: JSONValue]
        }

        struct Edit: Decodable, Sendable {
            var ok: Bool
            var set: [String: JSONValue]?
            var remove: [String]?
            var error: String?
        }
    }

    struct File: Decodable { var cases: [Case] }

    static let cases: [Case] = (try? JSONDecoder().decode(File.self, from: FixtureLoader.data("show-edits/fields.json")).cases) ?? []

    @Test func fixturesArePresent() {
        #expect(Self.cases.count >= 19)
    }

    @Test(arguments: cases)
    func matchesTheWeb(_ c: Case) {
        let result = ShowFieldEdit.edit(c.field, c.value)
        switch result {
        case .success(.set(let field, let value)):
            #expect(c.expected.edit.ok)
            #expect(c.expected.edit.set == [field.rawValue: value])
            #expect(c.expected.edit.remove == nil)
            #expect(ShowFieldEdit.apply(.set(field, value), to: c.show) == c.expected.show)
        case .success(.remove(let field)):
            #expect(c.expected.edit.ok)
            #expect(c.expected.edit.remove == [field.rawValue])
            #expect(c.expected.edit.set == nil)
            #expect(ShowFieldEdit.apply(.remove(field), to: c.show) == c.expected.show)
        case .failure(let error):
            #expect(!c.expected.edit.ok)
            #expect(c.expected.edit.error == error.rawValue)
            #expect(c.expected.show == c.show, "a refused edit leaves the show as it was")
        }
    }

    @Test(arguments: cases)
    func writesOnlyThatField(_ c: Case) throws {
        guard case .success(let change) = ShowFieldEdit.edit(c.field, c.value) else { return }
        let data = change.firestoreData
        #expect(Array(data.keys) == [c.field])
        switch change {
        case .remove: #expect(data[c.field] is FieldValue, "cleared with FieldValue.delete(), never 0 or \"\"")
        case .set(_, .number(let n)): #expect(data[c.field] as? Int == Int(n), "a rating is stored as an integer")
        case .set(_, .string(let s)): #expect(data[c.field] as? String == s)
        case .set: Issue.record("unexpected value")
        }
    }

    @Test func theAppsOwnCalls() {
        #expect(ShowFieldEdit.rating(.rating, 8) == .success(.set(.rating, .number(8))))
        #expect(ShowFieldEdit.rating(.venueRating, nil) == .success(.remove(.venueRating)))
        #expect(ShowFieldEdit.rating(.rating, 11) == .failure(.badRating))
        #expect(ShowFieldEdit.comment("  Great night \n") == .set(.comment, .string("Great night")))
        #expect(ShowFieldEdit.comment("  ") == .remove(.comment))
        #expect(ShowFieldEdit.comment(nil) == .remove(.comment))
    }
}
