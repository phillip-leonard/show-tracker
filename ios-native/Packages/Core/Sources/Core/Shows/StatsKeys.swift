import Foundation

/// The identities the server's stats count by (`lib/stats/keys.js`,
/// `lib/venueCount.js`), so "your shows for this band" lists exactly the
/// shows the band's count was made from. `fixtures/stats-keys/keys.json`
/// pins them (`StatsKeysTests`). These identify; they never count: every
/// number on Stats comes from `userStats/{uid}`.
public enum StatsKeys {
    /// One song: "Ashes//Dust" and "Ashes // Dust" are the same; trailing
    /// "- Live", "(Live)", remaster and similar tags are dropped.
    public static func normalizeSongTitle(_ title: String) -> String {
        var s = title.lowercased()
        let tags = #"(live|remaster(ed)?( [0-9]{4})?|mono|stereo|single|album)( version)?"#
        s = replacing(#"[-–—]\s*\#(tags)\s*$"#, in: s, with: "", caseInsensitive: true)
        s = replacing(#"\(\s*\#(tags)\s*\)\s*$"#, in: s, with: "", caseInsensitive: true)
        s = s.replacingOccurrences(of: "/", with: " ")
        s = replacing(#"[^a-z0-9\s]"#, in: s, with: "")
        s = replacing(#"\s+"#, in: s, with: " ")
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `songKey`: the normalized title, or the trimmed title when that's empty.
    public static func songKey(_ name: String?) -> String {
        let raw = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = normalizeSongTitle(raw)
        return normalized.isEmpty ? raw : normalized
    }

    static func artistNameKey(_ name: String) -> String {
        var s = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        s = replacing(#"[^a-z0-9\s-]"#, in: s, with: "")
        s = replacing(#"\s+"#, in: s, with: "-")
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// One band: "Goose" and "goose (US)", "The Band" and "Band" are the same.
    public static func bandKey(_ name: String?) -> String {
        var s = replacing(#"[(\[{][^)\]}]*[)\]}]"#, in: name ?? "", with: " ")
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        s = replacing(#"^the\s+"#, in: s, with: "", caseInsensitive: true)
        return artistNameKey(s)
    }

    static func venuePart(_ value: String?) -> String {
        replacing(#"\s+"#, in: (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), with: " ")
    }

    /// One venue: name + city, trimmed, lowercased, spaces collapsed; nil
    /// with no venue name.
    public static func venueKey(venue: String?, city: String?) -> String? {
        let name = venuePart(venue)
        return name.isEmpty ? nil : "\(name)::\(venuePart(city))"
    }

    private static func replacing(_ pattern: String, in text: String, with template: String, caseInsensitive: Bool = false) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : []) else { return text }
        return regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }
}

/// What a row on Stats opens: your shows for one band, song or venue
/// (Stage 2; full band, song and venue pages are Stage 4).
public struct ShowsFilter: Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable { case band, song, venue }

    public var kind: Kind
    /// The name as the server's list shows it ("Goose", "Arcadia",
    /// "Red Rocks Amphitheatre, Morrison").
    public var title: String
    /// The band, for a song.
    public var artist: String?

    public init(kind: Kind, title: String, artist: String? = nil) {
        self.kind = kind
        self.title = title
        self.artist = artist
    }

    /// The shows it matches, newest first. A venue's title is the server's
    /// topVenues name, "Venue, City", so each show's own "Venue, City" is
    /// compared with it the way `venueCountKey` compares (trimmed,
    /// lowercased, spaces collapsed). The one difference from the server's
    /// key: "A, B" with no city and "A" in "B" read the same here.
    public func shows(in all: [Show]) -> [Show] {
        let matches: (Show) -> Bool
        switch kind {
        case .band:
            let key = StatsKeys.bandKey(title)
            matches = { !key.isEmpty && StatsKeys.bandKey($0.artist) == key }
        case .song:
            let band = StatsKeys.bandKey(artist)
            let song = StatsKeys.songKey(title)
            matches = { show in
                !song.isEmpty && StatsKeys.bandKey(show.artist) == band
                    && show.setlist.contains { StatsKeys.songKey($0.name) == song }
            }
        case .venue:
            let target = Self.venueLabelKey(title)
            matches = { show in
                guard StatsKeys.venueKey(venue: show.venue, city: show.city) != nil else { return false }
                return Self.venueLabelKey(Self.venueLabel(show)) == target
            }
        }
        return ShowList.pastOrder(all.filter(matches))
    }

    /// The server's topVenues name for a show: "Venue, City", or "Venue".
    static func venueLabel(_ show: Show) -> String {
        let venue = show.venue.trimmingCharacters(in: .whitespacesAndNewlines)
        let city = show.city.trimmingCharacters(in: .whitespacesAndNewlines)
        return city.isEmpty ? venue : "\(venue), \(city)"
    }

    /// A label compared the way `venueCountKey` compares: trimmed,
    /// lowercased, spaces collapsed.
    static func venueLabelKey(_ label: String) -> String { StatsKeys.venuePart(label) }
}
