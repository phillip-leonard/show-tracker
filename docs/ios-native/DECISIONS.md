# Native SwiftUI app: approved decisions

The decisions behind the native iOS app, approved by Phillip. The original lives in his Claude project as `swift-v1-decisions.md`. This copy was written on 2026-11-14 from the foundation kickoff prompt and the answers to the Part 1 audit (`FOUNDATION-AUDIT.md`), so future sessions can find it. Don't reopen a decision here without asking him; add new ones at the end, with the date.

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
- **"Anonymous"** means sign-in provider `anonymous` **and** no linked identities (`firebase.identities` empty), in the rules and on the server (`isAnonymous`). Emulator tests cover link-then-refresh.
- **Allowed for guests:** their own shows, upcoming shows, profile, wishlists, bucket lists, alert settings and stats; public data; `normalize-show` for their own shows; re-sync and the setlist operations; following bands and push alerts (D-2); feedback (D-3); deleting their account.
- **Refused for guests:** AI ticket scan, `send-email`, friend requests and invites, tags, comments, photos and other UGC (writing **and reading**, D-1: guests see a "create an account to see comments" prompt instead), reports, festivals (joining and creating), roadmap submissions and votes (D-3), public shares and public Year in Review, the leaderboard, and the suggestions scan.
- Anonymous accounts are left out of rankings and **`totalUsers`**. The stats jobs read anonymity from Firebase Auth, never from a profile field.
- **Welcome email:** held for anonymous accounts (nothing recorded) and sent once they link.
- **`account-linked`** (new function): after a link, it runs what a new sign-up gets. It claims invites, sends the welcome email if due, recomputes stats and marks the profile converted. The display name still goes through `moderate-content`.
- **`adopt-guest-shows`** (new function, D-4): when the credential already belongs to an account, it moves the guest's shows into that account through `normalizeShowInput` and `classifyDuplicate`, then purges the anonymous account.
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
