import Foundation
import Testing
@testable import Core

/// The comment thread (CommentsSection.jsx): order, replies, blocked and
/// reported comments hidden, "new since your last visit", mentions, and
/// what is sent to the server.
@Suite struct CommentsTests {
    private func c(_ id: String, _ author: String, at minute: Int?, parent: String? = nil, likedBy: [String] = []) -> ShowComment {
        ShowComment(id: id, concertKey: "k", parentId: parent, authorUid: author, authorName: author.capitalized, text: "t \(id)",
                    likedBy: likedBy, createdAt: minute.map { Date(timeIntervalSince1970: TimeInterval($0 * 60)) })
    }

    @Test func topLevelOldestFirstWithTheirRepliesAndNoOrphans() {
        let thread = CommentThread([
            c("b", "bob", at: 5), c("a", "ann", at: 1), c("r2", "cy", at: 9, parent: "a"), c("r1", "bob", at: 7, parent: "a"),
            c("orphan", "cy", at: 3, parent: "gone"), c("pending", "ann", at: nil),
        ])
        #expect(thread.entries.map(\.id) == ["a", "b", "pending"], "a comment still waiting for its time goes last")
        #expect(thread.entries[0].replies.map(\.id) == ["r1", "r2"])
        #expect(thread.count == 5)
    }

    @Test func blockedPeopleAndReportedCommentsNeverShow() {
        let thread = CommentThread([c("a", "ann", at: 1), c("b", "bob", at: 2), c("r", "bob", at: 3, parent: "a"), c("x", "cy", at: 4)],
                                   hiding: ["bob"], reported: ["x"])
        #expect(thread.entries.map(\.id) == ["a"])
        #expect(thread.entries[0].replies.isEmpty)
    }

    @Test func newMeansSomeoneElsesSinceYourLastVisit() {
        let last = Date(timeIntervalSince1970: 300)
        #expect(CommentThread.isNew(c("a", "bob", at: 6), lastViewed: last, me: "me"))
        #expect(!CommentThread.isNew(c("a", "bob", at: 4), lastViewed: last, me: "me"))
        #expect(!CommentThread.isNew(c("a", "me", at: 6), lastViewed: last, me: "me"), "your own is never new")
        #expect(!CommentThread.isNew(c("a", "bob", at: 6), lastViewed: nil, me: "me"), "a first visit lights nothing up")
    }

    @Test func likesShowAtOnce() {
        let comment = c("a", "bob", at: 1, likedBy: ["ann"])
        #expect(comment.liking(true, uid: "me").likedBy == ["ann", "me"])
        #expect(comment.liking(true, uid: "me").liking(false, uid: "me").likedBy == ["ann"])
        #expect(comment.liking(true, uid: "ann").likeCount == 1, "never twice")
    }

    @Test func decodesStoredDocumentsAndSkipsBrokenOnes() throws {
        let at = Date(timeIntervalSince1970: 1000)
        let ok = try #require(ShowComment(id: "a", data: [
            "concertKey": "k", "authorUid": "u", "authorName": " ", "text": "  Hi  ", "likedBy": ["x"], "createdAt": at, "parentId": "",
        ]))
        #expect(ok.authorName == "Anonymous" && ok.text == "Hi" && ok.parentId == nil && ok.createdAt == at && ok.likeCount == 1)
        #expect(ShowComment(id: "b", data: ["concertKey": "k", "authorUid": "u", "text": "   "]) == nil)
        #expect(ShowComment(id: "c", data: ["concertKey": "k", "text": "hi"]) == nil)
    }

    @Test func mentionsFollowATrailingAt() {
        #expect(CommentMentions.query(in: "Great night @Ca") == "Ca")
        #expect(CommentMentions.query(in: "@") == "")
        #expect(CommentMentions.query(in: "mail me@x.com") == nil, "inside a word isn't a mention")
        #expect(CommentMentions.query(in: "no mention") == nil)
        #expect(CommentMentions.matches("ca", names: ["Carol", "Cam", "Bob", "Carol", ""]) == ["Carol", "Cam"])
        #expect(CommentMentions.complete("Great night @Ca", with: "Carol") == "Great night @Carol ")
    }

    @Test func thePostIsWhatModerateContentReads() throws {
        let request = PostCommentRequest(concertKey: "phish|msg|2025-12-31", text: "Tweezer!", parentId: nil,
                                         show: ContentShow(artist: "Phish", venue: "MSG", date: "2025-12-31"), showId: "s1")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        #expect(json?["target"] as? String == "showComment")
        #expect(json?["showId"] as? String == "s1")
        #expect((json?["show"] as? [String: String])?["venue"] == "MSG")
        let like = try JSONSerialization.jsonObject(with: JSONEncoder().encode(LikeRequest(.comment, id: "c1", liked: true))) as? [String: Any]
        #expect(like?["type"] as? String == "comment_like" && like?["liked"] as? Bool == true)
        let report = ReportContentRequest(contentType: .showComment, contentId: "c1", reason: .spam, details: nil)
        let reportJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(report)) as? [String: Any]
        #expect(reportJSON?["contentType"] as? String == "showComment")
    }
}
