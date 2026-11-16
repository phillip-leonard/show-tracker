import Foundation
import Testing
@testable import Core

/// `SetlistOps` against stubbed answers from each operation
/// (lib/setlistOps.js shapes), in `APIClientTests`'s serialized suite since
/// they share its URL stub. The app sends ids (and, on accept, the result it
/// was shown) and writes nothing to `setlist` itself.
extension APIClientTests {
    func body(_ request: URLRequest) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: try #require(request.httpBody))
    }

    @Test func resyncSendsTheShowIdAndDescribesTheMerge() async throws {
        let api = client(answers: [Self.ok(#"""
        {"ok":true,"fields":{"setlist":[]},"source":{"id":"elgoose","label":"El Goose","requiresReview":false},
         "summary":{"existingCount":12,"resultCount":14,"added":[{},{}],"removed":[],"keptManual":[{}],"keptNotInSource":[],"carriedOver":{"rating":5,"comment":2}},
         "result":{"songs":[]},"ambiguous":false,"message":""}
        """#)])
        let answer = try await SetlistOps(api: api).resync(showId: "1730000000001")
        #expect(Stub.requests.first?.url?.path == "/.netlify/functions/resync-show")
        #expect(try body(Stub.requests[0]) == .object(["showId": .string("1730000000001")]))
        #expect(answer.ok)
        #expect(answer.describe(sourceName: "El Goose", date: "Jun 12, 2026")
                == "Updated from El Goose: 12 → 14 songs, 2 added, 1 of yours kept, 7 ratings/notes kept.")
    }

    @Test func aRefusedResyncSaysWhy() async throws {
        let api = client(answers: [Self.ok(#"{"ok":false,"reason":"would-lose-notes","before":{"rated":3},"after":{"rated":2}}"#)])
        let answer = try await SetlistOps(api: api).resync(showId: "x")
        #expect(!answer.ok)
        #expect(answer.describe(sourceName: "El Goose", date: "Jun 12, 2026").hasPrefix("Not updated: it would have dropped a rating or comment."))
        #expect(SetlistOpAnswer(ok: false, reason: "no-show").describe(sourceName: "Phish.net", date: "Dec 31, 2025")
                == "Phish.net has no show listed on Dec 31, 2025. Your setlist is unchanged.")
        #expect(SetlistOpAnswer(ok: false, reason: "nothing-to-change").describe(sourceName: "El Goose", date: "")
                == "Already matches El Goose. Nothing to change.")
    }

    @Test func proposeThenAcceptSendsBackTheResultShown() async throws {
        let result = #"{"source":"archive","songs":[{"name":"Scarlet Begonias","set":"Set II"}],"confidence":"inferred-sets","needsReview":true,"partial":false}"#
        let api = client(answers: [
            Self.ok(#"{"ok":true,"source":{"id":"archive","label":"Internet Archive","requiresReview":true},"result":"# + result + #","setlist":[{"id":"g1","name":"Scarlet Begonias","set":"Set II","rating":9}],"summary":{}}"#),
            Self.ok(#"{"ok":true,"fields":{},"summary":{"existingCount":3,"resultCount":3}}"#),
        ])
        let ops = SetlistOps(api: api)
        let proposed = try await ops.propose(showId: "1730000000005")
        #expect(Stub.requests[0].url?.path == "/.netlify/functions/propose-setlist")
        #expect(proposed.proposedSongs.map(\.name) == ["Scarlet Begonias"])
        #expect(proposed.proposedSongs.first?.rating == 9, "the review shows ratings carried over")
        #expect(proposed.reviewWarnings.count == 2, "inferred sets and recordings that disagree")

        let shown = try #require(proposed.result)
        _ = try await ops.accept(showId: "1730000000005", result: shown)
        #expect(Stub.requests[1].url?.path == "/.netlify/functions/accept-proposal")
        #expect(try body(Stub.requests[1]) == .object(["showId": .string("1730000000005"), "result": shown]))
    }

    @Test func aStoredProposalIsAcceptedOrRejectedById() async throws {
        let api = client(answers: [Self.ok(#"{"ok":true,"fields":{}}"#), Self.ok(#"{"ok":true,"fields":{}}"#)])
        let ops = SetlistOps(api: api)
        _ = try await ops.acceptStored(showId: "s")
        _ = try await ops.reject(showId: "s")
        #expect(Stub.requests.map { $0.url?.path } == ["/.netlify/functions/accept-proposal", "/.netlify/functions/reject-proposal"])
        #expect(try Stub.requests.map { try body($0) } == [.object(["showId": .string("s")]), .object(["showId": .string("s")])])
        #expect(Stub.requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer tok" })
    }
}
