import FirebaseAuth
import Foundation
import os

/// What this phone keeps for an account outside Firestore's cache: queued
/// adds (`ShowOutbox`), queued song edits (`SetlistEditQueue`) and the terms
/// it has seen accepted (`TermsAcceptanceRecord`). Stage 2, Part 4: these
/// go when the account goes, and a guest's are sent before its shows move
/// to another account.
public enum LocalAccountData {
    /// Deletes all of it for `uid`: after the account is deleted, or once a
    /// guest's shows have moved and the guest account is gone.
    public static func forget(uid: String, terms: TermsAcceptanceRecord?, in directory: URL? = nil) {
        ShowOutbox.delete(uid: uid, in: directory)
        SetlistEditQueue.delete(uid: uid, in: directory)
        terms?.forget(uid: uid)
    }

    /// Changes for `uid` the server doesn't have yet: queued adds in any
    /// state (waiting, waiting for an answer, refused) and queued song edits.
    public static func unsentCount(uid: String, in directory: URL? = nil) -> Int {
        ShowOutbox.load(uid: uid, in: directory).count + SetlistEditQueue.load(uid: uid, in: directory).count
    }

    /// Why a guest's shows can't move yet.
    public static func unsentMessage(_ count: Int) -> String {
        let changes = count == 1 ? "1 change you made as a guest hasn't" : "\(count) changes you made as a guest haven't"
        return "\(changes) reached the server yet, and moving now would lose \(count == 1 ? "it" : "them"). Connect to the internet, check the Shows tab for a show waiting for an answer, then try again."
    }
}

/// After a deletion request fails without a clear "no" (a timeout, a lost
/// connection, the function running out of time mid-purge), whether the
/// account is in fact gone. `delete-account` disables the account and
/// revokes its tokens before it starts deleting data, so a forced token
/// refresh fails once the deletion has begun.
public enum AccountDeletionCheck {
    private static let log = Logger(subsystem: "com.mysetlists.app", category: "AccountDeletion")

    public enum Answer: Equatable, Sendable {
        /// The account is disabled or deleted: the deletion went through.
        case gone
        /// The account still works: the deletion didn't happen.
        case stillThere
        /// Couldn't tell (offline).
        case unknown
    }

    /// Whether a failed request might still have deleted the account: a
    /// timeout, a lost connection, a 5xx, or a token that can no longer be
    /// refreshed (a retry after a deletion that went through). Not the
    /// server's clear refusal of the request itself.
    public static func mightHaveDeleted(_ error: APIError) -> Bool {
        switch error {
        case .offline, .invalidResponse, .signInRequired: return true
        case .server(let status, _, _): return status == 0 || status >= 500
        case .accountRequired, .rateLimited, .forbidden: return false
        }
    }

    /// The Secure Token service's reasons for refusing a refresh that mean
    /// the account is disabled, deleted or its sessions revoked. The SDK
    /// maps some of them to codes and wraps others in an internal error
    /// (the Auth emulator answers `INVALID_REFRESH_TOKEN` for a deleted
    /// account), so both are read.
    static let goneReasons: Set<String> = ["USER_DISABLED", "USER_NOT_FOUND", "TOKEN_EXPIRED", "INVALID_REFRESH_TOKEN"]

    /// The server's reason inside an internal error, if any ("TOKEN_EXPIRED").
    static func serverReason(_ error: NSError) -> String? {
        let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError
        let response = (underlying ?? error).userInfo["FIRAuthErrorUserInfoDeserializedResponseKey"] as? [String: Any]
        guard let message = response?["message"] as? String else { return nil }
        // "TOKEN_EXPIRED : detail" → "TOKEN_EXPIRED"
        return message.split(whereSeparator: { $0 == " " || $0 == ":" }).first.map(String.init)
    }

    /// What a forced token refresh's failure says about the account.
    public static func answer(forRefreshError error: Error) -> Answer {
        let ns = error as NSError
        guard ns.domain == AuthErrorDomain, let code = AuthErrorCode(rawValue: ns.code) else { return .unknown }
        switch code {
        case .userDisabled, .userNotFound, .userTokenExpired, .invalidUserToken: return .gone
        case .internalError: return serverReason(ns).map { goneReasons.contains($0) ? .gone : .unknown } ?? .unknown
        default: return .unknown
        }
    }

    /// Asks Firebase Auth, with a fresh token.
    @MainActor
    public static func check() async -> Answer {
        guard let user = Auth.auth().currentUser else { return .gone }
        do {
            _ = try await user.getIDTokenResult(forcingRefresh: true)
            return .stillThere
        } catch {
            let ns = error as NSError
            let answer = answer(forRefreshError: error)
            // Error codes only, no account details.
            log.notice("deletion check: refresh refused \(ns.domain, privacy: .public) \(ns.code, privacy: .public) \(serverReason(ns) ?? "-", privacy: .public) → \(String(describing: answer), privacy: .public)")
            return answer
        }
    }
}
