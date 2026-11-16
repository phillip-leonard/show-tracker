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

## Signing in (Part 5)

`Core/Auth/SessionStore` owns the session: Apple, Google, email, "Continue as guest" (Firebase anonymous auth), linking a guest to a credential, password reset, sign-out and account deletion. `Core/Session/AccountGate` decides which screen replaces the app: update required, signed out, suspended, terms, or the app. `Core/API/APIClient` calls the Netlify functions with the user's ID token and turns failures into `APIError`, including `.accountRequired` for a guest. The screens are in `Features/Auth`.

## The app shell (Part 6)

`Features/Shows` (Stage 1, Part 2): the Shows tab. `Core/Shows/ShowsStore` keeps the signed-in person's `users/{uid}/shows`, `upcomingShows` and `userStats/{uid}` live (cache first; `LiveLoad` makes sure loading always ends, as `lib/liveShows.js` does), and `Core/Shows/ShowList` holds the list rules (order, years, search, filters, setlist status), unit-tested. The show page (Part 3a) is `Features/Shows/ShowDetail`: field edits go through `ShowFieldEdit` (one field per write, the rule in `lib/showFieldEdits.js`, checked against `fixtures/show-edits/`), the setlist through `SetGroups` (`lib/setGroups.js`, checked against `fixtures/setlist-grouping/`), the re-sync label through `setlist-source` (`SetlistSourceCache`), and a show still in the outbox (`ShowOutbox`) opens read-only as "Waiting to sync". Part 3b adds setlist editing: `SetlistEdits` (the Swift copy of `lib/setlistEdits.js` and the set editor's moves, checked against every case in `fixtures/setlist-edits/` and `fixtures/setlist-grouping/`), queued by `ShowsStore.editSetlist` (`SetlistEditQueue`, a file per person) and replayed in order as transactions on the stored setlist (`SetlistEditReplay`, `SetlistTransaction`): online at once with retries, offline on reconnect, and `SetlistOps` for re-sync, the Archive review and a waiting proposal. `AppTests/SetlistTransactionEmulatorTests` checks two devices rating at once against the emulators; its doc comment has the command. Part 4 adds shows: the + sheet (`Features/Shows/AddShow.swift`: setlist.fm search with an artist picker, a manual form, upcoming shows, and for accounts the web's import page). Every past show is an input sent to `normalize-show` through the outbox (`ShowOutbox`, `ShowsStore.addShow`, `flushOutbox`): saved to a file first, so an add made offline shows as "Waiting to sync" and is sent on reconnect, at launch, on return to the foreground or on pull to refresh. Upcoming shows are written directly with `UpcomingShowRules` (`lib/upcomingShows.js`, checked against `fixtures/upcoming-shows/`).

To try it with data, without production: run the Auth and Firestore emulators with the app's project id (the Firestore emulator needs Java, e.g. Homebrew's `openjdk@21`), launch a Debug build with `MYSETLISTS_EMULATORS=127.0.0.1`, continue as a guest, then write shows under that guest's uid in the emulator (REST with `Authorization: Bearer owner`):

```
PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npx firebase emulators:start --only auth,firestore --project show-tracker-d7a4d
SIMCTL_CHILD_MYSETLISTS_EMULATORS=127.0.0.1 xcrun simctl launch booted com.mysetlists.app
```

