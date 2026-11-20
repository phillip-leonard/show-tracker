import Core
import DesignSystem
import SwiftUI

enum MeLinks {
    static let howToUse = URL(string: "https://mysetlists.net/how-to-use")!
}

/// Name, handle, photo, public profile, activity sharing and the
/// leaderboard: accounts only,
/// as on the web's Profile page. Values come from the live profile
/// (`SessionStore.profile`), so a change made on the web shows here too.
struct ProfileSection: View {
    @Environment(SessionStore.self) private var session

    private var settings: ProfileSettings { ProfileSettings(api: session.api) }
    private var profile: UserProfile? { session.profile }
    private var uid: String? { session.user?.uid }

    var body: some View {
        Section {
            NavigationLink {
                NameEditor(current: profile?.displayName ?? session.user?.displayName ?? "")
            } label: {
                LabeledContent("Name", value: profile?.displayName ?? "Not set")
            }
            if let handle = profile?.handle {
                LabeledContent("Handle", value: "@\(handle)")
            } else {
                NavigationLink { HandleClaim() } label: { LabeledContent("Handle", value: "Not set") }
            }
            NavigationLink {
                PhotoURLEditor(current: profile?.photoURL ?? "")
            } label: {
                LabeledContent("Photo", value: (profile?.photoURL ?? "").isEmpty ? "None" : "Web address")
            }
        } header: {
            Text("Profile")
        } footer: {
            Text("Your name appears next to anything you share. It goes through the same filter as comments.")
        }
        .brandRow()

        Section {
            Toggle("Make my profile public", isOn: Binding(
                get: { profile?.publicProfile == true },
                set: { on in if let uid { settings.setPublicProfile(on, uid: uid) } }
            ))
            .disabled(profile?.handle == nil)
            .tint(.brand)
            if profile?.publicProfile == true, let handle = profile?.handle, let url = ProfileSettings.publicProfileURL(handle: handle) {
                Link(destination: url) {
                    Label("mysetlists.net/u/\(handle.lowercased())", systemImage: "globe")
                }
                ShareLink("Share your page", item: url)
            }
        } header: {
            Text("Public profile")
        } footer: {
            if profile?.handle == nil {
                Text("Claim a handle first. Your page would be mysetlists.net/u/your-handle.")
            } else if profile?.publicProfile == true {
                Text("Your profile is public. Anyone with the link can see the shows, dates, venues, artists and setlists you've logged, and your own ratings.")
            } else {
                Text("Off by default. Turning it on makes your page visible to anyone with the link: your shows, dates, venues, artists, setlists and your own ratings. Never your notes.")
            }
        }
        .brandRow()

        Section {
            Toggle("Show my activity to friends", isOn: Binding(
                get: { profile?.shareActivity ?? true },
                set: { on in if let uid { settings.setShareActivity(on, uid: uid) } }
            ))
            .tint(.brand)
        } header: {
            Text("Activity feed")
        } footer: {
            Text("When you add or rate a show, comment on one or share a photo, your friends see it in their activity. Never your notes. Turn this off and your friends stop seeing your activity, past entries included.")
        }
        .brandRow()

        Section {
            Toggle("Show me on the community leaderboard", isOn: Binding(
                get: { profile?.showOnLeaderboard ?? true },
                set: { on in if let uid { settings.setShowOnLeaderboard(on, uid: uid) } }
            ))
            .tint(.brand)
        } footer: {
            Text("The Community page lists the people with the most shows and the most rated songs, by first name. Turn this off to leave those lists. Your own rank stays on your Stats.")
        }
        .brandRow()
    }
}

