import Foundation
import Testing
@testable import Core

/// The sign-in screen's "Welcome back" (Q-01): shown after an update from the
/// Capacitor app until an account signs in on this install.
@Suite struct WelcomeBackTests {
    let app = AppInfo(version: "4.0.6", build: "150")

    func defaults() -> UserDefaults {
        let name = "WelcomeBackTests-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: name)!
        d.removePersistentDomain(forName: name)
        return d
    }

    func store(overCapacitor: Bool, in d: UserDefaults) {
        let r = FirstLaunchAuth.report(user: nil, keychain: .empty, keychainErrorCode: nil, installedOverCapacitor: overCapacitor, app: app)
        _ = FirstLaunchAuth.storeIfFirst(r, in: d)
    }

    @Test func theRule() {
        #expect(WelcomeBack.shows(installedOverCapacitor: true, accountSignedInBefore: false))
        #expect(!WelcomeBack.shows(installedOverCapacitor: true, accountSignedInBefore: true))
        #expect(!WelcomeBack.shows(installedOverCapacitor: false, accountSignedInBefore: false))
        #expect(!WelcomeBack.shows(installedOverCapacitor: false, accountSignedInBefore: true))
    }

    @Test func theWording() {
        #expect("\(WelcomeBack.title). \(WelcomeBack.message)" == "Welcome back. Sign in to see your shows. Everything you logged is still there.")
    }

    @Test func anUpdateFromTheCapacitorAppIsGreetedUntilAnAccountSignsIn() {
        let d = defaults()
        store(overCapacitor: true, in: d)
        #expect(WelcomeBack.shouldShow(in: d, containerHasWebKitData: { false }), "the recorded report wins over the live check")
        WelcomeBack.noteAccountSignIn(in: d)
        #expect(!WelcomeBack.shouldShow(in: d, containerHasWebKitData: { true }), "signed out later: the ordinary screen")
    }

    @Test func aFreshInstallIsNotGreeted() {
        let d = defaults()
        store(overCapacitor: false, in: d)
        #expect(!WelcomeBack.shouldShow(in: d, containerHasWebKitData: { true }))
    }

    @Test func beforeTheReportIsRecordedTheContainerDecides() {
        let d = defaults()
        #expect(WelcomeBack.shouldShow(in: d, containerHasWebKitData: { true }))
        #expect(!WelcomeBack.shouldShow(in: d, containerHasWebKitData: { false }))
    }
}
