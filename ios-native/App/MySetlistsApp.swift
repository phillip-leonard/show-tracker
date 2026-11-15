import Core
import DesignSystem
import Features
import GoogleSignIn
import SwiftUI

@main
struct MySetlistsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = SessionStore()
    @State private var router = AppRouter()

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(session)
                .environment(router)
                .preferredColorScheme(.dark) // dark only in v1 (docs/ios-native/DECISIONS.md)
                .onAppear { if !AppEnvironment.isHostingTests { session.start() } }
                .onOpenURL { url in
                    // Google's sign-in returns through the reversed-client-id scheme.
                    if GIDSignIn.sharedInstance.handle(url) { return }
                    // Universal links and mysetlists:// (Core's DeepLink, the
                    // table lib/deepLinks.js shares). A ?ref= is kept for the
                    // next account sign-in, or used now if one is signed in.
                    guard router.handle(url) else { return }
                    Task { await session.useReferralIfSignedIn() }
                }
        }
    }
}
