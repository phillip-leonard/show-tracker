import Foundation
import Testing
@testable import Core

/// Part 4: the upcoming-show rules against `fixtures/upcoming-shows/`,
/// setlist.fm search results, and what a `normalize-show` answer means for
/// an outbox entry.
@Suite struct AddShowTests {
    static func fixture(_ path: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: FixtureLoader.data(path))
    }

    static func cases(_ file: JSONValue) -> [JSONValue] {
        if case .array(let list)? = file["cases"] { return list }
        return []
    }

    // MARK: Upcoming shows (lib/upcomingShows.js)

    @Test func newUpcomingRecordMatchesTheWeb() throws {
        let file = try Self.fixture("upcoming-shows/create.json")
        let now = try #require(file["now"])
        #expect(!Self.cases(file).isEmpty)
        for c in Self.cases(file) {
            let extra = c["extra"]
            let doc = UpcomingShowRules.newRecord(UpcomingInput(json: c["input"] ?? .object([:])),
                                                  taggedBy: extra?["taggedBy"]?.stringValue, taggedByUid: extra?["taggedByUid"]?.stringValue,
                                                  originUpcomingId: extra?["originUpcomingId"]?.stringValue, now: now)
            #expect(JSONValue.object(doc) == c["expected"], "\(c["name"]?.stringValue ?? "")")
        }
    }

    @Test func upcomingUpdateMatchesTheWeb() throws {
        let file = try Self.fixture("upcoming-shows/update.json")
        let now = try #require(file["now"])
        for c in Self.cases(file) {
            let doc = UpcomingShowRules.update(UpcomingInput(json: c["input"] ?? .object([:])), now: now)
            #expect(JSONValue.object(doc) == c["expected"], "\(c["name"]?.stringValue ?? "")")
        }
    }

    @Test func upcomingValidationMatchesTheWeb() throws {
        let file = try Self.fixture("upcoming-shows/validate.json")
        let today = try #require(file["today"]?.stringValue)
        for c in Self.cases(file) {
            let problem = UpcomingShowRules.problem(UpcomingInput(json: c["input"] ?? .object([:])), today: today)
            #expect((problem.map(JSONValue.string) ?? .null) == c["expected"], "\(c["name"]?.stringValue ?? "")")
        }
    }

    @Test func upcomingDuplicateMatchesTheWeb() throws {
        let file = try Self.fixture("upcoming-shows/duplicate.json")
        guard case .array(let raw)? = file["existing"] else { Issue.record("no existing"); return }
        let existing: [UpcomingShow] = try raw.map { doc in
            var o = doc
            if case .object(var m) = doc { m["taggedFriendUids"] = .array([]); o = .object(m) }
            var show = try JSONDecoder().decode(UpcomingShow.self, from: JSONEncoder().encode(o))
            show.id = doc["id"]?.stringValue ?? ""
            return show
        }
        for c in Self.cases(file) {
            let found = UpcomingShowRules.duplicate(of: UpcomingInput(json: c["input"] ?? .object([:])), in: existing)
            #expect((found.map { JSONValue.string($0.id) } ?? .null) == c["expected"], "\(c["name"]?.stringValue ?? "")")
        }
    }

    // MARK: setlist.fm search

    @Test func aSetlistfmSetlistReadsForTheResultRow() throws {
        let file = try Self.fixture("shows/setlistfm-search.json")
        let raw = try #require(file["context"]?["setlistfm"]?["63de4613"])
        let s = SetlistfmSearch.Setlist(raw: raw)
        #expect(s.id == "63de4613")
        #expect(!s.artist.isEmpty && !s.venue.isEmpty)
        #expect(s.date.count == 10 && s.date == ShowDate.fromSetlistfm(raw["eventDate"]?.stringValue), "DD-MM-YYYY read as an ISO day")
        #expect(s.songCount > 0)
    }

    @Test func aPageKnowsWhetherThereIsMore() {
        let one = JSONValue.object(["id": .string("a"), "eventDate": .string("12-06-2026")])
        let page = SetlistfmSearch.page(from: .object(["setlist": .array([one]), "page": .number(1), "total": .number(45), "itemsPerPage": .number(20)]))
        #expect(page.setlists.count == 1 && page.hasMore)
        #expect(!SetlistfmSearch.page(from: .object(["setlist": .array([one]), "page": .number(3), "total": .number(45), "itemsPerPage": .number(20)])).hasMore)
        #expect(SetlistfmSearch.page(from: .object([:])).setlists.isEmpty)
    }

    @Test func theQueryPrefersThePickedArtistAndDropsEmptyFields() {
        let q = SetlistfmSearch.Query(artistMbid: "mbid-1", artistName: "Goose", year: " 2026 ", venueName: "", cityName: nil)
        #expect(q.parameters(page: 2) == ["artistMbid": "mbid-1", "year": "2026", "p": "2"])
        #expect(SetlistfmSearch.Query(artistName: "Goose").parameters(page: 1) == ["artistName": "Goose", "p": "1"])
        #expect(SetlistfmSearch.Query(artistName: "  ").isEmpty)
        #expect(!SetlistfmSearch.Query(cityName: "Denver").isEmpty, "a city alone is a search")
    }

    @Test func iWentFindsTheNightPreferringTheSameVenue() {
        func setlist(_ id: String, _ date: String, _ venue: String) -> SetlistfmSearch.Setlist {
            .init(raw: .object(["id": .string(id), "eventDate": .string(date), "venue": .object(["name": .string(venue)])]))
        }
        let list = [setlist("a", "11-06-2026", "Red Rocks"), setlist("b", "12-06-2026", "Aftershow Club"), setlist("c", "12-06-2026", "Red Rocks Amphitheatre")]
        #expect(SetlistfmSearch.setlist(for: "2026-06-12", venue: "Red Rocks Amphitheatre", in: list)?.id == "c")
        #expect(SetlistfmSearch.setlist(for: "2026-06-12", venue: "red rocks", in: list)?.id == "c", "contained, any case")
        #expect(SetlistfmSearch.setlist(for: "2026-06-11", venue: "", in: list)?.id == "a")
        #expect(SetlistfmSearch.setlist(for: "2026-06-13", venue: "", in: list) == nil)
    }

    // MARK: What normalize-show's answer means

    static func result(_ json: String) throws -> NormalizeShowResult {
        try JSONDecoder().decode(NormalizeShowResult.self, from: Data(json.utf8))
    }

    @Test func commitAnswersBecomeOutboxVerdicts() throws {
        #expect(ShowsStore.verdict(try Self.result(#"{"written":true,"created":true,"showId":"1763"}"#), showId: "1763") == .added("1763"))
        #expect(ShowsStore.verdict(try Self.result(#"{"written":false,"showId":"1763","alreadyNormalized":true}"#), showId: "1763") == .added("1763"),
                "a retry after a lost answer is the same show")
        #expect(ShowsStore.verdict(try Self.result(#"{"written":false,"showId":"999","mergedInto":"999","duplicate":{"showId":"999","rule":"same-show"}}"#), showId: "1763")
                == .alreadyThere("999"))
        #expect(ShowsStore.verdict(try Self.result(#"{"written":false,"showId":"1763","needsConfirmation":true,"duplicate":{"showId":"555","rule":"possible"}}"#), showId: "1763")
                == .needsAnswer(existing: "555"))
    }

    @Test func aFirstShowIsOneAddedToShowsThatHadLoadedEmpty() {
        #expect(ShowsStore.isFirstShow("1763", loaded: true, existing: []))
        #expect(ShowsStore.isFirstShow("1763", loaded: true, existing: ["1763"]), "the listener can have it before the answer")
        #expect(!ShowsStore.isFirstShow("1763", loaded: true, existing: ["900"]))
        #expect(!ShowsStore.isFirstShow("1763", loaded: false, existing: []), "before the shows load, nobody can tell")
    }

    @Test func errorsDecideWhetherTheAddWaitsOrIsRefused() {
        #expect(ShowsStore.verdict(.offline) == .wait)
        #expect(ShowsStore.verdict(.server(status: 502, message: nil, code: nil)) == .wait)
        #expect(ShowsStore.verdict(.server(status: 408, message: nil, code: nil)) == .wait)
        #expect(ShowsStore.verdict(.rateLimited(message: "limit", retryAfter: nil)) == .wait)
        #expect(ShowsStore.verdict(.server(status: 400, message: "artist is required.", code: "bad-input"))
                == .refused("artist is required.", dropsInput: true))
        #expect(ShowsStore.verdict(.signInRequired(message: nil)) == .refused("Sign in again to add shows.", dropsInput: false),
                "the input is fine; it stays queued for after sign-in")
    }

    @Test func theOutboxKeepsTheAnswerStateAndLeavesNoFileWhenEmpty() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        var entry = QueuedShow(showId: "1763251200000",
                               input: ShowInput(.manual(.init(artist: "Goose", venue: "Ryman", date: "2026-11-14"), .none), showId: "1763251200000"),
                               display: .init(artist: "Goose", venue: "Ryman", city: "", date: "2026-11-14"),
                               enqueuedAt: Date(timeIntervalSince1970: 1_763_251_200), state: .needsAnswer)
        entry.possibleDuplicateOf = "555"
        try ShowOutbox.save([entry], uid: "u", in: dir)
        #expect(ShowOutbox.load(uid: "u", in: dir) == [entry])
        try ShowOutbox.save([], uid: "u", in: dir)
        #expect(!FileManager.default.fileExists(atPath: ShowOutbox.url(uid: "u", in: dir).path))
    }
}

