import FirebaseFirestore
import Foundation

// Band alerts for the native app (Stage 3, Part 6; STAGE3-AUDIT §6):
// following bands, the alert preferences, and the home city on-sale alerts
// need. Everything here is the person's own documents, written as the web
// writes them; the jobs that send the alerts are unchanged. Guests follow
// and get alerts in the app and by push, never by email (D-2).

/// One band is one band however it's typed ("Goose" and "goose "), as the
/// web (`bandKey` in AppContext) and the alert job (`artistKey`) say.
public enum BandFollows {
    public static func key(_ name: String?) -> String {
        (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    public static func isFollowing(_ name: String, in follows: [FollowedBand]) -> Bool {
        let k = key(name)
        return !k.isEmpty && follows.contains { key($0.name) == k }
    }

    /// The list after following or unfollowing `name`. A new follow is
    /// `{name, mbid, addedAt}`; legacy plain-name entries come back as the
    /// same object shape (`resolve-artist` only reads `name` on an object).
    public static func toggled(_ name: String, in follows: [FollowedBand], mbid: String?, now: Date = Date()) -> [FollowedBand] {
        let k = key(name)
        if isFollowing(name, in: follows) { return follows.filter { key($0.name) != k } }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return follows + [FollowedBand(name: trimmed, mbid: mbid, addedAt: ISO8601DateFormatter.withFraction.string(from: now))]
    }

    /// `artistSlugFromName` (lib/artistSlug.js): the `?band=` in a band link.
    public static func slug(_ name: String?) -> String {
        let lowered = (name ?? "").lowercased()
        let kept = lowered.unicodeScalars.filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" || CharacterSet.whitespaces.contains($0) || CharacterSet.newlines.contains($0) }
        var out = ""
        var inSpace = false
        for ch in String(String.UnicodeScalarView(kept)) {
            if ch.isWhitespace { if !inSpace { out.append("-") }; inSpace = true } else { out.append(ch); inSpace = false }
        }
        return out
    }

    /// The band a `?band=` slug names: one you follow or have seen, else
    /// the slug with spaces, capitalized.
    public static func name(forSlug slug: String, follows: [FollowedBand], seen: [String]) -> String {
        if let f = follows.first(where: { Self.slug($0.name) == slug }) { return f.name }
        if let s = seen.first(where: { Self.slug($0) == slug }) { return s }
        return slug.split(separator: "-").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }

    /// Sorted by name for "Bands you follow".
    public static func sorted(_ follows: [FollowedBand]) -> [FollowedBand] {
        follows.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    static func firestoreValue(_ follows: [FollowedBand]) -> [[String: Any]] {
        follows.map { f in
            var entry: [String: Any] = ["name": f.name, "mbid": f.mbid ?? NSNull()]
            entry["addedAt"] = f.addedAt ?? NSNull()
            return entry
        }
    }

    /// What to say after a follow (the web's toast): push or email, and
    /// the city nudge for on-sale alerts. A guest has no address, so only
    /// the app and push.
    public static func followedMessage(_ name: String, pushAllowed: Bool, isGuest: Bool, hasHomeCity: Bool) -> String {
        let band = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let how: String
        if pushAllowed { how = "We'll let you know when they announce a tour." }
        else if isGuest { how = "Their tour news will be in Notifications." }
        else { how = "We'll email you when they announce a tour." }
        return "Following \(band). \(how)" + (hasHomeCity ? "" : " Add your city to get on-sale alerts.")
    }
}

/// One alert's preferences, `notificationPrefs.<key>` on the profile:
/// `{enabled, method, push, email, inApp?}`. Everything defaults on.
public struct AlertPref: Equatable, Sendable {
    public var enabled: Bool
    public var push: Bool
    public var email: Bool
    /// On-sale alerts only: whether they go to the inbox.
    public var inApp: Bool

    /// `alertChannels` (lib/alertChannels.js): explicit booleans win, else
    /// the legacy `method` ('both', 'push', 'email', 'none').
    public init(_ raw: JSONValue?) {
        enabled = raw?["enabled"]?.boolValue ?? true
        let method = raw?["method"]?.stringValue ?? "both"
        push = raw?["push"]?.boolValue ?? (method == "both" || method == "push")
        email = raw?["email"]?.boolValue ?? (method == "both" || method == "email")
        inApp = raw?["inApp"]?.boolValue ?? true
    }

    /// The stored shape, `method` kept in step (`withChannel`).
    public func stored(withInApp: Bool) -> [String: Any] {
        let method = push && email ? "both" : push ? "push" : email ? "email" : "none"
        var out: [String: Any] = ["enabled": enabled, "push": push, "email": email, "method": method]
        if withInApp { out["inApp"] = inApp }
        return out
    }
}

/// The four alerts, in the web's order and words (NotificationSettings).
public enum AlertKind: String, CaseIterable, Identifiable, Sendable {
    case anniversaries, followedBands, venueBucketList, onsaleAlerts
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .anniversaries: "Anniversary reminders"
        case .followedBands: "Bands you follow"
        case .venueBucketList: "Venue bucket list matches"
        case .onsaleAlerts: "On-sale alerts"
        }
    }

    public var detail: String {
        switch self {
        case .anniversaries: "\u{201C}X years ago today you saw…\u{201D}, on the date, once a year per show."
        case .followedBands: "When a band you follow announces a new tour (three or more new dates)."
        case .venueBucketList: "When a band you follow plays a venue on your bucket list."
        case .onsaleAlerts: "When a band you follow has a show going on sale near you, with presale times and any code the band shares."
        }
    }

    public var hasInApp: Bool { self == .onsaleAlerts }
}

/// `alertSettings/{uid}`: home city, radius and time zone for on-sale
/// alerts. Owner-only (the rules check every key and the radius).
public struct AlertSettings: Equatable, Sendable {
    public struct Place: Equatable, Sendable, Hashable {
        public var label: String
        public var lat: Double
        public var lng: Double
        public init(label: String, lat: Double, lng: Double) { self.label = label; self.lat = lat; self.lng = lng }
    }

