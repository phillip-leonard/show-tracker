import Foundation
import Testing
@testable import Core

/// The Friends tab's rules (Stage 3, Part 2b): what "Add a friend"
/// searches for, which requests show, what each answer says, and the
/// bodies sent to `friends.js` and `report-content`.
struct FriendsLogicTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private func body(_ value: some Encodable) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any] ?? [:]
    }

    // MARK: Search

    @Test func emailsAreLowercasedAndTrimmed() {
        #expect(FriendSearchQuery.parse("  Ann@Example.COM ") == .email("ann@example.com"))
    }

    @Test func handlesMatchTheServersRule() {
        #expect(FriendSearchQuery.parse("@Ben_B") == .handle("ben_b"))
        #expect(FriendSearchQuery.parse("ben_b") == .handle("ben_b"))
        #expect(FriendSearchQuery.parse("abc") == .handle("abc"))
        #expect(FriendSearchQuery.parse(String(repeating: "a", count: 20)) == .handle(String(repeating: "a", count: 20)))
    }

    @Test func anythingElseIsNotSearched() {
        for input in ["", "   ", "ab", "@ab", String(repeating: "a", count: 21), "ben b", "ben-b", "ann@", "ann@example", "a b@example.com", "@"] {
            #expect(FriendSearchQuery.parse(input) == nil, "\(input)")
        }
    }

    @Test func searchSendsTheMatchingAction() throws {
        #expect(try body(FriendSearchQuery.email("a@b.co").request) as NSDictionary == ["action": "lookupByEmail", "email": "a@b.co"])
        #expect(try body(FriendSearchQuery.handle("ben_b").request) as NSDictionary == ["action": "lookupByHandle", "handle": "ben_b"])
    }

    @Test func lookupAnswers() throws {
        let found = try decode(FriendLookupResponse.self, #"{"found":true,"uid":"u2","displayName":"Ben","handle":"Ben_B"}"#)
        #expect(FriendLookupOutcome(found, query: .handle("ben_b")) == .person(uid: "u2", name: "Ben", handle: "Ben_B"))

        let unnamed = try decode(FriendLookupResponse.self, #"{"found":true,"uid":"u2","displayName":""}"#)
        #expect(FriendLookupOutcome(unnamed, query: .email("b@x.co")) == .person(uid: "u2", name: "MySetlists member", handle: nil))

        let me = try decode(FriendLookupResponse.self, #"{"found":false,"self":true}"#)
        #expect(FriendLookupOutcome(me, query: .email("me@x.co")) == .yourself)

        let none = try decode(FriendLookupResponse.self, #"{"found":false}"#)
        #expect(FriendLookupOutcome(none, query: .email("new@x.co")) == .noAccountForEmail("new@x.co"))
        #expect(FriendLookupOutcome(none, query: .handle("nobody")) == .noAccountForHandle("nobody"))
    }

    // MARK: Lists

    private func request(_ id: String, from: String, to: String, status: String = "pending", at: String) throws -> FriendRequest {
        var r = try decode(FriendRequest.self, #"{"from":"\#(from)","to":"\#(to)","fromName":"F","toName":"T","status":"\#(status)","createdAt":"\#(at)"}"#)
        r.id = id
        return r
    }

    @Test func incomingIsPendingToMeNewestFirstWithoutBlocked() throws {
        let all = [
            try request("old", from: "a", to: "me", at: "2026-11-01T00:00:00Z"),
            try request("new", from: "b", to: "me", at: "2026-11-10T00:00:00Z"),
            try request("declined", from: "c", to: "me", status: "declined", at: "2026-11-12T00:00:00Z"),
            try request("blocked", from: "x", to: "me", at: "2026-11-13T00:00:00Z"),
            try request("mine", from: "me", to: "d", at: "2026-11-14T00:00:00Z"),
        ]
        #expect(FriendsLists.incoming(all, uid: "me", blocked: ["x"]).map(\.id) == ["new", "old"])
        #expect(FriendsLists.sent(all, uid: "me").map(\.id) == ["mine"])
    }

    @Test func friendsAreByNameWithoutBlocked() {
        let edges = [
            FriendEdge(friendUid: "1", friendName: "zoe"),
            FriendEdge(friendUid: "2", friendName: "Adam"),
            FriendEdge(friendUid: "3", friendName: "blocked"),
            FriendEdge(friendUid: "4", friendName: nil),
        ]
        #expect(FriendsLists.friends(edges, blocked: ["3"]).map(\.name) == ["Adam", "Friend", "zoe"])
    }

    @Test func invitesArePendingNewestFirst() throws {
        var a = try decode(Invite.self, #"{"inviteeEmail":"a@x.co","status":"pending","createdAt":"2026-11-01T00:00:00Z"}"#); a.id = "a"
        var b = try decode(Invite.self, #"{"inviteeEmail":"b@x.co","status":"pending","createdAt":"2026-11-05T00:00:00Z","lastSentAt":"2026-11-06T00:00:00Z"}"#); b.id = "b"
        var c = try decode(Invite.self, #"{"inviteeEmail":"c@x.co","status":"accepted"}"#); c.id = "c"
        #expect(FriendsLists.invites([a, b, c]).map(\.id) == ["b", "a"])
        #expect(b.lastSentAt != nil)
    }

    @Test func modelsReadTodaysDocuments() throws {
        // As friends.js writes them: no createdAt until the server's
        // timestamp lands in a cached copy, status always.
        let r = try decode(FriendRequest.self, #"{"from":"a","to":"b","status":"pending"}"#)
        #expect(r.isPending && r.fromName == nil && r.createdAt == nil)
        let blocks = try decode(UserBlocks.self, #"{"userId":"me","blockedUserIds":["x","y"],"updatedAt":"2026-11-16T00:00:00Z"}"#)
        #expect(blocks.blockedUserIds == ["x", "y"])
        #expect(try decode(UserBlocks.self, #"{"userId":"me"}"#).blockedUserIds.isEmpty)
    }

    // MARK: Messages

    @Test func requestAnswersSayWhatHappened() {
        #expect(FriendsMessages.request("requested", name: "Ben") == "Friend request sent to Ben.")
        // A block answers "requested" too, so it isn't revealed.
        #expect(FriendsMessages.request("already-requested", name: "Ben") == "You've already sent Ben a request.")
        #expect(FriendsMessages.request("already-friends", name: "Ben") == "You're already friends with Ben.")
        #expect(FriendsMessages.request("friends", name: "Ben") == "You and Ben are now friends.")
    }

    @Test func inviteAndResendAnswers() throws {
        #expect(FriendsMessages.invite("sent", email: "a@x.co") == "Invite sent to a@x.co.")
        #expect(FriendsMessages.invite("recipient opted out", email: "a@x.co").contains("turned off emails"))
        #expect(FriendsMessages.invite("already sent", email: "a@x.co").contains("last day"))
        #expect(FriendsMessages.resend(try decode(ResendInviteResponse.self, #"{"resent":true}"#)) == "Invite resent.")
        #expect(FriendsMessages.resend(try decode(ResendInviteResponse.self, #"{"resent":false,"reason":"already sent"}"#))
            == "An invite can be resent once every 24 hours.")
        #expect(FriendsMessages.resend(try decode(ResendInviteResponse.self, #"{"resent":false,"reason":"recipient opted out"}"#))
            .contains("turned off emails"))
    }

    @Test func failuresSayOfflineClearlyAndKeepTheServersWords() {
        #expect(FriendsMessages.failure(.offline, fallback: "x") == "You're offline. Try again when you're connected.")
        #expect(FriendsMessages.failure(.rateLimited(message: "Too many lookups today. Please try again tomorrow.", retryAfter: nil), fallback: "x")
            == "Too many lookups today. Please try again tomorrow.")
        #expect(FriendsMessages.failure(.server(status: 409, message: "You've already invited that address.", code: nil), fallback: "x")
            == "You've already invited that address.")
        #expect(FriendsMessages.failure(.server(status: 500, message: nil, code: nil), fallback: "Try again.") == "Try again.")
        #expect(FriendsMessages.failure(.accountRequired(message: nil), fallback: "x") == "Friends need an account.")
    }

    // MARK: Request bodies

    @Test func friendActionsSendTheServersFields() throws {
        let cases: [(FriendsRequest, NSDictionary)] = [
            (.request(toUid: "u2"), ["action": "request", "toUid": "u2"]),
            (.decline(requestId: "r1"), ["action": "decline", "requestId": "r1"]),
            (.cancel(requestId: "r1"), ["action": "cancel", "requestId": "r1"]),
            (.invite(email: "a@x.co"), ["action": "invite", "email": "a@x.co"]),
            (.resendInvite(inviteId: "i1"), ["action": "resendInvite", "inviteId": "i1"]),
            (.cancelInvite(inviteId: "i1"), ["action": "cancelInvite", "inviteId": "i1"]),
            (.block(targetUid: "u3"), ["action": "block", "targetUid": "u3"]),
            (.unblock(targetUid: "u3"), ["action": "unblock", "targetUid": "u3"]),
            (.remove(friendUid: "u2"), ["action": "remove", "friendUid": "u2"]),
            (.referralLink, ["action": "referralLink"]),
            (.activity(before: nil), ["action": "activity"]),
            (.activity(before: 1_795_131_311_227), ["action": "activity", "before": 1_795_131_311_227]),
            (.rated(showId: "s1"), ["action": "rated", "showId": "s1"]),
        ]
        for (request, expected) in cases {
            #expect(try body(request) as NSDictionary == expected)
        }
    }

    @Test func profileReportBody() throws {
        let plain = ReportContentRequest(contentType: .profile, contentId: "u3", reason: .spam, details: "   ")
        #expect(try body(plain) as NSDictionary == ["contentType": "profile", "contentId": "u3", "reason": "spam"])
        let long = ReportContentRequest(contentType: .profile, contentId: "u3", reason: .other, details: " " + String(repeating: "x", count: 1200))
        #expect(long.details?.count == ReportReason.maxDetails)
        #expect(ReportReason.allCases.filter(\.requiresDetails) == [.other])
        // lib/moderation.js REPORT_REASONS, in order.
        #expect(ReportReason.allCases.map(\.rawValue) == ["spam", "harassment", "sexual", "violence", "impersonation", "other"])
    }
}
