import Foundation
import Testing
@testable import Core

/// Show social (Stage 3, Part 3b): what waits for an answer, who can be
/// tagged, what each answer says, and the bodies sent to `friends.js`.
struct ShowSocialLogicTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private func body(_ value: some Encodable) throws -> NSDictionary {
        (try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? NSDictionary) ?? [:]
    }

    private func tag(_ id: String, from: String = "ann", to: String = "me", status: String = "pending", upcoming: Bool = false,
                     at: String = "2026-11-01T00:00:00Z") throws -> ShowTag {
        let extra = upcoming ? #","upcomingShowId":"u1""# : ""
        let data = upcoming
            ? #"{"artist":"Goose","venue":"Red Rocks","city":"Morrison","date":"2099-06-01","upcoming":true,"time":"19:00"}"#
            : #"{"artist":"Phish","venue":"MSG","city":"NYC","date":"31-12-2025","setlist":[{"id":"a","name":"Tweezer"}]}"#
        var t = try decode(ShowTag.self, #"{"fromUid":"\#(from)","fromName":"Ann","toUid":"\#(to)","status":"\#(status)","createdAt":"\#(at)","showData":\#(data)\#(extra)}"#)
        t.id = id
        return t
    }

    private func suggestion(_ id: String, mine: String, theirs: String, overall: String = "pending", other: String = "ben") throws -> ShowSuggestion {
        var s = try decode(ShowSuggestion.self, #"""
        {"participants":["me","\#(other)"],"names":{"me":"Me","\#(other)":"Ben"},"showKey":"k",
         "showData":{"artist":"Phish","venue":"MSG","date":"2025-12-31","city":""},
         "responses":{"me":"\#(mine)","\#(other)":"\#(theirs)"},"overallStatus":"\#(overall)"}
        """#)
        s.id = id
        return s
    }

    // MARK: Lists

    @Test func pendingTagsAreMineUnansweredNewestFirstWithoutBlocked() throws {
        let tags = [
            try tag("old", at: "2026-11-01T00:00:00Z"),
            try tag("new", upcoming: true, at: "2026-11-10T00:00:00Z"),
            try tag("answered", status: "declined"),
            try tag("revoked", status: "revoked"),
            try tag("blocked", from: "x"),
            try tag("notMine", to: "someone"),
        ]
        #expect(ShowSocialLists.pendingTags(tags, uid: "me", blocked: ["x"]).map(\.id) == ["new", "old"])
    }

    @Test func pendingSuggestionsWaitOnMe() throws {
        let all = [
            try suggestion("waiting", mine: "pending", theirs: "pending"),
            try suggestion("theySaidYes", mine: "pending", theirs: "confirmed", overall: "partially_confirmed"),
            try suggestion("answered", mine: "confirmed", theirs: "pending", overall: "partially_confirmed"),
            try suggestion("declined", mine: "pending", theirs: "declined", overall: "declined"),
            try suggestion("blocked", mine: "pending", theirs: "pending", other: "x"),
        ]
        #expect(Set(ShowSocialLists.pendingSuggestions(all, uid: "me", blocked: ["x"]).map(\.id)) == ["waiting", "theySaidYes"])
        #expect(ShowSocialMessages.suggestionNote(all[1], uid: "me") == "Ben said yes.")
        #expect(ShowSocialMessages.suggestionNote(all[0], uid: "me") == nil)
        #expect(ShowSocialMessages.suggestionTitle(all[0], uid: "me") == "Were you at Phish with Ben?")
    }

    @Test func taggableLeavesOutTheTaggedAndTheBlocked() {
        let friends = [FriendEdge(friendUid: "a", friendName: "A"), FriendEdge(friendUid: "b", friendName: "B"), FriendEdge(friendUid: "c", friendName: "C")]
        #expect(ShowSocialLists.taggable(friends, alreadyTagged: ["a"], blocked: ["c"]).map(\.friendUid) == ["b"])
    }

    @Test func sentStatusesPreferPendingOrAccepted() {
        let statuses = ShowSocialLists.sentStatuses([
            (toUid: "a", status: "revoked"), (toUid: "a", status: "pending"),
            (toUid: "b", status: "accepted"), (toUid: "b", status: "revoked"),
            (toUid: "c", status: "declined"),
        ])
        #expect(statuses == ["a": "pending", "b": "accepted", "c": "declined"])
    }

    // MARK: Messages

    @Test func tagTitles() throws {
        #expect(ShowSocialMessages.tagTitle(try tag("p")) == "Ann says you were at Phish")
        #expect(ShowSocialMessages.tagTitle(try tag("u", upcoming: true)) == "Ann is going to Goose with you")
        #expect(ShowSocialMessages.isUpcoming(try tag("u", upcoming: true)))
        #expect(try tag("p").showData.isoDate == "2025-12-31", "a DD-MM-YYYY tag date reads as ISO")
    }

    @Test func taggedMessages() throws {
        let two = try decode(TagFriendsResponse.self, #"{"tagged":["a","b"],"skipped":[],"emailTags":0}"#)
        #expect(ShowSocialMessages.tagged(two, band: "Phish", upcoming: false) == "Tagged 2 friends at Phish.")
        let one = try decode(TagFriendsResponse.self, #"{"tagged":["a"],"skipped":["x"],"emailTags":0}"#)
        #expect(ShowSocialMessages.tagged(one, band: "Goose", upcoming: true) == "Tagged 1 friend as going to Goose. 1 person couldn't be tagged.")
        let invite = try decode(TagFriendsResponse.self, #"{"tagged":[],"skipped":[],"emailTags":1}"#)
        #expect(ShowSocialMessages.tagged(invite, band: "Phish", upcoming: false) == "Invite sent.")
    }

    @Test func suggestionAnswers() throws {
        let both = try decode(SuggestionAnswerResponse.self, #"{"overallStatus":"confirmed","nudged":false}"#)
        #expect(ShowSocialMessages.suggestionAnswer(both, confirmed: true) == "You were both there.")
        let nudged = try decode(SuggestionAnswerResponse.self, #"{"overallStatus":"partially_confirmed","nudged":true}"#)
        #expect(ShowSocialMessages.suggestionAnswer(nudged, confirmed: true) == "Thanks. We've asked your friend too.")
        #expect(ShowSocialMessages.suggestionAnswer(both, confirmed: false) == "Thanks, noted.")
    }

    @Test func aPassedUpcomingTagBecomesAPastShow() {
        #expect(FriendsStore.isDatePassed(.server(status: 409, message: "That date has passed.", code: "date_passed")))
        #expect(!FriendsStore.isDatePassed(.server(status: 409, message: nil, code: "use_normalize_show")))
        #expect(!FriendsStore.isDatePassed(.offline))
    }

    // MARK: Answers and bodies

    @Test func answersDecode() throws {
        let accepted = try decode(RespondTagResponse.self, #"{"success":true,"tagStatus":"accepted","upcomingId":"u9","duplicate":false}"#)
        #expect(accepted.upcomingId == "u9" && accepted.duplicate == false)
        let together = try decode(ShowsTogetherResponse.self, #"""
        {"shows":[{"id":"s1","artist":"Phish","venue":"MSG","date":"2025-12-31","rating":9,"createdAt":{"_seconds":1},"friendShow":{"id":"f1"}}]}
        """#)
        #expect(together.shows.map(\.id) == ["s1"])
    }

    @Test func showSocialBodies() throws {
        let cases: [(FriendsRequest, NSDictionary)] = [
            (.tag(.show("s1"), friendUids: ["a"]), ["action": "tag", "showId": "s1", "friendUids": ["a"]]),
            (.tag(.upcoming("u1"), friendUids: ["a", "b"]), ["action": "tag", "upcomingId": "u1", "friendUids": ["a", "b"]]),
            (.tag(.show("s1"), friendUids: [], emails: [.init(email: "n@x.co", name: "Newt")]),
             ["action": "tag", "showId": "s1", "emails": [["email": "n@x.co", "name": "Newt"]]]),
            (.respondTag(tagId: "t1", response: .accepted), ["action": "respondTag", "tagId": "t1", "response": "accepted"]),
            (.declineEmailTag(pendingEmailTagId: "p1"), ["action": "respondTag", "pendingEmailTagId": "p1", "response": "declined"]),
            (.revokeTag(tagId: "t1"), ["action": "revokeTag", "tagId": "t1"]),
            (.revokeUpcomingTags(upcomingId: "u1", toUid: "a"), ["action": "revokeTag", "upcomingId": "u1", "toUid": "a"]),
            (.revokeUpcomingTags(upcomingId: "u1", toUid: nil), ["action": "revokeTag", "upcomingId": "u1"]),
            (.refreshUpcomingTags(upcomingId: "u1"), ["action": "refreshUpcomingTags", "upcomingId": "u1"]),
            (.respondSuggestion(suggestionId: "g1", response: .declined), ["action": "respondSuggestion", "suggestionId": "g1", "response": "declined"]),
        ]
        for (request, expected) in cases {
            #expect(try body(request) == expected)
        }
    }
}
