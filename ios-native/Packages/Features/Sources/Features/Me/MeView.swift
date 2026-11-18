import Core
import DesignSystem
import SwiftUI

/// Me: who is signed in; the profile and email settings (Stage 2, Part 3,
/// each through the web's own path: `ProfileSettings`); connected accounts;
/// help and legal pages; and the account actions that must always be
/// reachable: create an account (a guest), sign out, delete the account
/// (Guideline 5.1.1(v); DECISIONS.md, "Data export and the offline cache").
struct MeView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppRouter.self) private var router
    @State private var showUpgrade = false
    @State private var showDelete = false
    @State private var confirmGuestSignOut = false
    @State private var confirmUnsynced = false
    @State private var signingOut = false
    @State private var versionTaps = 0
    @State private var showHidden = false
    @State private var isAdmin = false

    private var isGuest: Bool { session.user?.isAnonymous == true }

    var body: some View {
        List {
            Section {
                Identity(user: session.user, name: session.profile?.displayName)
            }
            .brandRow()

            if isGuest {
                Section {
                    Button("Create your account") { showUpgrade = true }
                } footer: {
                    Text("Your shows stay with you. Your name, a public profile, friends, ticket scanning and anything other people see need an account.")
                }
                .brandRow()
            } else {
                ProfileSection()
                EmailPreferencesSection()
                BlockedAccountsLink()
            }

            PushSettingsSection()

            ConnectedAccountsSection(user: session.user)

            Section("Help") {
                Button("How to use MySetlists") { router.show(MeLinks.howToUse) }
                Button("Terms of Service") { router.show(Terms.url) }
                Button("Privacy Policy") { router.show(Terms.privacyURL) }
                Link("Contact support", destination: URL(string: "mailto:\(Terms.supportEmail)")!)
                Link("Request a copy of your data",
                     destination: ProfileSettings.dataRequestEmail(email: session.user?.email, uid: session.user?.uid))
            }
            .brandRow()

            Section {
                Button {
                    askThenSignOut()
                } label: {
                    HStack {
                        Text("Sign out")
                        if signingOut { Spacer(); ProgressView() }
                    }
                }
                .disabled(signingOut)
                // On the button, so on iPad and iOS 26 the popover points at it.
                .confirmationDialog("Sign out of your guest account?", isPresented: $confirmGuestSignOut, titleVisibility: .visible) {
                    Button("Sign out and lose my shows", role: .destructive) { signOut() }
                    Button("Create an account first") { showUpgrade = true }
                } message: {
                    Text("A guest account can't be signed back into. Create an account to keep your shows.")
                }
                // Sign-out clears the offline cache, unsynced writes with it.
                .alert(SignOutPrompt.unsyncedTitle, isPresented: $confirmUnsynced) {
                    Button("Stay signed in", role: .cancel) {}
                        .keyboardShortcut(.defaultAction)
                    Button("Sign out anyway", role: .destructive) { signOut() }
                }
                Button("Delete my account", role: .destructive) { showDelete = true }
                    .disabled(signingOut)
            }
            .brandRow()


            Section {
                LabeledContent("Version", value: "\(AppInfo.current.version) (\(AppInfo.current.build))")
                    .contentShape(Rectangle())
                    .onTapGesture {
                        // Hidden: five taps on the version.
                        versionTaps += 1
                        if versionTaps >= 5 { showHidden = true }
                    }
                if showHidden {
                    // Q-01, in every build (TestFlight is Release): what this
                    // install found on its first launch. No personal data.
                    NavigationLink("First-launch sign-in") { FirstLaunchReportView() }
                    if isAdmin {
                        // C-7: test pushes, for admins with the claim.
                        NavigationLink("Push") { PushDiagnosticsView() }
                    }
                    #if DEBUG
                    NavigationLink("Developer") { DeveloperSettingsView() }
                    #endif
                }
            }
            .brandRow()
        }
        .navigationTitle("Me")
        .task(id: showHidden) { if showHidden { isAdmin = await session.hasAdminClaim() } }
        .safeAreaInset(edge: .top, spacing: 0) { UpdateBanner() }
        .sheet(isPresented: $showUpgrade) { GuestUpgradeView() }
        .sheet(isPresented: $showDelete) { DeleteAccountView() }
    }

    /// A guest is always warned; an account only with changes that haven't
    /// synced (`SessionStore.signOutPrompt`).
    private func askThenSignOut() {
        signingOut = true
        Task {
            let prompt = await session.signOutPrompt()
            signingOut = false
            switch prompt {
            case .signOut: signOut()
            case .unsyncedChanges: confirmUnsynced = true
            case .guestLosesEverything: confirmGuestSignOut = true
            }
        }
    }

    private func signOut() {
        signingOut = true
        Task {
            // Never hangs (SignOutRunner); the gate then shows sign-in.
            await session.signOut()
            signingOut = false
        }
    }
}

/// Me → Blocked accounts, with how many (accounts only).
private struct BlockedAccountsLink: View {
    @Environment(FriendsStore.self) private var friends

    var body: some View {
        Section {
            NavigationLink { BlockedAccountsView().brandScreen() } label: {
                LabeledContent("Blocked accounts", value: friends.blockedUids.isEmpty ? "None" : "\(friends.blockedUids.count)")
            }
        }
        .brandRow()
    }
}

private struct Identity: View {
    let user: SessionStore.User?
    let name: String?

    var body: some View {
        HStack(spacing: Space.x4) {
            Image(systemName: user?.isAnonymous == true ? "person.crop.circle.badge.questionmark" : "person.crop.circle.fill")
                .font(.system(size: 44))
                .foregroundStyle(Color.brand)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Space.x1) {
                Text(title)
                    .font(.brand(.lg, weight: .semibold))
                if let subtitle {
                    Text(subtitle)
                        .font(.brand(.sm))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, Space.x1)
        .accessibilityElement(children: .combine)
    }

    var title: String {
        if user?.isAnonymous == true { return "Guest" }
        return name ?? user?.displayName ?? user?.email ?? "Signed in"
    }

    var subtitle: String? {
        if user?.isAnonymous == true { return "Your shows are kept on this guest account." }
        let provider = user?.isApple == true ? "Signed in with Apple"
            : user?.providerIDs.contains("google.com") == true ? "Signed in with Google" : nil
        let email = (title == user?.email) ? nil : user?.email
        return [email, provider].compactMap { $0 }.joined(separator: " · ").nilIfEmpty
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
