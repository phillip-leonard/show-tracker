import Foundation

/// The keys shared content hangs off (lib/concertKeys.js, Stage 6): comments,
/// photos and meetups belong to the concert, not to anyone's show document.
/// `fixtures/concert-keys/keys.json` pins all four, run by the web
/// (`lib/__tests__/concertKeysFixtures.test.js`) and here
/// (`ConcertKeysTests`), so a comment, photo or meetup posted from the app
/// lands in the web's thread.
public enum ConcertKeys {
    /// `showMatchKey`: the setlist.fm id, else `artist|venue|ISO day`.
    public static func concertKey(_ show: Show) -> String { ShowMatchKey.of(show) }

    public static func concertKey(artist: String?, venue: String?, date: String?, setlistfmId: String?) -> String {
        ShowMatchKey.of(artist: artist, venue: venue, date: date, setlistfmId: setlistfmId)
    }

    /// `meetupIdFor`: `meetups/{id}`. Lowercased, every run of other
    /// characters one underscore, none at the ends; nil for an empty key.
    public static func meetupId(_ concertKey: String?) -> String? {
        let joined = runs(concertKey, separator: "_").trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        return joined.isEmpty ? nil : joined
    }

    /// `mediaPathSegment`: the concert's Storage folder,
    /// `showPhotos/{segment}/{uid}/{file}`. Lowercased, every run of other
    /// characters one hyphen (ends kept, as the web does).
    public static func mediaPathSegment(_ concertKey: String?) -> String {
        runs(concertKey, separator: "-")
    }

    /// `commentViewId`: `commentViews/{id}`, "new since your last visit".
    public static func commentViewId(uid: String, concertKey: String?) -> String {
        "\(uid)_\(mediaPathSegment(concertKey))"
    }

    /// JavaScript's `toLowerCase().replace(/[^a-z0-9]+/g, separator)`.
    private static func runs(_ key: String?, separator: Character) -> String {
        var out = ""
        var inRun = false
        for scalar in (key ?? "").lowercased().unicodeScalars {
            if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) {
                out.unicodeScalars.append(scalar)
                inRun = false
            } else if !inRun {
                out.append(separator)
                inRun = true
            }
        }
        return out
    }
}
