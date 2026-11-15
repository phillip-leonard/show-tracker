import SwiftUI

/// The web's type scale (Tailwind `text-xs` … `text-4xl`) in Plus Jakarta
/// Sans, each scaled with Dynamic Type like the text style it stands in for
/// (docs/ios-native/FOUNDATION-AUDIT.md §1.6). Navigation and tab bar titles
/// keep the system font, so the platform's bars look native.
public enum TypeScale: CaseIterable, Sendable {
    case xs, sm, base, lg, xl, xl2, xl3, xl4

    public var size: CGFloat {
        switch self {
        case .xs: 12
        case .sm: 14
        case .base: 16
        case .lg: 18
        case .xl: 20
        case .xl2: 24
        case .xl3: 30
        case .xl4: 36
        }
    }

    public var textStyle: Font.TextStyle {
        switch self {
        case .xs: .caption
        case .sm: .subheadline
        case .base: .body
        case .lg, .xl: .title3
        case .xl2: .title2
        case .xl3: .title
        case .xl4: .largeTitle
        }
    }
}

public extension Font {
    /// The brand face at a step of the web's scale. `font-extrabold` maps to
    /// `.bold`: the variable font stops at 800, but the web never renders
    /// past 700.
    static func brand(_ step: TypeScale, weight: Font.Weight = .regular) -> Font {
        .jakarta(size: step.size, weight: weight, relativeTo: step.textStyle)
    }
}
