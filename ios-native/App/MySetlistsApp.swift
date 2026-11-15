import Core
import DesignSystem
import Features
import SwiftUI

@main
struct MySetlistsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark) // dark only in v1 (docs/ios-native/DECISIONS.md)
        }
    }
}
