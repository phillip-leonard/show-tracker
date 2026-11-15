// swift-tools-version: 6.0
// Features: one folder per area (Shows, ShowDetail, Search, Stats, Friends,
// Profile, …), built from Core and DesignSystem. Screens arrive after the
// foundation (docs/ios-native/DECISIONS.md, "Build order").
import PackageDescription

let package = Package(
    name: "Features",
    platforms: [.iOS(.v18)],
    products: [
        .library(name: "Features", targets: ["Features"]),
    ],
    dependencies: [
        .package(path: "../Core"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "Features",
            dependencies: [
                .product(name: "Core", package: "Core"),
                .product(name: "DesignSystem", package: "DesignSystem"),
            ]
        ),
    ]
)
