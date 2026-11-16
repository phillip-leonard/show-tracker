import Foundation

/// Which screen replaces the app, in the web's order
/// (app/AppProviderWrapper.jsx, components/layout/VersionGate.jsx):
///
///   1. update required: a build below `minSupportedIosVersion`. Covers
///      everything, signed in or not; account deletion stays reachable
///      (Guideline 5.1.1(v)).
///   2. signed out: the sign-in screen
///   3. suspended: `userProfiles.banned` (ahead of the terms gate)
///   4. terms: no acceptance of `Terms.version` on the profile, and none
///      on this phone (ticked just now, or seen earlier and recorded in
///      `TermsAcceptanceRecord`, so an offline launch never stops here for
///      someone who has agreed)
///   5. the app
///
/// The profile is tri-state, as on the web: until it has been read there is
/// no gate (`.loading`), so an account that has accepted never sees the
/// terms gate flash. A profile that couldn't be read fails closed for the
/// terms (agreeing again is cheap) and open for suspension (locking someone
/// out over a network blip is worse; the rules refuse a banned account's
/// writes regardless).
public enum AccountGate: Equatable, Sendable {
    case loading
    case updateRequired
    case signedOut
    case suspended
    case termsRequired
    case ready

    public enum ProfileState: Equatable, Sendable {
        case unknown
        case loaded(banned: Bool, termsAcceptedVersion: Int?)
        /// No profile document yet (a brand-new account).
        case missing
        case unreadable
    }

    public static func compute(
        signedIn: Bool?,
        profile: ProfileState,
        acceptedOnThisDevice: Bool,
        version: AppVersion.Status
    ) -> AccountGate {
        if version == .blocked { return .updateRequired }
        guard let signedIn else { return .loading }
        guard signedIn else { return .signedOut }
        switch profile {
        case .unknown:
            return .loading
        case .loaded(let banned, let accepted):
            if banned { return .suspended }
            return (accepted ?? 0) >= Terms.version || acceptedOnThisDevice ? .ready : .termsRequired
        case .missing:
            return acceptedOnThisDevice ? .ready : .termsRequired
        case .unreadable:
            return acceptedOnThisDevice ? .ready : .termsRequired
        }
    }
}

/// The Terms of Service the app asks people to agree to (lib/terms.js).
public enum Terms {
    /// `TERMS_VERSION`. Bumping it sends every account through the gate
    /// again, in both apps.
    public static let version = 1

    public static let url = URL(string: "https://mysetlists.net/terms")!
    public static let privacyURL = URL(string: "https://mysetlists.net/privacy")!
    public static let supportEmail = "support@mysetlists.net"

    /// `TERMS_SUMMARY`: the Community Guidelines the gate shows (Guideline 1.2).
    public static let summary: [(title: String, body: String)] = [
        ("Zero tolerance for objectionable content", "No slurs, harassment, hate, sexual content, threats or impersonation. Post any of it and it is removed."),
        ("Zero tolerance for abusive users", "Accounts that post objectionable content are removed from MySetlists."),
        ("You can flag anything", "Every comment, photo, video, meetup message and profile carries a flag icon."),
        ("You can block anyone", "Their content disappears from your app immediately, and you stop appearing to each other."),
        ("We review reports within 24 hours", "We remove content that breaks these rules and remove the account that posted it."),
    ]
}
