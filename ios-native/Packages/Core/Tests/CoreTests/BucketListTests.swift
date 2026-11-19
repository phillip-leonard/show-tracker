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

    @Test func shareTextIsTheWebs() {
        let text = BucketList.shareText([item("Goose", "2026-06-14", venue: "Red Rocks"), item("Phish", "2026-12-31")])
        #expect(text == "My concert bucket list:\n- Goose — Sun, Jun 14, 2026 @ Red Rocks\n- Phish — Thu, Dec 31, 2026")
        #expect(BucketList.longDate("not a date") == "not a date")
    }

    @Test func venuesReadTheirDocuments() {
        let v = BucketListVenue(data: ["userId": "u1", "venueKey": "red rocks::morrison", "venueName": "Red Rocks", "venueCity": "Morrison", "venueState": NSNull()])
        #expect(v.venueKey == "red rocks::morrison")
        #expect(v.place == "Morrison")
        #expect(BucketListVenue(data: ["venueName": "No key"]).venueKey.isEmpty)
    }
}
