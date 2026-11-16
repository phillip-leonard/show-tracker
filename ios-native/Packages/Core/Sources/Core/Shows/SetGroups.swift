import Foundation

/// A setlist split into its sets and encores, in the order they were
/// played: the Swift copy of `lib/setGroups.js` `groupSongsBySet`, checked
/// against `fixtures/setlist-grouping/groups.json` (`SetGroupsTests`).
///
/// Sets first, by number (Roman or Arabic: "Set V", "Set 9"), then
/// encores ("Encore" is encore 1), then any other label in the order it
/// first appears. A song with no set joins the section that is open; the
/// legacy `setBreak` marker is read only when no song has a `set`.
public enum SetGroups {
    public struct Group: Identifiable, Hashable, Sendable {
        public let label: String
        public let songs: [Song]
        public var id: String { label }
    }

    public static func group(_ setlist: [Song]) -> [Group] {
        guard !setlist.isEmpty else { return [] }
        var groups: [String: [Song]] = [:]
        var order: [String] = []
        let hasSetField = setlist.contains { $0.set != nil }
        var current = "Set I"
        for song in setlist {
            if hasSetField {
                if let set = song.set { current = set }
            } else if let mark = song.setBreak {
                current = setBreakToLabel(mark) ?? current
            }
            if groups[current] == nil { groups[current] = []; order.append(current) }
            groups[current]?.append(song)
        }
        return orderLabels(order).map { Group(label: $0, songs: groups[$0] ?? []) }
    }

    /// The labels in playing order; ties and other labels keep their order.
    public static func orderLabels(_ labels: [String]) -> [String] {
        labels.enumerated()
            .map { (label: $0.element, index: $0.offset, rank: rank($0.element)) }
            .sorted { a, b in
                if a.rank.rank != b.rank.rank { return a.rank.rank < b.rank.rank }
                if a.rank.number != b.rank.number { return a.rank.number < b.rank.number }
                return a.index < b.index
            }
            .map(\.label)
    }

    /// 0 a set, 1 an encore, 2 anything else (number 0).
    static func rank(_ label: String) -> (rank: Int, number: Int) {
        let words = label.trimmingCharacters(in: .whitespaces).split(whereSeparator: \.isWhitespace).map(String.init)
        if words.count == 2, words[0].lowercased() == "set" {
            let n = readNumber(words[1])
            if n > 0 { return (0, n) }
        }
        if let first = words.first, first.lowercased() == "encore", words.count <= 2 {
            let n = words.count == 2 ? readNumber(words[1]) : 1
            if n > 0 { return (1, n) }
        }
        return (2, 0)
    }

    /// "Main Set", "Set 2", "Encore 2" as a label.
    public static func setBreakToLabel(_ mark: String?) -> String? {
        guard let mark, !mark.isEmpty else { return nil }
        switch mark {
        case "Main Set": return "Set I"
        case "Encore": return "Encore"
        case "Encore 2": return "Encore II"
        default: break
        }
        let words = mark.split(separator: " ", omittingEmptySubsequences: false)
        if words.count == 2, words[0] == "Set", !words[1].isEmpty, words[1].allSatisfy(\.isASCII), let n = Int(words[1]) {
            return n > 0 ? "Set \(toRoman(n))" : mark
        }
        return mark
    }

    static let romanValues: [(String, Int)] = [("M", 1000), ("CM", 900), ("D", 500), ("CD", 400), ("C", 100), ("XC", 90),
                                               ("L", 50), ("XL", 40), ("X", 10), ("IX", 9), ("V", 5), ("IV", 4), ("I", 1)]

    public static func toRoman(_ n: Int) -> String {
        var left = n
        var out = ""
        for (symbol, value) in romanValues {
            while left >= value { out += symbol; left -= value }
        }
        return out
    }

    /// "IX" → 9, "12" → 12; 0 for anything else.
    static func readNumber(_ text: String) -> Int {
        let s = text.trimmingCharacters(in: .whitespaces).uppercased()
        guard !s.isEmpty else { return 0 }
        if s.allSatisfy({ $0.isASCII && $0.isNumber }) { return Int(s) ?? 0 }
        let digits: [Character: Int] = ["M": 1000, "D": 500, "C": 100, "L": 50, "X": 10, "V": 5, "I": 1]
        guard s.allSatisfy({ digits[$0] != nil }) else { return 0 }
        let values = s.compactMap { digits[$0] }
        var total = 0
        for (i, v) in values.enumerated() {
            let next = i + 1 < values.count ? values[i + 1] : 0
            total += v < next ? -v : v
        }
        // Only a numeral that reads back the same ("IIII" and "VX" aren't).
        return toRoman(total) == s ? total : 0
    }
}
