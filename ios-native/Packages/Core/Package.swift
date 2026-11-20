// swift-tools-version: 6.0
// Core: no UI. Models, Firestore, the Netlify function client, auth, moderation
// and dates (docs/ios-native/SCOPING.md §7.3). The only package that talks to
// Firebase; Features and the app reach Firebase through it.
import PackageDescription

let package = Package(
    name: "Core",
    platforms: [.iOS(.v18)],
    products: [
        .library(name: "Core", targets: ["Core"]),
    ],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", from: "13.0.0"),
        .package(url: "https://github.com/google/GoogleSignIn-iOS.git", from: "10.0.0"),
    ],
    targets: [
        .target(
            name: "Core",
            dependencies: [
                .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
                .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
                .product(name: "FirebaseFirestore", package: "firebase-ios-sdk"),
                .product(name: "FirebaseMessaging", package: "firebase-ios-sdk"),
                .product(name: "FirebaseStorage", package: "firebase-ios-sdk"),
                .product(name: "FirebaseCrashlytics", package: "firebase-ios-sdk"),
                .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS"),
            ],
            // A symlink to the repo's config/: the public bands
            // (public-artists.json) and their song title aliases
            // (song-title-aliases.json), the same files the web and the
            // snapshot job read, so the band page matches them (Stage 4, 4-5).
            resources: [.copy("Config"), .copy("NativeContent")]
        ),
        .testTarget(
            name: "CoreTests",
            dependencies: ["Core"],
            // A symlink to the repo's fixtures/ (the contract shared with the
            // server's tests), copied into the test bundle so the tests don't
            // depend on the source tree being on the machine that runs them.
            resources: [.copy("Fixtures")]
        ),
    ]
)
