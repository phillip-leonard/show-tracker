import FirebaseFirestore
import Foundation
import Testing
@testable import Core

/// The venue page (Stage 4, 4-7): the documents read and written match
/// lib/venues.js, lib/bucketListVenues.js and the web's VenueRatingModal.
struct VenuesTests {
    private let key = "red rocks amphitheatre::morrison"

    @Test func theVenueDocumentReadsLeniently() {
        let v = VenueInfo(key: key, data: [
            "name": "Red Rocks Amphitheatre", "city": "Morrison", "state": "CO",
            "isVerified": true, "verifiedOwnerUid": "owner",
            "capacity": 9525, "yearOpened": "1941", "address": "  18300 W Alameda Pkwy ",
            "bio": "", "officialWebsite": "redrocksonline.com", "phone": NSNull(),
        ])
        #expect(v.name == "Red Rocks Amphitheatre")
        #expect(v.state == "CO")
        #expect(v.capacity == "9525")
        #expect(v.yearOpened == "1941")
        #expect(v.address == "18300 W Alameda Pkwy")
        #expect(v.bio == nil) // empty reads as none
        #expect(v.officialWebsite?.absoluteString == "https://redrocksonline.com")
        #expect(v.isOwned(by: "owner"))
        #expect(!v.isOwned(by: "someone"))
        #expect(!v.isOwned(by: nil))
        // Not verified: nobody owns it, even with an owner stored.
        #expect(!VenueInfo(key: key, data: ["verifiedOwnerUid": "owner"]).isOwned(by: "owner"))
        // A boolean isn't a capacity.
        #expect(VenueInfo(key: key, data: ["capacity": true]).capacity == nil)
    }

    @Test func onlyWebLinksOpen() {
        #expect(VenueText.websiteURL("https://example.com/venue")?.absoluteString == "https://example.com/venue")
        #expect(VenueText.websiteURL("HTTP://example.com")?.host == "example.com")
        #expect(VenueText.websiteURL("www.example.com")?.absoluteString == "https://www.example.com")
        #expect(VenueText.websiteURL("javascript:alert(1)") == nil)
        #expect(VenueText.websiteURL("mailto:box@example.com") == nil)
        #expect(VenueText.websiteURL("example.com:8080/tickets")?.absoluteString == "https://example.com:8080/tickets")
        #expect(VenueText.websiteURL("ftp://example.com") == nil)
        #expect(VenueText.websiteURL("   ") == nil)
        #expect(VenueText.websiteURL(nil) == nil)
    }

    @Test func theAverageIsTheWebsToFixed() {
        func ratings(_ values: [Int]) -> [VenueRating] {
            values.enumerated().map { VenueRating(id: "r\($0.offset)", data: ["userId": "u\($0.offset)", "overallRating": $0.element]) }
        }
        #expect(VenueRatings.average([]) == nil)
        #expect(VenueRatings.average(ratings([4, 5])) == "4.5")
        #expect(VenueRatings.average(ratings([5])) == "5.0")
        // Exact ties round up, as JavaScript's toFixed does (%.1f would say 4.2).
        #expect(VenueRatings.average(ratings([4, 4, 4, 5])) == "4.3")
        #expect(VenueRatings.average(ratings([3, 4, 4, 4])) == "3.8")
        // 23 / 20 is 1.1499… in binary, so the web says 1.1.
        #expect(VenueRatings.average(ratings(Array(repeating: 1, count: 17) + [2, 2, 2])) == "1.1")
        // A rating with no overall counts as 0, as on the web.
        let missing = [VenueRating(id: "x", data: ["userId": "u"])] + ratings([4])
        #expect(VenueRatings.average(missing) == "2.0")
    }

    @Test func aRatingIsSavedUnderTheWebsDocumentId() {
        #expect(VenueRatings.documentId(uid: "u1", venueKey: key) == "u1_red_rocks_amphitheatre__morrison")
        // Every UTF-16 unit that isn't a-z or 0-9 is one "_" (an emoji is two).
        #expect(VenueRatings.documentId(uid: "u1", venueKey: "café 🎸::b") == "u1_caf______b")
        // The key part stops at 60.
        let long = String(repeating: "a", count: 80) + "::city"
        #expect(VenueRatings.documentId(uid: "u", venueKey: long) == "u_" + String(repeating: "a", count: 60))
    }

