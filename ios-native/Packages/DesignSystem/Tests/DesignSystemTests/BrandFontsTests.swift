import CoreText
import Testing
import UIKit
@testable import DesignSystem

@Suite struct BrandFontsTests {
    @Test func registersTheFamilyWithRomanAndItalic() {
        BrandFonts.register()
        BrandFonts.register() // a second call is harmless
        let names = UIFont.fontNames(forFamilyName: BrandFonts.family)
        #expect(!names.isEmpty, "Plus Jakarta Sans is not registered")
    }

    /// The weights the web app uses (font-medium, -semibold, -bold, -extrabold)
    /// all resolve to this family, not a fallback.
    @Test(arguments: [UIFont.Weight.regular, .medium, .semibold, .bold, .heavy])
    func resolvesWeight(_ weight: UIFont.Weight) {
        BrandFonts.register()
        let descriptor = UIFontDescriptor(fontAttributes: [
            .family: BrandFonts.family,
            .traits: [UIFontDescriptor.TraitKey.weight: weight],
        ])
        let font = UIFont(descriptor: descriptor, size: 17)
        #expect(font.familyName == BrandFonts.family)
    }
}
