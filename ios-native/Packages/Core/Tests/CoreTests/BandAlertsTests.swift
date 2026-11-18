import Foundation
import Testing
@testable import Core

/// Band alerts (Stage 3, Part 6): follows, the alert prefs, the on-sale
/// settings document, the city search, and the post-follow words.
struct BandAlertsTests {
    // MARK: Follows

    @Test func oneBandHoweverItsTyped() {
        let follows = [FollowedBand(name: "Goose"), FollowedBand(name: "Billy Strings")]
        #expect(BandFollows.isFollowing(" goose ", in: follows))
        #expect(!BandFollows.isFollowing("Phish", in: follows))
        #expect(!BandFollows.isFollowing("  ", in: follows))
    }

    @Test func followingAddsTheWebsShapeAndUnfollowingRemovesEverySpelling() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let added = BandFollows.toggled("  Phish ", in: [FollowedBand(name: "Goose")], mbid: "e01646f2", now: now)
        #expect(added.map(\.name) == ["Goose", "Phish"])
        #expect(added.last?.mbid == "e01646f2")
        #expect(added.last?.addedAt == "2027-01-15T08:00:00.000Z", "new Date().toISOString()")

        let removed = BandFollows.toggled("GOOSE", in: added, mbid: nil)
        #expect(removed.map(\.name) == ["Phish"])

