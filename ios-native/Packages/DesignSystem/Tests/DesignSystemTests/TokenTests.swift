import Foundation
import Testing
import UIKit
@testable import DesignSystem

/// The asset catalog against `fixtures/design/tokens.json` (bundled as
/// DesignTokens.json, a symlink), the table app/globals.css is checked
/// against too (lib/__tests__/designTokens.test.js).
@Suite struct TokenTests {
    struct Table: Decodable {
        struct Token: Decodable { let name: String; let css: String; let hex: String; let alpha: Double }
        let colors: [Token]
    }

    static func table() throws -> Table {
        let url = try #require(Bundle.module.url(forResource: "DesignTokens", withExtension: "json"))
        return try JSONDecoder().decode(Table.self, from: Data(contentsOf: url))
    }

    @Test func everyTokenIsInTheCatalogAndTheEnum() throws {
        let names = Set(try Self.table().colors.map(\.name))
        #expect(names == Set(BrandColor.allCases.map(\.rawValue)))
    }

    @Test func catalogMatchesTheWeb() throws {
        let dark = UITraitCollection(userInterfaceStyle: .dark)
        for token in try Self.table().colors {
            let color = try #require(UIColor(named: token.name, in: BrandColor.bundle, compatibleWith: dark), "\(token.name) missing")
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            #expect(color.getRed(&r, green: &g, blue: &b, alpha: &a))
            let hex = String(format: "#%02X%02X%02X", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
            #expect(hex == token.hex.uppercased(), "\(token.name) (\(token.css))")
            #expect(abs(Double(a) - token.alpha) < 0.002, "\(token.name) (\(token.css)) alpha")
        }
    }

    @Test func typeScaleIsTheWebs() {
        #expect(TypeScale.allCases.map(\.size) == [12, 14, 16, 18, 20, 24, 30, 36])
    }
}
