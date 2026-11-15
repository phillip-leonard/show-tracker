import Foundation

// Tolerant reads for the variants still in Firestore, and only those
// (docs/ios-native/FOUNDATION-AUDIT.md §1.3; scripts/scan-show-decode.js
// checks production against the same rules). Anything else that doesn't
// match is a decoding error, not a silent default: a model that hides a
// new variant would hide a bug.

/// A moment stored either as a Firestore `Timestamp` or as an ISO-8601
/// string. `shows.createdAt` is both (258 of 1,501 shows on 2026-11-14 are
/// strings: guest rescues and older add paths), and the fixtures write ISO.
public struct FlexibleDate: Decodable, Hashable, Sendable {
    public let date: Date?

    public init(_ date: Date?) { self.date = date }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { date = nil; return }
        // Firestore.Decoder turns a Timestamp into a Date.
        if let d = try? c.decode(Date.self) { date = d; return }
        let s = try c.decode(String.self)
        date = FlexibleDate.parse(s)
    }

    static func parse(_ s: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: s) { return d }
        return ISO8601DateFormatter().date(from: s)
    }
}

extension KeyedDecodingContainer {
    /// A string where absent, `null` and `""` all mean "none".
    func optionalText(_ key: Key) throws -> String? {
        guard let s = try decodeIfPresent(String.self, forKey: key) else { return nil }
        return s.isEmpty ? nil : s
    }

    /// A string that is always there in the canonical shape ('' when unknown).
    func text(_ key: Key) throws -> String {
        try decodeIfPresent(String.self, forKey: key) ?? ""
    }

    func flag(_ key: Key) throws -> Bool? {
        try decodeIfPresent(Bool.self, forKey: key)
    }

    /// A 1–10 rating: any number, rounded; `null`, absent or out of range is
    /// unrated (lib/showInputs.js validRating).
    func rating(_ key: Key) throws -> Int? {
        guard let n = try decodeIfPresent(Double.self, forKey: key) else { return nil }
        let r = Int(n.rounded())
        return (1...10).contains(r) ? r : nil
    }

    func moment(_ key: Key) throws -> Date? {
        try decodeIfPresent(FlexibleDate.self, forKey: key)?.date
    }

    /// A number that older documents stored as a string ("8.3"):
    /// `userStats.avgShowRating` before 5.60.12, `communityStats`
    /// `topSongsByRating[].avgRating` still.
    func numberOrNumericString(_ key: Key) throws -> Double? {
        guard contains(key) else { return nil }
        if try decodeNil(forKey: key) { return nil }
        if let n = try? decode(Double.self, forKey: key) { return n }
        let s = try decode(String.self, forKey: key)
        guard let n = Double(s) else {
            throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "Not a number: \(s)")
        }
        return n
    }

    func list<T: Decodable>(_ key: Key, of: T.Type = T.self) throws -> [T] {
        try decodeIfPresent([T].self, forKey: key) ?? []
    }
}
