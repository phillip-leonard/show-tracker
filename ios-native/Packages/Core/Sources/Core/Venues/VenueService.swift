import FirebaseFirestore
import Foundation

/// Reads and writes for the venue page (Stage 4, 4-7): the same documents
/// and queries as lib/venues.js, lib/bucketListVenues.js and the web's
/// `VenueRatingModal`. Each read is a single get with a deadline; the page
/// reloads on pull-to-refresh, after a rating is saved, and when a write
/// it made changes something.
///
/// Who may do what (firestore.rules):
/// - `venues`: any signed-in user reads, guests included.
/// - `venueRatings`, `venuePhotos`, `venueAnnouncements`: accounts only,
///   reading and writing (`isAccount()`); a guest's page doesn't ask.
/// - `venueReports`: accounts create; only the admin reads.
/// - `bucketListVenues`: the owner, guests included.
@MainActor
public enum VenueService {
    static let deadline: Duration = .seconds(10)

    /// The venue document, or nil when there's none (most venues).
    public static func venue(_ key: String) async throws -> VenueInfo? {
        guard VenueKeys.isDocumentId(key) else { return nil }
        let db = await Database.ready()
        let snap = try await withDeadline(deadline) { try await db.collection("venues").document(key).getDocument() }
        guard snap.exists, let data = snap.data() else { return nil }
        return VenueInfo(key: key, data: data)
    }

    /// Every rating of the venue (`where venueKey ==`), as the web loads them
    /// for the count and the average. Accounts only.
    public static func ratings(_ key: String) async throws -> [VenueRating] {
        let db = await Database.ready()
        let query = db.collection("venueRatings").whereField("venueKey", isEqualTo: key)
        let snap = try await withDeadline(deadline) { try await query.getDocuments() }
        return snap.documents.map { VenueRating(id: $0.documentID, data: $0.data()) }
    }

    /// The newest 50 announcements (`subscribeVenueAnnouncements`). Accounts only.
    public static func announcements(_ key: String) async throws -> [VenueAnnouncement] {
        let db = await Database.ready()
        let query = db.collection("venueAnnouncements").whereField("venueKey", isEqualTo: key)
            .order(by: "createdAt", descending: true).limit(to: 50)
        let snap = try await withDeadline(deadline) { try await query.getDocuments() }
        return snap.documents.map { VenueAnnouncement(id: $0.documentID, data: $0.data()) }.filter { !$0.text.isEmpty }
    }

    /// The newest 60 official photos (`subscribeVenuePhotos`). Accounts only.
    public static func photos(_ key: String) async throws -> [VenuePhoto] {
        let db = await Database.ready()
        let query = db.collection("venuePhotos").whereField("venueKey", isEqualTo: key)
            .order(by: "createdAt", descending: true).limit(to: 60)
        let snap = try await withDeadline(deadline) { try await query.getDocuments() }
        return snap.documents.map { VenuePhoto(id: $0.documentID, data: $0.data()) }.filter { $0.url != nil }
    }

    /// Saves your rating (`merge: true`), over your existing one when there is one.
    public static func saveRating(uid: String, userName: String, venueKey: String, venueName: String, venueCity: String,
                                  draft: VenueRatingDraft, existingId: String?) async throws {
        guard draft.canSave else { return }
        let db = await Database.ready()
        let id = existingId ?? VenueRatings.documentId(uid: uid, venueKey: venueKey)
        let data = VenueRatings.writeData(uid: uid, userName: userName, venueKey: venueKey, venueName: venueName,
                                          venueCity: venueCity, draft: draft, isNew: existingId == nil)
        try await db.collection("venueRatings").document(id).setData(data, merge: true)
    }

    /// Files a report for the admin (`reportVenue`).
    public static func report(_ reason: VenueReportReason, venueKey: String, venueName: String, uid: String,
                              userName: String, comment: String) async throws {
        let db = await Database.ready()
        let data = reason.reportData(venueKey: venueKey, venueName: venueName, uid: uid, userName: userName, comment: comment)
        _ = try await db.collection("venueReports").addDocument(data: data)
    }

    /// Whether the venue is on your venue bucket list. The rules allow
    /// reading your own document before it exists.
    public static func isOnBucketList(uid: String, venueKey: String) async throws -> Bool {
        guard VenueKeys.isDocumentId(venueKey) else { return false }
        let db = await Database.ready()
        let id = VenueBucketList.documentId(uid: uid, venueKey: venueKey)
        let snap = try await withDeadline(deadline) { try await db.collection("bucketListVenues").document(id).getDocument() }
        return snap.exists
    }

    /// Adds the venue to your venue bucket list, or takes it off.
    public static func setOnBucketList(_ on: Bool, uid: String, venueKey: String, name: String,
                                       city: String?, state: String?) async throws {
        guard VenueKeys.isDocumentId(venueKey) else { return }
        let db = await Database.ready()
        let ref = db.collection("bucketListVenues").document(VenueBucketList.documentId(uid: uid, venueKey: venueKey))
        if on {
            try await ref.setData(VenueBucketList.data(uid: uid, venueKey: venueKey, name: name, city: city, state: state), merge: true)
        } else {
            do {
                try await ref.delete()
            } catch {
                // Already off the list.
                if (error as NSError).code != FirestoreErrorCode.notFound.rawValue { throw error }
            }
        }
    }
}
