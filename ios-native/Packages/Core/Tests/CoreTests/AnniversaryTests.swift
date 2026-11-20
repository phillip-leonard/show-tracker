import Foundation
import Testing
@testable import Core

/// The show extras (Stage 6, 6-8): "Relive this night" and the upcoming
/// anniversaries against fixtures/anniversaries/cases.json (the web's
/// lib/__tests__/anniversaryFixtures.test.js reads the same file), relive's
/// once a day, and the Internet Archive backfill's shortlist and statuses.
@MainActor
struct AnniversaryTests {
    struct Fixture: Decodable {
        struct FixtureShow: Decodable { let id: String; let date: String }
        struct Case: Decodable {
            struct Upcoming: Decodable, Equatable { let id: String; let occurrence: String; let yearsAgo: Int }
            struct Expected: Decodable { let relive: String?; let upcoming: [Upcoming] }
            let name: String
            let today: String
            let showIds: [String]
            let expected: Expected
        }
        let shows: [FixtureShow]
        let cases: [Case]
    }

    static func fixture() throws -> Fixture {
        let url = try FixtureLoader.root.appendingPathComponent("anniversaries/cases.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    @Test func reliveAndUpcomingMatchTheWeb() throws {
        let f = try Self.fixture()
        #expect(f.cases.count >= 4)
        for c in f.cases {
            let shows = try c.showIds.map { id in
                let s = try #require(f.shows.first { $0.id == id })
                return try ShowListTests.show(s.id, "Band", s.date)
            }
            #expect(ReliveThisNight.pick(shows, today: c.today)?.id == c.expected.relive, "\(c.name): relive")
            let upcoming = Anniversaries.upcoming(shows, today: c.today).map {
                Fixture.Case.Upcoming(id: $0.show.id, occurrence: $0.occurrence, yearsAgo: $0.yearsAgo)
            }
            #expect(upcoming == c.expected.upcoming, "\(c.name): upcoming")
        }
    }

    @Test func reliveIsOfferedOnceADay() throws {
        let defaults = try #require(UserDefaults(suiteName: "AnniversaryTests.\(UUID().uuidString)"))
        let shows = [try ShowListTests.show("a", "Phish", "2019-11-20"), try ShowListTests.show("b", "Goose", "2022-11-20")]
        ReliveThisNight.reset()
        #expect(ReliveThisNight.show(for: "u1", shows: shows, today: "2026-11-20", defaults: defaults)?.id == "b")
        #expect(ReliveThisNight.show(for: "u1", shows: shows, today: "2026-11-20", defaults: defaults)?.id == "b",
                "the same run of the app keeps offering it, back from the show page")
        ReliveThisNight.dismiss()
        #expect(ReliveThisNight.show(for: "u1", shows: shows, today: "2026-11-20", defaults: defaults) == nil)

        ReliveThisNight.reset() // the app launched again later that day
        #expect(ReliveThisNight.show(for: "u1", shows: shows, today: "2026-11-20", defaults: defaults) == nil, "once a day")
        #expect(ReliveThisNight.show(for: "u2", shows: shows, today: "2026-11-20", defaults: defaults)?.id == "b", "per person")

        ReliveThisNight.reset()
        #expect(ReliveThisNight.show(for: "u1", shows: [shows[0]], today: "2027-11-20", defaults: defaults)?.id == "a", "a new day")
        #expect(ReliveThisNight.yearsAgo(shows[0], today: "2027-11-20") == 8)
        ReliveThisNight.reset()
    }

    // MARK: The Internet Archive backfill

    @Test func archiveBandsComeFromTheBundledConfig() throws {
        let bands = ArchiveBackfill.Bands.load()
        #expect(bands.mayBeArchive(try ShowListTests.show("a", "Grateful Dead", "1977-05-08")))
        #expect(bands.mayBeArchive(try ShowListTests.show("b", "The Grateful Dead", "1977-05-08")), "a leading The")
        #expect(!bands.mayBeArchive(try ShowListTests.show("c", "Phish", "1997-12-31")))
    }