/// The display name, through `moderate-content`.
struct NameEditor: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    let current: String
    @State private var name = ""
    @State private var saving = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    var body: some View {
        Form {
            Section {
                TextField("Your name", text: $name)
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { Task { await save() } }
            } footer: {
                if let problem { Text(problem).foregroundStyle(Color.amber) }
                else { Text("Shown next to anything you share, and to friends.") }
            }
            .brandRow()
        }
        .brandScreen()
        .navigationTitle("Name")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button { Task { await save() } } label: { if saving { ProgressView() } else { Text("Save") } }
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty || name == current)
            }
        }
        .onAppear { name = current; focused = true }
    }

    private func save() async {
        guard !saving else { return }
        saving = true
        focused = false
        defer { saving = false }
        do {
            _ = try await ProfileSettings(api: session.api).setDisplayName(name)
            dismiss()
        } catch {
            problem = error.message
        }
    }
}

/// Claims the public handle, once.
struct HandleClaim: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var handle = ""
    @State private var saving = false
    @State private var problem: String?
    @State private var confirming = false
    @FocusState private var focused: Bool

    var body: some View {
        Form {
            Section {
                HStack(spacing: 2) {
                    Text("@").foregroundStyle(Color.textMuted)
                    TextField("pick-a-handle", text: $handle)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { if !handle.isEmpty { confirming = true } }
                }
            } footer: {
                VStack(alignment: .leading, spacing: Space.x1) {
                    if let problem { Text(problem).foregroundStyle(Color.amber) }
                    Text("3–20 characters: lowercase letters, numbers and underscores. It can't be changed once it's set, so choose carefully.")
                }
            }
            .brandRow()
        }
        .brandScreen()
        .navigationTitle("Handle")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button { confirming = true } label: { if saving { ProgressView() } else { Text("Claim") } }
                    .disabled(saving || handle.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .confirmationDialog("Claim @\(handle.trimmingCharacters(in: .whitespaces))?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Claim it") { Task { await claim() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("A handle can't be changed later.")
        }
        .onAppear { focused = true }
    }

    private func claim() async {
        guard !saving else { return }
        saving = true
        focused = false
        defer { saving = false }
        do {
            _ = try await ProfileSettings(api: session.api).claimHandle(handle)
            dismiss()
        } catch {
            problem = error.message
        }
    }
}

/// The photo as a web address, as the web has it (no upload, C-6).
struct PhotoURLEditor: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    let current: String
    @State private var url = ""
    @State private var problem: String?
    @State private var saving = false
    @FocusState private var focused: Bool

    var body: some View {
        Form {
            Section {
                TextField("https://…", text: $url)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { Task { await save() } }
                if let preview = URL(string: url.trimmingCharacters(in: .whitespaces)), preview.scheme?.hasPrefix("http") == true {
                    AsyncImage(url: preview) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.surfaceHover
                    }
                    .frame(width: 72, height: 72)
                    .clipShape(Circle())
                    .accessibilityLabel("Photo preview")
                }
            } footer: {
                if let problem { Text(problem).foregroundStyle(Color.amber) }
                else { Text("A link to a picture already online. Leave it empty for no photo.") }
            }
            .brandRow()
        }
        .brandScreen()
        .navigationTitle("Photo")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button { Task { await save() } } label: { if saving { ProgressView() } else { Text("Save") } }
                    .disabled(saving || url == current)
            }
        }
        .onAppear { url = current; focused = true }
    }

    private func save() async {
        guard !saving, let uid = session.user?.uid else { return }
        saving = true
        focused = false
        defer { saving = false }
        do {
            try await ProfileSettings(api: session.api).setPhotoURL(url, uid: uid)
            dismiss()
        } catch {
            problem = error.message
        }
    }
}

/// The two email switches, from `update-email-preferences` (the server's
/// answer wins: it counts an unsubscribe from before the account existed).
struct EmailPreferencesSection: View {
    @Environment(SessionStore.self) private var session
    @State private var prefs: ProfileSettings.EmailPreferences?
    @State private var saving = false
    @State private var problem: String?

    private var settings: ProfileSettings { ProfileSettings(api: session.api) }

