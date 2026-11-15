# Native SwiftUI app: approved decisions

The decisions behind the native iOS app, approved by Phillip. **This file is the source of truth** (since 2026-11-14). It replaces `swift-v1-decisions.md` in his Claude project. It was first written from the foundation kickoff prompt and the answers to the Part 1 audit (`FOUNDATION-AUDIT.md`). Don't reopen a decision here without asking him. Add new ones at the end, with the date.

## Platform and project

- Native SwiftUI, iPhone-first, minimum **iOS 18**. Liquid Glass comes from standard SwiftUI components on iOS 26+. Use `if #available` only where needed, and build no custom glass for iOS 18.
- Same bundle ID (`com.mysetlists.app`) and the same App Store record. The native app ships as **4.0.0**.
- The project lives in `ios-native/`, next to the Capacitor `ios/`, which stays untouched and buildable until cutover.
- **Versioning:** a PR that touches `ios-native/` bumps the native `MARKETING_VERSION` (4.0.0, 4.0.1, …). The Capacitor rule for `ios/` and the web version in `package.json` stay as they are (CLAUDE.md).
- Native builds go to internal TestFlight only until cutover. Nothing is submitted to App Store review from the foundation work.

## Architecture

- SwiftUI with `@Observable` stores. No Combine.
- `TabView` with a `NavigationStack` per tab. Layout follows measured width (CLAUDE.md, "iPad and wide layouts").
- Firebase iOS SDK via SPM: Auth, Firestore, Messaging, Storage, Crashlytics. GoogleSignIn via SPM. No third-party UI libraries.
- Local Swift packages `Core`, `Features` and `DesignSystem` (SCOPING §7.3).
- Firestore offline persistence is **on** in the native app (the web keeps it off).
- Crashlytics ships in v1, with dSYM upload in CI.
- **No keychain-sharing entitlement**, matching the Capacitor app. The default access group (`66N4YR3VP9.com.mysetlists.app`) is what lets an existing Firebase session carry over (Q-01).

## Navigation

- Tabs: **Shows · Friends · Stats · Me**, plus **Search** as the system search tab.
- Upcoming is a segment inside Shows. "Add a show" is a + in the Shows toolbar.
- Universal links: every path the AASA file claims opens the app. A path without a native screen opens the same URL in `SFSafariViewController`. `/reset/*` (password reset) stays on the web.
- **Referral links open the app** (D-6): the AASA file claims `/` with a `ref` query, and the app keeps the ref for `friends.js` `referral` after sign-in.

## The server is the source of truth

- Shows are created through `normalize-show`. Setlist changes go through `resync-show`, `propose-setlist`, `accept-proposal` and `reject-proposal`. Friend features go through `friends.js`. Stats are read from `userStats`, `publicUserStats`, `communityStats` and `yearInReviews`.
- The app never builds show documents or rewrites whole shows. Every edit writes only the fields that changed (`lib/setlistEdits.js`).
- When a server function is missing, flag it. Don't reimplement the logic in Swift.

## Guests (Firebase anonymous auth)

- Guests use Firebase anonymous auth, and their data lives in Firestore from the first show. Upgrading means linking a credential: same UID, so the data stays.
- **"Anonymous"** means sign-in provider `anonymous` **and** no linked identities (`firebase.identities` empty), in the rules and on the server (`isAnonymous`). The Auth emulator test (`tests/auth/anonymousLink.test.js`) shows the token changes at link: `sign_in_provider` becomes `password` or `google.com` straight away.
- **Allowed for guests:** their own shows, upcoming shows, profile, wishlists, bucket lists, alert settings and stats; public data; `normalize-show` for their own shows; re-sync and the setlist operations; following bands and push alerts (D-2); feedback (D-3); deleting their account.
- **Refused for guests:** AI ticket scan, `send-email`, friend requests and invites, tags, comments, photos and other UGC (writing **and reading**, D-1: guests see a "create an account to see comments" prompt instead), reports, festivals (joining and creating), roadmap submissions and votes (D-3), public shares and public Year in Review, the leaderboard, and the suggestions scan.
- Anonymous accounts are left out of rankings and **`totalUsers`**. The stats jobs read anonymity from Firebase Auth, never from a profile field.
- **Welcome email:** held for anonymous accounts (nothing recorded) and sent once they link.
- **`account-linked`** (new function): after a link, it runs what a new sign-up gets. It claims invites, sends the welcome email if due, recomputes stats and marks the profile converted. The display name still goes through `moderate-content`.
- **`adopt-guest-shows`** (new function, D-4): when the credential already belongs to an account, it moves the guest's shows into that account and then purges the anonymous account. "The same show" is `classifyDuplicate`: duplicates stay with the account, and a `possible` match moves only when the user picks it. Shows are copied as stored (normalize-show built them), so ratings and notes survive. Upcoming shows and followed bands move too.
- Ticket scanning stays sign-in-only.
- Anonymous sign-in stays off in Firebase until the Part 2 rules are live from `main`. Then Phillip enables the provider.

## Data

