import Foundation
import Testing
@testable import Core

/// What the app sends `normalize-show`, against the fixtures' `input`s (the
/// contract with lib/normalizeShow.js), and what it reads back.
@Suite struct ShowInputTests {
    static let files: [URL] = (try? FixtureLoader.files(in: "shows")) ?? []

    @Test(arguments: files)
    func everyFixtureInputRoundTrips(_ url: URL) throws {
        let fixture = try FixtureLoader.json(url)
        let input = try #require(fixture["input"] as? [String: Any])
        let decoded = try JSONDecoder().decode(ShowInput.self, from: JSONSerialization.data(withJSONObject: input))
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(decoded))
        let diff = JSONCompare.difference(encoded, input)
        #expect(diff == nil, "\(url.lastPathComponent): \(diff ?? "")")
    }

    @Test(arguments: files)
    func everyFixtureAnswerDecodes(_ url: URL) throws {
        let expected = try #require(FixtureLoader.json(url)["expected"] as? [String: Any])
        let result = try JSONDecoder().decode(NormalizeShowResult.self, from: JSONSerialization.data(withJSONObject: expected))
        if expected["error"] != nil {
            #expect(result.error != nil && result.show == nil)
        } else {
            #expect(result.show != nil)
            #expect(result.band != nil)
            if let dup = expected["duplicate"] as? [String: Any] {
                #expect(result.duplicate?.rule == dup["rule"] as? String)
            } else {
                #expect(result.duplicate == nil)
            }
        }
    }

    @Test func typedInputsEncodeAsTheServerReadsThem() throws {
        func json(_ input: ShowInput) throws -> [String: Any] {
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as! [String: Any]
        }
        let manual = try json(ShowInput(.manual(.init(artist: "Goose", venue: "Red Rocks", city: "Morrison", date: "2024-06-21"), .init(rating: 9)), showId: "1"))
        #expect(manual["kind"] as? String == "manual" && manual["rating"] as? Int == 9 && manual["showId"] as? String == "1")
        #expect(manual["comment"] == nil, "absent, not null")
        let tag = try json(ShowInput(.tag(tagId: "t1", asPastShow: false), showId: nil))
        #expect(tag as NSDictionary == ["kind": "tag", "tagId": "t1"] as NSDictionary)
        let up = try json(ShowInput(.upcoming(upcomingId: "u1", setlistfmId: nil, .none), showId: "2", confirmPossible: true))
        #expect(up as NSDictionary == ["kind": "upcoming", "upcomingId": "u1", "showId": "2", "confirmPossible": true] as NSDictionary)
    }

    @Test func showIdsAreMillisecondsAndNeverRepeat() {
        let now = Date(timeIntervalSince1970: 1_763_121_600)
        let a = ShowID.mint(now: now), b = ShowID.mint(now: now), c = ShowID.mint(now: now)
        #expect(a.count == 13 && Int64(a) != nil)
        #expect(Set([a, b, c]).count == 3)
        #expect(Int64(b)! == Int64(a)! + 1)
    }

    @Test func requestBodies() throws {
        func json<T: Encodable>(_ v: T) throws -> NSDictionary { try JSONSerialization.jsonObject(with: JSONEncoder().encode(v)) as! NSDictionary }
        #expect(try json(FriendsRequest.accept(requestId: "r1")) == ["action": "accept", "requestId": "r1"])
        #expect(try json(FriendsRequest.showsTogetherCounts(friendUids: ["a", "b"])) == ["action": "showsTogetherCounts", "friendUids": ["a", "b"]])
        #expect(try json(FriendsRequest.suggestionScan(showId: nil)) == ["action": "suggestionScan"])
        #expect(try json(DeleteAccountRequest(appleAuthorizationCode: "c0de")) == ["confirmText": "DELETE", "appleToken": "c0de", "appleTokenType": "CODE"])
        #expect(try json(DeleteAccountRequest(appleAuthorizationCode: nil)) == ["confirmText": "DELETE"])
        #expect(try json(AdoptGuestShowsRequest(mode: .commit, guestIdToken: "g", includePossible: ["s1"])) == ["mode": "commit", "guestIdToken": "g", "includePossible": ["s1"]])
        #expect(try json(NormalizeShowRequest.one(ShowInput(.tag(tagId: "t", asPastShow: true), showId: nil), .preview)) == ["mode": "preview", "input": ["kind": "tag", "tagId": "t", "asPastShow": true]])
        #expect(SetlistOperation.accept(showId: "s", onlyIfEmpty: true).function == "accept-proposal")
        #expect(SetlistOperation.scanMissing(showIds: nil, dryRun: true).body == ["dryRun": .bool(true)])
    }
}
