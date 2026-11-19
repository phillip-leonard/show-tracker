import Foundation
import Testing
@testable import Core

/// The Search tab (Stage 4, 4-12): lib/advancedSearch.js's rules (the cases
/// in lib/__tests__/advancedSearch.test.js), sorting, presets, the summary
/// line, saved and recent searches, and "By artist".
struct ShowSearchTests {
    private func show(_ id: String = "s1", artist: String = "Phish", venue: String = "Dick's Sporting Goods Park",
                      city: String = "Commerce City", country: String = "USA", date: String = "2023-07-15",
                      rating: Int? = 8, comment: String? = "Great second set", friends: [String] = ["friend-1"],
                      songs: [String] = ["Tweezer", "Wilson"], festivalId: String? = nil, festivalName: String? = nil) throws -> Show {
        var doc: [String: Any] = [
            "artist": artist, "venue": venue, "city": city, "country": country, "date": date,
            "taggedFriendUids": friends,
            "setlist": songs.enumerated().map { ["id": "x\($0.offset)", "name": $0.element] },
        ]
        if let rating { doc["rating"] = rating }
        if let comment { doc["comment"] = comment }
        if let festivalId { doc["festivalId"] = festivalId }
        if let festivalName { doc["festivalName"] = festivalName }
        var s = try JSONDecoder().decode(Show.self, from: JSONSerialization.data(withJSONObject: doc))
        s.id = id
        return s
    }

    private func with(_ change: (inout ShowSearchFilters) -> Void) -> ShowSearchFilters {
        var f = ShowSearchFilters()
        change(&f)
        return f
    }

    @Test func activeOnceAnyFieldIsSet() {
        #expect(!ShowSearchFilters().isActive)
        #expect(with { $0.artist = "Phish" }.isActive)
        #expect(with { $0.minRating = 5 }.isActive)
        #expect(!with { $0.artist = "  " }.isActive, "spaces alone aren't a filter")
    }

    @Test func textFiltersAreCaseInsensitiveSubstrings() throws {
        let s = try show()
        #expect(ShowSearch.match(s, with { $0.artist = "phi" }) == [.artist])
        #expect(ShowSearch.match(s, with { $0.artist = "Goose" }) == nil)
        #expect(ShowSearch.match(s, with { $0.venue = "dick's"; $0.city = "commerce"; $0.country = "us" }) == [.venue, .city, .country])
    }

