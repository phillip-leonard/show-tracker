import Foundation

// The functions the app calls, and their request bodies. Paths are
// `/.netlify/functions/<name>`; answers are decoded by the caller.

/// `friends.js`: every friend feature that touches another user's documents
/// (an account only; a guest gets `account_required`).
public enum FriendsRequest: Encodable, Sendable {
    case accept(requestId: String)
    case claimInvites
    case referral(ref: String)
    case referralLink
    case lookupByEmail(email: String)
    case remove(friendUid: String)
    case showsTogether(friendUid: String)
    case showsTogetherCounts(friendUids: [String])
    case suggestionScan(showId: String?)

    public static let function = "friends"

    enum Keys: String, CodingKey { case action, requestId, ref, email, friendUid, friendUids, showId }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .accept(let id): try c.encode("accept", forKey: .action); try c.encode(id, forKey: .requestId)
        case .claimInvites: try c.encode("claimInvites", forKey: .action)
        case .referral(let ref): try c.encode("referral", forKey: .action); try c.encode(ref, forKey: .ref)
        case .referralLink: try c.encode("referralLink", forKey: .action)
        case .lookupByEmail(let e): try c.encode("lookupByEmail", forKey: .action); try c.encode(e, forKey: .email)
        case .remove(let uid): try c.encode("remove", forKey: .action); try c.encode(uid, forKey: .friendUid)
        case .showsTogether(let uid): try c.encode("showsTogether", forKey: .action); try c.encode(uid, forKey: .friendUid)
        case .showsTogetherCounts(let uids): try c.encode("showsTogetherCounts", forKey: .action); try c.encode(uids, forKey: .friendUids)
        case .suggestionScan(let id): try c.encode("suggestionScan", forKey: .action); try c.encodeIfPresent(id, forKey: .showId)
        }
    }
}

/// The setlist operations (lib/setlistOpsHandler.js), one function each.
/// Every setlist change from a source happens on the server.
public enum SetlistOperation: Sendable {
    case propose(showId: String)
    case accept(showId: String, onlyIfEmpty: Bool = false)
    case reject(showId: String)
    case resync(showId: String)
    case scanMissing(showIds: [String]?, dryRun: Bool = false)

    public var function: String {
        switch self {
        case .propose: "propose-setlist"
        case .accept: "accept-proposal"
        case .reject: "reject-proposal"
        case .resync: "resync-show"
        case .scanMissing: "scan-missing-setlists"
        }
    }

    public var body: [String: JSONValue] {
        switch self {
        case .propose(let id), .reject(let id), .resync(let id): return ["showId": .string(id)]
        case .accept(let id, let onlyIfEmpty): return onlyIfEmpty ? ["showId": .string(id), "onlyIfEmpty": .bool(true)] : ["showId": .string(id)]
        case .scanMissing(let ids, let dryRun):
            var b: [String: JSONValue] = [:]
            if let ids { b["showIds"] = .array(ids.map(JSONValue.string)) }
            if dryRun { b["dryRun"] = .bool(true) }
            return b
        }
    }
}

/// `send-password-reset`: no sign-in. Always `{ ok: true }`, whether or not
/// the address has an account.
public struct PasswordResetRequest: Encodable, Sendable {
    public var email: String
    public static let function = "send-password-reset"
}

/// `delete-account`: the ID token authorizes it; `confirmText` is the
/// deliberate step. An Apple account sends a fresh authorization code so
/// the server can revoke Apple's tokens first (B-11).
public struct DeleteAccountRequest: Encodable, Sendable {
    public var confirmText = "DELETE"
    public var appleToken: String?
    public var appleTokenType: String?
    public static let function = "delete-account"
    public init(appleAuthorizationCode: String?) {
        appleToken = appleAuthorizationCode
        appleTokenType = appleAuthorizationCode == nil ? nil : "CODE"
    }
}

/// `account-linked` (5.60.13): after a guest links a credential, what a new
/// sign-up gets. `ref` is a referral the app kept from a `/?ref=` link.
public struct AccountLinkedRequest: Encodable, Sendable {
    public var ref: String?
    public static let function = "account-linked"
}

public struct AccountLinkedResponse: Decodable, Sendable {
    public var ok: Bool
    public var invites: JSONValue?
    public var referral: JSONValue?
    public var welcomeEmail: JSONValue?
    public var stats: JSONValue?
    public var profile: JSONValue?
    /// The web sends `friend_joined` through send-email when this is true.
    public var newFriend: Bool { invites?["newFriend"]?.boolValue == true }
}

/// `adopt-guest-shows` (5.60.13, D-4): the guest signed in to an account
/// they already had. Called with the account's token; the guest's token in
/// the body proves they hold both.
public struct AdoptGuestShowsRequest: Encodable, Sendable {
    public enum Mode: String, Encodable, Sendable { case preview, commit }
    public var mode: Mode
    public var guestIdToken: String
    public var includePossible: [String]?
    public static let function = "adopt-guest-shows"
}

public struct AdoptGuestShowsPreview: Decodable, Sendable {
    public var move: Int
    public var duplicates: [Match]
    public var possible: [Match]
    public var upcoming: Int
    public var bands: Int

    public struct Match: Decodable, Hashable, Sendable {
        public var guestShowId: String
        public var artist: String
        public var venue: String
        public var date: String
        public var existingShowId: String?
        public var rule: String?
    }
}

public struct AdoptGuestShowsResult: Decodable, Sendable {
    public var moved: Int
    public var duplicates: Int
    public var possibleDropped: Int
    public var upcomingMoved: Int
    public var bandsAdded: Int
    public var guestDeleted: Bool
}

/// `moderate-content` `profileName`: the only way a display name is set;
/// the server runs the content filter.
public struct ProfileNameRequest: Encodable, Sendable {
    public var target = "profileName"
    public var displayName: String
    public static let function = "moderate-content"
}

/// `recompute-my-stats`: the caller's userStats, and the server's numbers
/// on their Year in Review documents, now.
public struct RecomputeStatsRequest: Encodable, Sendable {
    public init() {}
    public static let function = "recompute-my-stats"
}

/// Many functions answer `{ ok: true, … }` and nothing the caller reads.
public struct OKResponse: Decodable, Sendable {
    public var ok: Bool?
    public var success: Bool?
}