    @Test func shortlistIsEmptySetlistsNotYetLookedUp() throws {
        let bands = ArchiveBackfill.Bands(names: ["gratefuldead"], mbids: [])
        let shows = [
            try ShowListTests.show("empty", "Grateful Dead", "1977-05-08"),
            try ShowListTests.show("has", "Grateful Dead", "1977-05-09", songs: ["Scarlet Begonias"]),
            try ShowListTests.show("checked", "Grateful Dead", "1977-05-10"),
            try ShowListTests.show("other", "Goose", "2024-07-31"),
        ]
        #expect(ArchiveBackfill.shortlist(shows, bands: bands, checked: ["checked"]).map(\.id) == ["empty"])
    }

    @Test func summaryNamesOneBand() throws {
        let gd = try ShowListTests.show("a", "Grateful Dead", "1977-05-08")
        let gd2 = try ShowListTests.show("b", "Grateful Dead", "1977-05-09")
        let kw = try ShowListTests.show("c", "Keller Williams", "2003-07-04")
        #expect(ArchiveBackfill.summary([gd]) == "1 Grateful Dead show with no setlist. The Internet Archive may have it.")
        #expect(ArchiveBackfill.summary([gd, gd2]) == "2 Grateful Dead shows with no setlist. The Internet Archive may have them.")
        #expect(ArchiveBackfill.summary([gd, kw]) == "2 shows with no setlist. The Internet Archive may have them.")
    }

    @Test func checkedShowsAreRememberedPerPerson() throws {
        let defaults = try #require(UserDefaults(suiteName: "AnniversaryTests.\(UUID().uuidString)"))
        ArchiveBackfill.remember("s1", uid: "u1", defaults: defaults)
        ArchiveBackfill.remember("s2", uid: "u1", defaults: defaults)
        #expect(ArchiveBackfill.checked(uid: "u1", defaults: defaults) == ["s1", "s2"])
        #expect(ArchiveBackfill.checked(uid: "u2", defaults: defaults).isEmpty)
    }

    @Test func statusesAreTheWebs() {
        func status(_ ok: Bool, _ reason: String?) -> ArchiveBackfill.Status { .from(proposal: SetlistOpAnswer(ok: ok, reason: reason)) }
        if case .found = status(true, nil) {} else { Issue.record("found") }
        #expect(status(false, "no-show").message == "No setlist for this date on the Internet Archive.")
        #expect(status(false, "no-songs").message.contains("none of them lists a setlist"))
        #expect(status(false, "ambiguous-date").isSettledWithoutSaving)
        #expect(status(false, "nothing-to-change").message == "Already matches the Internet Archive. Nothing to change.")
        #expect(status(false, "fetch-failed").message.hasPrefix("Couldn't reach the Internet Archive"))
        #expect(!status(false, "fetch-failed").isSettledWithoutSaving, "a failure is offered again later")

        let saved = ArchiveBackfill.Status.from(save: SetlistOpAnswer(ok: true))
        #expect(saved.message == "Saved." && !saved.isSettledWithoutSaving)
        let since = ArchiveBackfill.Status.from(save: SetlistOpAnswer(ok: false, reason: "has-setlist"))
        #expect(since.message == "This show has a setlist now, so it was left as it is." && since.isSettledWithoutSaving)
    }

    @Test func savingSendsOnlyIfEmpty() throws {
        let body = SetlistOperation.acceptBody(showId: "s1", result: .object(["songs": .array([])]), onlyIfEmpty: true)
        #expect(body["onlyIfEmpty"] == .bool(true))
        #expect(SetlistOperation.acceptBody(showId: "s1", result: .null)["onlyIfEmpty"] == nil, "the show page's accept is unchanged")
    }
}
