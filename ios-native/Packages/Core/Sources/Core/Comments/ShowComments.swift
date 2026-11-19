import Foundation

/// A comment on a concert (lib/comments.js): `showComments/{id}`, keyed by
/// the concert (`ConcertKeys.concertKey`), not by anyone's show, so everyone
/// who logged the night shares one thread. Replies are one level deep.
///
/// Written only by the server: posting through `moderate-content`, likes
/// through `engagement-notify` (Stage 6, 5.60.38). The app deletes only its
/// own comments.
public struct ShowComment: Identifiable, Hashable, Sendable {
    public let id: String
    public var concertKey: String
    public var parentId: String?
    public var authorUid: String
    public var authorName: String
    public var text: String
    public var likedBy: [String]
    public var createdAt: Date?

    public init(id: String, concertKey: String, parentId: String? = nil, authorUid: String, authorName: String,
                text: String, likedBy: [String] = [], createdAt: Date? = nil) {
        self.id = id
        self.concertKey = concertKey
        self.parentId = parentId
        self.authorUid = authorUid
        self.authorName = authorName
        self.text = text
        self.likedBy = likedBy
        self.createdAt = createdAt
    }

    /// From a stored document. `createdAt` arrives as a Date (the SDK's
    /// Timestamp, converted by the store) or is missing.
    public init?(id: String, data: [String: Any]) {
        guard let concertKey = data["concertKey"] as? String,
              let authorUid = data["authorUid"] as? String, !authorUid.isEmpty else { return nil }
        let text = (data["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !text.isEmpty else { return nil }
        let parent = (data["parentId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let name = (data["authorName"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.init(id: id, concertKey: concertKey, parentId: parent, authorUid: authorUid,
                  authorName: (name?.isEmpty == false ? name : nil) ?? "Anonymous", text: text,
                  likedBy: (data["likedBy"] as? [String]) ?? [], createdAt: data["createdAt"] as? Date)
    }

    public func isLiked(by uid: String?) -> Bool { uid.map(likedBy.contains) ?? false }
    public var likeCount: Int { likedBy.count }

    /// The like as the server will store it, shown at once.
    public func liking(_ liked: Bool, uid: String) -> ShowComment {
        var copy = self
        copy.likedBy.removeAll { $0 == uid }
        if liked { copy.likedBy.append(uid) }
        return copy
    }
}

/// The thread a show page shows (CommentsSection.jsx): top-level comments
/// oldest first, each with its replies oldest first. Comments from people
/// you blocked and ones you just reported never show (Guideline 1.2); a
/// reply whose comment is gone isn't shown on its own.
public struct CommentThread: Equatable, Sendable {
    public struct Entry: Identifiable, Equatable, Sendable {
        public let comment: ShowComment
        public let replies: [ShowComment]
        public var id: String { comment.id }
    }

    public let entries: [Entry]
    /// Every comment shown, replies included: the section's count.
    public var count: Int { entries.reduce(0) { $0 + 1 + $1.replies.count } }

    public init(_ comments: [ShowComment], hiding blocked: Set<String> = [], reported: Set<String> = []) {
        let visible = comments.filter { !blocked.contains($0.authorUid) && !reported.contains($0.id) }
        let order: (ShowComment, ShowComment) -> Bool = {
            ($0.createdAt ?? .distantFuture, $0.id) < ($1.createdAt ?? .distantFuture, $1.id)
        }
        let tops = visible.filter { $0.parentId == nil }.sorted(by: order)
        let replies = Dictionary(grouping: visible.filter { $0.parentId != nil }, by: { $0.parentId ?? "" })
        entries = tops.map { Entry(comment: $0, replies: (replies[$0.id] ?? []).sorted(by: order)) }
    }

    /// Someone else's comment that arrived since your last visit
    /// (lib/commentViews.js). A first visit (`lastViewed` nil) marks
    /// nothing new.
    public static func isNew(_ comment: ShowComment, lastViewed: Date?, me: String?) -> Bool {
        guard let lastViewed, let at = comment.createdAt, comment.authorUid != me else { return false }
        return at > lastViewed
    }
}

/// "@Name" mentions (CommentsSection.jsx): the server notifies each of your
/// friends whose name follows an "@" in the text.
public enum CommentMentions {
    /// The partial name after a trailing "@" being typed, or nil: "Great
    /// night @Ca" → "Ca". An "@" inside a word ("me@x.com") isn't a mention.
    public static func query(in text: String) -> String? {
        guard let at = text.lastIndex(of: "@") else { return nil }
        if at > text.startIndex {
            let before = text[text.index(before: at)]
            guard before.isWhitespace else { return nil }
        }
        let partial = text[text.index(after: at)...]
        guard !partial.contains(where: \.isNewline), partial.count <= 30 else { return nil }
        return String(partial)
    }

    /// Friends whose name starts with any word of the query, at most five.
    public static func matches(_ query: String, names: [String]) -> [String] {
        let q = query.lowercased()
        let unique = Array(NSOrderedSet(array: names.filter { !$0.isEmpty })) as? [String] ?? []
        return Array(unique.filter { q.isEmpty || $0.lowercased().hasPrefix(q) }.prefix(5))
    }

    /// The text with the partial mention replaced by "@Name ".
    public static func complete(_ text: String, with name: String) -> String {
        guard let at = text.lastIndex(of: "@") else { return text }
        return String(text[..<at]) + "@\(name) "
    }
}

/// What the comments section says when something goes wrong.
public enum CommentMessages {
    public static let maxLength = 2000

    public static func failure(_ error: APIError, fallback: String) -> String {
        switch error {
        case .accountRequired: "Create an account to post."
        case .offline: "You're offline. Comments need a connection."
        case .rateLimited(let message, _): message ?? "That's a lot of posts for one day. Try again tomorrow."
        default: error.message ?? fallback
        }
    }
}
