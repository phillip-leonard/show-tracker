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
        // Google's own button (branding rules); the sign-in itself is Core's.
        .package(url: "https://github.com/google/GoogleSignIn-iOS.git", from: "10.0.0"),
    ],
    targets: [
        .target(
            name: "Features",
            dependencies: [
                .product(name: "Core", package: "Core"),
                .product(name: "DesignSystem", package: "DesignSystem"),
                .product(name: "GoogleSignInSwift", package: "GoogleSignIn-iOS"),
            ]
        ),
    ]
)
