import Foundation
import Testing
@testable import Core

/// Profile and help (Stage 6, 6-11): achievements, your notes, the public
/// preview, the guest banner's rule, feedback's documents, the roadmap, and
/// How to Use and What's New from the bundled JSON.
struct ProfileHelpTests {
    // MARK: Profile

    @Test func achievementsInTheWebsOrderAtMostFour() {
        #expect(Achievements.earned(shows: 0, bands: 0, venues: 0, friends: 0, follows: 0).isEmpty)
        #expect(Achievements.earned(shows: 1, bands: 1, venues: 1, friends: 0, follows: 1).map(\.id) == ["first-show", "fan-club"])
        let lots = Achievements.earned(shows: 120, bands: 40, venues: 30, friends: 9, follows: 3)
        #expect(lots.map(\.id) == ["first-show", "getting-into-it", "dedicated-fan", "centurion"], "the first four earned")
        #expect(Achievements.earned(shows: 12, bands: 12, venues: 3, friends: 5, follows: 0).map(\.id)
                == ["first-show", "getting-into-it", "eclectic", "connected"])
    }

    @Test func notesNewestFirstShowNoteThenSongs() throws {
        let old = try ShowListTests.show("a", "Goose", "2024-06-01")
        var new = try ShowListTests.show("b", "Phish", "31-12-2025", songs: ["Tweezer", "Ghost"])
        new.comment = "  NYE!  "
        new.setlist[1].comment = "Huge jam"
        new.setlist[0].comment = "   "
        var older = old
        older.comment = "First Goose"
        let notes = MyNotes.list([older, new])
        #expect(notes.map(\.text) == ["NYE!", "Huge jam", "First Goose"], "trimmed, blank ones skipped, a legacy date read")
        #expect(notes.map(\.songName) == [nil, "Ghost", nil])
        #expect(notes.first?.showId == "b")
    }

    @Test func previewUsesTheServersCountsAndFiveRecentShows() throws {
        let shows = try (1...7).map { try ShowListTests.show("s\($0)", "Band \($0)", "2025-0\($0)-01") }
        let preview = PublicProfilePreview(stats: nil, shows: shows)
        #expect(preview.shows == 7 && preview.bands == 7 && preview.years == 1)
        #expect(preview.recent.map(\.id) == ["s7", "s6", "s5", "s4", "s3"])
    }

    @Test func guestBannerShowsForAGuestWithAShowAndSnoozesAWeek() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(GuestRescue.shows(isGuest: true, showCount: 1, dismissedAt: nil, now: now))
        #expect(!GuestRescue.shows(isGuest: true, showCount: 0, dismissedAt: nil, now: now))
        #expect(!GuestRescue.shows(isGuest: false, showCount: 5, dismissedAt: nil, now: now))
        #expect(!GuestRescue.shows(isGuest: true, showCount: 1, dismissedAt: now.addingTimeInterval(-6 * 86_400), now: now))
        #expect(GuestRescue.shows(isGuest: true, showCount: 1, dismissedAt: now.addingTimeInterval(-7 * 86_400), now: now))
    }

    // MARK: Feedback

    @Test func feedbackCarriesNoEmailAndLinksItsDraft() {
        let draft = FeedbackDraft(kind: .feature, category: .search, message: "  Search by song  ")
        let fb = draft.feedbackFields(uid: "u1", firstName: "Casey", roadmapItemId: "r1")
        #expect(fb["submitterEmail"] == nil, "email-free: the server finds the address from the uid")
        #expect(fb["message"] as? String == "Search by song" && fb["category"] as? String == "search")
        #expect(fb["status"] as? String == "linked" && fb["roadmapItemId"] as? String == "r1")
        #expect(fb["submitterUid"] as? String == "u1")

        let item = draft.roadmapFields(uid: "u1", feedbackId: "f1")
        // What the rules require of a client's roadmap item.
        #expect(item["status"] as? String == "draft" && item["voteCount"] as? Int == 0)
        #expect(item["submitterUid"] as? String == "u1" && item["sourceFeedbackId"] as? String == "f1")
        #expect(Set(item.keys).isDisjoint(with: ["submitterEmail", "contributors", "notifiedEmails"]))
        #expect(item["title"] as? String == "Search by song")
    }

    @Test func feedbackTitlesAndAGuestsFeedback() {
        #expect(FeedbackDraft(kind: .bug, message: "Crash").roadmapTitle == "[Bug] Crash")
        #expect(FeedbackDraft(kind: .general, message: "Love it").roadmapTitle == "[Feedback] Love it")
        let long = String(repeating: "a", count: 150)
        #expect(FeedbackDraft(kind: .feature, message: long).roadmapTitle.count == 100)
        let guest = FeedbackDraft(kind: .general, message: "Hi").feedbackFields(uid: "g", firstName: "", roadmapItemId: nil)
        #expect(guest["status"] as? String == "new" && guest["roadmapItemId"] is NSNull && guest["category"] is NSNull)
        #expect(guest["submitterName"] as? String == "Anonymous")
        #expect(!FeedbackDraft(message: "   ").canSend)
    }

    // MARK: Roadmap

    @Test func roadmapItemsColumnsAndMostRequested() {
        #expect(RoadmapItem(id: "d", data: ["status": "draft", "title": "Draft"]) == nil, "drafts aren't on the board")
        let item = RoadmapItem(id: "a", data: ["status": "upnext", "title": "Dark mode", "description": "Dark mode",
                                               "category": "ui", "voteCount": 4])
        #expect(item?.category == .ui && item?.voteCount == 4 && item?.detail == nil, "a description that repeats the title is dropped")
        let items = [
            RoadmapItem(id: "1", title: "B", status: .upnext, voteCount: 2),
            RoadmapItem(id: "2", title: "A", status: .upnext, voteCount: 2),
            RoadmapItem(id: "3", title: "C", status: .shipped, voteCount: 9),
            RoadmapItem(id: "4", title: "D", status: .inprogress, voteCount: 1),
            RoadmapItem(id: "5", title: "E", status: .upnext, voteCount: 0),
        ]
        #expect(RoadmapBoard.column(.upnext, in: items).map(\.id) == ["2", "1", "5"], "most votes first, ties by title")
        #expect(RoadmapBoard.mostRequested(items) == ["3", "1", "2"])
    }

    // MARK: How to Use and What's New

    @Test func bundledGuideAndWhatsNewDecode() throws {
        let guide = try #require(NativeContent.bundled("how-to-use", as: HowToUse.self), "public/native/how-to-use.json wasn't bundled")
        #expect(guide.sections.count >= 5)
        #expect(guide.sections.allSatisfy { !$0.topics.isEmpty })
        #expect(Set(guide.sections.map(\.id)).count == guide.sections.count, "section ids are unique")
        let text = guide.sections.flatMap(\.topics).map { "\($0.title) \($0.body)" }.joined(separator: " ").lowercased()
        #expect(!text.contains("drawer") && !text.contains("sidebar"), "written for the native app, not the web's menu")

        let news = try #require(NativeContent.bundled("whats-new", as: WhatsNew.self))
        #expect(!news.releases.isEmpty)
        #expect(news.releases.allSatisfy { $0.version.split(separator: ".").count == 3 && !$0.items.isEmpty })
    }

    @Test func whatsNewOpensOnceAfterAnUpdate() {
        let news = WhatsNew(releases: [.init(version: "4.0.56", title: "T", items: ["x"])], announcement: nil)
        #expect(WhatsNewGate.release(for: "4.0.56", lastSeen: nil, in: news) == nil, "never on a first install")
        #expect(WhatsNewGate.release(for: "4.0.56", lastSeen: "4.0.54", in: news)?.version == "4.0.56")
        #expect(WhatsNewGate.release(for: "4.0.56", lastSeen: "4.0.56", in: news) == nil, "never twice")
        #expect(WhatsNewGate.release(for: "4.0.57", lastSeen: "4.0.56", in: news) == nil, "no entry for that version")
        #expect(WhatsNewGate.compare("4.0.10", "4.0.9") == .orderedDescending)
        #expect(WhatsNewGate.compare("4.1", "4.0.12") == .orderedDescending)
        let a = WhatsNew(releases: [], announcement: .init(id: "a1", title: "Hi", body: "B", link: nil))
        #expect(WhatsNewGate.announcement(in: a, seen: nil)?.id == "a1")
        #expect(WhatsNewGate.announcement(in: a, seen: "a1") == nil)
    }
}
