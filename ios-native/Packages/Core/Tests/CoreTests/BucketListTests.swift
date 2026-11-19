import FirebaseFirestore
import Foundation
import Testing
@testable import Core

/// The bucket list (Stage 4, 4-10): the documents lib/bucketList.js and
/// lib/bucketListVenues.js read and write, and the lists the screen shows.
struct BucketListTests {
    private func item(_ artist: String, _ date: String, venue: String? = nil, uid: String = "u1") -> BucketListItem {
        var data: [String: Any] = ["userId": uid, "artist": artist, "date": date, "source": "manual"]
        if let venue { data["venue"] = venue }
        return BucketListItem(id: "\(uid)_\(BucketList.itemKey(artist: artist, venue: venue, date: date))", uid: uid, data: data)
    }

    @Test func theItemKeyIsTheWebs() {
        #expect(BucketList.itemKey(artist: "Goose", venue: "Red Rocks", date: "2026-06-14") == "goose_red-rocks_2026-06-14")
        #expect(BucketList.itemKey(artist: " King Gizzard & the Lizard Wizard ", venue: nil, date: "2026-06-14")
                == "king-gizzard-the-lizard-wizard__2026-06-14")
        #expect(BucketList.itemKey(artist: "Phish", venue: "MSG!", date: "2026-12-31") == "phish_msg-_2026-12-31")
    }

    @Test func aDocumentReadsLeniently() {
        let read = BucketListItem(id: "u1_goose_red-rocks_2026-06-14", uid: "u1", data: [
            "userId": "u1", "artist": "Goose", "venue": "Red Rocks", "city": "Morrison", "state": "CO",
            "date": "14-06-2026", "source": "ticketmaster", "ticketUrl": "https://tm.example/1", "addedAt": NSNull(),
        ])
        #expect(read.key == "goose_red-rocks_2026-06-14")
        #expect(read.date == "2026-06-14", "a legacy date reads through ShowDate")
        #expect(read.place == "Red Rocks · Morrison, CO")
        #expect(read.sourceLabel == "Ticketmaster")
        #expect(read.ticketURL?.host == "tm.example")
        let bare = BucketListItem(id: "u1_x", uid: "u1", data: ["artist": "X", "date": "2026-01-01", "venue": NSNull(), "ticketUrl": NSNull()])
        #expect(bare.place.isEmpty)
        #expect(bare.sourceLabel == nil)
        #expect(bare.ticketURL == nil)
    }

    @Test func aShowAddedByHandWritesTheWebsShape() throws {
        var draft = BucketListDraft()
        #expect(BucketList.addData(uid: "u1", draft: draft) == nil, "band and date are required")
        draft.artist = " Goose "
        draft.date = "2026-06-14"
        draft.city = "Morrison"
        let made = try #require(BucketList.addData(uid: "u1", draft: draft))
        #expect(made.key == "goose__2026-06-14")
        #expect(BucketList.documentId(uid: "u1", key: made.key) == "u1_goose__2026-06-14")
        #expect(made.data["userId"] as? String == "u1")
        #expect(made.data["artist"] as? String == "Goose")
        #expect(made.data["venue"] is NSNull)
        #expect(made.data["city"] as? String == "Morrison")
        #expect(made.data["state"] is NSNull)
        #expect(made.data["date"] as? String == "2026-06-14")
        #expect(made.data["source"] as? String == "manual")
        #expect(made.data["ticketUrl"] is NSNull)
        #expect(made.data["addedAt"] is FieldValue)
    }

    @Test func comingUpAndAlreadyHappenedSplitOnToday() {
        let items = [
            item("Phish", "2026-12-31", venue: "MSG"),
            item("Goose", "2026-11-19", venue: "Red Rocks"),
            item("Billy Strings", "2026-11-01"),
            item("Arcade Fire", "2027-03-01"),
        ]
        let today = "2026-11-19"
        #expect(BucketList.upcoming(items, today: today, query: "", sort: .soonest).map(\.artist) == ["Goose", "Phish", "Arcade Fire"],
                "today counts as coming up, as on the web")
        #expect(BucketList.upcoming(items, today: today, query: "", sort: .name).map(\.artist) == ["Arcade Fire", "Goose", "Phish"])
        #expect(BucketList.past(items, today: today, query: "").map(\.artist) == ["Billy Strings"])
        #expect(BucketList.upcoming(items, today: today, query: "msg", sort: .soonest).map(\.artist) == ["Phish"], "venue matches too")
        #expect(BucketList.upcoming(items, today: today, query: "GOOSE", sort: .soonest).map(\.artist) == ["Goose"])
    }

    @Test func shareTextListsBandDateVenueAndCity() {
        let withCity = BucketListItem(id: "u1_k", uid: "u1", data: ["artist": "Goose", "date": "2026-06-14", "venue": "Red Rocks", "city": "Morrison", "state": "CO",
                                                                  "ticketUrl": "https://tm.example/1"])
        let cityOnly = BucketListItem(id: "u1_c", uid: "u1", data: ["artist": "Billy Strings", "date": "2026-10-02", "city": "Asheville"])
        let text = BucketList.shareText([withCity, item("Phish", "2026-12-31", venue: "MSG"), cityOnly, item("Eggy", "2027-01-05")])
        #expect(text == """
        My concert bucket list:
        - Goose — Sun, Jun 14, 2026 @ Red Rocks, Morrison
        - Phish — Thu, Dec 31, 2026 @ MSG
        - Billy Strings — Fri, Oct 2, 2026 @ Asheville
        - Eggy — Tue, Jan 5, 2027
        """)
        // Plain text: no ticket, calendar or other link.
        #expect(!text.contains("http"))
        #expect(BucketList.longDate("not a date") == "not a date")
    }

    @Test func theCalendarLocationIsVenuePlusCity() {
        let both = BucketListItem(id: "u1_a", uid: "u1", data: ["artist": "Goose", "date": "2026-06-14", "venue": "Red Rocks", "city": "Morrison", "state": "CO"])
        #expect(BucketList.calendarLocation(both) == "Red Rocks, Morrison")
        #expect(BucketList.calendarLocation(item("Phish", "2026-12-31", venue: "MSG")) == "MSG")
        let cityOnly = BucketListItem(id: "u1_c", uid: "u1", data: ["artist": "Billy Strings", "date": "2026-10-02", "city": "Asheville"])
        #expect(BucketList.calendarLocation(cityOnly) == "Asheville")
        #expect(BucketList.calendarLocation(item("Eggy", "2027-01-05")) == "")
    }

    @Test func aFoundVenueFillsOnlyWhatsMissing() throws {
        let show = BucketListItem(id: "u1_k", uid: "u1", data: ["artist": "Goose", "date": "2030-06-14", "city": "Morrison"])
        let request = BucketList.venueRequest(show)
        #expect(request == BucketVenueRequest(artist: "Goose", date: "2030-06-14", city: "Morrison", state: nil))
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        #expect(body?["state"] == nil, "a missing state isn't sent")

        let answer = BucketVenueAnswer(found: true, venue: "Red Rocks Amphitheatre", city: "MORRISON", state: "CO",
                                       lat: 39.66, lng: -105.2, url: "https://tm.example/1", reason: nil)
        let fields = try #require(BucketList.venueUpdate(show, answer: answer))
        #expect(fields["venue"] as? String == "Red Rocks Amphitheatre")
        #expect(fields["city"] == nil, "the city typed stays")
        #expect(fields["state"] as? String == "CO")
        #expect(fields["ticketUrl"] as? String == "https://tm.example/1")

        let updated = BucketList.applying(answer, to: show)
        #expect(updated.venue == "Red Rocks Amphitheatre")
        #expect(updated.city == "Morrison")
        #expect(updated.state == "CO")
        #expect(updated.ticketURL?.host == "tm.example")
        #expect(BucketList.calendarLocation(updated) == "Red Rocks Amphitheatre, Morrison")

        let none = BucketVenueAnswer(found: false, venue: nil, city: nil, state: nil, lat: nil, lng: nil, url: nil, reason: "ambiguous")
        #expect(BucketList.venueUpdate(show, answer: none) == nil)
        #expect(BucketList.applying(none, to: show) == show)
    }

    @Test func venuesReadTheirDocuments() {
        let v = BucketListVenue(data: ["userId": "u1", "venueKey": "red rocks::morrison", "venueName": "Red Rocks", "venueCity": "Morrison", "venueState": NSNull()])
        #expect(v.venueKey == "red rocks::morrison")
        #expect(v.place == "Morrison")
        #expect(BucketListVenue(data: ["venueName": "No key"]).venueKey.isEmpty)
    }
}
