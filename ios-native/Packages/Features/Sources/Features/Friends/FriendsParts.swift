import Core
import DesignSystem
import SwiftUI

/// Someone the Friends screens can open: a friend, a request's sender, a
/// lookup result or a blocked account.
struct PersonRef: Identifiable, Hashable {
    let uid: String
    let name: String
    var handle: String?
    var id: String { uid }
}

/// A photo when there is one, else the first letter of the name.
struct PersonAvatar: View {
    let name: String
    var photoURL: String?
    var size: CGFloat = 40

    var body: some View {
        Group {
            if let photoURL, let url = URL(string: photoURL), url.scheme == "https" {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initial
                }
            } else {
                initial
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initial: some View {
        Circle()
            .fill(Color.brand.opacity(0.25))
            .overlay(
                Text(name.first.map { String($0).uppercased() } ?? "?")
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(Color.brand)
            )
    }
}

/// A short confirmation at the bottom of the screen for a few seconds,
/// read out by VoiceOver.
struct NoticeModifier: ViewModifier {
    @Binding var message: String?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let message {
                    Text(message)
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, Space.x4)
                        .padding(.vertical, Space.x3)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.horizontal, Space.x4)
                        .padding(.bottom, Space.x4)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .onTapGesture { self.message = nil }
                        .accessibilityAddTraits(.isStaticText)
                }
            }
            .animation(.default, value: message)
            .task(id: message) {
                guard let message else { return }
                AccessibilityNotification.Announcement(message).post()
                try? await Task.sleep(for: .seconds(4))
                if !Task.isCancelled, self.message == message { self.message = nil }
            }
    }
}

extension View {
    func notice(_ message: Binding<String?>) -> some View { modifier(NoticeModifier(message: message)) }
}

/// What blocking does, in the web's words (`UserProfileSheet`), shown
/// before every block (Guideline 1.2: the person should understand it).
enum BlockCopy {
    static func title(_ name: String) -> String { "Block \(name)?" }
    static let message = "Their activity disappears from your app straight away, and you won't appear to each other. If you're friends, that ends too. You can undo this in Me → Blocked accounts."
}
