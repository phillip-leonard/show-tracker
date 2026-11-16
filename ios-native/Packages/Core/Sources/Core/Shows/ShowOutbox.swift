import Foundation

/// A show added on this device that the server hasn't built yet
/// (STAGE1-AUDIT S-4, §4). The add flow (Part 4) mints its id, writes the
/// entry, and sends `input` to `normalize-show` when it can; the entry
/// leaves the outbox once the server answers for it. Until then the show
/// is "Waiting to sync": its page is read-only, made from `display`.
public struct QueuedShow: Codable, Identifiable, Hashable, Sendable {
    /// Minted on the device (`ShowID.mint()`); the server's document gets
    /// the same id, so the queued row is replaced, not duplicated.
    public var showId: String
    public var input: ShowInput
    /// What the person typed or picked.
    public var display: Display
    public var enqueuedAt: Date
    public var state: State

    public var id: String { showId }

    public struct Display: Codable, Hashable, Sendable {
        public var artist: String
        public var venue: String
        public var city: String
        /// ISO `YYYY-MM-DD`.
        public var date: String

        public init(artist: String, venue: String, city: String, date: String) {
            self.artist = artist; self.venue = venue; self.city = city; self.date = date
        }
    }

    public enum State: String, Codable, Sendable {
        /// Not sent yet, or the server couldn't be reached.
        case queued
        /// The server found a possible duplicate; the person must answer.
        case needsAnswer
        /// The server refused the input (a 4xx); the person edits or deletes it.
        case failed
    }

    public init(showId: String, input: ShowInput, display: Display, enqueuedAt: Date, state: State = .queued) {
        self.showId = showId; self.input = input; self.display = display; self.enqueuedAt = enqueuedAt; self.state = state
    }
}

/// The outbox file: one per person, `Application Support/outbox-<uid>.json`,
/// written atomically. Part 3a reads it; Part 4 adds writing and sending.
public enum ShowOutbox {
    struct File: Codable {
        var version = 1
        var entries: [QueuedShow]
    }

    public static func url(uid: String, in directory: URL? = nil) -> URL {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        // Firebase uids are letters and digits; anything else is dropped so
        // the name can't leave the folder.
        let safe = uid.filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return base.appendingPathComponent("outbox-\(safe).json")
    }

    /// The queued shows, oldest first; empty when there is no file or it
    /// can't be read.
    public static func load(uid: String, in directory: URL? = nil) -> [QueuedShow] {
        guard let data = try? Data(contentsOf: url(uid: uid, in: directory)) else { return [] }
        return (try? decoder.decode(File.self, from: data).entries) ?? []
    }

    static func save(_ entries: [QueuedShow], uid: String, in directory: URL? = nil) throws {
        let target = url(uid: uid, in: directory)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(File(entries: entries)).write(to: target, options: .atomic)
    }

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.sortedKeys]
        return e
    }()
}
