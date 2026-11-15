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
        BrandFonts.register()
        // Hosting MySetlistsTests: the tests configure Firebase themselves.
        guard !AppEnvironment.isHostingTests else { return true }
        AppBootstrap.configureFirebase()
        return true
    }
}
