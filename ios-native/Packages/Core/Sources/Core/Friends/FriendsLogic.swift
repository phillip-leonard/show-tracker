import Foundation

// The Friends tab's rules, without Firebase: what was typed into "Add a
// friend", which requests to list, and what each server answer means to the
// person. `FriendsStore` uses them; `FriendsLogicTests` checks them.

/// What someone typed to find a friend (Stage 3, C-6): an email address,
/// or a handle, matched exactly. Never a name search.
public enum FriendSearchQuery: Equatable, Sendable {
    case email(String)
    case handle(String)

    /// nil when it's neither: the field says what to type.
    public static func parse(_ input: String) -> FriendSearchQuery? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if text.hasPrefix("@") {
            return handleQuery(String(text.dropFirst()))
        }
        if text.contains("@") {
            let email = text.lowercased()
            return isEmail(email) ? .email(email) : nil
        }
        return handleQuery(text)
    }

    private static func handleQuery(_ raw: String) -> FriendSearchQuery? {
        let h = raw.lowercased()
        // The handle rule `friends.js` checks (`HANDLE_RE`).
        return h.wholeMatch(of: /^[a-z0-9_]{3,20}$/) != nil ? .handle(h) : nil
    }

    /// The same loose check as the server's `isValidEmail`: one @, a dot
    /// after it, no spaces.
    static func isEmail(_ s: String) -> Bool {
        s.wholeMatch(of: /^[^\s@]+@[^\s@]+\.[^\s@]+$/) != nil
    }

    public var request: FriendsRequest {
        switch self {
        case .email(let e): .lookupByEmail(email: e)
        case .handle(let h): .lookupByHandle(handle: h)
        }
    }
}

/// What "Add a friend" found.
public enum FriendLookupOutcome: Equatable, Sendable {
    /// An account: offer to send a request (or say you're already friends).
    case person(uid: String, name: String, handle: String?)
    /// The signed-in person's own address or handle.
    case yourself
    /// No account by that address: offer to invite it.
    case noAccountForEmail(String)
    /// No account with that handle (unclaimed, a guest, or across a block,
    /// none of which the server reveals).
    case noAccountForHandle(String)

    public init(_ response: FriendLookupResponse, query: FriendSearchQuery) {
        if response.isSelf { self = .yourself; return }
        if response.found, let uid = response.uid {
            let name = response.displayName?.trimmingCharacters(in: .whitespaces) ?? ""
            self = .person(uid: uid, name: name.isEmpty ? "MySetlists member" : name, handle: response.handle)
            return
        }
        switch query {
        case .email(let e): self = .noAccountForEmail(e)
        case .handle(let h): self = .noAccountForHandle(h)
        }
    }
}

/// The lists the tab shows, from what the listeners hold.
public enum FriendsLists {
    /// Pending requests to `uid`, newest first, without anyone blocked
    /// (an old request from before a block, until `block` clears it).
    public static func incoming(_ requests: [FriendRequest], uid: String, blocked: Set<String>) -> [FriendRequest] {
        requests.filter { $0.to == uid && $0.isPending && !blocked.contains($0.from) }.sorted(by: newestFirst)
    }

    /// Pending requests from `uid`, newest first.
    public static func sent(_ requests: [FriendRequest], uid: String) -> [FriendRequest] {
        requests.filter { $0.from == uid && $0.isPending }.sorted(by: newestFirst)
    }

    /// Friends by name, as the web lists them; blocked people never show.
    public static func friends(_ edges: [FriendEdge], blocked: Set<String>) -> [FriendEdge] {
        edges.filter { !blocked.contains($0.friendUid) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Pending invites, newest first.
    public static func invites(_ invites: [Invite]) -> [Invite] {
        invites.filter { $0.status == "pending" }.sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
    }

    private static func newestFirst(_ a: FriendRequest, _ b: FriendRequest) -> Bool {
        (a.createdAt ?? .distantPast) > (b.createdAt ?? .distantPast)
    }
}

/// What to tell the person after each action, in the web's words where it
/// has them (`context/AppContext.jsx`).
public enum FriendsMessages {
    public static func request(_ result: String, name: String) -> String {
        switch result {
        case "friends": "You and \(name) are now friends."
        case "already-friends": "You're already friends with \(name)."
        case "already-requested": "You've already sent \(name) a request."
        default: "Friend request sent to \(name)."
        }
    }

    public static func invite(_ emailed: String, email: String) -> String {
        switch emailed {
        case "sent": "Invite sent to \(email)."
        case "recipient opted out": "Invite saved. \(email) has turned off emails from MySetlists, so it wasn't emailed."
        default: "Invite saved. An invite went to \(email) in the last day, so another wasn't sent."
        }
    }

    public static func resend(_ response: ResendInviteResponse) -> String {
        if response.resent { return "Invite resent." }
        switch response.reason {
        case "recipient opted out": return "They've turned off emails from MySetlists, so it wasn't resent."
        default: return "An invite can be resent once every 24 hours."
        }
    }

    /// An action that failed: the server's words when it sent some.
    public static func failure(_ error: APIError, fallback: String) -> String {
        switch error {
        case .offline: return "You're offline. Try again when you're connected."
        case .accountRequired: return "Friends need an account."
        case .signInRequired: return "Your session has expired. Sign in again."
        default: return error.message ?? fallback
        }
    }
}
