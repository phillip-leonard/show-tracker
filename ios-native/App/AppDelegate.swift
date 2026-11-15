import Core
import DesignSystem
import UIKit

/// Launch-time setup: fonts and Firebase. Links are followed in
/// `MySetlistsApp` (`onOpenURL`, `AppRouter`). Push registration isn't
/// wired yet.
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
