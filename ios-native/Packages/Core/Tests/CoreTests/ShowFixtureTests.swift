import Foundation
import Testing
@testable import Core

/// Every file in `fixtures/shows/` (the documents `normalize-show` writes,
/// fixtures/README.md): `expected.show` decodes as a `Show`, every field it
/// carries is one the model knows, and every value survives. The stored
/// documents in each fixture's `context` decode too. If one of these fails,
/// the model is wrong, not the fixture.
@Suite struct ShowFixtureTests {
    static let files: [URL] = (try? FixtureLoader.files(in: "shows")) ?? []

    @Test func fixturesArePresent() {
        #expect(Self.files.count >= 14, "fixtures/shows wasn't bundled")
    }

    @Test(arguments: files)
    func expectedShowDecodes(_ url: URL) throws {
        let fixture = try FixtureLoader.json(url)
        let expected = try #require(fixture["expected"] as? [String: Any])
        guard let showJSON = expected["show"] as? [String: Any] else {
            // An input normalize-show refuses: no document to decode.
            #expect(expected["error"] != nil, "\(url.lastPathComponent): no show and no error")
            return
        }

        // Every field the fixture's document carries is one the model reads.
        let unknown = Set(showJSON.keys).filter { Show.CodingKeys(stringValue: $0) == nil && !Show.ignoredFields.contains($0) }
        #expect(unknown.isEmpty, "\(url.lastPathComponent): fields the model doesn't know: \(unknown.sorted())")
        for case let song as [String: Any] in showJSON["setlist"] as? [Any] ?? [] {
            let unknownSong = Set(song.keys).filter { Song.CodingKeys(stringValue: $0) == nil }
            #expect(unknownSong.isEmpty, "\(url.lastPathComponent): song fields the model doesn't know: \(unknownSong.sorted())")
        }

        // Decoded, then projected back: the same document.
        let show = try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: showJSON))
        let model = JSONCompare.normalized(ShowProjection.json(show), keepEmpty: ShowProjection.keepEmpty)
        let fixtureValue = JSONCompare.normalized(showJSON, keepEmpty: ShowProjection.keepEmpty)
        let diff = JSONCompare.difference(model, fixtureValue)
        #expect(diff == nil, "\(url.lastPathComponent): \(diff ?? "")")

        // The documented guarantees of the canonical shape (lib/showInputs.js).
        #expect(!show.id.isEmpty)
        #expect(show.createdAt != nil, "createdAt is an ISO string in the fixtures")
        #expect(show.isoDate == show.date, "a new show's date is stored ISO")
        #expect(show.setlist.allSatisfy { !$0.id.isEmpty && !$0.name.isEmpty })
        if let rating = show.rating { #expect((1...10).contains(rating)) }
    }

    @Test(arguments: files)
    func contextDocumentsDecode(_ url: URL) throws {
        let context = try FixtureLoader.json(url)["context"] as? [String: Any] ?? [:]
        for case let doc as [String: Any] in context["existingShows"] as? [Any] ?? [] {
            _ = try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: doc))
        }
        for case let tag as [String: Any] in (context["showTags"] as? [String: Any] ?? [:]).values {
            let decoded = try JSONDecoder().decode(ShowTag.self, from: JSONSerialization.data(withJSONObject: tag))
            #expect(!decoded.showData.isoDate.isEmpty, "\(url.lastPathComponent): a tag's date reads")
        }
        for case let upcoming as [String: Any] in (context["upcomingShows"] as? [String: Any] ?? [:]).values {
            _ = try JSONDecoder().decode(UpcomingShow.self, from: JSONSerialization.data(withJSONObject: upcoming))
        }
    }
}
