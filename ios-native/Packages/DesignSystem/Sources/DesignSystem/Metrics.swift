import SwiftUI

/// Tailwind's 4pt spacing scale, as the web uses it (`p-1` = 4 … `p-8` = 32).
public enum Space {
    public static let x1: CGFloat = 4
    public static let x2: CGFloat = 8
    public static let x3: CGFloat = 12
    public static let x4: CGFloat = 16
    public static let x5: CGFloat = 20
    public static let x6: CGFloat = 24
    public static let x8: CGFloat = 32
}

/// The web's corner radii, by use: `rounded-xl` 12 is the default card.
/// Use with `style: .continuous` (`RoundedRectangle.brand(_:)`).
public enum Radius {
    /// `rounded-lg`: chips, small buttons.
    public static let lg: CGFloat = 8
    /// `rounded-xl`: cards and rows, the most used.
    public static let xl: CGFloat = 12
    /// `rounded-2xl`: large cards, the app icon tile.
    public static let xl2: CGFloat = 16
    /// `rounded-3xl`: sheets and hero panels.
    public static let xl3: CGFloat = 24
}

/// The minimum tap target (`min-h-touch`, Apple's 44pt).
public enum TouchTarget {
    public static let minimum: CGFloat = 44
}

public extension RoundedRectangle {
    /// A continuous-corner rectangle at one of the `Radius` sizes.
    static func brand(_ radius: CGFloat = Radius.xl) -> RoundedRectangle {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
    }
}
