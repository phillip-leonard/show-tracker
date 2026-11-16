import FirebaseFirestore

/// Reading model documents from Firestore. Every model takes its id from
/// the snapshot, never from a stored `id` field (58 shows carry one).
public extension DocumentSnapshot {
    func decodeShow() throws -> Show {
        var show = try data(as: Show.self)
        show.id = documentID
        return show
    }

    func decodeUpcomingShow() throws -> UpcomingShow {
        var show = try data(as: UpcomingShow.self)
        show.id = documentID
        return show
    }

    func decodeProfile() throws -> UserProfile {
        var profile = try data(as: UserProfile.self)
        profile.id = documentID
        return profile
    }
}