    @Test func dateRangeIsInclusiveAndReadsLegacyDates() throws {
        let s = try show(date: "2023-07-15")
        #expect(ShowSearch.match(s, with { $0.dateFrom = "2023-07-15"; $0.dateTo = "2023-07-15" }) != nil)
        #expect(ShowSearch.match(s, with { $0.dateFrom = "2023-07-16" }) == nil)
        #expect(ShowSearch.match(s, with { $0.dateTo = "2023-07-14" }) == nil)
        let legacy = try show(date: "15-07-2023")
        #expect(ShowSearch.match(legacy, with { $0.dateFrom = "2023-07-01"; $0.dateTo = "2023-07-31" }) != nil,
                "a DD-MM-YYYY date is the same day (lib/showDate.js)")
    }

    @Test func minimumRatingExcludesLowerAndUnrated() throws {
        #expect(ShowSearch.match(try show(rating: 7), with { $0.minRating = 8 }) == nil)
        #expect(ShowSearch.match(try show(rating: 9), with { $0.minRating = 8 }) != nil)
        #expect(ShowSearch.match(try show(rating: nil), with { $0.minRating = 1 }) == nil)
    }

    @Test func notesFriendAndSongAreReportedForTheHint() throws {
        let s = try show(comment: "Best show ever")
        let fields = try #require(ShowSearch.match(s, with { $0.notes = "best show"; $0.friendUid = "friend-1"; $0.song = "tweez" }))
        #expect(fields == [.notes, .friend, .song])
        #expect(ShowSearch.hint(fields) == "matched your notes · matched tagged friend · matched a song in the setlist")
        #expect(ShowSearch.hint([.artist, .venue]) == nil)
        #expect(ShowSearch.match(s, with { $0.friendUid = "friend-2" }) == nil)
        #expect(ShowSearch.match(s, with { $0.song = "Harry Hood" }) == nil)
        #expect(ShowSearch.match(try show(comment: nil), with { $0.notes = "x" }) == nil)
    }

    @Test func tourAndFestivalUseTheShowIdsGiven() throws {
        let a = try show("a", festivalId: "f1", festivalName: "Bonnaroo"), b = try show("b")
        #expect(ShowSearch.filter([a, b], with { $0.tourKey = "phish:summer-tour" }, tourShowIds: ["b"]).map(\.show.id) == ["b"])
        #expect(ShowSearch.filter([a, b], with { $0.tourKey = "k" }).isEmpty, "no ids: nothing matches")
        let ids = ShowSearch.festivalShowIds([a, b], festivalId: "f1")
        #expect(ShowSearch.filter([a, b], with { $0.festivalKey = "f1" }, festivalShowIds: ids).map(\.show.id) == ["a"])
        #expect(ShowSearch.festivals([a, b]) == [ShowSearch.FestivalOption(id: "f1", name: "Bonnaroo")])
    }

    @Test func sortsAsTheWebWithStableTies() throws {
        let shows = try [
            show("1", artist: "Goose", date: "2024-01-01", rating: 7),
            show("2", artist: "billy strings", date: "2025-01-01", rating: nil),
            show("3", artist: "Phish", date: "2023-01-01", rating: 9),
            show("4", artist: "Arcade Fire", date: "2025-01-01", rating: 7),
        ]
        let all = ShowSearch.filter(shows, with { $0.minRating = 0; $0.country = "usa" })
        #expect(ShowSearch.sorted(all, by: .newest).map(\.show.id) == ["2", "4", "1", "3"])
        #expect(ShowSearch.sorted(all, by: .oldest).map(\.show.id) == ["3", "1", "2", "4"])
        #expect(ShowSearch.sorted(all, by: .rating).map(\.show.id) == ["3", "1", "4", "2"])
        #expect(ShowSearch.sorted(all, by: .artist).map(\.show.id) == ["4", "2", "1", "3"])
        #expect(ShowSearch.countLine(1) == "1 show" && ShowSearch.countLine(12) == "12 shows")
    }

    @Test func presetsSetTheDates() {
        let f = ShowSearchFilters()
        let month = ShowSearch.apply(.thisMonth, to: f, today: "2026-11-19")
        #expect(month.dateFrom == "2026-11-01" && month.dateTo == "2026-11-19")
        let year = ShowSearch.apply(.thisYear, to: f, today: "2026-11-19")
        #expect(year.dateFrom == "2026-01-01" && year.dateTo == "2026-12-31")
        let last = ShowSearch.apply(.lastYear, to: f, today: "2026-11-19")
        #expect(last.dateFrom == "2025-01-01" && last.dateTo == "2025-12-31")
    }

    @Test func summaryReadsAsTheWebs() {
        var f = ShowSearchFilters()
        f.artist = "Phish"; f.venue = "MSG"; f.dateFrom = "2024-01-01"; f.minRating = 8
        f.tourKey = "k"; f.friendUid = "u"; f.song = "Tweezer"; f.notes = "rain"
        #expect(ShowSearch.summary(f, tourName: "Summer Tour", friendName: "Sam")
                == "Phish · @ MSG · 2024-01-01 → … · tour: Summer Tour · 8★+ · notes: \"rain\" · with Sam · song: \"Tweezer\"")
    }

    @Test func savedAndRecentSearchesStayPerPersonAndCapped() throws {
        let defaults = try #require(UserDefaults(suiteName: "ShowSearchTests-\(UUID().uuidString)"))
        let mine = SavedSearches(uid: "u1", defaults: defaults)
        var f = ShowSearchFilters()
        f.artist = "Phish"
        mine.save(name: " Phish nights ", filters: f, now: Date(timeIntervalSince1970: 1))
        mine.save(name: "Goose", filters: ShowSearchFilters(), now: Date(timeIntervalSince1970: 2))
        mine.save(name: "Phish nights", filters: f, now: Date(timeIntervalSince1970: 3))
        #expect(mine.saved.map(\.name) == ["Phish nights", "Goose"], "the same name replaces and moves to the top")
        #expect(mine.saved.first?.filters.artist == "Phish")
        #expect(SavedSearches(uid: "u2", defaults: defaults).saved.isEmpty)
        #expect(mine.delete(name: "Goose").map(\.name) == ["Phish nights"])
        for i in 0..<25 { mine.save(name: "s\(i)", filters: f) }
        #expect(mine.saved.count == SavedSearches.maxSaved)

        for i in 0..<10 { mine.push(summary: "q\(i)", filters: f) }
        mine.push(summary: "q3", filters: f)
        #expect(mine.recent.count == SavedSearches.maxRecent)
        #expect(mine.recent.first?.summary == "q3")
        #expect(mine.recent.filter { $0.summary == "q3" }.count == 1)
        mine.clearRecent()
        #expect(mine.recent.isEmpty)
    }

    @Test func aSavedSearchFromTheWebsShapeReads() throws {
        let json = #"[{"name":"Old","filters":{"artist":"Goose","minRating":7},"savedAt":1700000000000}]"#
        let saved = try JSONDecoder().decode([SavedSearch].self, from: Data(json.utf8))
        #expect(saved.first?.filters.artist == "Goose" && saved.first?.filters.minRating == 7 && saved.first?.filters.song == "")
    }

    @Test func byArtistGroupsAndSorts() throws {
        let shows = try [
            show("1", artist: "Goose", date: "2024-01-01", rating: 6),
            show("2", artist: "Phish", date: "2025-01-01", rating: 9),
            show("3", artist: "Goose", date: "2025-06-01", rating: 8),
            show("4", artist: "Arcade Fire", date: "2022-01-01", rating: nil),
        ]
        let most = ShowSearch.artistGroups(shows, sort: .mostShows)
        #expect(most.map(\.artist) == ["Goose", "Phish", "Arcade Fire"])
        #expect(most[0].shows.map(\.id) == ["3", "1"], "newest first")
        #expect(most[0].averageRating == 7)
        #expect(most[2].averageRating == nil)
        #expect(ShowSearch.artistGroups(shows, sort: .rating).map(\.artist) == ["Phish", "Goose", "Arcade Fire"])
        #expect(ShowSearch.artistGroups(shows, sort: .name).map(\.artist) == ["Arcade Fire", "Goose", "Phish"])
        #expect(ShowSearch.average(7) == "7.0/10" && ShowSearch.average(nil) == nil)
    }

    @Test func activeFiltersAreChipsThatClearOneAtATime() {
        var f = ShowSearchFilters()
        #expect(ShowSearch.chips(f).isEmpty)
        f.artist = "Goose"
        f.venue = "Red Rocks"
        f.dateFrom = "2025-01-01"
        f.dateTo = "2025-12-31"
        f.minRating = 8
        f.song = "Arcadia"
        f.tourKey = "goose:summer-tour-2025"
        let chips = ShowSearch.chips(f, tourName: "Summer Tour 2025", day: { "d:" + $0 })
        #expect(chips.map(\.label) == ["Goose", "@ Red Rocks", "d:2025-01-01 – d:2025-12-31", "Summer Tour 2025", "8★ and up", "Song: “Arcadia”"])
        let noDates = ShowSearch.clearing(.dates, in: f)
        #expect(noDates.dateFrom.isEmpty && noDates.dateTo.isEmpty && noDates.artist == "Goose")
        var one = f
        for chip in chips { one = ShowSearch.clearing(chip.field, in: one) }
        #expect(!one.isActive, "clearing every chip clears every filter")
        var from = ShowSearchFilters()
        from.dateFrom = "2024-06-01"
        #expect(ShowSearch.chips(from).map(\.label) == ["From 2024-06-01"])
        var blank = ShowSearchFilters()
        blank.artist = "  "
        #expect(ShowSearch.chips(blank).isEmpty, "whitespace isn't a filter")
    }
}
