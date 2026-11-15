import Core
import GoogleSignInSwift
import SwiftUI

/// A guest turns their guest account into a real one: Apple, Google or
/// email, linked to the same uid so every show stays.
public struct GuestUpgradeView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?
    @State private var showEmail = false

    public init() {}

    public var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Keep your shows, and add friends, ticket scanning and everything other people can see.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                AppleIDButton(type: .continue) { run { try await session.signInWithApple() } }
                    .frame(height: 50)
                    .allowsHitTesting(!busy)
                GoogleSignInButton(scheme: .dark, style: .wide, state: .normal) {
                    run { try await session.signInWithGoogle() }
                }
                .frame(height: 50)
                .allowsHitTesting(!busy)
                Button {
                    showEmail = true
                } label: {
                    Label("Use email and a password", systemImage: "envelope").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                if busy { ProgressView() }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Spacer()
            }
            .padding(24)
            .navigationTitle("Create your account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Not now") { dismiss() } } }
            .sheet(isPresented: $showEmail, onDismiss: dismissIfUpgraded) { EmailSignInView(mode: .create) }
        }
    }

    private func dismissIfUpgraded() {
        if session.user?.isAnonymous == false || session.adoption != nil { dismiss() }
    }

    private func run(_ work: @escaping @MainActor () async throws -> Void) {
        error = nil
        busy = true
        Task {
            defer { busy = false }
            do {
                try await work()
                dismiss()
            } catch {
                let failure = AuthFailure.from(error)
                if failure == .credentialInUse { dismiss(); return } // AdoptionView takes over
                self.error = failure.message
            }
        }
    }
}

/// The sign-in a guest chose already has an account (D-4): sign in to it
/// and move the guest's shows across. Duplicates stay with the account; a
/// "possible" match moves only if the person picks it.
public struct AdoptionView: View {
    @Environment(SessionStore.self) private var session
    @State private var busy = false
    @State private var error: String?
    @State private var picked: Set<String> = []
    @State private var result: AdoptGuestShowsResult?

    public init() {}

    public var body: some View {
        NavigationStack {
            Form {
                if let result {
                    Section {
                        Text("Moved \(result.moved) show\(result.moved == 1 ? "" : "s") into your account.")
                        if result.duplicates > 0 { Text("\(result.duplicates) were already there.") }
                    }
                } else if let preview = session.adoption?.preview {
                    Section {
                        Text("\(preview.move) guest show\(preview.move == 1 ? "" : "s") will move into this account.")
                        if !preview.duplicates.isEmpty {
                            Text("\(preview.duplicates.count) already logged here will stay as they are.")
                        }
                        if preview.upcoming > 0 { Text("\(preview.upcoming) upcoming show\(preview.upcoming == 1 ? "" : "s") too.") }
                    }
                    if !preview.possible.isEmpty {
                        Section("Same band, same night, a different venue name. Move these too?") {
                            ForEach(preview.possible, id: \.guestShowId) { match in
                                Toggle(isOn: Binding(get: { picked.contains(match.guestShowId) },
                                                     set: { on in if on { picked.insert(match.guestShowId) } else { picked.remove(match.guestShowId) } })) {
                                    VStack(alignment: .leading) {
                                        Text(match.artist)
                                        Text("\(match.venue) · \(ShowDate.isoDay(match.date))").font(.footnote).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                    Section {
                        Button("Move my shows") { commit() }.disabled(busy)
                    }
                } else {
                    Section {
                        Text("That sign-in already has a MySetlists account. Sign in to it, and we'll bring the shows you logged as a guest.")
                        Button("Sign in and bring my shows") { start() }.disabled(busy)
                    }
                }
                if busy { Section { ProgressView() } }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("You already have an account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(result == nil ? "Cancel" : "Done") { session.cancelAdoption(); result = nil }
                }
            }
        }
    }

    private func start() {
        error = nil
        busy = true
        Task {
            defer { busy = false }
            do { try await session.startAdoption() } catch { self.error = AuthFailure.from(error).message }
        }
    }

    private func commit() {
        error = nil
        busy = true
        Task {
            defer { busy = false }
            do { result = try await session.commitAdoption(includePossible: Array(picked)) } catch { self.error = AuthFailure.from(error).message }
        }
    }
}

/// Deleting the account and everything in it. Reachable from Me, and from
/// the update-required screen.
public struct DeleteAccountView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?

    public init() {}

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This permanently deletes your account, every show, rating and photo, your friends list and everything else you've added. It can't be undone.")
                    if session.user?.isApple == true {
                        Text("Apple will ask you to confirm, so we can also remove MySetlists from your Apple ID.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section {
                    Button(role: .destructive) {
                        busy = true
                        error = nil
                        Task {
                            defer { busy = false }
                            do {
                                try await session.deleteAccount()
                                dismiss()
                            } catch {
                                let failure = AuthFailure.from(error)
                                self.error = failure == .cancelled ? "Deletion cancelled. Confirm with Apple to delete your account." : failure.message
                            }
                        }
                    } label: {
                        HStack { Text("Delete my account"); if busy { Spacer(); ProgressView() } }
                    }
                    .disabled(busy)
                }
            }
            .navigationTitle("Delete account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) } }
        }
    }
}

/// Until the tab shell (Part 6): who is signed in, and the account actions
/// that must always be reachable.
struct AccountHomeView: View {
    @Environment(SessionStore.self) private var session
    @State private var showUpgrade = false
    @State private var showDelete = false
    @State private var confirmGuestSignOut = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let user = session.user {
                        LabeledContent("Signed in", value: user.isAnonymous ? "As a guest" : (user.email ?? session.profile?.displayName ?? "Yes"))
                        if let name = session.profile?.displayName { LabeledContent("Name", value: name) }
                    }
                }
                if session.user?.isAnonymous == true {
                    Section {
                        Button("Create your account") { showUpgrade = true }
                    } footer: {
                        Text("Your shows stay with you. Friends, ticket scanning and anything other people see need an account.")
                    }
                }
                Section {
                    Button("Sign out") {
                        if session.user?.isAnonymous == true { confirmGuestSignOut = true } else { Task { await session.signOut() } }
                    }
                    Button("Delete my account", role: .destructive) { showDelete = true }
                }
            }
            .navigationTitle("MySetlists")
            .safeAreaInset(edge: .bottom) { UpdateBanner() }
            .sheet(isPresented: $showUpgrade) { GuestUpgradeView() }
            .sheet(isPresented: $showDelete) { DeleteAccountView() }
            .confirmationDialog("Sign out of your guest account?", isPresented: $confirmGuestSignOut, titleVisibility: .visible) {
                Button("Sign out and lose my shows", role: .destructive) { Task { await session.signOut() } }
                Button("Create an account first") { showUpgrade = true }
            } message: {
                Text("A guest account can't be signed back into. Create an account to keep your shows.")
            }
        }
    }
}

/// The app's root: whichever gate applies, or the app.
public struct AppRootView: View {
    @Environment(SessionStore.self) private var session
    public init() {}

    public var body: some View {
        Group {
            switch session.gate {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .updateRequired:
                UpdateRequiredView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut:
                SignInView()
            case .suspended:
                SuspendedView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .termsRequired:
                TermsGateView()
            case .ready:
                AccountHomeView()
            }
        }
        .sheet(isPresented: Binding(get: { session.adoption != nil }, set: { if !$0 { session.cancelAdoption() } })) {
            AdoptionView()
        }
    }
}
