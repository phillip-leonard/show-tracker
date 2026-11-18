import FirebaseFirestore
import Foundation
import Observation

/// Starred tours (`lib/favoriteTours.js`): one `favoriteTours/{uid}`
/// document, `{ userId, tours: { [tourKey]: { tourName, artistName,
/// addedAt } }, updatedAt }`. A star is one merge write of that key; an
/// unstar deletes that one map field. The rules let any signed-in owner
/// write it, guests included (their own data).
@MainActor
@Observable
public final class FavoriteToursStore {
    public private(set) var keys: Set<String> = []
    /// Keys whose write is in flight (the star is disabled meanwhile).
    public private(set) var pending: Set<String> = []
    /// The last write failed; the star went back.
    public var problem: String?

    private var uid: String?
    private var listener: ListenerRegistration?

    public init() {}

    public func isFavorite(_ key: String) -> Bool { keys.contains(key) }

    public func start(uid: String) {
        guard self.uid != uid else { return }
        stop()
        self.uid = uid
        Task { [weak self] in
            let db = await Database.ready()
            guard let self, self.uid == uid else { return }
            self.listener = db.collection("favoriteTours").document(uid).addSnapshotListener { [weak self] snap, _ in
                Task { @MainActor [weak self] in
                    guard let self, self.uid == uid else { return }
                    let tours = snap?.data()?["tours"] as? [String: Any] ?? [:]
                    // A write in flight keeps its optimistic state.
                    var next = Set(tours.keys)
                    for key in self.pending { if self.keys.contains(key) { next.insert(key) } else { next.remove(key) } }
                    self.keys = next
                }
            }
        }
    }

    public func stop() {
        listener?.remove()
        listener = nil
        uid = nil
        keys = []
        pending = []
    }

    /// Stars or unstars a tour, at once on screen; reverted if the write fails.
    public func toggle(_ tour: TourIndex.Tour) {
        guard let uid, !pending.contains(tour.key) else { return }
        let starring = !keys.contains(tour.key)
        if starring { keys.insert(tour.key) } else { keys.remove(tour.key) }
        pending.insert(tour.key)
        problem = nil
        Task { [weak self] in
            let db = await Database.ready()
            let ref = db.collection("favoriteTours").document(uid)
            do {
                if starring {
                    try await ref.setData(Self.starData(uid: uid, tour: tour, now: Date()), merge: true)
                } else {
                    // `tours.<key>` as one path segment pair: a key holds ":" and "-".
                    try await ref.updateData([FieldPath(["tours", tour.key]): FieldValue.delete(),
                                              "updatedAt": FieldValue.serverTimestamp()])
                }
            } catch {
                guard let self, self.uid == uid else { return }
                // Unstarring a tour on a document that was never written is a no-op.
                let notFound = (error as NSError).code == FirestoreErrorCode.notFound.rawValue
                if !(notFound && !starring) {
                    if starring { self.keys.remove(tour.key) } else { self.keys.insert(tour.key) }
                    self.problem = "Couldn't update your favorite tours. Try again."
                }
            }
            self?.pending.remove(tour.key)
        }
    }

    /// The merge write a star makes (`addFavoriteTour`).
    nonisolated static func starData(uid: String, tour: TourIndex.Tour, now: Date) -> [String: Any] {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return [
            "userId": uid,
            "tours": [tour.key: ["tourName": tour.tourName, "artistName": tour.artistName, "addedAt": f.string(from: now)]],
            "updatedAt": FieldValue.serverTimestamp(),
        ]
    }
}
