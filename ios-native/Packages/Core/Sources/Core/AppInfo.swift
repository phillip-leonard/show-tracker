import Foundation

/// What the running build says about itself.
public struct AppInfo: Sendable, Equatable {
    /// `CFBundleShortVersionString` (the native app's `MARKETING_VERSION`, 4.0.x).
    public let version: String
    /// `CFBundleVersion`, set by Xcode Cloud.
    public let build: String

    public init(version: String, build: String) {
        self.version = version
        self.build = build
    }

    public init(bundle: Bundle) {
        self.init(
            version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0",
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        )
    }

    public static var current: AppInfo { AppInfo(bundle: .main) }
}

/// Where the process is running.
public enum AppEnvironment {
    /// The app is the host of an XCTest bundle (MySetlistsTests): it must
    /// not start Firebase or a session itself, so a test can configure
    /// Firebase (the Auth emulator) before anything uses it.
    public static var isHostingTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }
}