    public static let radiusOptions = [25, 50, 100, 250]
    public static let defaultRadius = 100

    public var homeLocation: Place?
    public var radiusMiles: Int
    public var timezone: String

    public init(homeLocation: Place? = nil, radiusMiles: Int = AlertSettings.defaultRadius, timezone: String = TimeZone.current.identifier) {
        self.homeLocation = homeLocation; self.radiusMiles = radiusMiles; self.timezone = timezone
    }

    public init(_ data: [String: Any]?) {
        let home = data?["homeLocation"] as? [String: Any]
        if let label = home?["label"] as? String, let lat = (home?["lat"] as? NSNumber)?.doubleValue, let lng = (home?["lng"] as? NSNumber)?.doubleValue {
            homeLocation = Place(label: label, lat: lat, lng: lng)
        } else {
            homeLocation = nil
        }
        let radius = (data?["alertRadiusMiles"] as? NSNumber)?.intValue ?? Self.defaultRadius
        radiusMiles = Self.radiusOptions.contains(radius) ? radius : Self.defaultRadius
        timezone = (data?["timezone"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? TimeZone.current.identifier
    }

    /// The document the rules allow: only these keys, a listed radius.
    public func fields(uid: String) -> [String: Any] {
        var out: [String: Any] = ["uid": uid, "alertRadiusMiles": radiusMiles, "timezone": String(timezone.prefix(64)),
                                  "updatedAt": FieldValue.serverTimestamp()]
        if let h = homeLocation { out["homeLocation"] = ["label": h.label, "lat": h.lat, "lng": h.lng] } else { out["homeLocation"] = NSNull() }
        return out
    }
}

/// The city search (lib/alertSettings.js `searchCityRows`): the web's
/// static list, biggest city first; "columbus, oh" narrows by region or
/// country. No geocoding and no device location, so no permission prompt.
public enum CitySearch {
    /// `[name, region, countryCode, lat, lng]`.
    public typealias Row = (name: String, region: String, country: String, lat: Double, lng: Double)

    public static let listURL = URL(string: "https://mysetlists.net/data/cities.json")!

    public static func label(_ row: Row) -> String { "\(row.name), \(row.region.isEmpty ? row.country : row.region)" }

    static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func search(_ rows: [Row], query: String, limit: Int = 8) -> [AlertSettings.Place] {
        let parts = fold(query).split(separator: ",", maxSplits: 1, omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        guard let namePart = parts.first, namePart.count >= 2 else { return [] }
        let placePart = parts.count > 1 ? parts[1] : ""
        var out: [AlertSettings.Place] = []
        for row in rows {
            guard fold(row.name).hasPrefix(namePart) else { continue }
            if !placePart.isEmpty, !fold(row.region).hasPrefix(placePart), !fold(row.country).hasPrefix(placePart) { continue }
            out.append(.init(label: label(row), lat: row.lat, lng: row.lng))
            if out.count >= limit { break }
        }
        return out
    }

    public static func parse(_ data: Data) -> [Row] {
        guard let list = try? JSONSerialization.jsonObject(with: data) as? [[Any]] else { return [] }
        return list.compactMap { r in
            guard r.count >= 5, let name = r[0] as? String,
                  let lat = (r[3] as? NSNumber)?.doubleValue, let lng = (r[4] as? NSNumber)?.doubleValue else { return nil }
            return (name, r[1] as? String ?? "", r[2] as? String ?? "", lat, lng)
        }
    }
}

/// Reads and writes for band alerts: the person's own profile and
/// `alertSettings`, as the web writes them.
@MainActor
public final class BandAlertsService {
    let api: APIClient
    private static var cities: [CitySearch.Row]?

    public init(api: APIClient) { self.api = api }

    /// Follows or unfollows. Returns whether it's now followed. The whole
    /// list is written, as on the web (STAGE3-AUDIT §6: people change it by
    /// hand, so two devices racing over it isn't a real risk).
    public func toggleFollow(_ name: String, uid: String, current: [FollowedBand]) async throws -> Bool {
        let following = BandFollows.isFollowing(name, in: current)
        var mbid: String?
        if !following {
            struct ArtistInfo: Decodable, Sendable { var mbid: String? }
            mbid = try? await api.get("get-artist-info", query: ["artistName": name.trimmingCharacters(in: .whitespaces)], as: ArtistInfo.self).mbid
        }
        let next = BandFollows.toggled(name, in: current, mbid: mbid)
        // Merged, so a guest with no profile document yet gets one.
        try await Database.ready().document("userProfiles/\(uid)").setData(["favoriteArtists": BandFollows.firestoreValue(next)], merge: true)
        if !following {
            // Finds the band on Ticketmaster for on-sale alerts; not waited for.
            struct Resolve: Encodable, Sendable { var artistName: String }
            let api = self.api
            Task { _ = try? await api.post("resolve-artist", Resolve(artistName: name.trimmingCharacters(in: .whitespaces)), as: JSONValue.self) }
        }
        return !following
    }

    /// One alert's preferences: only that key changes (a merge).
    public func save(_ pref: AlertPref, for kind: AlertKind, uid: String) async throws {
        try await Database.ready().document("userProfiles/\(uid)")
            .setData(["notificationPrefs": [kind.rawValue: pref.stored(withInApp: kind.hasInApp)]], merge: true)
    }

    /// Replies and likes (accounts): on or off, and the immediate email.
    public func saveEngagement(enabled: Bool? = nil, emailImmediately: Bool? = nil, uid: String) async throws {
        var prefs: [String: Any] = [:]
        if let enabled { prefs["engagementNotifications"] = enabled }
        if let emailImmediately { prefs["emailFrequency"] = emailImmediately ? "immediate" : "off" }
        guard !prefs.isEmpty else { return }
        try await Database.ready().document("userProfiles/\(uid)").setData(["notificationPrefs": prefs], merge: true)
    }

    public func loadSettings(uid: String) async -> AlertSettings {
        let snap = try? await Database.ready().document("alertSettings/\(uid)").getDocument()
        return AlertSettings(snap?.data())
    }

    public func saveSettings(_ settings: AlertSettings, uid: String) async throws {
        try await Database.ready().document("alertSettings/\(uid)").setData(settings.fields(uid: uid), merge: true)
    }

    /// The web's city list, fetched the first time someone types.
    public func searchCities(_ query: String) async -> [AlertSettings.Place] {
        if Self.cities == nil, let (data, response) = try? await URLSession.shared.data(from: CitySearch.listURL),
           (response as? HTTPURLResponse)?.statusCode == 200 {
            Self.cities = CitySearch.parse(data)
        }
        return CitySearch.search(Self.cities ?? [], query: query)
    }
}

extension ISO8601DateFormatter {
    /// `new Date().toISOString()`: milliseconds and Z.
    static var withFraction: ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }
}
