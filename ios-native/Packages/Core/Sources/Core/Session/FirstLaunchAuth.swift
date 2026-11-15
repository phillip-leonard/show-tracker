import Foundation

/// Which auth state the native app found the first time it ran on this
/// device: the answer to Q-01 (does a Capacitor-app session carry over when
/// the native build is installed over it?). docs/ios-native/Q01-SIGNIN-CARRYOVER.md
/// has the test steps.
///
/// No personal data: whether a uid was there, never the uid; the provider
/// ids (`google.com`, `apple.com`, `password`); no email or name.
public struct FirstLaunchAuthReport: Codable, Equatable, Sendable {
    /// What Firebase Auth's keychain entry held, read directly
    /// (`Auth.getStoredUser(forAccessGroup: nil)`), so a keychain error is
    /// told apart from "nobody was signed in".
    public enum Keychain: String, Codable, Sendable { case user, empty, unreadable }

    public let appVersion: String
    public let build: String
    public let recordedAt: Date
    /// Firebase restored a user at launch.
    public let uidPresent: Bool
    public let isAnonymous: Bool
    /// Sorted provider ids of the restored user; empty when none.
    public let providers: [String]
    public let keychain: Keychain
    /// The keychain error's code (`OSStatus`, e.g. -34018), when unreadable.
    public let keychainErrorCode: Int?
    /// The container already had WebKit data, which only the Capacitor app
    /// writes (its WebView): this install is an update over it.
    public let installedOverCapacitor: Bool

    /// One line for the log, Crashlytics and the hidden screen.
    public var summary: String {
        let who = uidPresent ? "signed in (\(isAnonymous ? "anonymous" : providers.isEmpty ? "no provider" : providers.joined(separator: "+")))" : "signed out"
        var line = "first launch \(appVersion) (\(build)): \(who); keychain \(keychain.rawValue)"
        if let code = keychainErrorCode { line += " \(code)" }
        line += installedOverCapacitor ? "; over the Capacitor app" : "; fresh install"
        return line
    }
}

/// What the report is made from, without Firebase types, so it can be
/// tested and can't carry anything personal by accident.
public struct AuthSnapshot: Sendable {
    public let uid: String?
    public let isAnonymous: Bool
    public let providerIDs: [String]

    public init(uid: String?, isAnonymous: Bool, providerIDs: [String]) {
        self.uid = uid
        self.isAnonymous = isAnonymous
        self.providerIDs = providerIDs
    }
}

public enum FirstLaunchAuth {
    static let key = "nativeFirstLaunchAuthReport"

    public static func report(user: AuthSnapshot?, keychain: FirstLaunchAuthReport.Keychain, keychainErrorCode: Int?,
                              installedOverCapacitor: Bool, app: AppInfo, at date: Date = Date()) -> FirstLaunchAuthReport {
        FirstLaunchAuthReport(
            appVersion: app.version,
            build: app.build,
            recordedAt: date,
            uidPresent: user?.uid?.isEmpty == false,
            isAnonymous: user?.isAnonymous ?? false,
            providers: Array(Set(user?.providerIDs ?? [])).sorted(),
            keychain: keychain,
            keychainErrorCode: keychain == .unreadable ? keychainErrorCode : nil,
            installedOverCapacitor: installedOverCapacitor
        )
    }

    /// Keeps the report the first time only. Returns it when this call was
    /// the first launch, nil on every later one. The Capacitor app never
    /// writes this key, so it survives the update and marks the first native
    /// launch.
    public static func storeIfFirst(_ report: FirstLaunchAuthReport, in defaults: UserDefaults = .standard) -> FirstLaunchAuthReport? {
        guard defaults.data(forKey: key) == nil, let data = try? JSONEncoder().encode(report) else { return nil }
        defaults.set(data, forKey: key)
        return report
    }

    /// The report from this device's first native launch, if it was kept.
    public static func stored(in defaults: UserDefaults = .standard) -> FirstLaunchAuthReport? {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(FirstLaunchAuthReport.self, from: $0) }
    }

    /// The Capacitor app's WebView leaves `Library/WebKit` in the container;
    /// the native app never creates it (SFSafariViewController and Apple's
    /// and Google's sign-in sheets run in other processes).
    public static func containerHasWebKitData(fileManager: FileManager = .default) -> Bool {
        guard let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first else { return false }
        return fileManager.fileExists(atPath: library.appendingPathComponent("WebKit").path)
    }
}