- One cleanup before Part 2 (5.60.12):
  - `showTags` and `pendingEmailTags` dates converted to ISO
  - `fromEmail`/`toEmail` removed from old friend requests
  - `userStats.avgShowRating` written as a number (`STATS_VERSION` 2)
- Everything else in production is handled by **tolerant Swift decoding in Part 4**, not by rewriting data:
  - the stored `id` field on 58 shows (no `@DocumentID`)
  - `createdAt` stored as an ISO string
  - followed bands stored as plain strings
  - songs without `set`
  - the `setBreak` field
- The golden fixtures in `fixtures/shows/` and `fixtures/year-in-review/` are the contract. If one doesn't decode, the model is wrong, not the fixture.

## Design

- **The shipped colors** (D-5), from `app/globals.css`, not `DESIGN_SYSTEM_GUIDE.md`: brand green `#10B981`, amber `#FFB700`, purple `#D946EF`, background `#2A2A4E`/`#1F1F3A`. Dark only in v1.
- Plus Jakarta Sans, bundled as the `.ttf` files from Google Fonts (OFL) in Part 3 and scaled with Dynamic Type. Navigation and tab bars keep the system font.
- System materials and components first, so iOS 26 provides Liquid Glass.

## Xcode Cloud (Q-07, D-7)

- Assume **one Xcode Cloud product** for `com.mysetlists.app` (Apple: "a bundle ID always matches exactly one Xcode Cloud product").
- **Capacitor builds are made manually** (archive and upload from Xcode) during the transition. Xcode Cloud builds the native project.
- Build numbers can't collide: no Capacitor build uses 4.x. During the transition the Capacitor app stays on 3.x, and a rollback build must use a version above the native one.

## Order of work

Part 1 audit (done, 2026-11-14) → data cleanup (5.60.12) → Part 2 server and rules for guests → Part 3 project skeleton and CI → Part 4 models and contract tests → Part 5 auth and API client → Part 6 app shell and design system → Part 7 spikes (Q-01 sign-in carry-over, Q-07 build numbers). One PR per part, each branched from the latest `main`.

## v1 scope, build order and cutover timing (2026-11-14)

From Phillip's project copy.

### v1 scope

- **Community** is in v1.
- **Discover** stays hidden.
- **Festivals** in v1 are read-and-attach only: list, detail, attach a show, lineup. Create, join and picks are v1.x.
- **Screenshot and CSV import** are v1.x. Until then, the app links to the web page.
- **Any v1.x screen** opens its web page in `SFSafariViewController` until it exists natively.
- **Year in Review** is in v1 only if v1 is ready before Dec 2. Otherwise it waits for next season.

### Build order after the foundation

