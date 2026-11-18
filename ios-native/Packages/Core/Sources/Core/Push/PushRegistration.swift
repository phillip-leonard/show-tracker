import Foundation

/// Where this device's push registration stands, step by step, so the Push
/// screen can say which step failed instead of "None yet" (the 4.0.24 bug):
///
/// 1. **APNs:** the app asks (`registerForRemoteNotifications`), and iOS
///    answers with a device token or an error. A build signed without the
///    `aps-environment` entitlement fails here.
/// 2. **FCM:** with the APNs token in hand, Messaging gives an FCM token.
///    Asked before step 1 has an answer it can only fail.
/// 3. **The document** `pushTokens/{fcmToken}` (`PushCenter.write`).
public struct PushRegistration: Equatable, Sendable {
    public private(set) var apnsRequestedAt: Date?
    public private(set) var apnsTokenAt: Date?
    public private(set) var apnsError: String?
    public private(set) var fcmToken: String?
    public private(set) var fcmError: String?

    public init() {}

    public var apnsReceived: Bool { apnsTokenAt != nil }

    /// What step 1 looks like right now.
    public var apnsStatus: String {
        if apnsReceived { return "Yes" }
        if apnsError != nil { return "No: iOS refused" }
        if apnsRequestedAt != nil { return "No: asked, no answer yet" }
        return "No: not asked"
    }

    mutating func apnsRequested(at date: Date) {
        apnsRequestedAt = date
    }

    mutating func apnsRegistered(at date: Date) {
        apnsTokenAt = date
        apnsError = nil
    }

    mutating func apnsFailed(_ error: Error) {
        apnsError = Self.describe(error)
    }

    mutating func fcmArrived(_ token: String) {
        fcmToken = token
        fcmError = nil
    }

    mutating func fcmFailed(_ error: Error) {
        fcmError = Self.describe(error)
    }

    /// Sign-out deletes the FCM token; the next account gets a new one.
    mutating func fcmForgotten() {
        fcmToken = nil
    }

    /// "Register again" starts both steps afresh.
    mutating func clearErrors() {
        apnsError = nil
        fcmError = nil
    }

    /// The message with its domain and code, which is what tells one APNs
    /// failure from another.
    static func describe(_ error: Error) -> String {
        let ns = error as NSError
        return "\(ns.localizedDescription) (\(ns.domain) \(ns.code))"
    }

    /// What an APNs failure most likely means, for the errors iOS gives.
    public static func hint(forAPNsError error: String) -> String? {
        if error.contains("aps-environment") || (error.contains("NSCocoaErrorDomain") && error.hasSuffix(" 3000)")) {
            return "This build isn't signed with the Push Notifications entitlement. Check aps-environment in the archive and that the provisioning profile includes push."
        }
        if error.contains("NSCocoaErrorDomain") && error.hasSuffix(" 3010)") {
            return "This device can't register with APNs (a simulator without push support)."
        }
        return nil
    }
}
