import Foundation
import Testing
@testable import Core

/// "Add shows from a tour" (Stage 4, 4-12): lib/tourBrowse.js's rules.
struct TourBrowseTests {
    private func tour(_ name: String, start: String? = nil, untagged: Bool = false) throws -> ArtistTours.Tour {
        var doc: [String: Any] = ["name": name, "untagged": untagged, "showCount": 3, "avgSongCount": 18, "shows": []]
        if let start { doc["startDate"] = start }
        return try JSONDecoder().decode(ArtistTours.Tour.self, from: JSONSerialization.data(withJSONObject: doc))
    }

    private func night(_ artist: String, _ date: String, venue: String, id: String? = nil, city: String = "Denver") -> TourShows.Night {
        var raw: [String: JSONValue] = ["artist": .string(artist), "date": .string(date), "venue": .string(venue), "city": .string(city)]
        if let id { raw["setlistfmId"] = .string(id) }
        return TourShows.Night(raw: .object(raw))
    }

    private func show(_ artist: String, _ date: String, venue: String, setlistfmId: String? = nil) throws -> Show {
        var doc: [String: Any] = ["artist": artist, "venue": venue, "city": "X", "date": date, "setlist": []]
        if let setlistfmId { doc["setlistfmId"] = setlistfmId }
        return try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: doc))
    }

    @Test func tourNamesNormalizeButKeepTheYear() {
        #expect(TourBrowse.normalizeTourName("  Summer  Tour 2025! ") == "summer tour 2025")
        #expect(TourBrowse.normalizeTourName("“Fall” Tour") == "fall' tour")
        #expect(TourBrowse.tourNamesMatch("Summer Tour 2025", "summer tour 2025"))
        #expect(!TourBrowse.tourNamesMatch("Summer Tour 2024", "Summer Tour 2025"))
        #expect(!TourBrowse.tourNamesMatch("", ""))
    }

    @Test func aRepeatedNameGetsItsYear() throws {
        let a = try tour("Summer Tour", start: "2024-06-01"), b = try tour("Summer Tour", start: "2025-06-01"), c = try tour("Fall Tour 2025")
        #expect(TourBrowse.optionLabel(a, in: [a, b, c]) == "Summer Tour (2024)")
        #expect(TourBrowse.optionLabel(c, in: [a, b, c]) == "Fall Tour 2025")
    }

    @Test func freeTextSplitsLongestBandFirst() {
        #expect(TourBrowse.splitCandidates("Goose") == [])
        #expect(TourBrowse.splitCandidates("My Morning Jacket Summer Tour") == [
            .init(artistQuery: "My Morning Jacket", tourQuery: "Summer Tour"),
            .init(artistQuery: "My Morning", tourQuery: "Jacket Summer Tour"),
            .init(artistQuery: "My", tourQuery: "Morning Jacket Summer Tour"),
        ])
        #expect(TourBrowse.splitCandidates("Goose Fall").map(\.artistQuery) == ["Goose"])
    }

    @Test func onlyAnExactNameSkipsAStep() {
        let found = [SetlistfmSearch.Artist(mbid: "1", name: "Goose"), SetlistfmSearch.Artist(mbid: "2", name: "Goose Creek Symphony")]
        #expect(TourBrowse.exactMatches(found, " goose ").map(\.mbid) == ["1"])
        #expect(TourBrowse.exactMatches(found, "").isEmpty)
    }

    @Test func aTourQueryResolvesOnlyToOneTour() throws {
        let tours = try [tour("Summer Tour 2025"), tour("Fall Tour 2025"), tour("Fall Tour 2024"), tour("No Tour Listed", untagged: true)]
        #expect(TourBrowse.resolveTourQuery("summer tour 2025", in: tours)?.name == "Summer Tour 2025")
        #expect(TourBrowse.resolveTourQuery("summer", in: tours)?.name == "Summer Tour 2025", "a unique prefix")
        #expect(TourBrowse.resolveTourQuery("fall tour", in: tours) == nil, "two tours start that way")
        #expect(TourBrowse.resolveTourQuery("no tour", in: tours) == nil, "never the untagged bucket")
        #expect(TourBrowse.resolveTourQuery("", in: tours) == nil)
    }

    @Test func nightsAlreadyYoursFollowTheDuplicateRule() throws {
        let shows = try [
            show("Goose", "2025-06-14", venue: "Red Rocks Amphitheatre", setlistfmId: "abc"),
            show("Goose", "2025-06-20", venue: "Dick's Sporting Goods Park"),
            show("goose", "2025-06-21", venue: "The Gorge"),
        ]
        #expect(TourBrowse.status(night("Goose", "2025-06-14", venue: "Somewhere", id: "abc"), in: shows) == .added, "same setlist")
        #expect(TourBrowse.status(night("Goose", "2025-06-20", venue: "Dicks Sporting Goods Park"), in: shows) == .added, "punctuation ignored")
        #expect(TourBrowse.status(night("Goose", "2025-06-21", venue: "Gorge Amphitheatre"), in: shows) == .possible)
        #expect(TourBrowse.status(night("Goose", "2025-06-22", venue: "The Gorge"), in: shows) == .new)
        #expect(TourBrowse.status(night("Phish", "2025-06-20", venue: "Dick's Sporting Goods Park"), in: shows) == .new)
    }

    @Test func longToursGroupByMonth() {
        let short = (1...3).map { night("Goose", "2025-06-0\($0)", venue: "V\($0)") }
        #expect(TourBrowse.grouped(short).count == 1 && TourBrowse.grouped(short)[0].label == nil)
        let long = (1...8).map { night("Goose", String(format: "2025-06-%02d", $0), venue: "V") }
            + (1...6).map { night("Goose", String(format: "2025-07-%02d", $0), venue: "V") }
        #expect(TourBrowse.grouped(long).map(\.label) == ["June 2025", "July 2025"])
        #expect(TourBrowse.filter(long, "v").count == 14 && TourBrowse.filter(short, "v2").count == 1)
        #expect(TourBrowse.filter(short, "denver").count == 3)
    }

    @Test func resultLine() {
        #expect(TourBrowse.resultLine(added: 3, waiting: 0, skipped: 1, failed: 0) == "Added 3 shows. 1 already in your shows.")
        #expect(TourBrowse.resultLine(added: 0, waiting: 0, skipped: 0, failed: 0) == nil)
    }
}
