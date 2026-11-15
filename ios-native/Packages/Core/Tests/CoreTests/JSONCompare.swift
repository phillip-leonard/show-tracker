import Foundation

/// Comparing a decoded model with the fixture JSON it came from.
///
/// The model treats absent, `null` and `""` as the same "none" (and an
/// empty list as no list), so both sides are normalized the same way
/// before comparing: those values are dropped. Keys listed in `keepEmpty`
/// keep `""` (a band source writes `transitionMark: ""` for "no segue").
enum JSONCompare {
    static func normalized(_ value: Any, keepEmpty: Set<String> = [], keepEmptyLists: Set<String> = ["setlist"]) -> Any {
        if let dict = value as? [String: Any] {
            var out: [String: Any] = [:]
            for (k, v) in dict {
                if v is NSNull { continue }
                if let s = v as? String, s.isEmpty, !keepEmpty.contains(k) { continue }
                if let a = v as? [Any], a.isEmpty, !keepEmptyLists.contains(k) { continue }
                out[k] = normalized(v, keepEmpty: keepEmpty, keepEmptyLists: keepEmptyLists)
            }
            return out
        }
        if let array = value as? [Any] {
            return array.map { normalized($0, keepEmpty: keepEmpty, keepEmptyLists: keepEmptyLists) }
        }
        return value
    }

    static func equal(_ a: Any, _ b: Any) -> Bool {
        (a as AnyObject).isEqual(b as AnyObject)
    }

    /// The first difference, for a readable failure.
    static func difference(_ a: Any, _ b: Any, path: String = "$") -> String? {
        if let x = a as? [String: Any], let y = b as? [String: Any] {
            for k in Set(x.keys).union(y.keys).sorted() {
                guard let xv = x[k] else { return "\(path).\(k): missing in the model, fixture has \(y[k]!)" }
                guard let yv = y[k] else { return "\(path).\(k): the model has \(xv), the fixture doesn't" }
                if let d = difference(xv, yv, path: "\(path).\(k)") { return d }
            }
            return nil
        }
        if let x = a as? [Any], let y = b as? [Any] {
            if x.count != y.count { return "\(path): \(x.count) items vs \(y.count)" }
            for (i, pair) in zip(x, y).enumerated() {
                if let d = difference(pair.0, pair.1, path: "\(path)[\(i)]") { return d }
            }
            return nil
        }
        return equal(a, b) ? nil : "\(path): \(a) vs \(b)"
    }

    static func encode<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value), options: .fragmentsAllowed)
    }

    static var iso: ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }
}
