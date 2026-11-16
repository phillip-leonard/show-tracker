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

public extension DocumentSnapshot {
    /// A friend-list entry. Its id is the friend's uid; older entries
    /// without `friendUid` take it from the document id.
    func decodeFriend() throws -> FriendEdge {
        var edge = try data(as: FriendEdge.self)
        if edge.friendUid.isEmpty { edge.friendUid = documentID }
        return edge
    }

    func decodeFriendRequest() throws -> FriendRequest {
        var request = try data(as: FriendRequest.self)
        request.id = documentID
        return request
    }

    func decodeInvite() throws -> Invite {
        var invite = try data(as: Invite.self)
        invite.id = documentID
        return invite
    }
}
