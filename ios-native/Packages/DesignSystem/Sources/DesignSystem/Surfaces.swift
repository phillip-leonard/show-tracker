import SwiftUI

/// System materials first (DECISIONS.md, "Design"): on iOS 26 and later a
/// card is Liquid Glass; on iOS 18 it's the web's surface color with its
/// subtle green border. Bars, tab bars, sheets and lists are left to the
/// system, which gives them glass on its own.
public extension View {
    /// A card: a grouped block of content on the app background.
    func brandCard(radius: CGFloat = Radius.xl) -> some View {
        modifier(BrandCard(radius: radius))
    }

    /// The app's background (`#2A2A4E`) behind views that don't draw their
    /// own: the sign-in and gate screens.
    func brandBackground() -> some View {
        background(Color.bgBase.ignoresSafeArea())
    }

    /// A screen in a NavigationStack: the app's background behind it, and a
    /// list's or form's own background hidden so it shows through. Rows go
    /// on the surface color with `brandRow()`, as the web's cards do.
    func brandScreen() -> some View {
        containerBackground(Color.bgBase, for: .navigation)
            .scrollContentBackground(.hidden)
    }

    /// A list or form row on the surface color (`#1F1F3A`). Apply to each
    /// Section.
    func brandRow() -> some View {
        listRowBackground(Color.surface)
    }
}

struct BrandCard: ViewModifier {
    let radius: CGFloat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle.brand(radius)
        if #available(iOS 26, *) {
            content
                .padding(Space.x4)
                .glassEffect(.regular, in: shape)
        } else {
            content
                .padding(Space.x4)
                .background(Color.surface, in: shape)
                .overlay(shape.strokeBorder(Color.borderSubtle))
        }
    }
}
