// swift-tools-version: 6.0
// DesignSystem: the shipped web app's tokens (app/globals.css, decision D-5)
// and Plus Jakarta Sans. System materials and components first, so iOS 26+
// supplies Liquid Glass.
import PackageDescription

let package = Package(
    name: "DesignSystem",
    platforms: [.iOS(.v18)],
    products: [
        .library(name: "DesignSystem", targets: ["DesignSystem"]),
    ],
    targets: [
        .target(
            name: "DesignSystem",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "DesignSystemTests",
            dependencies: ["DesignSystem"],
            // A symlink to fixtures/design/tokens.json, the table the web's
            // globals.css is checked against too.
            resources: [.copy("DesignTokens.json")]
        ),
    ]
)
