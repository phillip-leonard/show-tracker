import Foundation

/// A person's edit to a setlist, as an operation on songs by id: the Swift
/// copy of `lib/setlistEdits.js`, checked against every case in
/// `fixtures/setlist-edits/` (`SetlistEditsTests`), survive-checks included.
///
/// Ratings and comments live inside the show's `setlist` array, and
/// Firestore can't change one element of an array, so every edit rewrites
/// the whole array. The edit is therefore described (rate this song, delete
/// that one) and applied to the setlist *as stored*, in a transaction
/// (`SetlistTransaction`): another device's change made meanwhile is kept.
/// The same rule runs on the device first, so the screen changes at once.
///
/// Songs are raw JSON maps, not `Song`: a song carries fields the model
/// doesn't list (`setBreak`, source fields), and an edit must keep every one
/// (STAGE1-AUDIT §2, "Edit raw maps, not the model").
public enum SetlistEdit: Equatable, Sendable {
    /// `rating` nil clears it (stored as null, as the web does).
    case rate(songId: String, rating: Int?)
    /// `comment` nil removes the key (the web's `undefined`); `.null` and
    /// `""` are stored as given.
    case comment(songId: String, comment: JSONValue?)
    /// Every song with no rating yet (absent, null or 0).
    case rateUnrated(rating: Int)
    /// Appended; a song already there (same id) is left alone.
    case add(song: JSONValue)
    case delete(songId: String)
    /// The undo of a delete: back at `index` (past the end or negative
    /// appends); no-op when the song is back already.
    case restore(song: JSONValue, index: Int)
    /// The editor's new order and set labels; ratings, comments and source
    /// fields come from the stored copy.
    case reorder(setlist: [JSONValue])

    /// An edit as the fixtures (and the web) write it: `{ type, … }`.
    public init?(json: JSONValue) {
        guard case .object(let o) = json, let type = o["type"]?.stringValue else { return nil }
        switch type {
        case "rate":
            guard let id = o["songId"]?.stringValue else { return nil }
            self = .rate(songId: id, rating: o["rating"]?.intValue)
        case "comment":
            guard let id = o["songId"]?.stringValue else { return nil }
            self = .comment(songId: id, comment: o["comment"])
        case "rate-unrated":
            guard let r = o["rating"]?.intValue else { return nil }
            self = .rateUnrated(rating: r)
        case "add":
            guard let song = o["song"] else { return nil }
            self = .add(song: song)
        case "delete":
            guard let id = o["songId"]?.stringValue else { return nil }
            self = .delete(songId: id)
        case "restore":
            guard let song = o["song"] else { return nil }
            self = .restore(song: song, index: o["index"]?.intValue ?? -1)
        case "reorder":
            guard case .array(let list)? = o["setlist"] else { return nil }
            self = .reorder(setlist: list)
        default:
            return nil
        }
    }
}

public struct SetlistEditResult: Equatable, Sendable {
    public var setlist: [JSONValue]
    public var changed: Bool
    /// A delete: the song taken out and where it was (for the undo).
    public var removed: JSONValue?
    public var index: Int?
}

public enum SetlistEdits {
    public static func apply(_ setlist: [JSONValue], _ edit: SetlistEdit) -> SetlistEditResult {
        switch edit {
        case .rate(let id, let rating):
            return patch(setlist, songId: id, key: "rating", value: rating.map { .number(Double($0)) } ?? .null)
        case .comment(let id, let comment):
            return patch(setlist, songId: id, key: "comment", value: comment)
        case .rateUnrated(let rating):
            var changed = false
            let out = setlist.map { item -> JSONValue in
                guard case .object(var song) = item, !isTruthy(song["rating"]) else { return item }
                changed = true
                song["rating"] = .number(Double(rating))
                return .object(song)
            }
            return SetlistEditResult(setlist: changed ? out : setlist, changed: changed)
        case .add(let song):
            guard let id = songId(song), !setlist.contains(where: { songId($0) == id }) else {
                return SetlistEditResult(setlist: setlist, changed: false)
            }
            return SetlistEditResult(setlist: setlist + [song], changed: true)
        case .delete(let id):
            guard let index = setlist.firstIndex(where: { songId($0) == id }) else {
                return SetlistEditResult(setlist: setlist, changed: false, removed: nil, index: -1)
            }
            var out = setlist
            let removed = out.remove(at: index)
            return SetlistEditResult(setlist: out, changed: true, removed: removed, index: index)
        case .restore(let song, let index):
            guard let id = songId(song), !setlist.contains(where: { songId($0) == id }) else {
                return SetlistEditResult(setlist: setlist, changed: false)
            }
            var out = setlist
            out.insert(song, at: index >= 0 ? min(index, out.count) : out.count)
            return SetlistEditResult(setlist: out, changed: true)
        case .reorder(let edited):
            return reorder(setlist, edited)
        }
    }

    /// A song's id, when it is a map with a string id.
    public static func songId(_ song: JSONValue) -> String? {
        guard case .object(let o) = song else { return nil }
        return o["id"]?.stringValue
    }

