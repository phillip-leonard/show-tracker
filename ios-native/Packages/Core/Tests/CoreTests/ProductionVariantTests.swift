import FirebaseFirestore
import Foundation
import Testing
@testable import Core

/// The shapes production still holds (the 2026-11-14 scan, FOUNDATION-AUDIT
/// §1.3), decoded the way Firestore hands them over: `Firestore.Decoder`
/// with real `Timestamp` values. Each test is one variant; together they are
/// what scripts/scan-show-decode.js checks every production document for.
@Suite struct ProductionVariantTests {
    let decoder = Firestore.Decoder()
    let stamp = Timestamp(seconds: 1_763_121_600, nanoseconds: 0) // 2025-11-14T12:00:00Z

    private func show(_ fields: [String: Any]) throws -> Show {
        try decoder.decode(Show.self, from: ["artist": "Goose", "venue": "Red Rocks", "city": "Morrison", "date": "2024-06-21", "setlist": []].merging(fields) { _, new in new })
    }

    @Test func storedIdFieldIsReadAndTheSnapshotIdWins() throws {
        // 58 shows store `id`; @DocumentID would refuse them.
        var s = try show(["id": "1700000000001"])
        #expect(s.id == "1700000000001")
        s.id = "doc-id" // what DocumentSnapshot.decodeShow() does
        #expect(s.id == "doc-id")
        #expect(try show([:]).id == "")
    }

    @Test func createdAtTimestampOrIsoString() throws {
        #expect(try show(["createdAt": stamp]).createdAt == stamp.dateValue())
        #expect(try show(["createdAt": "2025-11-14T12:00:00.000Z"]).createdAt == stamp.dateValue())
        #expect(try show(["createdAt": "2025-11-14T12:00:00Z"]).createdAt == stamp.dateValue())
        #expect(try show(["createdAt": NSNull()]).createdAt == nil)
        #expect(try show([:]).createdAt == nil)
    }

    @Test func noneIsNullEmptyOrAbsent() throws {
        for value: Any in [NSNull(), ""] {
            let s = try show(["tour": value, "country": value, "artistMbid": value, "comment": value, "setlistfmId": value, "festivalId": value, "needsReviewReason": NSNull()])
            #expect(s.tour == nil && s.country == nil && s.artistMbid == nil && s.comment == nil && s.setlistfmId == nil && s.festivalId == nil)
            #expect(s.needsReviewReason == nil)
        }
        #expect(try show(["city": ""]).city == "")
    }

    @Test func ratingsReadAsWholeNumbersOneToTen() throws {
        #expect(try show(["rating": 8]).rating == 8)
        #expect(try show(["rating": 7.6]).rating == 8)
        #expect(try show(["rating": NSNull()]).rating == nil)
        #expect(try show(["rating": 11]).rating == nil)
        #expect(try show(["venueRating": 4]).venueRating == 4)
    }

    @Test func legacyAndExtraFieldsDecode() throws {
        let s = try show([
            "date": "2024-06-21", "dateNormalizedFrom": "21-06-2024", "importedByAdmin": true,
            "artistImage": "https://x", "posterCheckedQuick": true, "setlistScanAt": "2025-01-01T00:00:00Z",
            "setlistFetchAttempted": true, "isFestival": true, "festivalName": "Bonnaroo", "normalizedVersion": 1,
        ])
        #expect(s.festivalName == "Bonnaroo" && s.isFestival == true && s.normalizedVersion == 1)
    }

