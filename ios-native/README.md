# MySetlists native iOS app

SwiftUI, iOS 18+, version 4.0.x. It replaces the Capacitor app in `ios/` at cutover, under the same bundle ID (`com.mysetlists.app`) and App Store record. Decisions: [`docs/ios-native/DECISIONS.md`](../docs/ios-native/DECISIONS.md). Xcode Cloud: [`docs/ios-native/XCODE-CLOUD.md`](../docs/ios-native/XCODE-CLOUD.md).

**Open `MySetlists.xcworkspace`**, not the `.xcodeproj`. The workspace includes the local packages, so their tests run from the MySetlists scheme. It also holds the committed `Package.resolved`.

## Layout

```
ios-native/
  MySetlists.xcworkspace      the entry point (project + packages)
  MySetlists.xcodeproj        the app target; App/ is a synchronized folder,
                              so new files need no project edits
  App/                        @main, AppDelegate
    Resources/                Assets, GoogleService-Info.plist, PrivacyInfo.xcprivacy
  Config/                     Info.plist, entitlements (Debug, Release)
  Packages/
    Core/                     no UI: Firebase, models, API, auth (+ CoreTests)
    Features/                 screens, built from Core and DesignSystem
    DesignSystem/             tokens and Plus Jakarta Sans (+ DesignSystemTests)
  ci_scripts/ci_post_clone.sh Xcode Cloud; no npm
```

Only `Core` depends on Firebase (13.x) and GoogleSignIn (10.x). Features and the app reach them through it.

## Build and test

```bash
xcodebuild test -workspace ios-native/MySetlists.xcworkspace -scheme MySetlists -destination 'platform=iOS Simulator,name=iPhone 18 Pro'
```

A Release build uploads its dSYM to Crashlytics (the "Upload dSYM to Crashlytics" build phase). For a local Release build or archive that shouldn't upload, pass `SKIP_CRASHLYTICS_UPLOAD=YES`.

## Things that are deliberate

- **iPhone and iPad** (`TARGETED_DEVICE_FAMILY = 1,2`). The Capacitor app supports iPad, and an update can't drop a device family. Layout follows measured width (CLAUDE.md).
- **No keychain-sharing entitlement.** The default keychain access group stays `66N4YR3VP9.com.mysetlists.app`, the group the Capacitor app's Firebase Auth session is stored under. Adding a keychain group would change where the native app looks, and sign-in carry-over (Q-01) would fail.
- **Same capabilities as the Capacitor app:** Sign in with Apple, push (development APNs in Debug, production in Release), and universal links for `mysetlists.net`. The App ID already has all three, so the developer portal needs no changes.
- **Firestore offline persistence is on** (`AppBootstrap`). The web keeps it off.
- **Crashlytics collects from Release builds only.** Debug builds don't report.
- **Dark only in v1.**

## Netlify skips native-only commits

A push whose changes since the last deploy are all under `ios-native/` doesn't build the website (`scripts/netlify-ignore.sh`, netlify.toml's `ignore`). Anything else in the commit (docs, `CHANGELOG.md`, `package.json`, the version bumps every PR makes) builds as usual. So a native PR's first commit builds, and its follow-up commits that change only Swift don't.

Netlify compares a push with the last build it *finished* (`CACHED_COMMIT_REF`). A native-only commit pushed while the previous build is still finishing is compared with an older commit, so it may build anyway. That's harmless, just not skipped.

## Versioning

A PR that touches `ios-native/` bumps `MARKETING_VERSION` here (4.0.0 → 4.0.1 …) **as well as** the Capacitor and web versions. CLAUDE.md, "Versioning", has the rule. Leave `CURRENT_PROJECT_VERSION` alone: Xcode Cloud sets it.
