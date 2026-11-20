import FirebaseCore
import FirebaseCrashlytics
import FirebaseFirestore
import Foundation

// Send feedback (Stage 6, 6-11; the web's FeedbackView). A `feedback`
// document as yourself (guests too), and for an account a draft roadmap item
// linked to it, in one batch. Email-free: no address on either document (the
// server finds it from the uid when an item ships; CLAUDE.md, "No email
// address on any document other users can read"). A guest's idea goes to
// feedback only, since `roadmapItems` needs an account (rules).

public enum FeedbackKind: String, CaseIterable, Sendable, Identifiable {
    case feature, bug, general
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .feature: "Feature request"
        case .bug: "Bug report"
        case .general: "General feedback"
        }
    }
}

/// `ROADMAP_CATEGORIES` (lib/constants.js).
public enum RoadmapCategory: String, CaseIterable, Sendable, Identifiable {
    case ui, social, data, search, other
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .ui: "UI/Design"
        case .social: "Social"
        case .data: "Data & Stats"
        case .search: "Search"
        case .other: "Other"
        }
    }
}

public struct FeedbackDraft: Equatable, Sendable {
    public var kind: FeedbackKind
    public var category: RoadmapCategory
    public var message: String

    public init(kind: FeedbackKind = .general, category: RoadmapCategory = .other, message: String = "") {
        self.kind = kind
        self.category = category
        self.message = message
    }

    public var trimmed: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }
    public var canSend: Bool { !trimmed.isEmpty }

    /// The roadmap item's title (FeedbackView's `draftTitle`).
    public var roadmapTitle: String {
        switch kind {
        case .feature: String(trimmed.prefix(100))
        case .bug: "[Bug] \(trimmed.prefix(90))"
        case .general: "[Feedback] \(trimmed.prefix(90))"
        }
    }

    /// The `feedback` document, without the timestamp. `firstName` is the
    /// web's `submitterName` (the feedback is readable by its writer and
    /// the admin only).
    public func feedbackFields(uid: String, firstName: String, roadmapItemId: String?) -> [String: Any] {
        [
            "type": kind.rawValue,
            "category": kind == .feature ? category.rawValue : NSNull(),
            "message": trimmed,
            "submitterUid": uid,
            "submitterName": firstName.isEmpty ? "Anonymous" : firstName,
            "status": roadmapItemId == nil ? "new" : "linked",
            "roadmapItemId": roadmapItemId ?? NSNull(),
        ]
    }

    /// The draft `roadmapItems` document, without the timestamps.
    public func roadmapFields(uid: String, feedbackId: String) -> [String: Any] {
        [
            "title": roadmapTitle,
            "description": trimmed,
            "status": "draft",
            "category": kind == .feature ? category.rawValue : RoadmapCategory.other.rawValue,
            "voteCount": 0,
            "sourceFeedbackId": feedbackId,
            "submitterUid": uid,
            "publishedAt": NSNull(),
            "completedAt": NSNull(),
            "notificationsSent": false,
            "notificationsSentAt": NSNull(),
        ]
    }
}

public enum FeedbackSender {
    /// Writes the feedback (and, for an account, its draft roadmap item) in
    /// one batch, so neither exists without the other.
    @MainActor
    public static func send(_ draft: FeedbackDraft, uid: String, displayName: String?, isAccount: Bool) async throws {
        let db = await Database.ready()
        let feedback = db.collection("feedback").document()
        let firstName = (displayName ?? "").split(separator: " ").first.map(String.init) ?? ""
        let batch = db.batch()
        if isAccount {
            let item = db.collection("roadmapItems").document()
            var fields = draft.feedbackFields(uid: uid, firstName: firstName, roadmapItemId: item.documentID)
            fields["createdAt"] = FieldValue.serverTimestamp()
            batch.setData(fields, forDocument: feedback)
            var itemFields = draft.roadmapFields(uid: uid, feedbackId: feedback.documentID)
            itemFields["createdAt"] = FieldValue.serverTimestamp()
            itemFields["updatedAt"] = FieldValue.serverTimestamp()
            batch.setData(itemFields, forDocument: item)
        } else {
            var fields = draft.feedbackFields(uid: uid, firstName: firstName, roadmapItemId: nil)
            fields["createdAt"] = FieldValue.serverTimestamp()
            batch.setData(fields, forDocument: feedback)
        }
        do {
            try await batch.commit()
        } catch {
            Crashlytics.crashlytics().record(error: error, userInfo: ["stage": "FeedbackSender send"])
            throw error
        }
    }
}
