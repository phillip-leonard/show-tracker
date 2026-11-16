import Foundation

// Show social without Firebase (Stage 3, Part 3b): which tags and
// suggestions wait for an answer, who can be tagged, what each answer says.
// `FriendsStore` uses them; `ShowSocialLogicTests` checks them.

public enum ShowSocialLists {
    /// Tags to `uid` nobody has answered, newest first, without anyone blocked.
    public static func pendingTags(_ tags: [ShowTag], uid: String, blocked: Set<String>) -> [ShowTag] {
        tags.filter { $0.toUid == uid && $0.status == "pending" && !blocked.contains($0.fromUid) }
            .sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
    }

    /// Tags sent to this account's address before it existed.
    public static func pendingEmailTags(_ tags: [PendingEmailTag], blocked: Set<String>) -> [PendingEmailTag] {
        tags.filter { $0.status == "pending" && !blocked.contains($0.fromUid) }
            .sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
    }

    /// "Were you there together?" waiting on `uid`, as the web lists them
    /// (`myPendingSuggestions`): my answer pending, not declined by either.
    public static func pendingSuggestions(_ suggestions: [ShowSuggestion], uid: String, blocked: Set<String>) -> [ShowSuggestion] {
        suggestions.filter { s in
            s.responses[uid] == "pending" && s.overallStatus != "declined"
                && !s.participants.contains(where: { $0 != uid && blocked.contains($0) })
        }
        .sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
    }

    /// Friends who can be tagged at a show: not blocked, not tagged already.
    public static func taggable(_ friends: [FriendEdge], alreadyTagged: [String], blocked: Set<String>) -> [FriendEdge] {
        let tagged = Set(alreadyTagged)
        return friends.filter { !tagged.contains($0.friendUid) && !blocked.contains($0.friendUid) }
    }

    /// Per friend, what they said to the caller's tags on one upcoming show.
    /// A friend tagged, removed and tagged again: pending or accepted wins
    /// (`loadUpcomingTagStatuses` in AppContext).
    public static func sentStatuses(_ tags: [(toUid: String, status: String)]) -> [String: String] {
        var out: [String: String] = [:]
        for t in tags where out[t.toUid] == nil || t.status == "pending" || t.status == "accepted" {
            out[t.toUid] = t.status
        }
        return out
    }
}

public enum ShowSocialMessages {
    /// "Ann tagged you at Phish" or, for an upcoming show, "Ann is going to Goose".
    public static func tagTitle(_ tag: ShowTag) -> String {
        let band = tag.showData.artist.isEmpty ? "a show" : tag.showData.artist
        let name = tag.fromName.isEmpty ? "A friend" : tag.fromName
        return isUpcoming(tag) ? "\(name) is going to \(band) with you" : "\(name) says you were at \(band)"
    }

    public static func isUpcoming(_ tag: ShowTag) -> Bool { tag.upcomingShowId != nil || tag.showData.upcoming }

    /// "Were you at Phish with Ben?", and what Ben said if he has.
    public static func suggestionTitle(_ s: ShowSuggestion, uid: String) -> String {
        let band = s.showData.artist.isEmpty ? "this show" : s.showData.artist
        return "Were you at \(band) with \(friendName(s, uid: uid))?"
    }

    public static func friendName(_ s: ShowSuggestion, uid: String) -> String {
        guard let other = s.participants.first(where: { $0 != uid }) else { return "your friend" }
        return s.names[other].flatMap { $0.isEmpty ? nil : $0 } ?? "your friend"
    }

    public static func suggestionNote(_ s: ShowSuggestion, uid: String) -> String? {
        guard let other = s.participants.first(where: { $0 != uid }) else { return nil }
        return s.responses[other] == "confirmed" ? "\(friendName(s, uid: uid)) said yes." : nil
    }

    public static func tagged(_ r: TagFriendsResponse, band: String, upcoming: Bool) -> String {
        let n = r.tagged.count
        var text: String
        if n == 0 && r.emailTags == 0 {
            text = "Nobody was tagged."
        } else if n == 0 {
            text = r.emailTags == 1 ? "Invite sent." : "\(r.emailTags) invites sent."
        } else {
            let people = n == 1 ? "1 friend" : "\(n) friends"
            text = upcoming ? "Tagged \(people) as going to \(band)." : "Tagged \(people) at \(band)."
        }
        if !r.skipped.isEmpty {
            text += r.skipped.count == 1 ? " 1 person couldn't be tagged." : " \(r.skipped.count) people couldn't be tagged."
        }
        return text
    }

    public static func suggestionAnswer(_ r: SuggestionAnswerResponse, confirmed: Bool) -> String {
        guard confirmed else { return "Thanks, noted." }
        switch r.overallStatus {
        case "confirmed": return "You were both there."
        default: return r.nudged ? "Thanks. We've asked your friend too." : "Thanks. Waiting on your friend."
        }
    }
}