    @Test func aRatingWritesTheModalsFields() throws {
        var draft = VenueRatingDraft()
        #expect(!draft.canSave)
        draft.overallRating = 4
        draft.subRatings = ["soundQuality": 5]
        draft.review = "  Great sound.  "
        #expect(draft.canSave)
        let data = VenueRatings.writeData(uid: "u1", userName: "Phil", venueKey: key, venueName: "Red Rocks Amphitheatre",
                                          venueCity: "Morrison", draft: draft, isNew: true)
        #expect(data["venueName"] as? String == "red rocks amphitheatre")
        #expect(data["venueCity"] as? String == "morrison")
        #expect(data["venueKey"] as? String == key)
        #expect(data["venueDisplayName"] as? String == "Red Rocks Amphitheatre")
        #expect(data["venueCityDisplay"] as? String == "Morrison")
        #expect(data["userId"] as? String == "u1")
        #expect(data["userDisplayName"] as? String == "Phil")
        #expect(data["overallRating"] as? Int == 4)
        #expect(data["subRatings"] as? [String: Int] == ["soundQuality": 5, "sightlines": 0, "atmosphere": 0, "accessibility": 0, "foodDrinks": 0])
        #expect(data["review"] as? String == "Great sound.")
        #expect(data["updatedAt"] is FieldValue)
        #expect(data["createdAt"] is FieldValue)

        // Editing: no createdAt; an empty review is null; no name is "Anonymous".
        draft.review = "   "
        let edit = VenueRatings.writeData(uid: "u1", userName: "", venueKey: key, venueName: "Red Rocks Amphitheatre",
                                          venueCity: "Morrison", draft: draft, isNew: false)
        #expect(edit["createdAt"] == nil)
        #expect(edit["review"] is NSNull)
        #expect(edit["userDisplayName"] as? String == "Anonymous")
    }

    @Test func anExistingRatingFillsTheDraft() {
        let mine = VenueRating(id: "u1_x", data: ["userId": "u1", "overallRating": 3,
                                                  "subRatings": ["sightlines": 2, "atmosphere": 0], "review": "Fine"])
        let draft = VenueRatingDraft(mine)
        #expect(draft.overallRating == 3)
        #expect(draft.subRatings == ["sightlines": 2, "atmosphere": 0])
        #expect(draft.review == "Fine")
    }

    @Test func aReportWritesTheWebsFields() {
        #expect(VenueReportReason.allCases.map(\.rawValue) == ["unverified_claiming_official", "duplicate", "wrong_info", "other"])
        let comment = String(repeating: "x", count: 600)
        let data = VenueReportReason.wrongInfo.reportData(venueKey: key, venueName: "Red Rocks", uid: "u1", userName: "", comment: comment)
        #expect(data["venueKey"] as? String == key)
        #expect(data["venueName"] as? String == "Red Rocks")
        #expect(data["reporterUid"] as? String == "u1")
        #expect(data["reporterName"] as? String == "Anonymous")
        #expect(data["reason"] as? String == "wrong_info")
        #expect((data["comment"] as? String)?.count == 500)
        #expect(data["status"] as? String == "open")
        #expect(data["createdAt"] is FieldValue)
    }

    @Test func theBucketListWritesTheWebsDocument() {
        #expect(VenueBucketList.documentId(uid: "u1", venueKey: key) == "u1_red rocks amphitheatre::morrison")
        let data = VenueBucketList.data(uid: "u1", venueKey: key, name: "Red Rocks Amphitheatre", city: "Morrison", state: nil)
        #expect(data["userId"] as? String == "u1")
        #expect(data["venueKey"] as? String == key)
        #expect(data["venueName"] as? String == "Red Rocks Amphitheatre")
        #expect(data["venueCity"] as? String == "Morrison")
        #expect(data["venueState"] is NSNull)
        #expect(data["addedAt"] is FieldValue)
    }

    @Test func keysThatCantNameADocumentAreSkipped() {
        #expect(VenueKeys.isDocumentId(key))
        #expect(!VenueKeys.isDocumentId("ac/dc arena::x"))
        #expect(!VenueKeys.isDocumentId(""))
        #expect(!VenueKeys.isDocumentId("__x__"))
        #expect(VenueKeys.parts(key).name == "red rocks amphitheatre")
        #expect(VenueKeys.parts(key).city == "morrison")
        #expect(VenueKeys.parts("no city::").city == "")
        #expect(VenueKeys.fallbackName(key) == "Red Rocks Amphitheatre")
        #expect(VenueKeys.fallbackName("::morrison") == "Venue")
    }

    @Test func yourShowsHereMatchTheVenueKey() throws {
        let shows = [
            try ShowListTests.show("a", "Goose", "2024-06-01", venue: "Red Rocks Amphitheatre", city: "Morrison"),
            try ShowListTests.show("b", "Phish", "2025-08-01", venue: " red rocks amphitheatre", city: "MORRISON "),
            try ShowListTests.show("c", "Goose", "2025-01-01", venue: "Red Rocks", city: "Morrison"),
        ]
        #expect(VenueShows.mine(key, in: shows).map(\.id) == ["b", "a"])
    }

    @Test func manageVenueOpensTheDashboard() {
        #expect(VenueLinks.dashboard(key).absoluteString == "https://mysetlists.net/venue-dashboard/?venue=red+rocks+amphitheatre%3A%3Amorrison")
    }
}
