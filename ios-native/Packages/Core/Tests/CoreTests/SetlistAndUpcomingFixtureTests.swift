import Foundation
import Testing
@testable import Core

/// The Stage 1 fixtures (5.60.22) decode with today's models: every setlist
/// in `fixtures/setlist-edits/` and `fixtures/setlist-grouping/` as `[Song]`,
/// every upcoming-show document in `fixtures/upcoming-shows/` as
/// `UpcomingShow`. The grouping runs in `SetGroupsTests`; running the edits
/// waits for the Swift port (Part 3b). This only checks the models read the files, and
/// that a rating or comment a case says survives is decoded as such.
@Suite struct SetlistAndUpcomingFixtureTests {
    static let setlistFiles: [URL] = ((try? FixtureLoader.files(in: "setlist-edits")) ?? [])
        + ((try? FixtureLoader.files(in: "setlist-grouping")) ?? [])
    static let upcomingFiles: [URL] = (try? FixtureLoader.files(in: "upcoming-shows")) ?? []

    @Test func fixturesArePresent() {
        #expect(Self.setlistFiles.count == 11, "fixtures/setlist-edits (7) and fixtures/setlist-grouping (4)")
        #expect(Self.upcomingFiles.count == 4, "fixtures/upcoming-shows")
    }

    /// Every array of songs in a case: the setlist, an edit's song or new
    /// order, and the expected setlist (or the setlist a grouping op returns).
    static func setlists(in c: [String: Any]) -> [[Any]] {
        var out: [[Any]] = []
        if let s = c["setlist"] as? [Any] { out.append(s) }
        if let edit = c["edit"] as? [String: Any] {
            if let s = edit["setlist"] as? [Any] { out.append(s) }
            if let song = edit["song"] { out.append([song]) }
        }
        if let expected = c["expected"] as? [String: Any] {
            if let s = expected["setlist"] as? [Any] { out.append(s) }
            if let removed = expected["removed"], !(removed is NSNull) { out.append([removed]) }
        } else if let expected = c["expected"] as? [Any], expected.first is [String: Any], (expected.first as? [String: Any])?["songIds"] == nil {
            out.append(expected)
        }
        return out
    }

    @Test(arguments: setlistFiles)
    func everySetlistDecodes(_ url: URL) throws {
        let cases = try #require(FixtureLoader.json(url)["cases"] as? [[String: Any]])
        #expect(!cases.isEmpty)
        for c in cases {
            let name = "\(url.lastPathComponent): \(c["name"] ?? "")"
            for list in Self.setlists(in: c) {
                for case let song as [String: Any] in list {
                    let unknown = Set(song.keys).filter { Song.CodingKeys(stringValue: $0) == nil }
                    #expect(unknown.isEmpty, "\(name): song fields the model doesn't know: \(unknown.sorted())")
                }
                let songs = try JSONDecoder().decode([Song].self, from: JSONSerialization.data(withJSONObject: list))
                #expect(songs.count == list.count, "\(name)")
            }

            // What the case says survives, as the model reads it.
            guard let survives = c["survives"] as? [[String: Any]] else { continue }
            let after: [Any]
            if let e = c["expected"] as? [String: Any], let s = e["setlist"] as? [Any] { after = s }
            else if let s = c["expected"] as? [Any] { after = s }
            else { continue }
            let songs = try JSONDecoder().decode([Song].self, from: JSONSerialization.data(withJSONObject: after))
            for s in survives {
                let id = try #require(s["songId"] as? String)
                let song = try #require(songs.first { $0.id == id }, "\(name): \(id) is gone")
                if let rating = s["rating"] as? Int { #expect(song.rating == rating, "\(name): \(id)'s rating") }
                if s["rating"] is NSNull { #expect(song.rating == nil, "\(name): \(id)'s rating") }
                if let comment = s["comment"] as? String { #expect((song.comment ?? "") == comment, "\(name): \(id)'s comment") }
            }
        }
    }

    @Test func everyNewUpcomingDocumentDecodes() throws {
        let url = try #require(Self.upcomingFiles.first { $0.lastPathComponent == "create.json" })
        let cases = try #require(FixtureLoader.json(url)["cases"] as? [[String: Any]])
        for c in cases {
            let name = c["name"] as? String ?? ""
            let doc = try #require(c["expected"] as? [String: Any])
            let unknown = Set(doc.keys).filter { UpcomingShow.CodingKeys(stringValue: $0) == nil }
            #expect(unknown.isEmpty, "\(name): fields the model doesn't know: \(unknown.sorted())")

            let show = try JSONDecoder().decode(UpcomingShow.self, from: JSONSerialization.data(withJSONObject: doc))
            #expect(show.artist == doc["artist"] as? String, "\(name)")
            #expect(show.venue == doc["venue"] as? String, "\(name)")
            #expect(show.date == doc["date"] as? String, "\(name)")
            #expect(ShowDate.isoDay(show.date) == show.date, "\(name): an ISO day")
            #expect(show.time == (doc["time"] as? String), "\(name)")
            #expect(show.source == (doc["source"] as? String), "\(name)")
            #expect(show.ticketUrl == (doc["ticketUrl"] as? String), "\(name)")
            #expect(show.taggedFriendUids.isEmpty, "\(name)")
            #expect(show.taggedBy == (doc["taggedBy"] as? String), "\(name)")
            #expect(show.createdAt != nil && show.updatedAt != nil, "\(name): createdAt and updatedAt")
        }
    }
}