        // A legacy plain-name entry is written back as an object.
        let legacy = try JSONDecoder().decode([FollowedBand].self, from: Data(#"["Goose",{"name":"Phish","mbid":null}]"#.utf8))
        let stored = BandFollows.firestoreValue(legacy)
        #expect(stored.first?["name"] as? String == "Goose")
        #expect(stored.first?["mbid"] is NSNull)
    }

    @Test func slugsMatchTheWeb() {
        // artistSlugFromName (lib/artistSlug.js).
        #expect(BandFollows.slug("Billy Strings") == "billy-strings")
        #expect(BandFollows.slug("AC/DC") == "acdc")
        #expect(BandFollows.slug("Mumford & Sons") == "mumford-sons")
        #expect(BandFollows.slug("The  String Cheese   Incident") == "the-string-cheese-incident")
        #expect(BandFollows.slug("Béla Fleck") == "bla-fleck")
        #expect(BandFollows.slug("King Gizzard & the Lizard Wizard") == "king-gizzard-the-lizard-wizard")
        #expect(BandFollows.slug("  Phish  ") == "phish", "trimmed first (5.60.32)")
    }

    /// fixtures/song-index/keys.json `artistSlug` rows: the web's
    /// artistSlugFromName, row for row.
    @Test func slugsMatchTheSharedFixture() throws {
        let fixture = try FixtureLoader.json(FixtureLoader.root.appendingPathComponent("song-index/keys.json"))
        let rows = try #require(fixture["artistSlug"] as? [[String]])
        #expect(!rows.isEmpty)
        for row in rows {
            #expect(BandFollows.slug(row[0]) == row[1], "\(row[0])")
        }
    }

    @Test func aBandLinkFindsItsName() {
        let follows = [FollowedBand(name: "Goose")]
        #expect(BandFollows.name(forSlug: "goose", follows: follows, seen: []) == "Goose")
        #expect(BandFollows.name(forSlug: "billy-strings", follows: follows, seen: ["Phish", "Billy Strings"]) == "Billy Strings")
        #expect(BandFollows.name(forSlug: "dead-company", follows: [], seen: []) == "Dead Company")
    }

    @Test func whatAFollowSays() {
        #expect(BandFollows.followedMessage("Goose ", pushAllowed: true, isGuest: false, hasHomeCity: true)
                == "Following Goose. We'll let you know when they announce a tour.")
        #expect(BandFollows.followedMessage("Goose", pushAllowed: false, isGuest: false, hasHomeCity: false)
                == "Following Goose. We'll email you when they announce a tour. Add your city to get on-sale alerts.")
        #expect(BandFollows.followedMessage("Goose", pushAllowed: false, isGuest: true, hasHomeCity: true)
                == "Following Goose. Their tour news will be in Notifications.", "a guest has no email")
    }

    // MARK: Prefs

    @Test func prefsReadLikeAlertChannels() throws {
        let decode = { (json: String) in try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) }
        let none = AlertPref(nil)
        #expect(none.enabled && none.push && none.email && none.inApp, "everything defaults on")
        let legacy = AlertPref(try decode(#"{"enabled":true,"method":"email"}"#))
        #expect(!legacy.push && legacy.email)
        let explicit = AlertPref(try decode(#"{"enabled":false,"method":"both","push":false,"email":true,"inApp":false}"#))
        #expect(!explicit.enabled && !explicit.push && explicit.email && !explicit.inApp)

        var p = AlertPref(nil)
        p.email = false
        let stored = p.stored(withInApp: false)
        #expect(stored["method"] as? String == "push")
        #expect(stored["inApp"] == nil)
        p.push = false
        #expect(p.stored(withInApp: true)["method"] as? String == "none")
        #expect(p.stored(withInApp: true)["inApp"] as? Bool == true)
    }

    @Test func profileCarriesItsPrefs() throws {
        let profile = try JSONDecoder().decode(UserProfile.self, from: Data(#"""
        {"displayName":"Ann","favoriteArtists":["Goose"],
         "notificationPrefs":{"engagementNotifications":false,"emailFrequency":"immediate","onsaleAlerts":{"enabled":true,"method":"both","inApp":false}}}
        """#.utf8))
        #expect(profile.alertPref(.onsaleAlerts).inApp == false)
        #expect(profile.alertPref(.anniversaries).enabled)
        #expect(!profile.engagementOn && profile.engagementEmailImmediately)
        #expect(AlertKind.allCases.map(\.rawValue) == ["anniversaries", "followedBands", "venueBucketList", "onsaleAlerts"])
    }

    // MARK: On-sale settings

    @Test func theSettingsDocumentIsWhatTheRulesAllow() {
        // firestore.rules alertSettings: keys hasOnly(uid, homeLocation, alertRadiusMiles, timezone, updatedAt).
        let s = AlertSettings(homeLocation: .init(label: "Denver, CO", lat: 39.739, lng: -104.985), radiusMiles: 50, timezone: "America/Denver")
        let fields = s.fields(uid: "u1")
        #expect(Set(fields.keys) == ["uid", "homeLocation", "alertRadiusMiles", "timezone", "updatedAt"])
        #expect(Set((fields["homeLocation"] as? [String: Any])?.keys.map { $0 } ?? []) == ["label", "lat", "lng"])
        #expect(AlertSettings.radiusOptions.contains(fields["alertRadiusMiles"] as? Int ?? 0))
        #expect(AlertSettings(nil).fields(uid: "u1")["homeLocation"] is NSNull)
    }

    @Test func storedSettingsRead() {
        let s = AlertSettings(["homeLocation": ["label": "Denver, CO", "lat": 39.7, "lng": -105.0], "alertRadiusMiles": 33, "timezone": "America/Denver"])
        #expect(s.homeLocation?.label == "Denver, CO")
        #expect(s.radiusMiles == AlertSettings.defaultRadius, "an unlisted radius falls back")
        #expect(s.timezone == "America/Denver")
    }

    // MARK: Cities

    @Test func citySearchMatchesTheWebs() {
        let rows = CitySearch.parse(Data(#"""
        [["Columbus","OH","US",39.96,-82.99],["Columbus","GA","US",32.46,-84.98],["Colombo","","LK",6.93,79.85],
         ["Montréal","QC","CA",45.5,-73.57],["Paris","","FR",48.85,2.35],["Paris","TX","US",33.66,-95.56]]
        """#.utf8))
        #expect(rows.count == 6)
        #expect(CitySearch.search(rows, query: "columbus").map(\.label) == ["Columbus, OH", "Columbus, GA"], "biggest first")
        #expect(CitySearch.search(rows, query: "columbus, ga").map(\.label) == ["Columbus, GA"])
        #expect(CitySearch.search(rows, query: "montreal").first?.label == "Montréal, QC", "accents fold")
        #expect(CitySearch.search(rows, query: "paris").first?.label == "Paris, FR", "no region: the country")
        #expect(CitySearch.search(rows, query: "c").isEmpty, "two letters at least")
        #expect(CitySearch.search(rows, query: "co", limit: 1).count == 1)
    }
}