    @Test func songsWithoutSetWithSetBreakAndNullCover() throws {
        let s = try show(["setlist": [
            ["id": "1", "name": "Arcadia", "set": "Set I", "cover": NSNull(), "tape": false],
            ["id": "2", "name": "Soundcheck jam"],                                    // `set` absent
            ["id": "3", "name": "Tweezer", "set": "Set II", "setBreak": "Set Break", "cover": "Phish"],
            ["id": "4", "name": "", "setBreak": NSNull(), "sourceGap": 12, "jamchart": true, "jamchartNote": "x"],
            ["id": "5", "name": "Jam", "rating": NSNull(), "transitionMark": "", "footnote": ""],
        ]])
        #expect(s.setlist.map(\.set) == ["Set I", nil, "Set II", nil, nil])
        #expect(s.setlist[0].cover == nil && s.setlist[2].cover == "Phish")
        #expect(s.setlist[2].setBreak == "Set Break" && s.setlist[3].setBreak == nil)
        #expect(s.setlist[3].name == "" && s.setlist[3].sourceGap == 12)
        #expect(s.setlist[4].transitionMark == "" && s.setlist[4].rating == nil)
    }

    @Test func followedBandsAreObjectsOrPlainNames() throws {
        let p = try decoder.decode(UserProfile.self, from: [
            "favoriteArtists": [["name": "Goose", "mbid": "abc", "addedAt": "2026-01-01T00:00:00.000Z"], "Phish", "Spafford"],
            "createdAt": stamp, "banned": false, "displayName": "",
        ])
        #expect(p.favoriteArtists.map(\.name) == ["Goose", "Phish", "Spafford"])
        #expect(p.favoriteArtists[0].mbid == "abc" && p.favoriteArtists[1].mbid == nil)
        #expect(p.displayName == nil, "an empty name is no name")
        #expect(p.showOnLeaderboard, "missing means on")
    }

    @Test func profileLegacyCountsAreIgnored() throws {
        // Old iOS builds write these; nothing reads them (CLAUDE.md, 5.59.15).
        _ = try decoder.decode(UserProfile.self, from: ["showCount": 44, "venueCount": 3, "odubleserId": "u1", "notificationPrefs": ["x": true]])
    }

    @Test func averageRatingNumberOrLegacyString() throws {
        let base: [String: Any] = ["statsVersion": 2, "showCount": 3, "showsByYear": ["2025": 2, "2026": 1], "topBands": [["name": "Goose", "count": 2]]]
        #expect(try decoder.decode(UserStats.self, from: base.merging(["avgShowRating": 8.3]) { $1 }).avgShowRating == 8.3)
        #expect(try decoder.decode(UserStats.self, from: base.merging(["avgShowRating": "8.3"]) { $1 }).avgShowRating == 8.3)
        let none = try decoder.decode(UserStats.self, from: base.merging(["avgShowRating": NSNull(), "firstShowDate": NSNull(), "rank": NSNull()]) { $1 })
        #expect(none.avgShowRating == nil && none.firstShowDate == nil && none.rank == nil)
        #expect(throws: DecodingError.self) { try decoder.decode(UserStats.self, from: base.merging(["avgShowRating": "high"]) { $1 }) }
    }

    @Test func communityStatsLegacyKeysAndStringAverages() throws {
        let c = try decoder.decode(CommunityStats.self, from: [
            "totalUsers": 34, "totalShows": 1467, "totalSongs": 21745,
            "topShowsAttended": [["odubleserId": "u1", "firstName": "A", "photoURL": "", "count": 10], ["userId": "u2", "odubleserId": "u2", "count": 9]],
            "topSongsByRating": [["songName": "Tweezer", "avgRating": "9.5", "ratingCount": 2, "artists": ["Phish"]]],
            "updatedAt": stamp,
        ])
        #expect(c.topShowsAttended.map(\.userId) == ["u1", "u2"])
        #expect(c.topShowsAttended[0].photoURL == nil)
        #expect(c.topSongsByRating[0].avgRating == 9.5)
        #expect(!UserCount.shouldShow(c.totalUsers), "below 1,000 the count is hidden")
        #expect(UserCount.shouldShow(1_000))
    }

    @Test func yearInReviewWithoutPrivacyIsPrivate() throws {
        let doc = try decoder.decode(YearInReviewDocument.self, from: ["userId": "u1", "year": 2025, "generatedDate": stamp, "stats": NSNull()])
        #expect(!doc.isPublic && doc.stats == nil)
    }

