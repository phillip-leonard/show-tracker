import Core
import DesignSystem
import SwiftUI

/// Q-01 (docs/ios-native/Q01-SIGNIN-CARRYOVER.md): the auth state this
/// install found the first time the native app ran. Reached by tapping the
/// version in Me five times, in every build. Shows no personal data: whether
/// a uid was there, never the uid.
struct FirstLaunchReportView: View {
    private let report = FirstLaunchAuth.stored()

    var body: some View {
        Form {
            if let report {
                Section {
                    LabeledContent("Result", value: report.uidPresent ? "Signed in" : "Signed out")
                    LabeledContent("Providers", value: report.providers.isEmpty ? "None" : report.providers.joined(separator: ", "))
                    LabeledContent("Guest", value: report.isAnonymous ? "Yes" : "No")
                    LabeledContent("Keychain", value: report.keychain.rawValue + (report.keychainErrorCode.map { " (\($0))" } ?? ""))
                    LabeledContent("Installed over the Capacitor app", value: report.installedOverCapacitor ? "Yes" : "No")
                    LabeledContent("Version", value: "\(report.appVersion) (\(report.build))")
                    LabeledContent("Recorded", value: report.recordedAt.formatted(date: .abbreviated, time: .standard))
                }
                .brandRow()
                Section {
                    Text(report.summary)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                } footer: {
                    Text("Recorded once, on the first launch of the native app on this device. Copy this line into the Q-01 results.")
                }
                .brandRow()
            } else {
                Section {
                    Text("No first-launch record on this device. It's written on the first launch of a build that has it (4.0.5 and later).")
                }
                .brandRow()
            }
        }
        .brandScreen()
        .navigationTitle("First-launch sign-in")
        .navigationBarTitleDisplayMode(.inline)
    }
}
