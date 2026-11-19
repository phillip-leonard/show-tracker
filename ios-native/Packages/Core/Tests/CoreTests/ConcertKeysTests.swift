import Foundation
import Testing
@testable import Core

/// `fixtures/concert-keys/keys.json` (lib/concertKeys.js): the concert key,
/// the meetup id, the Storage folder and the comment-view id, as the web
/// and the server build them.
@Suite struct ConcertKeysTests {
    @Test func everyCaseMatchesTheWeb() throws {
        let fixture = try FixtureLoader.json(FixtureLoader.root.appendingPathComponent("concert-keys/keys.json"))
        let uid = try #require(fixture["uid"] as? String)
        let cases = try #require(fixture["cases"] as? [[String: Any]])
        #expect(cases.count >= 8)
        for c in cases {
            let name = c["name"] as? String ?? "?"
            let show = try #require(c["show"] as? [String: Any])
            let key = ConcertKeys.concertKey(
                artist: show["artist"] as? String, venue: show["venue"] as? String,
                date: show["date"] as? String, setlistfmId: show["setlistfmId"] as? String)
            #expect(key == c["concertKey"] as? String, "\(name): concertKey")
            #expect(ConcertKeys.meetupId(key) == c["meetupId"] as? String, "\(name): meetupId")
            #expect(ConcertKeys.mediaPathSegment(key) == c["mediaSegment"] as? String, "\(name): mediaSegment")
            #expect(ConcertKeys.commentViewId(uid: uid, concertKey: key) == c["commentViewId"] as? String, "\(name): commentViewId")
        }
        #expect(ConcertKeys.meetupId("") == nil)
    }
}
