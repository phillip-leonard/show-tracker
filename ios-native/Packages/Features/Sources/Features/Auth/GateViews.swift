import Core
import DesignSystem
import SwiftUI

/// An account that hasn't accepted the current Terms (one created before
/// the gate existed, or after `Terms.version` is bumped). Replaces the app
/// until they agree (app/AppProviderWrapper.jsx TermsGate).
public struct TermsGateView: View {
    @Environment(SessionStore.self) private var session
    @State private var busy = false
    @State private var error: String?

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Community Guidelines")
                    .font(.jakarta(size: 28, weight: .bold, relativeTo: .title))
                Text("To keep using MySetlists, please agree to our Terms of Service.")
                    .foregroundStyle(.secondary)
                ForEach(Terms.summary, id: \.title) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title).font(.headline)
                        Text(item.body).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Link("Read the full Terms of Service", destination: Terms.url)
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
                Button {
                    busy = true
                    Task {
                        defer { busy = false }
                        do { try await session.acceptTerms() } catch { self.error = "That didn't save. Check your connection and try again." }
                    }
                } label: {
                    Text("I agree").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy)
                Button("Sign out") { Task { await session.signOut() } }
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .padding(24)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
    }
}

/// `userProfiles.banned`: the account was ejected for breaking the
/// Community Guidelines (components/auth/SuspendedScreen.jsx). Ahead of the
/// terms gate.
public struct SuspendedView: View {
    @Environment(SessionStore.self) private var session
    @State private var showDelete = false
    public init() {}

    public var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "shield.slash").font(.system(size: 40)).foregroundStyle(.red)
            Text("Your account has been suspended")
                .font(.jakarta(size: 22, weight: .bold, relativeTo: .title2))
                .multilineTextAlignment(.center)
            Text("This account was suspended for breaking the [Community Guidelines](\(Terms.url.absoluteString)). Its posts have been removed and it can no longer be used.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Text("If you think this was a mistake, email [\(Terms.supportEmail)](mailto:\(Terms.supportEmail)) and we'll look at it again.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Sign out") { Task { await session.signOut() } }
                .buttonStyle(.bordered)
                .frame(minHeight: 44)
            // Deletion stays reachable (Guideline 5.1.1(v); Stage 2). A
            // suspended account can't sign in again, so it works only while
            // this session lasts; after that it goes through support.
            Button("Delete my account", role: .destructive) { showDelete = true }
                .frame(minHeight: 44)
            Text("You can delete this account now, while you're still signed in. After you sign out, email [\(Terms.supportEmail)](mailto:\(Terms.supportEmail)) to delete it or to get a copy of your data.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(maxWidth: 480)
        .sheet(isPresented: $showDelete) { DeleteAccountView() }
    }
}

/// A build below `config/app.minSupportedIosVersion`: can't be dismissed,
/// but account deletion stays reachable (Guideline 5.1.1(v)).
public struct UpdateRequiredView: View {
    @Environment(SessionStore.self) private var session
    @State private var showDelete = false
    public init() {}

    public var body: some View {
        VStack(spacing: 16) {
            Text("Please update MySetlists")
                .font(.jakarta(size: 22, weight: .bold, relativeTo: .title2))
            Text("This version of the app is no longer supported. Update to keep using MySetlists. Your shows are safe in your account.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            if let reason = session.appConfig?.reason {
                Text(reason).font(.footnote).multilineTextAlignment(.center).foregroundStyle(.secondary)
            }
            Link(destination: AppVersion.appStoreURL) {
                Text("Update on the App Store").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            if session.signedIn == true {
                Button("Delete my account") { showDelete = true }
                    .font(.footnote)
                    .frame(minHeight: 44)
            }
        }
        .padding(24)
        .frame(maxWidth: 420)
        .sheet(isPresented: $showDelete) { DeleteAccountView() }
    }
}

/// A build below `config/app.latestIosVersion`: a banner, dismissed per
/// version (a newer release shows it again).
public struct UpdateBanner: View {
    @Environment(SessionStore.self) private var session
    @AppStorage("updateBannerDismissed") private var dismissedVersion = ""
    public init() {}

    public var body: some View {
        if session.versionStatus == .update, let latest = session.appConfig?.latestIosVersion, dismissedVersion != latest {
            HStack(spacing: 12) {
                Text("A new version of MySetlists is available.")
                    .font(.subheadline)
                Spacer(minLength: 0)
                Link("Update", destination: AppVersion.appStoreURL)
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
                Button {
                    dismissedVersion = latest
                } label: {
                    Image(systemName: "xmark")
                }
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Dismiss")
            }
            .padding(.horizontal, 16)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.horizontal, 16)
        }
    }
}