    var body: some View {
        if session.user?.email != nil {
            Section {
                if let prefs {
                    Toggle(isOn: Binding(get: { prefs.announcements }, set: { on in change(.announcements, on) })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Product news & announcements")
                            Text(prefs.emailOptOut ? "Off because all emails are turned off." : "New features, app releases and other news from MySetlists. Only occasionally.")
                                .font(.jakarta(size: 12, relativeTo: .caption))
                                .foregroundStyle(Color.textSecondary)
                        }
                    }
                    .disabled(saving || prefs.emailOptOut)
                    .tint(.brand)
                    Toggle(isOn: Binding(get: { prefs.allEmails }, set: { on in change(.allEmails, on) })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("All emails")
                            Text("Tags, invites, replies and other activity emails, plus announcements. Turn this off to stop every email from MySetlists. Essential account emails (password resets) will still be sent.")
                                .font(.jakarta(size: 12, relativeTo: .caption))
                                .foregroundStyle(Color.textSecondary)
                        }
                    }
                    .disabled(saving)
                    .tint(.brand)
                } else if problem == nil {
                    HStack { Text("Loading your email settings"); Spacer(); ProgressView() }
                        .foregroundStyle(Color.textSecondary)
                }
            } header: {
                Text("Email")
            } footer: {
                if let problem {
                    HStack {
                        Text(problem)
                        if prefs == nil { Button("Try again") { Task { await load() } } }
                    }
                }
            }
            .brandRow()
            .task { await load() }
        }
    }

    private func load() async {
        problem = nil
        do throws(ProfileSettingError) {
            prefs = try await settings.emailPreferences()
            problem = nil
        } catch {
            problem = Self.describe(error, saving: false)
        }
    }

    /// What to say when loading or saving fails: nothing for a cancelled
    /// request (the section went off screen), else a sentence that says
    /// what didn't happen.
    static func describe(_ error: ProfileSettingError, saving: Bool) -> String? {
        switch error {
        case .cancelled:
            return nil
        case .offline:
            return saving ? "You're offline, so that change wasn't saved. Connect and try again."
                          : "You're offline. Your email settings load when you're connected."
        case .invalid(let message), .refused(let message):
            return message
        case .accountRequired:
            return error.message
        case .failed:
            return saving ? "Couldn't save that change. Try again." : "Couldn't load your email settings. Try again."
        }
    }

    private enum Switch { case allEmails, announcements }

    private func change(_ which: Switch, _ on: Bool) {
        let settings = self.settings
        Task {
            saving = true
            defer { saving = false }
            problem = nil
            do throws(ProfileSettingError) {
                switch which {
                case .allEmails: prefs = try await settings.setAllEmails(on)
                case .announcements: prefs = try await settings.setAnnouncements(on)
                }
                problem = nil
            } catch {
                problem = Self.describe(error, saving: true)
            }
        }
    }
}

/// Which sign-in methods this account has. Linking another isn't offered
/// yet; a guest links one by creating an account.
struct ConnectedAccountsSection: View {
    let user: SessionStore.User?

    private var methods: [(name: String, symbol: String, detail: String?)] {
        guard let user else { return [] }
        var list: [(String, String, String?)] = []
        if user.providerIDs.contains("apple.com") { list.append(("Apple", "apple.logo", nil)) }
        if user.providerIDs.contains("google.com") { list.append(("Google", "g.circle", nil)) }
        if user.providerIDs.contains("password") { list.append(("Email and password", "envelope", user.email)) }
        return list
    }

    var body: some View {
        Section {
            if user?.isAnonymous == true {
                Label("None yet: this is a guest account", systemImage: "person.crop.circle.badge.questionmark")
                    .foregroundStyle(Color.textSecondary)
            } else {
                ForEach(methods, id: \.name) { method in
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(method.name)
                            if let detail = method.detail {
                                Text(detail).font(.jakarta(size: 12, relativeTo: .caption)).foregroundStyle(Color.textSecondary)
                            }
                        }
                    } icon: {
                        Image(systemName: method.symbol).foregroundStyle(Color.brand)
                    }
                }
            }
        } header: {
            Text("Signed in with")
        }
        .brandRow()
    }
}
