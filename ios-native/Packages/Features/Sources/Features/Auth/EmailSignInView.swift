import Core
import SwiftUI

/// Email and password: sign in, create an account (for a guest, add an email
/// and password to their guest account), or reset a forgotten password.
public struct EmailSignInView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    public enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign in"
        case create = "Create account"
        public var id: String { rawValue }
    }

    @State private var mode: Mode
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var showReset = false

    public init(mode: Mode = .signIn) { _mode = State(initialValue: mode) }

    private var isGuest: Bool { session.user?.isAnonymous == true }

    public var body: some View {
        NavigationStack {
            Form {
                if !isGuest {
                    Picker("", selection: $mode) {
                        ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(mode == .create || isGuest ? .newPassword : .password)
                } footer: {
                    if mode == .create || isGuest { Text("At least 6 characters.") }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                Section {
                    Button(action: submit) {
                        HStack {
                            Text(isGuest ? "Create account" : mode.rawValue)
                            if busy { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(busy || email.isEmpty || password.isEmpty)
                    if mode == .signIn && !isGuest {
                        Button("Forgot password?") { showReset = true }
                    }
                }
            }
            .navigationTitle(isGuest ? "Create your account" : "Email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .sheet(isPresented: $showReset) { PasswordResetView(email: email) }
        }
    }

    private func submit() {
        error = nil
        busy = true
        Task {
            defer { busy = false }
            do {
                if mode == .create || isGuest {
                    try await session.createAccount(email: email, password: password)
                } else {
                    try await session.signIn(email: email, password: password)
                }
                dismiss()
            } catch {
                let failure = AuthFailure.from(error)
                if failure == .credentialInUse { dismiss(); return } // the adoption sheet takes over
                self.error = failure.message
            }
        }
    }
}

/// "Forgot password": `send-password-reset` emails a link that opens the
/// website, where the new password is set (/reset/<token>, web only).
struct PasswordResetView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State var email: String
    @State private var sent = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if sent {
                    Section {
                        Text("If an account uses \(email), we've sent it a link to set a new password. It works for an hour.")
                    }
                } else {
                    Section {
                        TextField("Email", text: $email)
                            .keyboardType(.emailAddress)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } footer: {
                        Text("We'll email you a link to set a new password.")
                    }
                    if let error { Section { Text(error).foregroundStyle(.red) } }
                    Section {
                        Button("Send link") {
                            busy = true
                            Task {
                                defer { busy = false }
                                do {
                                    try await session.sendPasswordReset(email: email)
                                    sent = true
                                } catch {
                                    self.error = (error as? APIError)?.message ?? "That didn't go through. Try again."
                                }
                            }
                        }
                        .disabled(busy || email.isEmpty)
                    }
                }
            }
            .navigationTitle("Reset password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