`Features/Shell`: `AppShell` (Shows · Friends · Stats · Me, and the system Search tab), `AppRouter` (the selected tab, each tab's stack, the web page on top). Links arrive in `MySetlistsApp.onOpenURL`; `Core/Navigation/DeepLink` decides where they go, from the table `lib/deepLinks.js` shares (`fixtures/deep-links/links.json`). `Features/Me` has the account actions and a hidden menu (tap the version five times): **First-launch sign-in** in every build, and, in Debug builds, a Developer screen for testing Crashlytics.

`DesignSystem` holds the web's colors (`Colors.xcassets`, checked against `fixtures/design/tokens.json`), spacing, radii, the type scale (`Font.brand(.sm)`) and `brandScreen()` / `brandRow()` / `brandCard()`.

Sign-out clears Firestore's offline cache: `Core/Database` terminates the instance, clears its files and starts a fresh one with the launch settings. Read Firestore through `Database.ready()`, never `Firestore.firestore()`.

## Q-01: the first-launch report

Once per install, `Core/Auth/FirstLaunchAuthRecorder` records which auth state Firebase restored on the first launch (no personal data). To read it: tap the version in Me five times, then open **First-launch sign-in**. It also goes to Crashlytics (`FirstLaunchAuthState`) and the system log (`com.mysetlists.app`, category `Q01`). The test steps are in [`docs/ios-native/Q01-SIGNIN-CARRYOVER.md`](../docs/ios-native/Q01-SIGNIN-CARRYOVER.md). The answer: Google carries over, Apple and email don't, and those users sign in again. So after an update from the Capacitor app, until an account signs in, the sign-in screen says "Welcome back" (`Core/Session/WelcomeBack`).

## Trying it without production accounts

A Debug build launched with `MYSETLISTS_EMULATORS` uses local emulators (Auth on 9099, Firestore on 8080). With no Firestore emulator running, Firestore stays offline, and nothing reaches production:

```bash
npx firebase emulators:start --only auth --project demo-native-auth
SIMCTL_CHILD_MYSETLISTS_EMULATORS=127.0.0.1 xcrun simctl launch booted com.mysetlists.app
```

A Debug build launched with `MYSETLISTS_API_BASE=<url>` also calls the functions at that address instead of mysetlists.net, for running them locally against the emulators (the handlers need `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` and the three `FIREBASE_*` admin variables, which can be a throwaway key against the emulators). Release builds always call production.

## Build and test

```bash
xcodebuild test -workspace ios-native/MySetlists.xcworkspace -scheme MySetlists -destination 'platform=iOS Simulator,name=iPhone 18 Pro'
```

Two test targets run from that one command:
- **CoreTests** and **DesignSystemTests** (package tests): models, fixtures, dates, deep links, the API client, the version table, the gate, sign-out, the colors.
- **MySetlistsTests** (`AppTests/`, hosted in the app): `SessionStore` against the Firebase Auth emulator with the real SDK, including sign-out clearing the offline cache. It is skipped unless the emulator is running. Run it with `npm run test:native-auth-emulator`. It's hosted because Firebase Auth needs the app's keychain entitlement, and Messaging needs an app bundle. While the app hosts tests (`AppEnvironment.isHostingTests`), it doesn't start Firebase itself.

A Release build uploads its dSYM to Crashlytics (the "Upload dSYM to Crashlytics" build phase). For a local Release build or archive that shouldn't upload, pass `SKIP_CRASHLYTICS_UPLOAD=YES`.

## Things that are deliberate

- **iPhone and iPad** (`TARGETED_DEVICE_FAMILY = 1,2`). The Capacitor app supports iPad, and an update can't drop a device family. Layout follows measured width (CLAUDE.md).
- **No keychain-sharing entitlement.** The default keychain access group stays `66N4YR3VP9.com.mysetlists.app`, the group the Capacitor app's Firebase Auth session is stored under. Adding a keychain group would change where the native app looks, and sign-in carry-over (Q-01) would fail.
- **Same capabilities as the Capacitor app:** Sign in with Apple, push (development APNs in Debug, production in Release), and universal links for `mysetlists.net`. The App ID already has all three, so the developer portal needs no changes.
- **Firestore offline persistence is on** (`AppBootstrap`). The web keeps it off. Sign-out clears it (`Database`).
- **Crashlytics collects from Release builds only.** Debug builds don't report.
- **Ticket photos never touch the disk.** The scan resizes them in memory, sends them once when Scan is tapped, and drops them afterwards (`TicketScan`, `ScanTicketView`). The library uses `PhotosPicker`, which needs no photo permission; the camera asks with `NSCameraUsageDescription`.
- **Dark only in v1.**

## Netlify skips native-only commits

A push whose changes since the last deploy are all under `ios-native/` doesn't build the website (`scripts/netlify-ignore.sh`, netlify.toml's `ignore`). Anything else in the commit (docs, `CHANGELOG.md`, `package.json`, the version bumps every PR makes) builds as usual. So a native PR's first commit builds, and its follow-up commits that change only Swift don't.

Netlify compares a push with the last build it *finished* (`CACHED_COMMIT_REF`). A native-only commit pushed while the previous build is still finishing is compared with an older commit, so it may build anyway. That's harmless, just not skipped.

## Versioning

A PR that touches `ios-native/` bumps `MARKETING_VERSION` here (4.0.0 → 4.0.1 …) **as well as** the Capacitor and web versions. CLAUDE.md, "Versioning", has the rule. Leave `CURRENT_PROJECT_VERSION` alone: Xcode Cloud sets it.
