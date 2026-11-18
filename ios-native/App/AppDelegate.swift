import Core
import DesignSystem
import UIKit

/// Launch-time setup: fonts, Firebase and push (Stage 3, Part 5:
/// `PushCenter` takes the notification and Messaging delegates and
/// registers with APNs, which shows nothing). Links, push taps included,
/// are followed in `MySetlistsApp` (`AppRouter`).
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        BrandFonts.register()
        // Hosting MySetlistsTests: the tests configure Firebase themselves.
        guard !AppEnvironment.isHostingTests else { return true }
        AppBootstrap.configureFirebase()
        // Q-01: which auth state this install found the first time it ran.
        FirstLaunchAuthRecorder.start()
        PushCenter.shared.configureAtLaunch(application)
        return true
    }

    // APNs's answer to `registerForRemoteNotifications`, handled here rather
    // than left to Firebase's swizzling (4.0.24: "Registered token: None
    // yet"). `PushCenter` gives Messaging the token, then asks for the FCM
    // token; a failure is logged and shown on Me → Push.

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushCenter.shared.apnsRegistered(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushCenter.shared.apnsFailed(error)
    }
}
