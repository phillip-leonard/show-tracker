import Foundation

/// `normalize-show`: preview (writes nothing) or commit one input or up to 25.
public struct NormalizeShowRequest: Encodable, Sendable {
    public enum Mode: String, Encodable, Sendable { case preview, commit }
    public var mode: Mode
    public var input: ShowInput?
    public var inputs: [ShowInput]?

    public static func one(_ input: ShowInput, _ mode: Mode) -> Self { .init(mode: mode, input: input, inputs: nil) }
    public static func batch(_ inputs: [ShowInput], _ mode: Mode) -> Self { .init(mode: mode, input: nil, inputs: inputs) }
    public static let maxInputs = 25
}

/// One input's answer: the document the server built (fixtures/shows
/// `expected.show`), the duplicate verdict, what the band source said, and
/// on commit what was written.
public struct NormalizeShowResult: Decodable, Sendable {
    public var show: Show?
    public var duplicate: Duplicate?
    public var band: Band?
    /// Catalog festivals the show may belong to: a suggestion only.
    public var festivalMatches: [JSONValue]?
    public var written: Bool?
    public var created: Bool?
    public var updated: Bool?
    public var showId: String?
    /// The show matched one already logged; nothing new was written.
    public var mergedInto: String?
    public var alreadyNormalized: Bool?
    /// A `possible` duplicate: nothing written until the person says it's
    /// a different show (`confirmPossible`).
    public var needsConfirmation: Bool?
    /// An input the server refused (`bad-input`, `bad-kind`, `tag-not-found`…).
    public var error: InputError?

    public struct Duplicate: Decodable, Hashable, Sendable {
        public var showId: String
        /// `setlistfm-id`, `same-show`, or `possible` (only ever a question for the user).
        public var rule: String
        public var isPossible: Bool { rule == "possible" }
    }
    public struct Band: Decodable, Hashable, Sendable { public var reason: String }
    public struct InputError: Decodable, Hashable, Sendable {
        public var code: String
        public var message: String?
        public init(from decoder: Decoder) throws {
            // `{ code, message }` from normalize-show; a fixture writes just the code.
            if let code = try? decoder.singleValueContainer().decode(String.self) { self.code = code; message = nil; return }
            let c = try decoder.container(keyedBy: CodingKeys.self)
            code = try c.decode(String.self, forKey: .code)
            message = try c.decodeIfPresent(String.self, forKey: .message)
        }
        enum CodingKeys: String, CodingKey { case code, message }
    }
}

public struct NormalizeShowBatchResponse: Decodable, Sendable {
    public var results: [NormalizeShowResult]
}
