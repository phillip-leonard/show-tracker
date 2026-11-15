import SwiftUI

/// The shipped web app's colors (app/globals.css, decision D-5), from this
/// package's asset catalog (`Resources/Colors.xcassets`). Dark only in v1;
/// each color set has a dark appearance, so a light theme can be added in
/// the catalog later without code changes.
///
/// The table they come from is `fixtures/design/tokens.json`: the catalog is
/// checked against it in DesignSystemTests, and globals.css in
/// lib/__tests__/designTokens.test.js.
public enum BrandColor: String, CaseIterable, Sendable {
    case brand, brandLight, brandSubtle
    case amber, amberLight, amberSubtle
    case accentPurple
    case bgBase, surface, surfaceHover
    case textPrimary, textSecondary, textMuted
    case borderSubtle, borderActive
    case success, danger

    /// The bundle holding `Colors.xcassets`.
    public static let bundle = Bundle.module

    public var color: Color { Color(rawValue, bundle: Self.bundle) }
    public func uiColor(_ traits: UITraitCollection? = nil) -> UIColor {
        UIColor(named: rawValue, in: Self.bundle, compatibleWith: traits) ?? .magenta
    }
}

public extension Color {
    /// Brand green `#10B981`: the app's tint, links, primary actions.
    static let brand = BrandColor.brand.color
    static let brandLight = BrandColor.brandLight.color
    /// Brand green at 12%: selected chips, subtle highlights.
    static let brandSubtle = BrandColor.brandSubtle.color
    /// Amber `#FFB700`: ratings and highlights.
    static let amber = BrandColor.amber.color
    static let amberLight = BrandColor.amberLight.color
    static let amberSubtle = BrandColor.amberSubtle.color
    /// Purple `#D946EF`. Named so it can't be mistaken for `Color.accentColor`.
    static let accentPurple = BrandColor.accentPurple.color
    /// The root background on iOS 18 (`#2A2A4E`); behind materials on iOS 26.
    static let bgBase = BrandColor.bgBase.color
    /// Cards, sheets, the sidebar (`#1F1F3A`).
    static let surface = BrandColor.surface.color
    /// Pressed and selected rows (`#35355E`).
    static let surfaceHover = BrandColor.surfaceHover.color
    static let textPrimary = BrandColor.textPrimary.color
    static let textSecondary = BrandColor.textSecondary.color
    static let textMuted = BrandColor.textMuted.color
    static let borderSubtle = BrandColor.borderSubtle.color
    static let borderActive = BrandColor.borderActive.color
    static let success = BrandColor.success.color
    /// The destructive role's color (`#E05555`).
    static let danger = BrandColor.danger.color
}
