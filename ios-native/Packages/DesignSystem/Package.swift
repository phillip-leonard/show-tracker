// swift-tools-version: 6.0
// DesignSystem: the shipped web app's tokens (app/globals.css, decision D-5)
// and Plus Jakarta Sans. System materials and components first, so iOS 26+
// supplies Liquid Glass. Tokens arrive in Part 6; the fonts are here now.
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
            dependencies: ["DesignSystem"]
        ),
    ]
)
