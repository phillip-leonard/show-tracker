#if DEBUG
import Core
import DesignSystem
import SwiftUI

/// Debug builds only, reached by tapping the version in Me five times:
/// checks that Crashlytics receives reports.
///
/// Debug builds don't collect crash reports (`AppBootstrap`), so turn
/// collection on first. Then run the app without the debugger (stop it in
/// Xcode and open it from the Home Screen), crash, and open the app again:
/// the report uploads on that launch and shows in the Firebase console
/// within a few minutes.
struct DeveloperSettingsView: View {
    @State private var collecting = Diagnostics.isCollectingCrashReports
    @State private var confirmCrash = false
    @State private var sentNonFatal = false

    var body: some View {
        Form {
            Section {
                Toggle("Send crash reports from this build", isOn: $collecting)
                    .onChange(of: collecting) { _, on in Diagnostics.setCollectingCrashReports(on) }
            } footer: {
                Text("Crashlytics keeps this setting across launches. Release builds always send.")
            }
            .brandRow()

            Section {
                Button(sentNonFatal ? "Test error recorded" : "Record a test error") {
                    Diagnostics.recordTestError()
                    sentNonFatal = true
                }
                .disabled(sentNonFatal)
                Button("Crash the app", role: .destructive) { confirmCrash = true }
            } footer: {
                Text("Run without the debugger: Xcode catches the crash otherwise. The report uploads the next time the app opens.")
            }
            .brandRow()
        }
        .brandScreen()
        .navigationTitle("Developer")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Crash MySetlists now?", isPresented: $confirmCrash, titleVisibility: .visible) {
            Button("Crash", role: .destructive) { Diagnostics.testCrash() }
        }
    }
}
#endif