/// The search functions over the stubbed client (in `APIClientTests`'s
/// serialized suite, which owns the URL stub).
extension APIClientTests {
    @Test func searchingArtistsAndSetlists() async throws {
        let api = client(answers: [
            Self.ok(#"{"artist":[{"mbid":"m1","name":"Goose","disambiguation":"US jam band"},{"mbid":"m2","name":"Goose"}]}"#),
            Self.status(404, #"{"code":404,"message":"not found"}"#),
            Self.ok(#"{"setlist":[{"id":"s1","eventDate":"12-06-2026","artist":{"name":"Goose"},"venue":{"name":"Red Rocks","city":{"name":"Morrison","stateCode":"CO"}}}],"total":1,"page":1,"itemsPerPage":20}"#),
        ])
        let search = SetlistfmSearch(api: api)
        let artists = try await search.artists(named: " Goose ")
        #expect(artists.map(\.mbid) == ["m1", "m2"] && artists.first?.disambiguation == "US jam band")
        #expect(Stub.requests[0].url?.query == "artistName=Goose")

        let none = try await search.setlists(.init(artistName: "Nobody"))
        #expect(none.setlists.isEmpty, "setlist.fm's 404 is no results")

        let page = try await search.setlists(.init(artistMbid: "m1", year: "2026"))
        #expect(page.setlists.first?.city == "Morrison, CO")
        #expect(Stub.requests[2].url?.path == "/.netlify/functions/search-setlists")
        #expect(Stub.requests[2].url?.query == "artistMbid=m1&p=1&year=2026")
    }
}
