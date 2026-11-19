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
- **`adopt-guest-shows`** (new function, D-4): when the credential already belongs to an account, it moves the guest's shows into that account and then purges the anonymous account. "The same show" is `classifyDuplicate`: duplicates stay with the account, and a `possible` match moves only when the user picks it. Shows are copied as stored (normalize-show built them), so ratings and notes survive. Upcoming shows and followed bands move too, and since 5.60.34 the guest's song wishlists, favorite tours and bucket list shows and venues (the account's entry wins a clash).
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

**Superseded in part on 2026-11-17 by "Parity before launch" (below):** v1 is the whole web and Capacitor app except the admin portal. The bullets are kept as they were decided, each marked where it changed.

- **Community** is in v1.
- **Discover** stays hidden. (Unchanged: it's hidden on the web too.)
- ~~**Festivals** in v1 are read-and-attach only: list, detail, attach a show, lineup. Create, join and picks are v1.x.~~ **Reversed (parity):** all of Festivals is v1, in Stage 5.
- ~~**Screenshot and CSV import** are v1.x. Until then, the app links to the web page.~~ **Reversed (parity):** both are v1, in Stage 6.
- ~~**Comments, photos and meetups** on a show are v1.x (Stage 3, C-4). Until then, the show's row opens its web page.~~ **Reversed (parity):** all three are v1, in Stage 6.
- ~~**Any v1.x screen** opens its web page in `SFSafariViewController` until it exists natively.~~ **Changed (parity):** there are no v1.x screens. Only the pages "Parity before launch" keeps on the web open there, plus a screen not yet built during development.
- ~~**Year in Review** is in v1 only if v1 is ready before Dec 2. Otherwise it waits for next season.~~ **Changed (parity):** the 2026 season uses the web link (C-9); native Year in Review is built in Stage 6.

### Build order after the foundation

1. Shows tab, show detail (first, since it's the biggest screen, R-03) and add flows
2. Stats, Me/Profile with deletion, moderation
3. Friends, tags, notifications, push
4. Tours, runs, songs, bands, venues, wishlist, bucket list, Community, plus navigation, per-year stats, advanced search and adding a whole tour (parity)
5. Festivals, all of it (parity; was read and attach)
6. Parity: user content, imports, posters, Year in Review, show extras, profile and help (`PARITY-AUDIT.md` §4)
7. Internal TestFlight, then cutover per SCOPING §7.4

### Cutover timing

Not during the Year in Review peak (Dec 2 to mid-January), because the cutover makes most users sign in again. ~~Cut over either before about Nov 28 or after the peak.~~ **Changed (parity, 2026-11-17):** cutover follows parity, after the peak (late January at the earliest).

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
- **Post-launch idea: `export-my-data`** (on the post-v1 list; reaffirmed in Stage 2, C-1). A server function that builds a user's shows, ratings and profile as JSON/CSV and emails it or returns a download, signed-in only, with a per-user limit.
- **Part 6: sign-out clears Firestore's offline cache.** Terminate the Firestore instance, `clearPersistence()`, then use a fresh instance before the next sign-in. If the SDK can't create a new instance in the same process, report it to Phillip rather than leaving the cache in place.
  - **Done in Part 6 (4.0.3).** The SDK can: `terminate` removes the instance from Firebase's registry, so the next `Firestore.firestore()` is a new one in the same process. `Core/Database` does terminate → `clearPersistence()` → fresh instance with the launch settings. Every read goes through `Database.ready()`, which waits for a reset in flight. `MySetlistsTests` (`signOutClearsTheOfflineCache`) checks it against the real SDK: a new instance, the same settings, the last session's document gone from the cache.
  - **Unsynced changes are never lost without asking (4.0.4).** Before signing an account out, Me checks for writes the server hasn't acknowledged (`waitForPendingWrites` not finishing within 0.75 s; it covers every document, not one listener's `hasPendingWrites`). If there are any: "You have changes that haven't synced yet. Signing out now will lose them.", with **Stay signed in** (the default) or **Sign out anyway**. A guest always gets the guest warning instead, because a guest loses everything on sign-out. `SignOutPromptTests` and `MySetlistsTests` (`signOutWarnsAboutUnsyncedChanges`) cover it.
  - **After "Sign out anyway"**, sign-out still waits up to 4 s for those writes (`waitForPendingWrites`, bounded like every step), then drops what's left with the cache.

## App shell and design system (2026-11-15, Part 6)

- **Tabs:** Shows · Friends · Stats · Me, plus the system Search tab (`Tab(role: .search)`), each its own NavigationStack. `.sidebarAdaptable` makes them a sidebar on a wide iPad window. Every screen is a placeholder until its feature is built. Shows has the Shows/Upcoming segment and a + that does nothing yet.
- **Me** has identity, "Create your account" (guests), sign out, delete account, the legal links and the version. This is the deletion path the privacy policy should name at cutover (above).
- **The colors are the web's, in an asset catalog** (`DesignSystem/Resources/Colors.xcassets`, dark appearance set). `fixtures/design/tokens.json` is the table: DesignSystemTests checks the catalog against it, and `lib/__tests__/designTokens.test.js` checks `app/globals.css`. Screens sit on `#2A2A4E` with `#1F1F3A` rows (`brandScreen()`, `brandRow()`). Bars and the tab bar are left to the system, which gives them Liquid Glass on iOS 26; a card is glass there and the surface color on iOS 18 (`brandCard()`).
- **Deep links:** `Core/DeepLink` is `lib/deepLinks.js` ported, and both run `fixtures/deep-links/links.json` (which also pins the route list to `lib/navRoutes.js`). Show, band, song, venue and Year in Review open their placeholder. Every other claimed path opens the same page in SFSafariViewController, and so does one of our pages the app doesn't claim (`/reset/*`). SFSafariViewController doesn't share the app's sign-in, so a page that needs an account shows the web's signed-out view.
- **D-6 is live:** the AASA file claims `/` with a `ref` query only (`{"/": "/", "?": {"ref": "*"}}`, the only component with a query). `deepLinks.test.js` applies Apple's documented matching rules to the file: `/?ref=…` opens the app; `/`, `/?utm_source=…`, `/artist/*`, `/reset/*` and the other unclaimed pages stay in Safari. A `?ref=` is kept until the next account sign-in or guest upgrade, or used at once when an account is already signed in (the web does the same on load). The Capacitor app opens these links too, where `AppContext` already keeps the ref.
- **Crashlytics:** Release builds report. A hidden Developer screen (Debug only: tap the version in Me five times) turns collection on for a Debug build and has a test error and a test crash.
- **Local emulators for trying the app:** a Debug build launched with `MYSETLISTS_EMULATORS=<host>` uses the Auth emulator at `<host>:9099` and Firestore at `<host>:8080`, so sign-in and guests can be tried without production accounts.

## Spikes (2026-11-15, Part 7: prep)

- **Q-01 (sign-in carry-over): answered 2026-11-15.** [`Q01-SIGNIN-CARRYOVER.md`](Q01-SIGNIN-CARRYOVER.md) has the steps and results.
  - **Google carries over. Apple and email don't.** (Apple was expected to carry over; the Capacitor app signs Apple in with `skipNativeAuth: true`, so the native SDK never held that session.)
  - **Decision: Apple and email users sign in again. No token bridge.**
  - **Native 4.0.6:** after an update from the Capacitor app, until an account signs in on that install, the sign-in screen says "Welcome back. Sign in to see your shows. Everything you logged is still there.", and "Forgot your password?" is on that screen (`Core/Session/WelcomeBack.swift`).
- **First-launch report (4.0.5):** once per install, the native app records which auth state Firebase restored: uid present or not, providers, guest, keychain read result, and whether it was installed over the Capacitor app. No personal data. It goes to the system log (`com.mysetlists.app`, `Q01`), Crashlytics (non-fatal domain `FirstLaunchAuthState`, plus custom keys), and a hidden screen (tap the version in Me five times, in every build).
  - At cutover the same report measures how many updates carried a session over. Remove it once that's known.
- **Q-07 (build numbers): answered.** [`Q07-BUILD-NUMBERS.md`](Q07-BUILD-NUMBERS.md). They can't collide, because the native app is 4.0.x and Capacitor builds are 3.13.x, and App Store Connect needs only the version-and-build pair to be unique. Set Xcode Cloud's Next Build Number above TestFlight's highest only to keep the list in order. A rollback after cutover is the one time Capacitor takes a 4.x version.


## Stage 1: Shows tab, show detail, adding shows (2026-11-15)

From the Stage 1 Part 1 audit ([`STAGE1-AUDIT.md`](STAGE1-AUDIT.md)), approved with these calls:

- **Upcoming shows** are `users/{uid}/upcomingShows`, as on the web. The native app writes them directly, field by field (no server function). Marking one attended goes through `normalize-show` (kind `upcoming`). A golden fixture pins the upcoming-show shape.
- **Song ratings are on the native show detail screen** (the web's show page has none). Song comments come in Part 3b.
- **No web links inside the show screen** in Stage 1: photos, comments, tags, friends at the show, follow band and archival audio stay hidden until their stage. Import links (screenshot, CSV/XLSX) are for signed-in accounts only. **Parity (2026-11-17):** every one of these becomes a native section of the show screen (Stages 4 and 6), except playlists, which native leaves out.
- **`setlist-source`**: a new read-only function that answers `resolveSource` for the app (band source or not, label, needs review). No Swift copy of the source registry. Built in 5.60.22: `GET /.netlify/functions/setlist-source?artist=&mbid=&setlistSource=`, public and cached; it also returns the re-sync button's wording and which call to make (`lib/setlistSourceAnswer.js`).
- **`lib/setlistEdits.js` and the set-grouping rules are ported to Swift**, with shared golden fixtures run by both the JS and the Swift tests.
- **Offline adds:** a file-backed queue of `normalize-show` requests, keyed by show id. Queued shows appear as "Waiting to sync", and their songs can't be rated until the show syncs.
- **The sign-out warning counts queued adds**, as well as Firestore's unsynced writes.
- **Model fixes:** `populatedFrom` is an ignored field; `setlistSourceChange` is decoded (Part 3).
- **PR order:** Q-01 + Welcome back → `setlist-source` + fixtures → Part 2 (Shows tab) → 3a (detail and field edits) → 3b (setlist editing and operations) → 4 (search and manual adds) → 5 (ticket scan).

## Stage 2: Stats, Me, moderation (2026-11-15)

From the Stage 2 Part 1 audit ([`STAGE2-AUDIT.md`](STAGE2-AUDIT.md)), approved with these calls:

- **No data export in v1** (C-1). Copies of a person's data go through support@mysetlists.net, as above. A data export is on the post-v1 list.
- **Top lists use the server's definitions, top 10, all time** (C-2): the loose band key, `countVenues`, and songs counted by distinct shows. `userStats` gains `topSongs` (keyed by band + song), and `topBands`/`topVenues` go to 10. The fields are additive, so `STATS_VERSION` stays 2. Follow-up: the web Stats page switches to the server lists.
- **No per-year stats in Stage 2** (C-3). "This year" stats are on the v1.x list, and need a per-year block on the server first. **Reversed (parity, 2026-11-17):** the year picker is built in Stage 4, on a per-year block in `userStats` computed on the server.
- **"Hours of live music" is dropped in native** (C-4). **Confirmed (parity, 2026-11-17):** it stays dropped, and the web's Stats page drops it too (Stage 4 server PR), so both apps show the same tiles.
- **Rank is "#N" only** (C-5). Native never shows `rankedOf` or any other user count. Guests see "Create an account to see your rank".
- **Avatar upload and bio are deferred** (C-6). Neither exists on the web, and both are public user content that need server and rules work first. Me shows the current photo read-only.
- **Block side effects move to the server** (C-7, C-8). Unfriending both ways and clearing pending friend requests and show tags happen in `notify-block` (or its successor), after it checks the caller's own `userBlocks`. The web's `blockUser` stops writing those documents itself. The block, unblock, blocked-accounts and report UI moves to Stage 3, with the first screens that show other people.
- **Year in Review entry** (C-9): on Stats, for accounts only, Dec 2 – Jan 15 Pacific (`recapPromoActive`), opening `mysetlists.net/year-in-review/?year=2026` in SFSafariViewController. The card shows no numbers. `fixtures/recap-launch/` pins the dates to `lib/recapLaunch.js`. **Confirmed for 2026 (parity, 2026-11-17):** the web link stays for this season; native Year in Review is built in Stage 6.
- **Tap-through lists** (band, song, venue → your shows) filter the cached shows with the server's keys, ported with a shared fixture (`fixtures/stats-keys/`). The counts come from the server.
- **Debug rows stay as they are:** both behind five taps on the version; "Developer" is Debug-only; the first-launch report stays until the cutover numbers are in.
- **The deletion PR fixes three native bugs:** deletion clears the outbox and the edit queue; a deletion that times out checks whether the account is gone before reporting a failure; guest changes are flushed before adoption, or adoption doesn't start. The suspended screen gets "Delete my account" and the support email (deletion works there while the session lasts; after that, through support).
- **PR order:** server PR (top songs, top 10, block side effects, the two fixtures) → Stats → Me → deletion and upgrade fixes.

## Stage 3: friends, notifications, push (2026-11-16)

From the Stage 3 Part 1 audit ([`STAGE3-AUDIT.md`](STAGE3-AUDIT.md)), approved with these calls:

- **Friend requests go through the server** (C-1): `friends.js` gains `request`, `decline` and `cancel`. `request` checks for a block and, if there is one, answers as if the request were sent, so the block isn't revealed. The web switches to them in the same PR.
- **Invites go through the server** (C-1, §8 of the audit): `invite`, `resendInvite` and `cancelInvite`. `resendInvite` fixes the web's resend, refused by the `invites` rule since 5.59.7 (2a).
- **Tags go through the server** (C-2): `tag`, `respondTag` and `revokeTag`, with `showData` built from the tagger's own stored show, never from the request. Accepting a past tag stays `normalize-show` kind `tag`.
- **Suggestion answers go through the server** (C-3): `respondSuggestion`, which sends the nudge email once.
- **Comments, photos and meetups stay on the web in Stage 3** (C-4) and are on the v1.x list (above). Native doesn't post, like or report them yet. **Reversed (parity, 2026-11-17):** all three are built natively in Stage 6.
- **Engagement notifications are a security fix** (C-5): today any account can write a notification into anyone's inbox. In 3a, `moderate-content` writes the reply and mention notifications when it creates a comment, and a server action writes like and meetup-join notifications after checking the like or join happened. The web stops writing them. Refusing client creates on `notifications` goes in GATED-CLEANUPS, safe from the Capacitor version 3a ships in, since older builds still write them.
- **Old client-write rules wait the same way:** 2a and 3a each add a GATED-CLEANUPS row for the client creates they replace (`friendRequests`, `invites`, `showTags`, `pendingEmailTags`), safe from the Capacitor version that PR ships in. No rule is loosened.
- **Find friends by handle** (C-6): `lookupByHandle`, an exact match only, and only accounts with a claimed handle. Email lookup stays.
- **Test push** (C-7): an admin-only `send-test-push` function, gated on the `admin` claim, sends to the caller's own devices with a chosen link; the native debug rows (behind five taps) call it.
- **Push stays on FCM tokens; `token()` stays** (C-8). Firebase deprecated the token APIs (Messaging 12.18.0) in favour of installation IDs, but those work only with `FirebaseMessagingInstallationIdEnabled` on, which makes every token API fail and needs the server to send by installation ID. `firebase-admin` 12.7 can't (its `send()` takes a token, topic or condition), and the Capacitor app's `pushTokens` documents are keyed by FCM token. With the setting off (the default), the token APIs work as they do in the Capacitor app, so there's no server change. Native calls them from one file, which keeps the deprecation warnings in one place. The move to installation IDs stays in GATED-CLEANUPS, for when Firebase removes `token()` or the Admin SDK sends by installation ID, and after the Capacitor builds retire.
- **`iosPushOfferEnabled` stays off**, and native follows it: no permission prompt while it's off. A device that already allowed push (in the Capacitor app) registers without asking.
- **Guests:** no Friends, requests, invites, tags or UGC (the Friends tab keeps "Friends need an account"). Guests follow bands and get band alerts in the app and by push, never by email (no address); the server needs no change for that (D-2).
- **PR order:** 2a (friends server actions, the invite resend fix) → 2b (native Friends, block, report) → 3a (show social server actions, engagement notifications) → 3b (native show social) → 4 (notifications inbox) → 5 (push) → 6 (band alerts and links). Parts 2 and 3 are two PRs each: the server actions change the web and carry its versions.

## Parity before launch (2026-11-17)

**The requirement:** before launch, the native app reaches full parity with the web and Capacitor app, except the admin portal. The inventory, sizes and PR list are in [`PARITY-AUDIT.md`](PARITY-AUDIT.md). Phillip accepted its recommendations (§3) with one change, F-9.

- **Reversed by parity:**
  - festivals are all v1 (Stage 5);
  - screenshot and CSV import are v1 (Stage 6);
  - comments, photos and meetups are v1 (Stage 3 C-4, Stage 6);
  - per-year stats are v1 (Stage 2 C-3, Stage 4).
- **Navigation (F-1):** no drawer.
  - A **Library** section at the top of Me: Tours, Runs, Festivals, Wishlist, Bucket List, Setlist Photos.
  - **Community** on Stats; **Activity** on Friends.
  - Songs, bands and venues are reached from where they appear.
  - The wide-iPad sidebar can list them all.
- **The Search tab (F-2)** is advanced search over your own shows, with saved and recent searches. Adding a show from setlist.fm stays under +.
- **"Hours of live music" (F-3)** stays dropped in native, and the web drops it too (Stage 4 server PR).
- **Discover and "Fans also see" (F-4)** aren't part of parity while the web hides them. They're built when the web turns them on, behind the same switch.
- **What's New and release notes (F-5):**
  - a native What's New sheet per native release, from a JSON file in the repo;
  - the web's Release Notes page (web version numbers) stays a web link.
- **Venue owner tools (F-6):**
  - native shows venue photos, announcements and the verified badge;
  - "Verify this venue", "Manage venue" and the venue dashboard open the web.
- **How to Use (F-7)** is a native screen with content written for the native app, from a JSON file in the repo.
- **Haptics (F-8):** nothing to copy, since the web's haptics are on its own swipe gestures, which iOS provides. Native adds `.sensoryFeedback` where it suits iOS: saving a rating, adding a show, following a band.
- **Playlists (F-9) are left out of the native app.** No Spotify or Apple Music playlist creation, and no web link in its place. Phillip didn't accept the MusicKit and Spotify sign-in proposal.
- **CSV and Excel import (F-10):** a server function parses the file with the web's code and returns the rows. Native has the file picker and the review screen; no Swift parser.
- **The "Songs I've heard" tool (F-11)** stays a web link, as it is in the Capacitor app.
- **Terms, Privacy and Community Guidelines (F-12)** stay web pages in `SFSafariViewController`. Me adds the Community Guidelines link.
- **Year in Review (F-13):**
  - the 2026 season keeps the web link (C-9);
  - native Year in Review is built in Stage 6;
  - cutover follows parity, after the peak.
- **Unchanged, because the web doesn't have them either (F-14):** avatar upload and bio (C-6), data export (C-1).
- **Per-year stats (F-15)** are a per-year block in `userStats`, computed on the server, not on the device.
- **Not app screens (web by design):** the landing, compare and switch pages, public profiles, show, band and poster pages, shared collections, `/reset`, `/cookies`, and the PWA install prompt.
- **Two fixes regardless of screens:**
  - the welcome email after a first show moves to the server (`normalize-show`), because native never asked for it;
  - a guest's first show opens the account prompt, as on the web.
- **PR order:** Stage 4 (12 PRs, starting with its audit and a server PR) → Stage 5 (4) → Stage 6 (12) → internal TestFlight and cutover. Each PR is listed in `PARITY-AUDIT.md` §4.

## Stage 4: library screens (2026-11-18)

From the Stage 4 audit ([`STAGE4-AUDIT.md`](STAGE4-AUDIT.md)), approved with these calls:

- **Listening moves into Stage 4.** "Listen to this night" (Relisten and the Internet Archive) and "Where to stream this show" leave Stage 6 (6-8) and go in 4-4, with Songs.
- **The streaming list comes from the server** (A). `lib/streamingPlatforms.js` becomes CommonJS, and `archival-audio-lookup` adds a `streaming` list to its answer, built on every call and never cached. No Swift copy, and adding a band needs no app release.
- **Library rows for screens not built yet** (B): Festivals and Setlist Photos open the web until Stages 5 and 6. Guests don't see either row.
- **Both song keys stay** (C). The song page keys on the strict artist slug (`artistSlugFromName`: "goose (US)" is its own page); Stats keys on the loose band key (`bandKey`: merged). Stats' top songs keep opening the filtered show list. Unifying them is on the post-launch list (below).
- **The welcome email** is sent by `normalize-show` (an account's first show) and by `adopt-guest-shows` (shows moved into an account with none), as well as by `account-linked`. **The web keeps its own call** (D), for its offline adds and old Capacitor builds; the send is claimed in a transaction, so extra calls send nothing.
- **Per-year stats** are a `years` map on `userStats`, each entry `computeUserStats` on that year's shows plus `showsByMonth`. Additive, so `STATS_VERSION` stays 2.
- **`lib/songIndex.js` becomes CommonJS**, with a shared fixture for the song key and the gap rules; runs get a fixture for `lib/runIndex.js` (with `venuesFuzzyMatch`), and the user count one for `lib/userCount.js`.
- **The web's "Listen to this night"** is checked for a `DD-MM-YYYY` date in 4-2; `archival-audio-lookup` accepts only ISO. **Done (5.60.32):** the web sent the stored date as is, so `useArchivalAudio` now converts with `toIsoDate`.
- **Artist slugs trim first** (2026-11-18, 5.60.32): `artistSlugFromName` and its Swift port trim before slugging, so " Phish " is `phish`, as `bandKey` already read it. Production had no padded artist names (shows, upcoming shows, followed bands, favorite tours, wishlists, bucket list: 0 each), so no cleanup ran. `lib/wishlist.js` `artistKeyFor` keeps its rule: it names stored wishlist documents.
- **Navigation as built (4-3, native 4.0.30):**
  - one list, `LibraryDestination` (Core), drives Library in Me, Community on Stats and the sidebar; each later PR flips its item's `native` and swaps the web page for its screen;
  - the sidebar's Library section exists only when a sidebar can (regular width **and** height): an iPhone puts every `TabSection` tab in its tab bar, ignoring `.defaultVisibility(.hidden, for: .tabBar)`, so Search fell into "More", and a Max iPhone in landscape is regular width;
  - a guest's first show shows "Great start!" before the show opens, from the add flow (`AddOutcomeHandling`), so "I went" on an upcoming show gets it too.
- **Songs and listening as built (4-4, native 4.0.31):**
  - `SongIndex` (Core) is the Swift copy of `lib/songIndex.js` `buildSongIndex`, run against `fixtures/song-index/` (`SongIndexTests`); `ShowsStore.songIndex` builds it from the shows on the phone, once per list of shows and day. Guests get song pages too: it's their own data;
  - **the song list has one row per song page** (artist slug and title, call C), so "Arcadia" by Goose and by Phish are two rows. The web's Stats → Songs tab merges by title alone and its `/stats/songs` lists one band at a time; neither row could open one song page. Times seen are distinct shows, and the average is of the ratings you gave its performances, as `buildSongStats` averages them. Stats' tiles and top songs stay the server's;
  - **no two song counts disagree on screen** (2026-11-18): Stats' tile, which counts titles whatever the band (`uniqueSongCount`), is labeled "Different song titles", and the song list shows no total. Of the two options (that, or a list header like "10 songs across your bands"), this one never puts two different numbers in front of people;
  - links: `/songs/?artist=&song=` opens the song page and `/stats/songs` the list, both on Stats; `/bands/?band=&song=` is now its own route (the band's song page, 4-5) and opens the web until then. A setlist song's touch-and-hold menu has "Your history with this song"; a tap still rates it;
  - "Listen to this night" and "Where to stream this show" come from one `archival-audio-lookup` GET with the ISO day (`ShowDate`). Picking a recording writes `archivalAudioPick` alone, as the web does. A famous show lists dozens of recordings, so three show first, plus the picked one, then "Show all". When the lookup can't be reached, neither section shows (the web still draws its streaming links offline, from its own copy).
- **Bands as built (4-5, native 4.0.34):**
  - **every band has a page.** Your side (your shows, songs heard, first and last, most heard) and "About" need no snapshot, so a band you've logged or follow gets a page even without one. A band in `config/public-artists.json` also gets its own stats from the snapshot (`/api/artist`, `/api/artist-song`). The web sends an unknown band to Top Artists instead; native has no Top Artists screen to send it to;
  - the app bundles `config/` through a symlink (`Core/Sources/Core/Config`, a `.copy` resource), so the public bands and the song-title aliases are the files the web and the snapshot job read: no Swift copy of either. `/api/artists` decides only whether a band may be shown now (the Phish 24 hours); offline, every configured band counts and its page shows the error state, as the web's `loadBandIndex` does;
  - a band link carries the config slug (what the server's links use) or the app's own `BandFollows.slug` of the name; both find the same band (`BandDirectory.band(forSlug:)`), so "King Gizzard & the Lizard Wizard" opens one page whichever way it's linked. Your shows of a band are matched with `StatsKeys.bandKey`, which is the web's `artistNameKeyLoose`;
  - links in: the show and upcoming-show header (the band name), band-alert notifications (tour and on-sale; the dates and ticket links stay in the row), tour pushes (`/bands/?band=`), Bands you follow, and your shows of a band from Stats (the web's "Band stats"). A setlist song's touch-and-hold menu adds "<band> stats for this song" when the band has a song page for it;
  - "About" asks `get-entity-info` and `enrich-artist` when opened. It shows the web's links, except that a streaming link is named by its site ("Deezer", not "free streaming") and two links with one name show once;
  - "Fans also see" (F-4) and "Make my poster" (Stage 6) are not on the page.
- **Runs and tours as built (4-6, native 4.0.33):**
  - `RunIndex`, `TourIndex` and `VenueNames.fuzzyMatch` (Core) are the Swift copies of `lib/runIndex.js` and `venuesFuzzyMatch`, run against every case in `fixtures/runs/` (runs, tours, new songs on each tour, venue pairs). `ShowsStore.runs` and `.tours` build them once per list of shows. Guests get them too: their own shows;
  - favorite tours write the web's `favoriteTours/{uid}` document: a star is a merge of `tours.<key>` (`tourName`, `artistName`, `addedAt`); an unstar deletes that one field. Optimistic, reverted on failure;
  - links: `/tours` and `/tours/?tour=` open Tours in Me, `/runs/?run=` a run there, `/stats/runs` the runs list on Stats. Library → Tours and Runs open these screens (`LibraryDestination.route`), and so does the iPad sidebar;
  - the show page gains a card under the header: the tour (only when it's one of yours, as on the web), "Night N of M" for a run, and the venue, whose web page opens until 4-7;
  - tour info (current, recent, all-time, songs) and "Add more shows" call `get-artist-tours`, `get-artist-song-stats` and `get-tour-shows` with the artist's MusicBrainz id, taken from your own shows of the band (setlist.fm imports store it). Without one, a single exact setlist.fm name match is used, or you pick the band. A night you add goes to `normalize-show` as the row `get-tour-shows` sent (`kind: setlistfm`, `row`), as on the web; nights already yours (setlist.fm id, else band and day) are marked and can't be picked;
  - "Current tour" keeps the web's rule (the first tour, most recent start first, that ended within 30 days), so a one-off night with its own tour name can show as current over the main tour. Changing it is for both apps at once.
- **Venues as built (4-7, native 4.0.35):**
  - one key: `venueKeyFor` (`VenueNames.venueKey`, `name::city` trimmed and lowercased) names the page, the `venues` document, the ratings and the venue bucket list, as on the web. Every venue gets a page: most have no `venues` document, so the name and city come from your shows, else from the key;
  - `VenueService` (Core) reads and writes the web's documents and queries: `venues/{key}`; `venueRatings` (`where venueKey ==`, for the count, the average and your own rating); the newest 50 `venueAnnouncements` and 60 `venuePhotos`; `venueReports`; `bucketListVenues/{uid}_{key}`. Single gets with a deadline, reloaded on pull-to-refresh and after a write, instead of the web's live listeners;
  - a rating is saved under the web's document id and fields (`VenueRatings.writeData`); `venueName` and `venueCity` are the key's two halves, so they always join back into `venueKey`. The average is the web's `toFixed(1)` (exact ties round up: 4.25 is 4.3), checked against JavaScript for every mean of up to 400 ratings;
  - **guests:** the venue document, your shows and the bucket list button (the rules allow both); no ratings, photos, announcements or reports (`isAccount()`), with an account prompt in their place (D-1);
  - "Verify this Venue" (⋯ menu, unverified venues) and "Manage Venue" (the verified owner) open the web (F-6). SFSafariViewController doesn't share the app's sign-in, so the owner signs in there;
  - a venue name with "/" can't name a Firestore document (on the web either); the page skips the venue document and the bucket list for one, since asking the SDK raises an exception Swift can't catch;
  - links in: the show page's venue row, a tour stop's venue, venue alerts in notifications and `/venues/?venue=`. Stats' venue rows still open your shows there (the full lists are 4-8), and a `/shows/?venueKey=` link still opens the web.
- **Stats as built (4-8, native 4.0.36):**
  - the period picker offers "All time" and each year in `userStats.years`, newest first, and opens on All time (the web opens on the newest year; native has always shown all time, and rank is all time). Totals, the average show rating, shows by month and the top 10s are the server's numbers for the period; all time's months are the years' `showsByMonth` added up, the only sum the phone does. Rank, Community and Year in Review show for All time only;
  - the full lists (every band and venue, with shows, average show rating and songs heard or bands) and the top-rated shows come from the shows on the phone with the server's keys (`StatsLists`), as the web's Stats tabs build them. A test checks that, in every `fixtures/user-stats/` case and every period, the lists have one row per band and venue the server counted and the server's top counts. Ratings outside 1–10 don't count (the server's `validRating`; the web's lists count any rating). A year's songs are `SongIndex` built from that year's shows, without "Longest since seen";
  - `/stats/top-artists` and `/stats/top-venues` open the full lists (`AppRoute.statsList`), all time; with `/stats/songs` (4-4) and `/stats/runs` (4-6) every `/stats/*` page is native;
  - shows by year: every year from the first to the later of the last and this year, zeros included; labels on every fifth year plus the first and last, dropping a fifth year within two of an end; touch and drag reads "2024 · 12 shows" (`chartXSelection`); a tap picks that year (a tap gesture beside the selection, so the list still scrolls over the chart); this year is amber and the busiest year shows its count;
  - the Shows tab's Past | Upcoming switch is the list's first row, so a pull to refresh moves it with the list; the empty, loading and no-results states became rows under it, so it stays reachable;
  - a cancelled request (`URLError.cancelled`, a cancelled task) is `APIError.cancelled`, with no message: Me → Email showed the system's "cancelled" when its section's task ended. The section now says nothing for a cancellation, words its own load and save failures, and clears them on success.
- **Wishlist as built (4-9, native 4.0.37):**
  - the web's `wishlists/{uid}_{artistKey}` documents, read and written as lib/wishlist.js does: a star is one merge of `songs.<normalizeSongTitle>` (`{ title, addedAt }`) with no read first; an unstar deletes that one key. Optimistic, back on failure with a note on the row for five seconds. The artist key is `artistKeyFor` as it stands (the MusicBrainz id, else its own slug, untrimmed), since it names stored documents;
  - **guests have wishlists** (DECISIONS "Guests": the rules let them keep their own). The web shows its guests a sign-in prompt, but its guests are local-only; native guests are accounts on anonymous auth. Linking a credential keeps them (same uid), and adoption into an existing account (`adopt-guest-shows`) moves them since 5.60.34, merged by band;
  - a band is found with setlist.fm's search (`search-artists`), as the web's artist picker; its catalog is `get-artist-song-stats`, kept for 24 hours on the phone as the web keeps it. A band without a MusicBrainz id (a wishlist stored without one) gets the web's "no matched setlist.fm profile" message and still shows your seen songs and stars;
  - "The songs I've seen" matches your shows by the band's exact name (trimmed, any case), as the web does, not `bandKey`: "goose (US)" is another band here, as on the web's wishlist. Each opens your song page;
  - one search field filters all three lists by title (the web has none; Phish's catalog is about 900 songs);
  - `/wishlist` opens the hub in Me's Library; a band's own wishlist has no web link, so it has no deep link.
- **Bucket list as built (4-10, native 4.0.38):**
  - shows (`bucketList/{uid}_{itemKey}`) and venues (`bucketListVenues/{uid}_{venueKey}`), read and written as lib/bucketList.js and lib/bucketListVenues.js do; a show added by hand is the web's document (`source: manual`, `bucketListItemKey`). Guests too (DECISIONS "Guests"); the web shows its local-only guests a sign-in prompt instead;
  - "Coming up" lists today and later, as the web does, sorted soonest or A–Z and filtered by band or venue. **Shows whose date has passed get their own section ("Already happened")**, where the web stops listing them, because that's when "I went" is useful;
  - "I went" adds the show as `TicketScan` does: setlist.fm's setlist for that night when there is one, else the show by hand (it needs a venue), through `normalize-show` and the add flow's alerts and duplicate question. The bucket item is removed once the show is added, already there, or queued. The web opens its add form prefilled instead;
  - "Add to Calendar" is EventKitUI's event editor with an all-day event (iOS 17 lets an app show it without asking for calendar access; the person saves it). Its location is the venue plus the city; Apple's place search (four seconds at most) adds the coordinates, making it a structured location that Calendar maps and opens in Maps, and without a match it stays text (4.0.39). **A show saved without a venue gets it from Ticketmaster first** (decided 2026-11-19): `find-bucket-venue` (accounts only, 20 a day) finds the band's event that day, in the show's city when it has one, and the app saves the venue (and the city, state and ticket link where missing) to the show and uses its coordinates. Guests and shows Ticketmaster can't place keep the city. The web opens a Google Calendar link;
  - "Share with friends" sends the list as text through the share sheet, as the web does (`navigator.share`; its `create-shared-collection` is the separate past-shows page): no public page, so guests can share too. Each line is the band, date, venue and city, with no links, in both apps since 4.0.39 and 5.60.35 (decided 2026-11-19);
  - venues open the native venue page (4-7); adding one keys it with `venueKeyFor(name, city)`, as the web does;
  - each show's meetup card stays on the web (meetups, C-4), and "add to bucket list" from tour dates isn't here yet;
  - `/bucket-list` opens it in Me's Library.
- **Community as built (4-11, native 4.0.40):**
  - one screen, `/community` (on Stats, and in a wide iPad window's sidebar), from `communityStats/global` as the web's `CommunityStatsView` shows it: the top five show-goers, raters, rated songs and venues, then the totals and "Updated …";
  - the boards are the same for everyone; someone you've blocked is left out of your copy, as on the web;
  - a name opens that person's card (Report and Block, Guideline 1.2); for guests and for your own name it's plain text. "Add" sends a friend request, and a guest's opens the account prompt, as on the web;
  - Total Users shows only from 1,000 users (`UserCount.shouldShow`, now checked against `fixtures/user-count/threshold.json`); below that the tile isn't there at all;
  - guests can look (the rules let anyone read `communityStats`).
- **Search tab as built (4-12, native 4.0.41):**
  - the search field finds your past shows by band, venue, city or song at once (the Shows tab's own search rule, `ShowList`);
  - **Advanced search** is the web's (`lib/advancedSearch.js` as `ShowSearch`): every filter, the three date presets, the four sorts, "matched your notes / a song / tagged friend", and "No shows match these filters". Results update as you type instead of waiting for a Search button, so a search goes into Recent searches when you leave it. Saved searches (20) and recent searches (8) stay on the device per person, as the web keeps them in localStorage; a recent search reopens its filters, where the web only lists it. `/advanced-search` opens it;
  - **guests can use it** on their own shows (DECISIONS "Guests" allows their own shows and stats); the web asks a guest to sign in because its guest shows aren't in Firestore. The friend filter shows only for accounts with friends;
  - **By artist** is the Shows page's view: every band with its show count and average rating, sorted by most shows, rating or name, each opening to its shows and band page;
  - **Add shows from a tour** is the web's TourBrowseModal (`lib/tourBrowse.js` as `TourBrowse`), also from Tours and a tour page: "Goose Summer Tour 2025" goes straight to the tour when the band name is clear, else to the pickers with the text filled in; nights already yours can't be picked, a night that may be yours (same band and day, venue spelled differently) says so and can be picked (sent with `confirmPossible`, as the web sends every tour night); select all, filter, months for a long tour, a warning above 20 nights, "try again" for nights that failed, and the tour's page once everything is in;
  - searching setlist.fm to add one show stays under + on Shows.
- **PR order:** 4-1 audit → 4-2 server → 4-3 navigation → 4-4 songs and listening → 4-5 bands → 4-6 runs and tours → 4-7 venues → 4-8 stats → 4-9 wishlist → 4-10 bucket list → 4-11 Community → 4-12 Search tab.

## Stage 5: festivals (2026-11-19)

From the Stage 5 audit ([`STAGE5-AUDIT.md`](STAGE5-AUDIT.md)), approved with all four calls as recommended:

- **Festival writes that others read go through the server**, in one function, `netlify/functions/festivals.js` (the `friends.js` pattern, accounts only): `create` (the shared festival and the creator's attendance record in one batch, with an attendance id the app mints so a retry can't make a second festival), `join`, `leave` (clears `festivalId` on every one of the caller's shows found on the server, then deletes the record; the shared festival stays) and `update` (A: the creator's or the admin's edit of name, dates and location). The web switches to them. Notes, the typed lineup (`myLineup`) and attaching or removing shows stay direct one-field writes to the person's own documents, so they work offline.
- **Picks are scored on the server** (B): `festival-lineup` returns `picks` (recommended, bands you love, everyone else, with each recommendation's reason) beside the lineup, from the caller's shows, followed bands and dismissed list, with `lib/recommendations.js`. No Swift copy. The web keeps scoring in the browser with the same module.
- **Festival stats use the shared keys, in both apps** (C): artists by `bandKey` (shown with the first spelling), the average over 1–10 ratings only (`validRating`), days by ISO date. `lib/festivalGrouping.js`, `lib/festivalDates.js` (without the label, which formats per app) and `lib/festivalCatalog.js` become CommonJS, pinned by `fixtures/festivals/`. The owner's own stats come from their cached shows; nobody else sees them.
- **No web "Different song titles" tile** (D): the web never showed `uniqueSongCount`, so the carry-over is dropped and the unused `summaryStats.totalSongs` goes.
- **The lineup search import checks duplicates with `normalize-show` `preview`**, then commits `festival-row` inputs, so conflicts (a show already in another festival) are asked about before anything is written, as on the web, with no Swift copy of `classifyDuplicate`.
- **Guests** see "Create an account to use Festivals"; every festival path refuses them already.
- **Old Capacitor builds** write festivals from the phone until `minSupportedIosVersion` reaches the Part 2 build (`GATED-CLEANUPS.md`). Part 2 first counts attendance records from before 5.30.0 (no `festivalId`), whose owners edit name and dates on their own record.
- **List and page as built (5-3, native 4.0.44):**
  - `FestivalsStore` (Core, accounts only, owned by `AppShell`) reads each attendance record and its shared festival the way the web's `loadFestivals` does, into `Festival` (the joined view, `Festival.joined`, checked against `fixtures/festivals/joined.json`). The device's copy shows first, then the server's (10 s deadline); offline, the list says so instead of spinning. A shared festival that can't be read leaves the record as "unavailable", as on the web;
  - `FestivalDates` and `FestivalStats` are the Swift copies of `lib/festivalDates.js` and `lib/festivalGrouping.js`, run against `fixtures/festivals/dates.json` and `stats.json`. The tiles come from the shows on the phone;
  - the list's filter matches a show's band or venue (the web's shared show filter) **and the festival's own name** (the web matches shows only), plus a year menu; the web's single-date filter isn't there. With no festivals, "New festival on mysetlists.net" opens the web until 5-4;
  - the page: header (catalog and "added by another user" notes, cut short), Shows attended · Artists · Days · Avg rating, notes (one `updateData` of the record's `notes`), artists and the lineup opening band pages (the web's artist chips open a filtered show list), the lineup with its credit, and the shows by day with swipe to remove. An upcoming festival asks `festival-lineup` when opened, as the web does;
  - "Pick from my shows" and remove write the show's `festivalId` alone (`ShowsStore.setFestival`, one batch), so both work offline; a show already in another festival is moved only after asking. Leave is `festivals.js` `leave` and says so when offline;
  - links: Library → Festivals, `/festivals` and `/festivals/?festival=` (and the old `/festivals/<id>`) open in Me; a festival link names an attendance id, so someone else's shows "Festival not found". The show page's festival badge opens the festival, and every show row names its festival;
  - guests reaching a festival link get "Create an account to use Festivals".
- **Create, join, edit, lineup search and picks as built (5-4, native 4.0.45):**
  - "New festival" (list toolbar and empty state) is the web's form: name; start and end dates, or "I don't know the exact dates" and a year (the start date's year carries over); location; notes. As it fills in, `match-festivals` (400 ms after the last change) offers festivals someone already added, with Join; the button becomes "Create anyway". Create and Join are `festivals.js`, with an attendance id minted on the device; either opens the festival's page;
  - "Edit festival" (the creator, or a record from before 5.30.0) is the same form for the shared details, through `festivals.js` `update`; someone else's festival offers only "Edit your note";
  - the typed lineup ("Enter the lineup" / "Edit lineup", when there's no shared one) is one `updateData` of `myLineup`: one band per line, trimmed, each once, 300 at most, as the web saves it;
  - "Your picks" are `festival-lineup`'s `picks` (Stage 5 call B), asked for an upcoming festival or any festival with a lineup, and again after the typed lineup changes; until the answer comes, or offline, the lineup shows as a plain list. Every band opens its band page;
  - "Search the lineup" (menu and empty state) asks `search-festival-lineup` ("Find who played" or "By artist") with the festival's own name, city and dates (or year), with the web's warnings for a year-only festival and one without a location. Adding the picked sets is `ShowsStore.importLineup`: a `normalize-show` preview of every set as a `festival-row` input, a set already logged attached rather than added again (a `possible` match is added), already-logged sets in another festival asked about before anything is written, then a commit of the new ones (25 at a time) and `setFestival` for the rest. It needs a connection and says so; it isn't queued in the outbox;
  - "Already logged" on a result is the web's simple key (setlist.fm id, or band, venue and day); the import's real check is the server's.
- **PR order:** 5-1 audit → 5-2 server → 5-3 list and page → 5-4 create, join, edit, lineup search, picks.

## Stage 6: parity (2026-11-19)

From the Stage 6 audit ([`STAGE6-AUDIT.md`](STAGE6-AUDIT.md)), approved with all eleven calls as recommended:

- **Likes and meetups go through the server** (A). `engagement-notify` writes comment and photo likes (`like`, `unlike`), and notifies on a like as before. A new `netlify/functions/meetups.js` (accounts only) does create-or-join, from the caller's own bucket list item with names from the profile, and leave. The web switches; the client rules wait for old builds (`GATED-CLEANUPS.md`).
- **The activity feed goes through the server** (B). `friends.js` `activity` reads it: mutual friends only, blocks either way removed, newest first, paged. The server writes it: `normalize-show` (an account's single add), `moderate-content` (`commented`, `shared_media`) and `friends.js` `rated` (the rating read from the stored show), each checking the actor's `shareActivity`, with ids that make a retry harmless. Bulk adds and imports log nothing. The read dedupes until old builds stop writing.
- **CSV and Excel are parsed on the server** (C): `import-sheet` with `parse`, `plan` (duplicates against the caller's stored shows) and `match` (one show a call), accounts only, 2 MB and 2,000 rows a file. SheetJS 0.20.x (pinned by URL) replaces npm's `xlsx` 0.18.5 for the server and the web.
- **Year in Review's rarity and show buddy come from an on-demand read** (D), `year-recap`, not from the stored `recap`: a public review would show the buddy. The web switches to it.
- **The recap card is `my-poster`'s image** (E), drawn on the server as the web's is; no native `ImageRenderer` copy.
- **One native Year in Review layout, from `recap`, for every year** with a review document (F). 2026 is native from Jan 16, 2027 (`RecapWindow`); before that the Stats card keeps opening the web (C-9). Someone else's public review opens the web.
- **The poster record is built on the server** (G): `lib/myPoster.js` becomes CommonJS; `my-poster` gains `record` and accepts `artist` in place of `record`.
- **No native copy of the web's popups** (H). What's New's JSON can carry an optional announcement.
- **`showMedia` is checked on the server before native uploads to it** (I): the Storage path must be the caller's under the concert's segment, the URL is built and the size read from Storage by the server, 50 MB per concert, YouTube links rebuilt from their id; replies name an existing top-level comment on the same concert; daily limits on comments, messages and uploads; an admin's delete removes the Storage file too.
- **Meetup fixes** (J): `attendeeNames` may change only at the caller's own key (not gated); email-shaped names already stored are counted and replaced (`scripts/cleanup-meetup-names.js`, dry run unless `--apply`); a `meetup` report type for the pinned details (to the queue, never auto-hidden); messages need the meetup to exist. Natively, blocked people's names and details are hidden.
- **6-2 splits in three** (K): 6-2a (social server) before comments, photos, meetups and activity; 6-2b (`import-sheet`) before imports; 6-2c (`year-recap`, poster record) before posters and Year in Review.
- **Social server as built (6-2a, 5.60.38, iOS 3.13.54, native 4.0.47):**
  - likes: `engagement-notify` `{ type: 'comment_like' | 'photo_like', id, liked }` → `{ liked, likeCount, written }` (a banned account 403, 1,000 a day); the old notify-only shape stays for old builds;
  - meetups: `meetups.js` `join { bucketListItemKey }` (the item's stored document key, as `listBucketList` gives it) or `join { meetupId }`, and `leave { meetupId }` → `{ meetup, created?, already? }`; the meetup's show fields go through the content filter (422); 200 a day;
  - activity: `friends.js` `activity { before? }` → `{ items, next }` (100 a page; `timestamp` in ms; `before` is the last page's `next`) and `rated { showId }`; entries written by `normalize-show` (one show added: kinds `setlistfm`, `manual`, `upcoming`, `tag`, `email-tag`), `moderate-content` (`commented`, `shared_media`, linked to `showId` only when it's the poster's own show) and `rated`;
  - uploads: the app uploads to `showPhotos/{ConcertKeys.mediaPathSegment}/{uid}/{name}` with its `contentType`, then sends `moderate-content` `showMedia` with `storagePath` (or a YouTube `url`), `category`, `caption`, `show` and its own `showId`; the answer carries the stored `url`. Refusals have codes: `bad_path`, `no_upload`, `bad_type` (JPEG, PNG, GIF, WebP; MP4 for photos only), `too_large`, `concert_full`, `duplicate`, `bad_link`, `daily_limit`;
  - replies: `bad_parent` unless the parent is a top-level comment on the same concert;
  - `ConcertKeys` (Core) and `lib/concertKeys.js` are the shared keys (`fixtures/concert-keys/`); the meetup-name dry run found no meetups in production.
- **Comments as built (6-3, native 4.0.48):**
  - a Comments card at the bottom of the show page, for accounts; guests get "Create an account to see comments" (D-1);
  - `CommentsStore` (Core) per open show page: the web's live query on `showComments` by concert key, and `commentViews` read once then stamped for "New"; posting and replying through `moderate-content` (with the poster's own `showId`), likes through `engagement-notify` (shown at once, put back on failure), reports through `report-content` (`showComment`, hidden for you at once), and deleting your own comment directly (the one client write, which the rules allow its author);
  - `CommentThread` orders top-level comments oldest first with their replies under them; replies to a deleted comment and comments from people you blocked don't show;
  - "@" mentions suggest your friends when the "@" is at the end of the text (SwiftUI gives no cursor position); the server does the notifying. No Swift copy of the content filter: the server's message shows under the box;
  - you can't like your own comment (the web lets you, and notifies nobody); a name opens the person's card (Report, Block);
  - reply, mention and comment-like notifications open the show natively; photo likes open the web until 6-4;
  - `ReportContentSheet` is shared with photos and meetups (6-4, 6-5).
- **PR order:** 6-1 audit → 6-2a → 6-3 comments → 6-4 photos → 6-5 meetups → 6-6 activity → 6-2b → 6-7 imports → 6-8 show extras → 6-2c → 6-9 posters → 6-10 Year in Review → 6-11 profile and help → 6-12 parity check.

## Post-launch list

Work decided for after cutover, not before:

- **`export-my-data`** (Data export, above; Stage 2 C-1).
- **Unify the song keys** (Stage 4 C): one key for the song page and Stats, with redirects for the old `/songs?song=` links.
- **Venue aliases for runs** (2026-11-18): runs match venues with `venuesFuzzyMatch` (`lib/showIdentity.js`), so "MSG" and "Madison Square Garden" don't match and a night logged under the other name splits a run (`fixtures/runs/` pins it). A small alias table (MSG = Madison Square Garden, and the like), shared by the web and native through the same fixture.
- **A public `/shared` bucket-list link** (2026-11-19): "Share with friends" sends plain text in both apps today. A public page for the bucket list, like the past-shows `/shared` collection, would need `create-shared-collection` to build one from `bucketList` (accounts only, as now).
- **One copy of the gap math** (2026-11-18): `netlify/functions/lib/artistSnapshotStats.js` keeps its own port of `lib/songIndex.js`'s gaps for the public band snapshot, checked by `lib/__tests__/artistSnapshotStatsParity.test.js`. `lib/songIndex.js` is CommonJS since 5.60.32, so the snapshot can require it and the copy and the parity test go (CLAUDE.md: no server twin of a `lib/` module).
