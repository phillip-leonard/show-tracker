import Foundation

/// The terms version this phone has seen an account accept: on its profile,
/// or agreed to here. Kept per account in UserDefaults, so an offline launch
/// never stops at the terms gate for someone who has already agreed, and
/// "I agree" offline lets them in at once while the profile write waits to
/// sync (`SessionStore.acceptTerms`). A terms version bump (`Terms.version`)
/// asks again, as on the profile.
public struct TermsAcceptanceRecord: @unchecked Sendable {  // UserDefaults is thread-safe
    let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    static func key(_ uid: String) -> String { "termsAcceptedVersion.\(uid)" }

    /// The version recorded for this account, or nil.
    public func version(uid: String) -> Int? {
        defaults.object(forKey: Self.key(uid)) as? Int
    }

    /// This account has accepted the current terms, as far as this phone knows.
    public func hasAcceptedCurrent(uid: String) -> Bool {
        (version(uid: uid) ?? 0) >= Terms.version
    }

    /// Records a version; never lowers one already recorded.
    public func record(_ version: Int, uid: String) {
        guard version > (self.version(uid: uid) ?? 0) else { return }
        defaults.set(version, forKey: Self.key(uid))
    }

    /// Forgets the account (deleted, or a guest signing out for good).
    public func forget(uid: String) {
        defaults.removeObject(forKey: Self.key(uid))
    }
}