    /// JavaScript's truthiness, for `!song.rating`.
    static func isTruthy(_ value: JSONValue?) -> Bool {
        switch value {
        case nil, .null?: return false
        case .bool(let b)?: return b
        case .number(let n)?: return n != 0 && !n.isNaN
        case .string(let s)?: return !s.isEmpty
        case .array?, .object?: return true
        }
    }

    /// `{ ...song, [key]: value }` on the song with this id; `value` nil
    /// removes the key. Changed only when the value differs.
    static func patch(_ setlist: [JSONValue], songId id: String, key: String, value: JSONValue?) -> SetlistEditResult {
        var changed = false
        let out = setlist.map { item -> JSONValue in
            guard case .object(var song) = item, song["id"]?.stringValue == id else { return item }
            if song[key] != value { changed = true }
            song[key] = value
            return .object(song)
        }
        return SetlistEditResult(setlist: changed ? out : setlist, changed: changed)
    }

    /// The editor's order applied to the stored setlist: order and `set`
    /// from the editor, everything else from the stored copy. A song stored
    /// but not in the editor's list (added elsewhere meanwhile) is kept,
    /// after the others; one in the editor's list but no longer stored is
    /// kept too. Nothing is dropped.
    static func reorder(_ stored: [JSONValue], _ edited: [JSONValue]) -> SetlistEditResult {
        var byId: [String: [String: JSONValue]] = [:]
        for item in stored {
            if case .object(let o) = item, let id = o["id"]?.stringValue { byId[id] = o } // the last wins, as a JS Map
        }
        var seen = Set<String>()
        var out: [JSONValue] = []
        for item in edited {
            guard case .object(let song) = item else { continue }
            let id = song["id"]?.stringValue
            if let id, var copy = byId[id] {
                copy["set"] = song["set"]
                out.append(.object(copy))
            } else {
                out.append(item)
            }
            if let id { seen.insert(id) }
        }
        for item in stored {
            guard case .object(let o) = item else { continue }
            if let id = o["id"]?.stringValue, seen.contains(id) { continue }
            out.append(item)
        }
        let changed = out.count != stored.count || zip(out, stored).contains { a, b in
            guard case .object(let x) = a, case .object(let y) = b else { return a != b }
            return x["id"] != y["id"] || x["set"] != y["set"]
        }
        return SetlistEditResult(setlist: changed ? out : stored, changed: changed)
    }

    // MARK: The set editor (lib/setlistGrouping.js)

    /// The canonical sections the "which set?" picker always offers.
    public static let canonicalSets = ["Set I", "Set II", "Set III", "Set IV", "Encore", "Encore II", "Encore III"]

    /// `getSetOptions`: every canonical label and every other label the
    /// show has, in playing order.
    public static func setOptions(_ setlist: [JSONValue]) -> [String] {
        setOptions(existing: SetGroups.groupRaw(setlist).map(\.label))
    }

    /// The same, from the labels the show's sets already have.
    public static func setOptions(existing: [String]) -> [String] {
        SetGroups.orderLabels(canonicalSets + existing.filter { !canonicalSets.contains($0) })
    }

    /// `moveSongToSet`: the song goes to the end of `label`'s section
    /// (created when missing); every song's `set` is stamped from its
    /// section. Unchanged when the song isn't there. Send the result as a
    /// `.reorder` edit.
    public static func moveSong(_ setlist: [JSONValue], songId id: String, toSet label: String) -> [JSONValue] {
        var moved: JSONValue?
        var groups: [(label: String, songs: [JSONValue])] = SetGroups.groupRaw(setlist).compactMap { group in
            let songs = group.songs.filter { song in
                if songId(song) == id { moved = song; return false }
                return true
            }
            return songs.isEmpty ? nil : (group.label, songs)
        }
        guard let moved else { return setlist }
        if let i = groups.firstIndex(where: { $0.label == label }) {
            groups[i].songs.append(moved)
        } else {
            groups.append((label, [moved]))
        }
        return flatten(groups)
    }

    /// `reorderSongWithinSet`: the song at `index` in `label`'s section
    /// swaps with its neighbour (`direction` -1 or 1). Unchanged when the
    /// move would leave the section. Send the result as a `.reorder` edit.
    public static func moveSong(_ setlist: [JSONValue], inSet label: String, at index: Int, by direction: Int) -> [JSONValue] {
        let groups = SetGroups.groupRaw(setlist)
        guard let g = groups.firstIndex(where: { $0.label == label }) else { return setlist }
        var songs = groups[g].songs
        let target = index + direction
        guard songs.indices.contains(index), songs.indices.contains(target) else { return setlist }
        songs.swapAt(index, target)
        return flatten(groups.enumerated().map { i, group in (group.label, i == g ? songs : group.songs) })
    }

    static func flatten(_ groups: [(label: String, songs: [JSONValue])]) -> [JSONValue] {
        groups.flatMap { group in
            group.songs.map { song -> JSONValue in
                guard case .object(var o) = song else { return song }
                o["set"] = .string(group.label)
                return .object(o)
            }
        }
    }
}
