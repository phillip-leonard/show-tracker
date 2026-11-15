import AuthenticationServices
import Core
import DesignSystem
import GoogleSignInSwift
import SwiftUI

/// The signed-out screen: agree to the terms, then Apple, Google, email or
/// "Continue as guest". Every way in stays disabled until the box is ticked
/// (Guideline 1.2; components/auth/AuthModal.js on the web).
public struct SignInView: View {
    @Environment(SessionStore.self) private var session
    @State private var busy = false
    @State private var error: String?
    @State private var showEmail = false
    @State private var showReset = false
    /// Someone coming from the Capacitor app whose sign-in didn't carry over
    /// (Apple and email, Q-01). Read once, when the screen appears.
    @State private var welcomeBack = WelcomeBack.shouldShow()

    public init() {}

    public var body: some View {
        @Bindable var session = session
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text("MySetlists")
                        .font(.jakarta(size: 34, weight: .bold, relativeTo: .largeTitle))
                    Text("Every show you've seen, every song you've heard.")
                        .font(.jakarta(size: 16, relativeTo: .body))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 48)

                if welcomeBack {
                    VStack(spacing: 6) {
                        Text(WelcomeBack.title)
                            .font(.jakarta(size: 20, weight: .semibold, relativeTo: .title3))
                        Text(WelcomeBack.message)
                            .font(.jakarta(size: 16, relativeTo: .body))
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(16)
                    .brandCard()
                    .accessibilityElement(children: .combine)
                }

                TermsAgreement(ticked: $session.termsTicked)

                VStack(spacing: 12) {
                    AppleIDButton { run { try await session.signInWithApple() } }
                        .frame(height: 50)
                        .opacity(session.termsTicked ? 1 : 0.4)
                        .allowsHitTesting(session.termsTicked && !busy)
                        .accessibilityLabel("Sign in with Apple")

                    // Google's own disabled state draws only the "G" on a dark
                    // background, so it's dimmed like the Apple button instead.
                    GoogleSignInButton(scheme: .dark, style: .wide, state: .normal) {
                        run { try await session.signInWithGoogle() }
                    }
                    .frame(height: 50)
                    .opacity(session.termsTicked ? 1 : 0.4)
                    .allowsHitTesting(session.termsTicked && !busy)

                    Button {
                        showEmail = true
                    } label: {
                        Label("Continue with email", systemImage: "envelope")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .disabled(!session.termsTicked || busy)

                    // On the first screen, not only inside the email sheet:
                    // someone signing in again after the update may not
                    // remember the password (Q-01). Needs no terms tick.
                    Button("Forgot your password?") { showReset = true }
                        .font(.footnote)
                        .frame(minHeight: 44)
                        .disabled(busy)

                    Button("Continue as guest") {
                        run { try await session.continueAsGuest() }
                    }
                    .frame(minHeight: 44)
                    .disabled(!session.termsTicked || busy)
                }

                if busy { ProgressView() }
                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                Text("Guests keep their shows on this account until they sign up. Ticket scanning, friends and anything other people see need an account.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                LegalLinks()
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .sheet(isPresented: $showEmail) {
            EmailSignInView()
        }
        .sheet(isPresented: $showReset) {
            PasswordResetView(email: "")
        }
    }

    private func run(_ work: @escaping @MainActor () async throws -> Void) {
        error = nil
        busy = true
        Task {
            defer { busy = false }
            do { try await work() } catch {
                let failure = AuthFailure.from(error)
                self.error = failure.message
            }
        }
    }
}

/// The unticked "I agree" box, with the Terms and Privacy links.
struct TermsAgreement: View {
    @Binding var ticked: Bool

    var body: some View {
        Toggle(isOn: $ticked) {
            Text("I agree to the [Terms of Service](\(Terms.url.absoluteString)) and [Privacy Policy](\(Terms.privacyURL.absoluteString)), including zero tolerance for objectionable content and abusive users.")
                .font(.footnote)
        }
        .toggleStyle(CheckboxToggleStyle())
    }
}

/// A checkbox: a toggle that reads as "I agree", not as a setting.
struct CheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(configuration.isOn ? Color.accentColor : .secondary)
                configuration.label
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(.primary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    }
}

struct LegalLinks: View {
    var body: some View {
        HStack(spacing: 16) {
            Link("Terms", destination: Terms.url)
            Link("Privacy", destination: Terms.privacyURL)
            Link("Support", destination: URL(string: "mailto:\(Terms.supportEmail)")!)
        }
        .font(.footnote)
        .padding(.bottom, 24)
    }
}

/// Apple's own button (Human Interface Guidelines), driving Core's flow.
struct AppleIDButton: UIViewRepresentable {
    var type: ASAuthorizationAppleIDButton.ButtonType = .signIn
    let action: () -> Void

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(authorizationButtonType: type, authorizationButtonStyle: .white)
        button.addTarget(context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
        return button
    }

    func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {
        context.coordinator.action = action
    }

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func tapped() { action() }
    }
}
