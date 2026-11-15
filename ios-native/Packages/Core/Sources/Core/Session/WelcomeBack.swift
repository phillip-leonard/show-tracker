import Foundation

/// The sign-in screen's greeting for someone who used the Capacitor app.
///
/// Q-01 (docs/ios-native/Q01-SIGNIN-CARRYOVER.md): a Google session carries
/// over when the native app is installed over the Capacitor app; Apple and
/// email sessions don't. The decision of 2026-11-15 is that Apple and email
/// users sign in again, with no token bridge. So they land on the sign-in
/// screen with their shows still in their account, and the screen says so.
///
/// Shown while the app was installed over the Capacitor app and no account
/// has signed in on this install yet. The first account sign-in (a carried-over
/// Google session counts) turns it off for good; a guest doesn't, because their
/// old account is still waiting.
public enum WelcomeBack {
    static let accountSignedInKey = "nativeAccountSignedIn"

    public static let title = "Welcome back"
    public static let message = "Sign in to see your shows. Everything you logged is still there."

    /// The rule, without storage.
    public static func shows(installedOverCapacitor: Bool, accountSignedInBefore: Bool) -> Bool {
        installedOverCapacitor && !accountSignedInBefore
    }

    /// Whether the sign-in screen greets this person. "Installed over the
    /// Capacitor app" comes from the first-launch report when it has been
    /// recorded, and from the container itself before that (the report waits
    /// for Firebase's first auth callback, which can come after the screen).
    public static func shouldShow(in defaults: UserDefaults = .standard,
                                  containerHasWebKitData: () -> Bool = { FirstLaunchAuth.containerHasWebKitData() }) -> Bool {
        let over = FirstLaunchAuth.stored(in: defaults)?.installedOverCapacitor ?? containerHasWebKitData()
        return shows(installedOverCapacitor: over, accountSignedInBefore: defaults.bool(forKey: accountSignedInKey))
    }

    /// An account (not a guest) is signed in on this install.
    public static func noteAccountSignIn(in defaults: UserDefaults = .standard) {
        guard !defaults.bool(forKey: accountSignedInKey) else { return }
        defaults.set(true, forKey: accountSignedInKey)
    }
}
