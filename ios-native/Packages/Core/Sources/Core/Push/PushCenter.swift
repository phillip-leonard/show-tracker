import FirebaseCrashlytics
import FirebaseFirestore
import Foundation
import Observation
import UIKit
import UserNotifications

/// Push for the native app (Stage 3, Part 5), as the Capacitor app does it
/// (lib/pushAlerts.js, STAGE3-AUDIT §5):
///
/// - **Registration:** APNs at launch (it shows nothing); then, for a
///   signed-in person (a guest too: band alerts reach them, D-2) who has
///   allowed notifications, `pushTokens/{fcmToken} = {userId, platform,
///   updatedAt}`, on every launch and on rotation. The previous token's
///   document is deleted when the token changes. A tester who allowed push
///   in the Capacitor app is registered without being asked again.
/// - **Asking:** only when `config/app.iosPushOfferEnabled` is true (off
///   today), and only from a tap (`requestPermission`).
/// - **Showing:** a banner in the foreground too; a tap opens the push's
///   `data.link` through `DeepLink`, the table links use, and marks the
///   notification it's about read.
/// - **Sign-out** deletes the document and the token (`SessionStore`).
@MainActor
@Observable
public final class PushCenter {
    public static let shared = PushCenter()

    public private(set) var authorization: UNAuthorizationStatus = .notDetermined
    /// The last 6 characters of the registered token, for the admin rows.
    public private(set) var registeredTokenSuffix: String?
    public private(set) var lastProblem: String?
    /// A tapped push's link, for the app to open (`MySetlistsApp`).
    public var pendingLink: URL?

    private var uid: String?
    private static let lastTokenKey = "push.lastRegisteredToken"
    @ObservationIgnored let delegate = PushNotificationDelegate()

    private init() {}

    /// Launch: the delegates and APNs registration. Asking comes later, if ever.
    public func configureAtLaunch(_ application: UIApplication) {
        UNUserNotificationCenter.current().delegate = delegate
        PushTokenObserver.install()
        application.registerForRemoteNotifications()
    }

    /// Someone signed in (or nobody): register this device for them.
    public func signedIn(uid: String?) async {
        self.uid = uid
        await refreshAuthorization()
        guard let uid, Self.allowed(authorization) else { return }
        if let token = await PushToken.current() { await write(token: token, uid: uid) }
    }

    public func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Asks for permission, only when the offer is on (`iosPushOfferEnabled`).
    @discardableResult
    public func requestPermission(offerEnabled: Bool) async -> Bool {
        guard offerEnabled else { return false }
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refreshAuthorization()
        if granted {
            UIApplication.shared.registerForRemoteNotifications()
            await signedIn(uid: uid)
        }
        return granted
    }

    /// A new or rotated token from Messaging.
    func tokenArrived(_ token: String) {
        guard let uid else { return }
        Task {
            await refreshAuthorization()
            guard Self.allowed(authorization) else { return }
            await write(token: token, uid: uid)
        }
    }

    /// Sign-out: this device's document while still signed in, then the token.
    public func forgetForSignOut() async throws {
        let token = await PushToken.current() ?? UserDefaults.standard.string(forKey: Self.lastTokenKey)
        if let token { try await Database.ready().document("pushTokens/\(token)").delete() }
        UserDefaults.standard.removeObject(forKey: Self.lastTokenKey)
        registeredTokenSuffix = nil
        uid = nil
        try? await PushToken.delete()
    }

    static func allowed(_ status: UNAuthorizationStatus) -> Bool {
        status == .authorized || status == .provisional || status == .ephemeral
    }

    private func write(token: String, uid: String) async {
        let db = await Database.ready()
        let previous = UserDefaults.standard.string(forKey: Self.lastTokenKey)
        do {
            try await db.document("pushTokens/\(token)").setData(PushTokenDocument.fields(uid: uid))
            if let previous, previous != token {
                // Ours only (the rules refuse anyone else's): best effort.
                try? await db.document("pushTokens/\(previous)").delete()
            }
            UserDefaults.standard.set(token, forKey: Self.lastTokenKey)
            registeredTokenSuffix = String(token.suffix(6))
            lastProblem = nil
        } catch {
            lastProblem = "This device couldn't be registered for push: \(error.localizedDescription)"
            Crashlytics.crashlytics().record(error: error, userInfo: ["stage": "PushCenter write"])
        }
    }

    /// A tap: open its link, and mark the notification it's about read.
    func opened(link: String?, notificationId: String?) {
        if let link, let url = URL(string: link) { pendingLink = url }
        if let id = notificationId, !id.isEmpty, uid != nil {
            Task { try? await Database.ready().document("notifications/\(id)").updateData(["read": true]) }
        }
    }
}

/// The document the rules allow (`hasOnly(['userId', 'platform', 'updatedAt'])`).
public enum PushTokenDocument {
    public static func fields(uid: String) -> [String: Any] {
        ["userId": uid, "platform": "ios", "updatedAt": FieldValue.serverTimestamp()]
    }
}

/// Banners in the foreground; taps routed. The system calls these off the
/// main actor, so only strings cross over.
final class PushNotificationDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let link = PushPayload.link(info)
        let id = PushPayload.notificationId(info)
        await MainActor.run { PushCenter.shared.opened(link: link, notificationId: id) }
    }
}

/// What a push carries (lib/pushDelivery.js `fcmMessage`): `data` keys
/// arrive at the top of `userInfo`.
public enum PushPayload {
    public static func link(_ userInfo: [AnyHashable: Any]) -> String? {
        (userInfo["link"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    public static func notificationId(_ userInfo: [AnyHashable: Any]) -> String? {
        (userInfo["notificationId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    }
}
