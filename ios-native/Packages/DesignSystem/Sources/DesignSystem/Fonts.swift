import CoreText
import SwiftUI

/// Plus Jakarta Sans, the brand typeface, bundled as Google Fonts' variable
/// TTFs (weights 200 to 800, roman and italic; SIL Open Font License, see
/// Resources/Fonts/OFL.txt). Registered from this package's bundle, so the
/// app's Info.plist needs no `UIAppFonts` entry.
public enum BrandFonts {
    static let files = [
        "PlusJakartaSans-VariableFont_wght",
        "PlusJakartaSans-Italic-VariableFont_wght",
    ]

    /// The family name the fonts register under.
    public static let family = "Plus Jakarta Sans"

    /// Registers the fonts for this process. Safe to call more than once.
    /// Call at launch, before any view uses `Font.jakarta`.
    public static func register() {
        for name in files {
            guard let url = Bundle.module.url(forResource: name, withExtension: "ttf") else {
                assertionFailure("Missing font \(name).ttf in DesignSystem's resources")
                continue
            }
            // An "already registered" error on a second call is expected.
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

public extension Font {
    /// Plus Jakarta Sans at `size`, scaled with Dynamic Type like `relativeTo`.
    static func jakarta(size: CGFloat, weight: Font.Weight = .regular, relativeTo textStyle: Font.TextStyle = .body) -> Font {
        .custom(BrandFonts.family, size: size, relativeTo: textStyle).weight(weight)
    }
}
