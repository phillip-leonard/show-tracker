import FirebaseCrashlytics
import FirebaseFirestore
import Foundation
import Observation

/// One concert's comment thread, kept live while its show page is open
/// (Stage 6, 6-3). Accounts only: guests see no user content (D-1), and the
/// rules refuse their reads.
///
/// Reads are the web's: a listener on `showComments where concertKey ==`
/// ordered by `createdAt`, and `commentViews/{uid}_{segment}` for "new since
/// your last visit" (read once, then stamped). Every write other people see
/// goes through the server (5.60.38): posting and replying through
/// `moderate-content`, likes through `engagement-notify`, reports through
/// `report-content`. The one direct write is deleting your own comment,
/// which the rules allow its author.
@MainActor
@Observable
public final class CommentsStore {
    public enum State: Equatable {
        case loading
        case ready
        /// Nothing from the server yet and no copy on the phone.
        case offline
        case failed(String)
    }

    public let concertKey: String
    public let uid: String
    public private(set) var comments: [ShowComment] = []
    public private(set) var state: State = .loading
    /// The previous visit, read before this one is stamped; nil on a first visit.
    public private(set) var lastViewed: Date?
    /// Reported this session: hidden at once (the queue takes a moment).
    public private(set) var reported: Set<String> = []
    /// Comments with a like, post or delete in flight.
    public private(set) var busy: Set<String> = []

    private let api: APIClient?
    private var listener: ListenerRegistration?
    /// Likes sent but not yet seen in a snapshot: shown as sent meanwhile.
    private var pendingLikes: [String: Bool] = [:]

    public init(concertKey: String, uid: String, api: APIClient?) {
        self.concertKey = concertKey
        self.uid = uid
        self.api = api
    }

    public func thread(hiding blocked: Set<String>) -> CommentThread {
        CommentThread(comments.map(withPendingLike), hiding: blocked, reported: reported)
    }

    public func isNew(_ comment: ShowComment) -> Bool {
        CommentThread.isNew(comment, lastViewed: lastViewed, me: uid)
    }

    // MARK: Live

    public func start() {
        guard listener == nil, !concertKey.isEmpty else { return }
        Task { await attach() }
        Task { await stampVisit() }
    }

    public func stop() {
        listener?.remove()
        listener = nil
    }

    private func attach() async {
        let db = await Database.ready()
        guard listener == nil else { return }
        // The web's query; its index (concertKey, createdAt asc) exists.
        let query = db.collection("showComments").whereField("concertKey", isEqualTo: concertKey).order(by: "createdAt")
        listener = query.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, error in
            MainActor.assumeIsolated {
                guard let self else { return }
                if let error {
                    Self.log(error, stage: "listen")
                    if self.comments.isEmpty { self.state = .failed("Comments couldn't load. Pull to refresh or try again later.") }
                    return
                }
                guard let snapshot else { return }
                self.comments = snapshot.documents.compactMap { doc in
                    var data = doc.data(with: .estimate)
                    if let ts = data["createdAt"] as? Timestamp { data["createdAt"] = ts.dateValue() }
                    return ShowComment(id: doc.documentID, data: data)
                }
                self.settleLikes()
                self.state = snapshot.metadata.isFromCache && snapshot.documents.isEmpty ? .offline : .ready
            }
        }
    }

    /// Reads the last visit, then stamps this one (lib/commentViews.js, in
    /// that order, or everything looks seen).
    private func stampVisit() async {
        let db = await Database.ready()
        let ref = db.collection("commentViews").document(ConcertKeys.commentViewId(uid: uid, concertKey: concertKey))
        do {
            let snap = try await withDeadline(.seconds(8)) { try await ref.getDocument() }
            lastViewed = snap.exists ? (snap.data()?["lastViewedAt"] as? Timestamp)?.dateValue() : nil
        } catch {
            lastViewed = nil
        }
        do {
            try await ref.setData(["uid": uid, "concertKey": concertKey, "lastViewedAt": FieldValue.serverTimestamp()])
        } catch {
            Self.log(error, stage: "commentViews")
        }
    }

    // MARK: Writes

    /// Posts a comment, or a reply to `parentId`. Throws with the server's
    /// words (the filter's, or a daily limit) for the composer to show.
    public func post(_ text: String, parentId: String? = nil, show: Show) async throws(APIError) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard let api else { throw .offline }
        let request = PostCommentRequest(
            concertKey: concertKey, text: String(trimmed.prefix(CommentMessages.maxLength)), parentId: parentId,
            show: ContentShow(artist: show.artist, venue: show.venue, date: show.date), showId: show.id)
        _ = try await api.post(PostCommentRequest.function, request, as: PostedContent.self)
    }

    /// Likes or unlikes: shown at once, put back if the server says no.
    /// Returns a message when it failed.
    public func toggleLike(_ comment: ShowComment, show: Show) async -> String? {
        guard let api, !busy.contains(comment.id) else { return api == nil ? CommentMessages.failure(.offline, fallback: "") : nil }
        let liked = !withPendingLike(comment).isLiked(by: uid)
        pendingLikes[comment.id] = liked
        busy.insert(comment.id)
        defer { busy.remove(comment.id) }
        do {
            let request = LikeRequest(.comment, id: comment.id, liked: liked,
                                      show: ContentShow(artist: show.artist, venue: show.venue, date: show.date))
            _ = try await api.post(LikeRequest.function, request, as: LikeResponse.self)
            return nil
        } catch {
            pendingLikes[comment.id] = nil
            return CommentMessages.failure(error, fallback: "Couldn't update your like. Try again.")
        }
    }

    /// Deletes one of your own comments (the rules allow only its author).
    public func delete(_ comment: ShowComment) async -> String? {
        guard comment.authorUid == uid else { return nil }
        busy.insert(comment.id)
        defer { busy.remove(comment.id) }
        do {
            try await Database.ready().collection("showComments").document(comment.id).delete()
            return nil
        } catch {
            Self.log(error, stage: "delete")
            return "Couldn't delete that comment. Try again."
        }
    }

    /// Reports someone else's comment; it disappears for you at once.
    public func report(_ comment: ShowComment, reason: ReportReason, details: String) async throws(APIError) {
        guard let api else { throw .offline }
        let request = ReportContentRequest(contentType: .showComment, contentId: comment.id, reason: reason, details: details)
        _ = try await api.post(ReportContentRequest.function, request, as: JSONValue.self)
        reported.insert(comment.id)
    }

    // MARK: Likes in flight

    private func withPendingLike(_ comment: ShowComment) -> ShowComment {
        guard let liked = pendingLikes[comment.id] else { return comment }
        return comment.liking(liked, uid: uid)
    }

    /// A like the snapshot now shows is no longer pending.
    private func settleLikes() {
        for (id, liked) in pendingLikes {
            if let c = comments.first(where: { $0.id == id }), c.isLiked(by: uid) == liked { pendingLikes[id] = nil }
            if !comments.contains(where: { $0.id == id }) { pendingLikes[id] = nil }
        }
    }

    private static func log(_ error: Error, stage: String) {
        Crashlytics.crashlytics().record(error: error, userInfo: ["stage": "CommentsStore \(stage)"])
    }
}
