import Core
import DesignSystem
import Features
import GoogleSignIn
import SwiftUI

@main
struct MySetlistsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(session)
                .preferredColorScheme(.dark) // dark only in v1 (docs/ios-native/DECISIONS.md)
                .onAppear { if !AppEnvironment.isHostingTests { session.start() } }
                .onOpenURL { url in
                    // Google's sign-in returns through the reversed-client-id scheme.
                    if GIDSignIn.sharedInstance.handle(url) { return }
                    // A referral link (D-6: https://mysetlists.net/?ref=…), kept
                    // until the next sign-up or guest upgrade uses it. The full
                    // deep-link router arrives with the app shell (Part 6).
                    if let ref = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                        .queryItems?.first(where: { $0.name == "ref" })?.value, !ref.isEmpty {
                        Referral.remember(ref)
                    }
                }
        }
    }
}
