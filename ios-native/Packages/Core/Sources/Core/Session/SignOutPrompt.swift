import Foundation

/// What tapping "Sign out" does first.
///
/// Sign-out clears Firestore's offline cache, so writes that haven't reached
/// the server go with it. An account with such writes is asked first
/// ("Stay signed in" is the default). A guest is always asked, because a
/// guest account can't be signed back into: every show goes, synced or not.
public enum SignOutPrompt: Equatable, Sendable {
    case signOut
    case unsyncedChanges
    case guestLosesEverything

    public static func decide(isGuest: Bool, hasUnsyncedWrites: Bool) -> SignOutPrompt {
        if isGuest { return .guestLosesEverything }
        return hasUnsyncedWrites ? .unsyncedChanges : .signOut
    }

    public static let unsyncedTitle = "You have changes that haven't synced yet. Signing out now will lose them."
}

/// Whether Firestore still holds writes the server hasn't acknowledged.
///
/// Firestore's `waitForPendingWrites()` finishes at once when there are
/// none, and otherwise only once the server has them. So "not finished
/// within `limit`" means unsynced: offline, or a write still on its way. It
/// covers every document (shows, the profile, anything), not just one
/// listener's, which `hasPendingWrites` on a snapshot would. A failure (the
/// user changed meanwhile) reads as "nothing to warn about".
public enum UnsyncedWrites {
    public static let defaultLimit: Duration = .milliseconds(750)

    public static func exist(within limit: Duration = defaultLimit,
                             waitForSync: @escaping @Sendable () async throws -> Void) async -> Bool {
        await SignOutRunner(timeout: limit).bounded(waitForSync) == .timedOut
    }
}
