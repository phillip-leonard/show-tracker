import Foundation

/// One show-level field, edited on its own: the show rating, the venue
/// rating or the note (`comment`). Each is one `updateData` of that field
/// and nothing else, so another device's edit made meanwhile is never
/// erased (CLAUDE.md, R-06).
///
/// The rule is `lib/showFieldEdits.js`; `fixtures/show-edits/fields.json`
/// keeps the two the same (`ShowFieldEditTests`). A cleared value is
/// removed (`FieldValue.delete()`), never written as 0 or "" (S-8).
public enum ShowField: String, CaseIterable, Sendable {
    case rating, venueRating, comment
}

public enum ShowFieldChange: Equatable, Sendable {
    /// Write this value to the field.
    case set(ShowField, JSONValue)
    /// Delete the field.
    case remove(ShowField)

    public var field: ShowField {
        switch self { case .set(let f, _), .remove(let f): f }
    }
}

public enum ShowFieldEditError: String, Error, Equatable, Sendable {
    case badField = "bad-field"
    case badRating = "bad-rating"
    case badText = "bad-text"
}

public enum ShowFieldEdit {
    /// A rating, 1–10; `nil` or 0 clears it.
    public static func rating(_ field: ShowField, _ value: Int?) -> Result<ShowFieldChange, ShowFieldEditError> {
        edit(field.rawValue, value.map { .number(Double($0)) } ?? .null)
    }

    /// The show's note: trimmed at both ends; empty clears it.
    public static func comment(_ text: String?) -> ShowFieldChange {
        // A string never fails the text rule.
        (try? edit(ShowField.comment.rawValue, text.map(JSONValue.string) ?? .null).get()) ?? .remove(.comment)
    }

    /// `showFieldEdit(field, value)`, as `lib/showFieldEdits.js` has it.
    /// JSON has no `undefined`; `.null` stands for both.
    public static func edit(_ fieldName: String, _ value: JSONValue) -> Result<ShowFieldChange, ShowFieldEditError> {
        guard let field = ShowField(rawValue: fieldName) else { return .failure(.badField) }
        switch field {
        case .rating, .venueRating:
            switch value {
            case .null: return .success(.remove(field))
            case .string(let s) where s.isEmpty: return .success(.remove(field))
            case .number(let n) where n == 0: return .success(.remove(field))
            case .number(let n) where n.rounded() == n && n >= 1 && n <= 10: return .success(.set(field, .number(n)))
            default: return .failure(.badRating)
            }
        case .comment:
            switch value {
            case .null: return .success(.remove(field))
            case .string(let s):
                let text = s.trimmingCharacters(in: .whitespacesAndNewlines)
                return .success(text.isEmpty ? .remove(field) : .set(field, .string(text)))
            default: return .failure(.badText)
            }
        }
    }

    /// The stored show after the change: every other field as it was.
    public static func apply(_ change: ShowFieldChange, to show: [String: JSONValue]) -> [String: JSONValue] {
        var next = show
        switch change {
        case .set(let field, let value): next[field.rawValue] = value
        case .remove(let field): next[field.rawValue] = nil
        }
        return next
    }
}
