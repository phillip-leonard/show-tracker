import Core
import DesignSystem
import UIKit

/// Launch-time setup. Push registration and deep links arrive with the app
/// shell (Part 6); auth with Part 5.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        AppBootstrap.configureFirebase()
        BrandFonts.register()
        return true
    }
}
