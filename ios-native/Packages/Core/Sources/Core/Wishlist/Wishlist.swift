import FirebaseFirestore
import Foundation

// The song wishlist (Stage 4, 4-9): lib/wishlist.js and the web's
// WishlistView. One document per person and band,
// `wishlists/{uid}_{artistKey}`:
//   { userId, artistKey, artistName, artistMbid, songs: { [songKey]:
//     { title, addedAt } }, updatedAt }
// The rules let the owner read and write it, guests included (their own
// data), and read it before it exists.

/// A band to keep a wishlist for: as setlist.fm names it, with its
/// MusicBrainz id when there is one (the document key prefers it).
public struct WishlistArtist: Hashable, Sendable {
    public var name: String
    public var mbid: String?

    public init(name: String, mbid: String?) {
        self.name = name
        self.mbid = mbid.flatMap { $0.isEmpty ? nil : $0 }
    }

    /// `artistKeyFor`: the MusicBrainz id, else a slug of the name. Kept as
    /// the web has it (DECISIONS, "Artist slugs trim first"): it names
    /// stored documents, so " Goose" stays "-goose".
    public var key: String {
        if let mbid { return mbid }
        var s = name.lowercased()
        s = s.replacingOccurrences(of: #"[^a-z0-9\s-]"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+"#, with: "-", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// A band you've starred songs for (the hub's "Your wishlists").
public struct WishlistSummary: Hashable, Sendable, Identifiable {
    public var artist: WishlistArtist
    public var songCount: Int
    public var id: String { artist.key }

    public init(artist: WishlistArtist, songCount: Int) {
        self.artist = artist
        self.songCount = songCount
    }
}

/// A starred song.
public struct WishlistEntry: Hashable, Sendable, Identifiable {
    public var key: String
    public var title: String
    public var addedAt: String?
    public var id: String { key }

    /// The app makes one while a star is saving (it shows at once).
    public init(key: String, title: String, addedAt: String?) {
        self.key = key
        self.title = title
        self.addedAt = addedAt
    }
}

public enum Wishlist {
    /// The document id: `${uid}_${artistKey}`.
    public static func documentId(uid: String, artist: WishlistArtist) -> String { "\(uid)_\(artist.key)" }

    /// A song's key in `songs`: `normalizeSongTitle`, or nil when that's
    /// empty (the web doesn't star such a song).
    public static func songKey(_ title: String) -> String? {
        let key = StatsKeys.normalizeSongTitle(title)
        return key.isEmpty ? nil : key
    }

    /// What starring a song writes (`addWishlistSong`, with `merge: true`).
    public static func addData(uid: String, artist: WishlistArtist, title: String, now: Date) -> [String: Any]? {
        guard let key = songKey(title) else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return [
            "userId": uid,
            "artistKey": artist.key,
            "artistName": artist.name,
            "artistMbid": artist.mbid.map { $0 as Any } ?? NSNull(),
            "songs": [key: ["title": title, "addedAt": f.string(from: now)]],
            "updatedAt": FieldValue.serverTimestamp(),
        ]
    }

    /// The starred songs in a document's `songs` map, by title.
    public static func entries(_ songs: [String: Any]?) -> [WishlistEntry] {
        (songs ?? [:]).compactMap { key, value -> WishlistEntry? in
            let entry = value as? [String: Any] ?? [:]
            let title = (entry["title"] as? String) ?? key
            return WishlistEntry(key: key, title: title, addedAt: entry["addedAt"] as? String)
        }
        .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    /// The hub's list (`listWishlistedArtists`): bands with at least one
    /// starred song, by name.
    public static func summaries(_ docs: [[String: Any]]) -> [WishlistSummary] {
        docs.compactMap { data -> WishlistSummary? in
            let count = (data["songs"] as? [String: Any])?.count ?? 0
            guard count > 0, let name = data["artistName"] as? String, !name.isEmpty else { return nil }
            return WishlistSummary(artist: WishlistArtist(name: name, mbid: data["artistMbid"] as? String), songCount: count)
        }
        .sorted { $0.artist.name.localizedStandardCompare($1.artist.name) == .orderedAscending }
    }

    // MARK: Songs you've seen, and every song

    /// A song you've seen the band play: shows you saw it at.
    public struct Seen: Hashable, Sendable, Identifiable {
        public var title: String
        public var count: Int
        public var id: String { title }
    }

    /// Your songs of the band (the web's "The songs I've seen"): your shows
    /// whose band is this name (trimmed, any case), each song counted once
    /// a show, keyed by `songKey` and shown under its most logged spelling.
    public static func seen(_ shows: [Show], artist: String) -> [Seen] {
        let target = artist.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var order: [String] = []
        var counts: [String: (count: Int, spellings: [(String, Int)])] = [:]
        for show in ShowList.pastOrder(shows) where show.artist.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == target {
            var here = Set<String>()
            for song in show.setlist {
                let key = StatsKeys.songKey(song.name)
                guard !key.isEmpty, here.insert(key).inserted else { continue }
                if counts[key] == nil { order.append(key); counts[key] = (0, []) }
                counts[key]?.count += 1
                if let i = counts[key]?.spellings.firstIndex(where: { $0.0 == song.name }) {
                    counts[key]?.spellings[i].1 += 1
                } else {
                    counts[key]?.spellings.append((song.name, 1))
                }
            }
        }
        return order.compactMap { key -> Seen? in
            guard let c = counts[key] else { return nil }
            // The most logged spelling; the first seen on a tie.
            var best = c.spellings[0]
            for s in c.spellings.dropFirst() where s.1 > best.1 { best = s }
            return Seen(title: best.0, count: c.count)
        }
        .sorted { a, b in a.count != b.count ? a.count > b.count : a.title.localizedStandardCompare(b.title) == .orderedAscending }
    }

    /// One row of "All songs": setlist.fm's catalog and your own songs of
    /// the band, one row per song.
    public struct Song: Hashable, Sendable, Identifiable {
        public var key: String
        public var title: String
        /// Times setlist.fm has the band playing it (0 when it has no record).
        public var plays: Int
        /// Shows you saw it at.
        public var seenCount: Int
        public var id: String { key }
    }

    /// "All songs" (`allSongs`): the catalog plus every song you've seen,
    /// keyed by `normalizeSongTitle`, most played first, then by name.
    public static func allSongs(catalog: [ArtistSongStats.Song], seen: [Seen]) -> [Song] {
        var order: [String] = []
        var rows: [String: Song] = [:]
        for song in catalog {
            guard let key = songKey(song.name) else { continue }
            if rows[key] == nil { order.append(key) }
            rows[key] = Song(key: key, title: song.name, plays: song.count, seenCount: 0)
        }
        for song in seen {
            guard let key = songKey(song.title) else { continue }
            if rows[key] != nil {
                rows[key]?.seenCount = song.count
            } else {
                order.append(key)
                rows[key] = Song(key: key, title: song.title, plays: 0, seenCount: song.count)
            }
        }
        return order.compactMap { rows[$0] }
            .sorted { a, b in a.plays != b.plays ? a.plays > b.plays : a.title.localizedStandardCompare(b.title) == .orderedAscending }
    }

    /// "You've seen everything setlist.fm has on record": a catalog, and
    /// none of it left unseen.
    public static func seenEverything(catalog: [ArtistSongStats.Song], seen: [Seen]) -> Bool {
        guard !catalog.isEmpty else { return false }
        let seenKeys = Set(seen.map { StatsKeys.normalizeSongTitle($0.title) })
        return catalog.allSatisfy { seenKeys.contains(StatsKeys.normalizeSongTitle($0.name)) }
    }

    /// A seen song setlist.fm has no record of (once the catalog has loaded).
    public static func isInCatalog(_ title: String, catalog: [ArtistSongStats.Song]) -> Bool {
        let key = StatsKeys.normalizeSongTitle(title)
        return catalog.contains { StatsKeys.normalizeSongTitle($0.name) == key }
    }
}

// MARK: - Reading and writing

/// The wishlist documents, read and written as lib/wishlist.js does, and
/// each band's catalog (`get-artist-song-stats`), kept for 24 hours as the
/// web keeps it.
@MainActor
public enum WishlistService {
    static let deadline: Duration = .seconds(10)

    /// Every band you've starred a song for.
    public static func summaries(uid: String) async throws -> [WishlistSummary] {
        let db = await Database.ready()
        let query = db.collection("wishlists").whereField("userId", isEqualTo: uid)
        let snap = try await withDeadline(deadline) { try await query.getDocuments() }
        return Wishlist.summaries(snap.documents.map { $0.data() })
    }

    /// Your starred songs for one band ([] before the first star).
    public static func entries(uid: String, artist: WishlistArtist) async throws -> [WishlistEntry] {
        let db = await Database.ready()
        let ref = db.collection("wishlists").document(Wishlist.documentId(uid: uid, artist: artist))
        let snap = try await withDeadline(deadline) { try await ref.getDocument() }
        return Wishlist.entries(snap.data()?["songs"] as? [String: Any])
    }

    /// Stars a song (one merge write, no read first, as the web does).
    public static func add(uid: String, artist: WishlistArtist, title: String) async throws {
        guard let data = Wishlist.addData(uid: uid, artist: artist, title: title, now: Date()) else { return }
        let db = await Database.ready()
        try await db.collection("wishlists").document(Wishlist.documentId(uid: uid, artist: artist)).setData(data, merge: true)
    }

    /// Unstars a song: deletes that one key. A document that was never
    /// written has nothing to remove.
    public static func remove(uid: String, artist: WishlistArtist, title: String) async throws {
        guard let key = Wishlist.songKey(title) else { return }
        let db = await Database.ready()
        let ref = db.collection("wishlists").document(Wishlist.documentId(uid: uid, artist: artist))
        do {
            try await ref.updateData([FieldPath(["songs", key]): FieldValue.delete(), "updatedAt": FieldValue.serverTimestamp()])
        } catch {
            if (error as NSError).code != FirestoreErrorCode.notFound.rawValue { throw error }
        }
    }

    private static var catalogs: [String: (at: Date, songs: [ArtistSongStats.Song])] = [:]

    /// Every song setlist.fm has the band playing live.
    public static func catalog(mbid: String, api: APIClient) async throws(APIError) -> [ArtistSongStats.Song] {
        if let hit = catalogs[mbid], Date().timeIntervalSince(hit.at) < 24 * 60 * 60 { return hit.songs }
        let songs = try await TourLookups.songStats(mbid: mbid, api: api).songs
        catalogs[mbid] = (Date(), songs)
        return songs
    }
}