    @Test func tagsWithLegacyDatesAndUpcomingTags() throws {
        let tag = try decoder.decode(ShowTag.self, from: [
            "fromUid": "a", "fromName": "A", "toUid": "b", "status": "pending", "createdAt": stamp,
            "showData": ["artist": "Goose", "venue": "Red Rocks", "city": "Morrison", "date": "21-06-2024", "tour": "",
                         "setlistfmId": "x", "isManual": false, "setlist": [["id": "1", "name": "Arcadia"]]],
        ])
        #expect(tag.showData.isoDate == "2024-06-21" && tag.showData.tour == nil)
        let upcoming = try decoder.decode(ShowTag.self, from: [
            "fromUid": "a", "fromName": "A", "toUid": "b", "status": "accepted", "upcomingShowId": "u1",
            "showData": ["artist": "Goose", "venue": "MSG", "city": "NYC", "date": "2030-01-01", "upcoming": true, "time": NSNull(), "ticketUrl": NSNull()],
        ])
        #expect(upcoming.showData.upcoming && upcoming.showData.setlist.isEmpty)
    }

    @Test func pendingEmailTagWithoutReadingAddresses() throws {
        let t = try decoder.decode(PendingEmailTag.self, from: [
            "fromUid": "a", "fromName": "A", "fromEmail": "a@example.com", "toEmail": "b@example.com", "toName": "B",
            "personalMessage": NSNull(), "status": "pending", "createdAt": stamp,
            "showData": ["artist": "Goose", "venue": "V", "city": "", "date": "03-04-2024", "setlistfmId": NSNull(), "isManual": true, "setlist": []],
        ])
        #expect(t.showData.isoDate == "2024-04-03", "two-two-four dates are day-first")
        #expect(t.personalMessage == nil)
    }

    @Test func friendEdgeSuggestionUpcomingAndConfig() throws {
        let f = try decoder.decode(FriendEdge.self, from: ["friendUid": "u2", "friendName": "B", "friendEmail": "b@example.com", "friendPhotoURL": "", "addedAt": stamp])
        #expect(f.friendPhotoURL == nil && f.addedAt != nil)
        let s = try decoder.decode(ShowSuggestion.self, from: [
            "participants": ["a", "b"], "names": ["a": "A", "b": "B"], "showKey": "k",
            "showData": ["artist": "Goose", "venue": "V", "date": "2024-06-21", "city": "C", "setlistfmId": NSNull()],
            "responses": ["a": "pending", "b": "yes"], "overallStatus": "pending", "emailSentToUid": NSNull(),
            "lastViewedAt": ["a": NSNull(), "b": NSNull()], "createdAt": stamp, "updatedAt": stamp, "backfill": true,
        ])
        #expect(s.backfill && s.responses["b"] == "yes")
        let u = try decoder.decode(UpcomingShow.self, from: [
            "artist": "Goose", "venue": "V", "city": "C", "date": "2030-01-01", "notes": "", "source": "manual",
            "time": NSNull(), "sourceEventId": NSNull(), "ticketUrl": NSNull(), "taggedFriendUids": [],
            "taggedBy": NSNull(), "taggedByUid": NSNull(), "originUpcomingId": NSNull(), "createdAt": stamp, "updatedAt": stamp,
        ])
        #expect(u.notes == nil && u.source == "manual")
        let config = try decoder.decode(AppConfig.self, from: ["minSupportedIosVersion": "3.13.10", "latestIosVersion": "3.13.30", "reason": "", "iosPushOfferEnabled": true, "updatedAt": stamp, "updatedBy": "admin"])
        #expect(config.reason == nil && config.iosPushOfferEnabled == true)
    }

    @Test func aWrongTypeIsAnErrorNotADefault() throws {
        #expect(throws: DecodingError.self) { try show(["artist": 42]) }
        #expect(throws: DecodingError.self) { try show(["setlist": "Arcadia, Tweezer"]) }
        #expect(throws: DecodingError.self) { try show(["rating": "great"]) }
    }
}
