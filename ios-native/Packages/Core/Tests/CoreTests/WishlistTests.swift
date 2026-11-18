import FirebaseFirestore
import Foundation
import Testing
@testable import Core

/// The song wishlist (Stage 4, 4-9): the documents lib/wishlist.js reads
/// and writes, and the web's three lists (WishlistView).
struct WishlistTests {
    private func show(_ id: String, _ artist: String, _ date: String, _ songs: [String]) throws -> Show {
        try ShowListTests.show(id, artist, date, songs: songs)
    }

    private func catalog(_ songs: [(String, Int)]) -> [ArtistSongStats.Song] {
        songs.map { ArtistSongStats.Song(name: $0.0, count: $0.1, plays: []) }
    }

    @Test func theArtistKeyIsTheWebs() {
        #expect(WishlistArtist(name: "Goose", mbid: "b6a2d4a0-1").key == "b6a2d4a0-1")
        #expect(WishlistArtist(name: "King Gizzard & the Lizard Wizard", mbid: nil).key == "king-gizzard-the-lizard-wizard")
        #expect(WishlistArtist(name: "Goose", mbid: "").key == "goose", "an empty mbid is none")
        // artistKeyFor doesn't trim first: it names stored documents (DECISIONS).
        #expect(WishlistArtist(name: " Goose", mbid: nil).key == "-goose")
    }

    @Test func aStarWritesTheWebsShape() throws {
        let artist = WishlistArtist(name: "Goose", mbid: "m1")
        #expect(Wishlist.documentId(uid: "u1", artist: artist) == "u1_m1")
        let data = try #require(Wishlist.addData(uid: "u1", artist: artist, title: "Arcadia (Live)", now: Date(timeIntervalSince1970: 0)))
        #expect(data["userId"] as? String == "u1")
        #expect(data["artistKey"] as? String == "m1")
        #expect(data["artistName"] as? String == "Goose")
        #expect(data["artistMbid"] as? String == "m1")
        let songs = try #require(data["songs"] as? [String: [String: String]])
        #expect(songs == ["arcadia": ["title": "Arcadia (Live)", "addedAt": "1970-01-01T00:00:00.000Z"]])
        #expect(data["updatedAt"] is FieldValue)
        // No MusicBrainz id: null, as the web writes it.
        let noMbid = try #require(Wishlist.addData(uid: "u1", artist: WishlistArtist(name: "Local Band", mbid: nil), title: "Song", now: Date()))
        #expect(noMbid["artistMbid"] is NSNull)
        // A title with nothing to key on isn't starred.
        #expect(Wishlist.addData(uid: "u1", artist: artist, title: "???", now: Date()) == nil)
        #expect(Wishlist.songKey("Ashes//Dust") == Wishlist.songKey("Ashes // Dust"))
    }

    @Test func theHubListsBandsWithStars() {
        let docs: [[String: Any]] = [
            ["artistName": "Phish", "artistMbid": "p", "songs": ["tweezer": ["title": "Tweezer"], "ghost": ["title": "Ghost"]]],
            ["artistName": "goose", "artistMbid": NSNull(), "songs": ["arcadia": ["title": "Arcadia"]]],
            ["artistName": "Empty", "songs": [String: Any]()],
        ]
        let list = Wishlist.summaries(docs)
        #expect(list.map(\.artist.name) == ["goose", "Phish"])
        #expect(list.map(\.songCount) == [1, 2])
        #expect(list.first?.artist.mbid == nil)
        #expect(list.last?.artist.key == "p")
    }

    @Test func entriesReadTheSongsMap() {
        let entries = Wishlist.entries(["tweezer": ["title": "Tweezer", "addedAt": "2026-01-01T00:00:00.000Z"], "ghost": ["title": "Ghost"]])
        #expect(entries.map(\.title) == ["Ghost", "Tweezer"])
        #expect(entries.last?.addedAt == "2026-01-01T00:00:00.000Z")
        #expect(Wishlist.entries(nil).isEmpty)
    }

    @Test func seenSongsCountShowsUnderTheMostLoggedSpelling() throws {
        let shows = [
            try show("a", "Goose", "2024-06-14", ["Arcadia", "Hot Tea", "Arcadia"]),
            try show("b", " goose ", "2024-06-15", ["arcadia", "Madhuvan"]),
            try show("c", "Goose", "2025-01-01", ["Arcadia"]),
            try show("d", "goose (US)", "2025-02-01", ["Tumble"]), // another band name to the web's exact match
            try show("e", "Phish", "2025-03-01", ["Arcadia"]),
        ]
        let seen = Wishlist.seen(shows, artist: "Goose")
        #expect(seen.map(\.title) == ["Arcadia", "Hot Tea", "Madhuvan"])
        #expect(seen.map(\.count) == [3, 1, 1]) // twice in one show counts once
    }

    @Test func allSongsIsTheCatalogPlusYours() throws {
        let seen = [Wishlist.Seen(title: "Arcadia", count: 3), Wishlist.Seen(title: "Bar Song", count: 1)]
        let all = Wishlist.allSongs(catalog: catalog([("Arcadia", 223), ("Hot Tea", 400), ("Tumble", 223)]), seen: seen)
        #expect(all.map(\.title) == ["Hot Tea", "Arcadia", "Tumble", "Bar Song"])
        #expect(all.first { $0.title == "Arcadia" }?.seenCount == 3)
        #expect(all.last?.plays == 0)
        #expect(Wishlist.isInCatalog("Bar Song", catalog: catalog([("Arcadia", 1)])) == false)
        #expect(Wishlist.isInCatalog("ARCADIA (live)", catalog: catalog([("Arcadia", 1)])))
    }

    @Test func seenEverythingNeedsACatalog() {
        let seen = [Wishlist.Seen(title: "Arcadia", count: 1), Wishlist.Seen(title: "Hot Tea", count: 1)]
        #expect(Wishlist.seenEverything(catalog: catalog([("Arcadia", 9), ("Hot Tea", 9)]), seen: seen))
        #expect(!Wishlist.seenEverything(catalog: catalog([("Arcadia", 9), ("Tumble", 9)]), seen: seen))
        #expect(!Wishlist.seenEverything(catalog: [], seen: seen))
    }
}