1. Shows tab, show detail (first, since it's the biggest screen, R-03) and add flows
2. Stats, Me/Profile with deletion, moderation
3. Friends, tags, notifications, push
4. Tours, runs, songs, bands, venues, wishlist, bucket list, Community
5. Festivals (read and attach)
6. Internal TestFlight, then cutover per SCOPING §7.4

### Cutover timing

Not during the Year in Review peak (Dec 2 to mid-January), because the cutover makes most users sign in again. Cut over either before about Nov 28 or after the peak.

## Project setup (2026-11-15, Part 3)

- **`ios-native/MySetlists.xcworkspace` is the entry point.** It holds the project, the three local packages and the committed `Package.resolved`. Xcode Cloud builds the workspace.
- **iPhone and iPad.** "iPhone-first" describes the design. The target stays universal because the Capacitor app supports iPad and an App Store update can't drop a device family.
- **The keychain access group is `66N4YR3VP9.com.mysetlists.app`**, the default, because neither app has a keychain-sharing entitlement. Q-01 depends on this.
- **Plus Jakarta Sans:** Google Fonts' variable TTFs, weights 200 to 800, roman and italic, registered from the DesignSystem package. Extra-bold renders as itself; it isn't mapped to bold, as the Part 1 audit assumed.
- **The privacy manifest** keeps the Capacitor app's data types. It adds crash and diagnostic data (Crashlytics, not linked to the account) and drops product interaction (the native binary links no analytics SDK). Check the App Store privacy labels against it before cutover (Q-08).

## Sign-in and the API client (2026-11-15, Part 5)

- **The terms box comes first.** Every way in (Apple, Google, email, guest) is disabled until it's ticked. The tick is recorded on the profile at the first sign-in. An account without an acceptance of `Terms.version` gets the gate. The order of screens is the web's: update required, signed out, suspended, terms, the app.
- **Version gating** reads `config/app` at launch and on every return to the foreground. The shared table `fixtures/app-version/version-status.json` keeps the rule the same in both apps. Today's values are Capacitor 3.x numbers, which no native 4.x build is below. Native-only minimums need their own keys when they're wanted, plus a rules change, because `config/app` is `hasOnly`.
- **Linking a guest** calls `account-linked` with any kept referral. When the credential already has an account, the app signs in to that account and uses `adopt-guest-shows` (preview, then commit); the guest's ID token is kept from before the switch as proof.
- **Deletion** asks Apple for a fresh authorization code on Apple accounts (only when it's the same Apple ID) so `delete-account` can revoke Apple's tokens. Backing out of Apple's sheet cancels the deletion. Deletion is reachable from the update-required screen too.
- **Sign-out never hangs:** push-token document, Firebase, Google and local state, each step bounded at 4 s (`SignOutRunner`).
- **Flagged, not built:**
  - **Sign-out didn't clear Firestore's offline cache.** Fixed in Part 6 (below).

## Data export and the offline cache (2026-11-15)

- **No data export in v1.** The requirement is **"deletion is always reachable"** (in the app, and on the update-required screen). The privacy policy says people can request a copy of their data by emailing support@mysetlists.net (components/PrivacyPolicy.jsx, "Your Rights and Choices").
- **The privacy policy names the deletion path:** "Profile → Delete My Account in the app or on the website", which is the web's and the Capacitor app's menu. **At cutover**, the native app has it under the Me tab ("Delete my account"), so update that sentence in components/PrivacyPolicy.jsx when the native app ships.
- **Post-launch idea: `export-my-data`.** A server function that builds a user's shows, ratings and profile as JSON/CSV and emails it or returns a download, signed-in only, with a per-user limit.
- **Part 6: sign-out clears Firestore's offline cache.** Terminate the Firestore instance, `clearPersistence()`, then use a fresh instance before the next sign-in. If the SDK can't create a new instance in the same process, report it to Phillip rather than leaving the cache in place.
  - **Done in Part 6 (4.0.3).** The SDK can: `terminate` removes the instance from Firebase's registry, so the next `Firestore.firestore()` is a new one in the same process. `Core/Database` does terminate → `clearPersistence()` → fresh instance with the launch settings. Every read goes through `Database.ready()`, which waits for a reset in flight. `MySetlistsTests` (`signOutClearsTheOfflineCache`) checks it against the real SDK: a new instance, the same settings, the last session's document gone from the cache.
  - **Unsynced changes are never lost without asking.** Before signing an account out, Me checks for writes the server hasn't acknowledged (`waitForPendingWrites` not finishing within 0.75 s; it covers every document, not one listener's `hasPendingWrites`). If there are any: "You have changes that haven't synced yet. Signing out now will lose them.", with **Stay signed in** (the default) or **Sign out anyway**. A guest always gets the guest warning instead, because a guest loses everything on sign-out. `SignOutPromptTests` and `MySetlistsTests` (`signOutWarnsAboutUnsyncedChanges`) cover it.
  - **After "Sign out anyway"**, sign-out still waits up to 4 s for those writes (`waitForPendingWrites`, bounded like every step), then drops what's left with the cache.

## App shell and design system (2026-11-15, Part 6)

- **Tabs:** Shows · Friends · Stats · Me, plus the system Search tab (`Tab(role: .search)`), each its own NavigationStack. `.sidebarAdaptable` makes them a sidebar on a wide iPad window. Every screen is a placeholder until its feature is built. Shows has the Shows/Upcoming segment and a + that does nothing yet.
- **Me** has identity, "Create your account" (guests), sign out, delete account, the legal links and the version. This is the deletion path the privacy policy should name at cutover (above).
- **The colors are the web's, in an asset catalog** (`DesignSystem/Resources/Colors.xcassets`, dark appearance set). `fixtures/design/tokens.json` is the table: DesignSystemTests checks the catalog against it, and `lib/__tests__/designTokens.test.js` checks `app/globals.css`. Screens sit on `#2A2A4E` with `#1F1F3A` rows (`brandScreen()`, `brandRow()`). Bars and the tab bar are left to the system, which gives them Liquid Glass on iOS 26; a card is glass there and the surface color on iOS 18 (`brandCard()`).
- **Deep links:** `Core/DeepLink` is `lib/deepLinks.js` ported, and both run `fixtures/deep-links/links.json` (which also pins the route list to `lib/navRoutes.js`). Show, band, song, venue and Year in Review open their placeholder. Every other claimed path opens the same page in SFSafariViewController, and so does one of our pages the app doesn't claim (`/reset/*`). SFSafariViewController doesn't share the app's sign-in, so a page that needs an account shows the web's signed-out view.
- **D-6 is live:** the AASA file claims `/` with a `ref` query only (`{"/": "/", "?": {"ref": "*"}}`, the only component with a query). `deepLinks.test.js` applies Apple's documented matching rules to the file: `/?ref=…` opens the app; `/`, `/?utm_source=…`, `/artist/*`, `/reset/*` and the other unclaimed pages stay in Safari. A `?ref=` is kept until the next account sign-in or guest upgrade, or used at once when an account is already signed in (the web does the same on load). The Capacitor app opens these links too, where `AppContext` already keeps the ref.
- **Crashlytics:** Release builds report. A hidden Developer screen (Debug only: tap the version in Me five times) turns collection on for a Debug build and has a test error and a test crash.
- **Local emulators for trying the app:** a Debug build launched with `MYSETLISTS_EMULATORS=<host>` uses the Auth emulator at `<host>:9099` and Firestore at `<host>:8080`, so sign-in and guests can be tried without production accounts.
