import FirebaseCrashlytics
import Foundation

/// Crashlytics, for the screens: Features doesn't import Firebase.
///
/// Release builds collect crash reports (`AppBootstrap`); Debug builds
/// don't, unless the hidden developer screen turns collection on to test the
/// pipeline. Crashlytics remembers that setting across launches.
public enum Diagnostics {
    public static var isCollectingCrashReports: Bool {
        Crashlytics.crashlytics().isCrashlyticsCollectionEnabled()
    }

    public static func setCollectingCrashReports(_ on: Bool) {
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(on)
    }

    /// A breadcrumb in the next crash report.
    public static func log(_ message: String) {
        Crashlytics.crashlytics().log(message)
    }

    /// A non-fatal report, sent with the next batch.
    public static func recordTestError() {
        Crashlytics.crashlytics().record(error: NSError(domain: "MySetlists.DiagnosticsTest", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "Test non-fatal from the developer screen",
        ]))
    }

    /// Crashes the app. The report uploads on the next launch, and only when
    /// no debugger is attached (Xcode catches the crash first).
    public static func testCrash() -> Never {
        log("Test crash from the developer screen")
        fatalError("Test crash from the developer screen")
    }
}
