import FirebaseMessaging
import Foundation

/// The one file that calls Firebase Messaging's token APIs (Stage 3, C-8).
///
/// Messaging 12.18.0 deprecated `token()`, `deleteToken()` and
/// `messaging(_:didReceiveRegistrationToken:)` in favour of installation
/// IDs. Push stays on FCM tokens: installation IDs need
/// `FirebaseMessagingInstallationIdEnabled`, which makes every token API
/// fail, and the server (`firebase-admin` 12.7) can only send to a token.
/// The Capacitor app's `pushTokens` documents are keyed by FCM token too.
/// The deprecation warnings stay here; the move is a GATED-CLEANUPS row
/// (STAGE3-AUDIT §5.3).
public enum PushToken {
    /// This install's FCM token, or nil before APNs has given Messaging a
    /// device token (or with no network). Rotation arrives through
    /// `PushTokenObserver`.
    @MainActor
    public static func current() async -> String? {
        try? await Messaging.messaging().token()
    }

    /// The same, with Messaging's error when there is none, for the Push
    /// screen. Ask only once `hasAPNsToken`: before that it can only fail.
    @MainActor
    static func fetch() async throws -> String {
        try await Messaging.messaging().token()
    }

    /// Hands APNs's device token to Messaging. Set here rather than left to
    /// Firebase's app-delegate swizzling, which can miss the callback in a
    /// SwiftUI app (the 4.0.24 "None yet" bug). The type is worked out from
    /// the build's signing: production for TestFlight and the App Store.
    @MainActor
    static func setAPNs(_ deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
    }

    /// Whether Messaging has an APNs token, from us or from its swizzling.
    @MainActor
    static var hasAPNsToken: Bool { Messaging.messaging().apnsToken != nil }

    /// Throws away this install's token (sign-out), so the next account on
    /// the device gets a fresh one, as the Capacitor app does.
    @MainActor
    public static func delete() async throws {
        try await Messaging.messaging().deleteToken()
    }
}

/// Messaging's delegate: a new or rotated token goes to `PushCenter`.
public final class PushTokenObserver: NSObject, MessagingDelegate, @unchecked Sendable {
    public static let shared = PushTokenObserver()

    @MainActor
    static func install() { Messaging.messaging().delegate = shared }

    public func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken, !fcmToken.isEmpty else { return }
        Task { @MainActor in PushCenter.shared.tokenArrived(fcmToken) }
    }
}
