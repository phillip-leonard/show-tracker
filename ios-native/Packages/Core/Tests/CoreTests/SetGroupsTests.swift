import Foundation
import Testing
@testable import Core

/// `SetGroups` against `fixtures/setlist-grouping/groups.json`, the file
/// `lib/setGroups.js` `groupSongsBySet` generates: the same sets, labels
/// and songs, in the same order.
@Suite struct SetGroupsTests {
    struct Case: Sendable, CustomTestStringConvertible {
        var name: String
        var setlist: Data
        var expected: [(label: String, songIds: [String])]
        var testDescription: String { name }
    }

    static let cases: [Case] = {
        guard let data = try? FixtureLoader.data("setlist-grouping/groups.json"),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cases = root["cases"] as? [[String: Any]] else { return [] }
        return cases.compactMap { c in
            guard let name = c["name"] as? String, let setlist = c["setlist"] as? [Any],
                  let expected = c["expected"] as? [[String: Any]],
                  let json = try? JSONSerialization.data(withJSONObject: setlist) else { return nil }
            return Case(name: name, setlist: json, expected: expected.map {
                (label: $0["label"] as? String ?? "", songIds: $0["songIds"] as? [String] ?? [])
            })
        }
    }()

    @Test func fixturesArePresent() {
        #expect(Self.cases.count >= 11)
    }

    @Test(arguments: cases)
    func matchesTheWeb(_ c: Case) throws {
        let songs = try JSONDecoder().decode([Song].self, from: c.setlist)
        let groups = SetGroups.group(songs)
        #expect(groups.map(\.label) == c.expected.map(\.label))
        #expect(groups.map { $0.songs.map(\.id) } == c.expected.map(\.songIds))
    }

    @Test func numerals() {
        #expect(SetGroups.readNumber("IX") == 9)
        #expect(SetGroups.readNumber("12") == 12)
        #expect(SetGroups.readNumber("IIII") == 0)
        #expect(SetGroups.readNumber("VX") == 0)
        #expect(SetGroups.toRoman(7) == "VII")
        #expect(SetGroups.orderLabels(["Encore", "Set V", "Soundcheck", "Set I", "Encore 2", "Set 9"])
                == ["Set I", "Set V", "Set 9", "Encore", "Encore 2", "Soundcheck"])
    }
}
