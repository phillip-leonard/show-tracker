import Foundation

/// A song edit waiting to be applied to the stored setlist. Every song edit
/// goes through the queue: it's saved to a file at once, shown on this
/// device, and replayed in order as a transaction against the setlist as
/// stored (`SetlistTransaction`). Online that happens straight away, with
/// retries; offline it waits for the connection, across a force-quit. The
/// whole setlist is never written from this device's copy, so a rating made
/// on another device meanwhile is never overwritten.
///
/// Replaying is safe after a lost answer: under the `fixtures/setlist-edits/`
/// rules every edit applied twice changes nothing the second time (a rating
/// to the same value, an add or restore of a song that's there, a delete of
/// one that's gone, the same order).
public struct QueuedSetlistEdit: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var showId: String
    /// The edit as the fixtures write it (`{ type, … }`, `SetlistEdit.json`).
    public var edit: JSONValue
    public var enqueuedAt: Date

    public init(id: String = UUID().uuidString, showId: String, edit: SetlistEdit, enqueuedAt: Date = Date()) {
        self.id = id
        self.showId = showId
        self.edit = edit.json
        self.enqueuedAt = enqueuedAt
    }

    /// The edit, or nil when the stored one can't be read (it is dropped).
    public var setlistEdit: SetlistEdit? { SetlistEdit(json: edit) }
}

/// The queue's file: one per person, `Application Support/setlist-edits-<uid>.json`,
/// written atomically on every change.
public enum SetlistEditQueue {
    struct File: Codable {
        var version = 1
        var entries: [QueuedSetlistEdit]
    }

    public static func url(uid: String, in directory: URL? = nil) -> URL {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let safe = uid.filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return base.appendingPathComponent("setlist-edits-\(safe).json")
    }

    /// The queued edits, oldest first; entries whose edit can't be read are
    /// left out. Empty when there is no file or it can't be read.
    public static func load(uid: String, in directory: URL? = nil) -> [QueuedSetlistEdit] {
        guard let data = try? Data(contentsOf: url(uid: uid, in: directory)),
              let file = try? ShowOutbox.decoder.decode(File.self, from: data) else { return [] }
        return file.entries.filter { $0.setlistEdit != nil }
    }

    public static func save(_ entries: [QueuedSetlistEdit], uid: String, in directory: URL? = nil) throws {
        let target = url(uid: uid, in: directory)
        if entries.isEmpty {
            try? FileManager.default.removeItem(at: target)
            return
        }
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try ShowOutbox.encoder.encode(File(entries: entries)).write(to: target, options: .atomic)
    }

    /// Removes the file (a guest signing out: that account can't be signed back into).
    public static func delete(uid: String, in directory: URL? = nil) {
        try? FileManager.default.removeItem(at: url(uid: uid, in: directory))
    }

    /// `edits` applied in order to `setlist`: what this device shows while
    /// they wait.
    public static func overlay(_ setlist: [JSONValue], _ edits: [QueuedSetlistEdit]) -> [JSONValue] {
        edits.compactMap(\.setlistEdit).reduce(setlist) { SetlistEdits.apply($0, $1).setlist }
    }
}

/// Replays the queue in order, one transaction at a time.
public enum SetlistEditReplay {
    public enum Outcome: Sendable {
        case landed
        /// The phone lost its connection while the attempt ran.
        case wentOffline
        case failed(Error)
    }

    /// Runs until the queue is empty or the phone is offline. `next()` is
    /// read before each attempt, so edits added meanwhile are replayed too,
    /// after the ones before them. An attempt that fails is retried while
    /// online (`SetlistSavePolicy`); one that retrying can't fix is given up
    /// (`gaveUp`), and the queue moves on.
    @MainActor
    public static func run(
        next: () -> QueuedSetlistEdit?,
        canRun: () -> Bool,
        attempt: (QueuedSetlistEdit) async -> Outcome,
        sleep: (Duration) async -> Void = { try? await Task.sleep(for: $0) },
        landed: (QueuedSetlistEdit) -> Void,
        gaveUp: (QueuedSetlistEdit, Error) -> Void,
        failed: (Error, Int) -> Void = { _, _ in }
    ) async {
        var tries: (id: String, count: Int) = ("", 0)
        while let entry = next() {
            guard canRun() else { return }
            tries = tries.id == entry.id ? (entry.id, tries.count + 1) : (entry.id, 1)
            switch await attempt(entry) {
            case .landed:
                landed(entry)
            case .wentOffline:
                return
            case .failed(let error):
                failed(error, tries.count)
                switch SetlistSavePolicy.next(after: error, attempt: tries.count, online: canRun()) {
                case .retry(let delay): await sleep(delay)
                case .waitForConnection: return
                case .giveUp: gaveUp(entry, error)
                }
            }
        }
    }
}

extension SetlistEdit {
    /// The edit as the fixtures (and the web) write it: `{ type, … }`.
    /// `SetlistEdit(json:)` reads it back.
    public var json: JSONValue {
        switch self {
        case .rate(let id, let rating):
            return .object(["type": .string("rate"), "songId": .string(id), "rating": rating.map { .number(Double($0)) } ?? .null])
        case .comment(let id, let comment):
            var o: [String: JSONValue] = ["type": .string("comment"), "songId": .string(id)]
            if let comment { o["comment"] = comment }
            return .object(o)
        case .rateUnrated(let rating):
            return .object(["type": .string("rate-unrated"), "rating": .number(Double(rating))])
        case .add(let song):
            return .object(["type": .string("add"), "song": song])
        case .delete(let id):
            return .object(["type": .string("delete"), "songId": .string(id)])
        case .restore(let song, let index):
            return .object(["type": .string("restore"), "song": song, "index": .number(Double(index))])
        case .reorder(let setlist):
            return .object(["type": .string("reorder"), "setlist": .array(setlist)])
        }
    }
}
