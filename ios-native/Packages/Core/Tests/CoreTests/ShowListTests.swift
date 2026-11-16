import Foundation
import Testing
@testable import Core

/// The Shows tab's rules (`ShowList`): the web's order and count, years,
/// search, filters and setlist status.
@Suite struct ShowListTests {
    static func show(_ id: String, _ artist: String, _ date: String, venue: String = "Venue", city: String = "City",
                     songs: [String] = [], proposal: String? = nil) throws -> Show {
        var doc: [String: Any] = [
            "artist": artist, "venue": venue, "city": city, "date": date,
            "setlist": songs.enumerated().map { ["id": "s\($0.offset)", "name": $0.element] },
        ]
        if let proposal { doc["setlistProposal"] = ["status": proposal, "songs": []] }
        var s = try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: doc))
        s.id = id
        return s
    }

    static func upcoming(_ id: String, _ artist: String, _ date: String, venue: String = "Venue", city: String = "City") throws -> UpcomingShow {
        var u = try JSONDecoder().decode(UpcomingShow.self, from: JSONSerialization.data(withJSONObject: [
            "artist": artist, "venue": venue, "city": city, "date": date, "taggedFriendUids": [],
        ]))
        u.id = id
        return u
    }

    @Test func pastIsNewestFirstWithTiesByIdAndUnreadableLast() throws {
        let shows = try [
            Self.show("1700000000003", "B", "2024-05-01"),
            Self.show("1700000000001", "A", "2026-06-12"),
            Self.show("seed-1", "C", "not a date"),
            Self.show("1700000000002", "D", "2024-05-01"),
            Self.show("1700000000000", "E", "12-06-2026"), // legacy day-first: 2026-06-12
        ]
        #expect(ShowList.pastOrder(shows).map(\.id) == ["1700000000000", "1700000000001", "1700000000002", "1700000000003", "seed-1"])
    }

    @Test func sectionsByYearNewestFirst() throws {
        let shows = try [
            Self.show("1", "A", "2024-01-02"), Self.show("2", "B", "2026-03-04"),
            Self.show("3", "C", "2026-11-01"), Self.show("4", "D", "bad"),
        ]
        let sections = ShowList.byYear(shows)
        #expect(sections.map(\.year) == ["2026", "2024", ""])
        #expect(sections[0].shows.map(\.id) == ["3", "2"])
        #expect(sections.flatMap(\.shows).count == shows.count, "every show is in a section: the count matches the web")
    }

    @Test func upcomingIsSoonestFirstThenBand() throws {
        let list = try [
            Self.upcoming("a", "Phish", "2026-12-31"),
            Self.upcoming("b", "goose", "2026-11-20"),
            Self.upcoming("c", "Billy Strings", "2026-12-31"),
            Self.upcoming("d", "X", ""),
        ]
        #expect(ShowList.upcomingOrder(list).map(\.id) == ["b", "c", "a", "d"])
    }

    @Test func upcomingSectionsBySoonestYear() throws {
        let list = try [
            Self.upcoming("a", "Phish", "2027-01-02"),
            Self.upcoming("b", "Goose", "2026-12-30"),
            Self.upcoming("c", "Billy Strings", "2026-11-28"),
            Self.upcoming("d", "X", ""),
        ]
        let sections = ShowList.upcomingByYear(list)
        #expect(sections.map(\.year) == ["2026", "2027", ""])
        #expect(sections[0].shows.map(\.id) == ["c", "b"])
        #expect(sections.flatMap(\.shows).count == list.count)
    }

    @Test func searchMatchesBandVenueCityAndSongs() throws {
        let s = try Self.show("1", "Goose", "2024-05-01", venue: "Red Rocks", city: "Morrison, CO", songs: ["Arcadia", "Tumble"])
        for text in ["goose", "RED", "morrison", "tumb", "  arcadia "] {
            #expect(ShowList.matches(s, .init(text: text)), "\(text)")
        }
        #expect(!ShowList.matches(s, .init(text: "Phish")))
        let accented = try Self.show("2", "Sigur Rós", "2024-05-01", venue: "Café du Nord")
        #expect(ShowList.matches(accented, .init(text: "sigur ros")))
        #expect(ShowList.matches(accented, .init(text: "cafe")))
    }

    @Test func yearBandAndVenueFiltersCombine() throws {
        let shows = try [
            Self.show("1", "Goose", "2024-05-01", venue: "Red Rocks"),
            Self.show("2", "Goose", "2026-05-01", venue: "Red Rocks"),
            Self.show("3", "goose ", "2026-06-01", venue: "MSG"),
            Self.show("4", "Phish", "2026-06-01", venue: "MSG"),
        ]
        #expect(ShowList.filter(shows, .init(year: "2026")).map(\.id) == ["2", "3", "4"])
        #expect(ShowList.filter(shows, .init(band: "Goose")).map(\.id) == ["1", "2", "3"], "case and spacing don't split a band")
        #expect(ShowList.filter(shows, .init(year: "2026", band: "Goose", venue: "msg")).map(\.id) == ["3"])
        #expect(ShowList.filter(shows, .init()).count == 4)
        #expect(ShowList.Filter(text: "  ").isEmpty)
        #expect(ShowList.Filter(year: "2026", band: "Goose").activeCount == 2)
    }

    @Test func filterOptions() throws {
        let shows = try [
            Self.show("1", "Goose", "2024-05-01", venue: "Red Rocks"),
            Self.show("2", "goose", "2026-05-01", venue: "MSG"),
            Self.show("3", "Phish", "2026-06-01", venue: "MSG"),
            Self.show("4", "Billy Strings", "2025-06-01", venue: "MSG"),
            Self.show("5", "", "bad", venue: ""),
        ]
        #expect(ShowList.years(shows) == ["2026", "2025", "2024"])
        let bands = ShowList.bands(shows)
        #expect(bands.map(\.name) == ["goose", "Billy Strings", "Phish"], "most shows first, then by name; the newest spelling")
        #expect(bands.first?.count == 2)
        #expect(ShowList.venues(shows).map(\.name) == ["MSG", "Red Rocks"])
    }

    @Test func setlistStatus() throws {
        #expect(ShowList.setlistStatus(try Self.show("1", "A", "2024-01-01", songs: ["x", "y"])) == .songs(2))
        #expect(ShowList.setlistStatus(try Self.show("2", "A", "2024-01-01")) == .missing)
        #expect(ShowList.setlistStatus(try Self.show("3", "A", "2024-01-01", songs: ["x"], proposal: "pending")) == .proposalWaiting)
        #expect(ShowList.setlistStatus(try Self.show("4", "A", "2024-01-01", songs: ["x"], proposal: "accepted")) == .songs(1))
    }

    @Test func aShowDatedAfterTodayIsMarked() throws {
        #expect(ShowList.isFutureDated(try Self.show("1", "A", "2026-11-16"), today: "2026-11-15"))
        #expect(!ShowList.isFutureDated(try Self.show("2", "A", "2026-11-15"), today: "2026-11-15"), "tonight is not marked")
        #expect(!ShowList.isFutureDated(try Self.show("3", "A", "bad"), today: "2026-11-15"))
    }
}
