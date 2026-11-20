# Internal TestFlight, then cutover

Build order item 7 (`DECISIONS.md`): with Stage 6 merged (#488, parity check: every PARITY-AUDIT row closed), the native app goes to a round of internal TestFlight testing, then replaces the Capacitor app per SCOPING §7.4. Cutover itself waits until after the Year in Review peak (late January at the earliest, DECISIONS "Cutover timing"). Written 2026-11-20 against `main` at 35b296e (native 4.0.58, web 5.60.42, Capacitor 3.13.58).

## 1. Where the build pipeline stands

- **Xcode Cloud already sends every `main` merge that touches `ios-native/` or `fixtures/` to internal TestFlight** ("Native: internal TestFlight", `XCODE-CLOUD.md`). Its Archive succeeded for 4.0.57 (#488); 4.0.58 (#489) was building when this was written.
- **Signing and entitlements are the App Store ones:** `aps-environment` production, Sign in with Apple, `applinks:mysetlists.net` (`ios-native/Config/MySetlistsRelease.entitlements`). So push and universal links behave on TestFlight as they will in the App Store.
- **Universal links:** `public/.well-known/apple-app-site-association` claims every route the native app opens, including `/bands`, `/my-poster`, `/upcoming` and referral links. Nothing to change.
- **Crashlytics** is in the build with dSYM upload in the Archive (DECISIONS "Architecture"), so TestFlight crashes show in the Firebase console.
- **One unrelated CI note:** the post-merge Integration Tests failed once on `main` (3fa541d) because setlist.fm answered a search test with 429 (rate limited). The runs before and after passed, and that commit changed only docs and native code. It isn't a regression.

## 2. Before inviting testers (Phillip, in App Store Connect)

1. **Check the newest build:** TestFlight → iOS builds shows **4.0.58** (or later), "Ready to Test", in the "Native internal" group.
2. **Add the internal testers** to "Native internal" (internal testers must be App Store Connect users on the team, up to 100). No external testing: native builds stay internal until cutover (DECISIONS "Platform and project").
3. **Paste the What to Test text** (§3) into the build's test information.
4. **Tell testers before they install:** a phone holds one build of `com.mysetlists.app`, so installing the native TestFlight build **replaces the App Store app on that phone**. Google accounts stay signed in; Apple and email accounts sign in once (Q-01). Going back means reinstalling from the App Store and signing in again there.
5. **Guests must not test on their main phone** until Q-02 (§5) is decided: a Capacitor guest's shows live only in that app's storage and don't come across.

## 3. What to Test (TestFlight text)

> This is the new, fully native MySetlists. It replaces the App Store app on this phone, and your shows are safe in your account. If you signed in with Apple or email, sign in once more.
>
> Please try what you normally do, then:
> - add a show (setlist.fm search, by hand, ticket scan, upcoming, import) and edit its setlist and ratings
> - Stats, a year's Year in Review, and Make my poster on a band's page
> - friends: add one, tag them at a show, comments and photos
> - Me: your profile, notes, How to Use, Send feedback and the roadmap
>
> Report anything wrong with Send feedback in Me, or the TestFlight screenshot feedback. Include what you tapped and what you expected.

## 4. The test round

Each area lists what a tester checks, roughly in the order of the stages that built it. Two accounts are needed for the social checks; use a throwaway account for deletion.

| Area | Check |
|---|---|
| **Sign-in** | Install over the App Store app: Google lands on Shows; Apple and email see "Welcome back" and sign in. Continue as guest, add a show, then create an account (the shows stay). Sign in with an existing account from a guest (adoption: the guest's shows move in). Sign out with unsynced changes (the warning). |
| **Shows** | Past and Upcoming; search and filters; add by setlist.fm, by hand, ticket scan, upcoming then "I went"; add offline (Waiting to sync), then online. |
| **Show page** | Rate the show, venue and songs; a note; edit the setlist (add, move, remove, undo); accept or skip a newer setlist; play counts; listening links; Relive this night. |
| **Social on a show** | Comments (reply, mention, like, report, delete); photos and videos (upload a HEIC photo and a video, like, report, delete); tag a friend and confirm on the second account. |
| **Stats** | All time and a year; top lists open the shows; rank; Community; the Songs I've heard card; a year's "Your <year> in review": rare ones, show buddy, the card, Share link. 2026 still opens the web until Jan 16. |
| **Library** | Tours, Runs, Festivals (create, join, lineup, picks), Wishlist, Bucket List, Setlist Photos; band, song and venue pages; follow a band. |
| **Friends** | Requests, invites, Shows together, Activity, the bell; block and unblock. |
| **Push** | Allow push when following a band; a friend tags you (second account) and the push opens the show. |
| **Me** | Name, handle, photo, public profile and Preview, leaderboard, email preferences, alerts, achievements, Your notes, How to Use, What's new, Send feedback, the roadmap and a vote. |
| **Imports** | A CSV or Excel file from Files, and a screenshot of past events. |
| **iPad** | The sidebar at full width; Split View at a third (the phone layout). |
| **Delete account** (throwaway) | Me → Delete my account, including an Apple account (the Apple sheet). |

**What to watch while they test:**
- **Crashlytics** (Firebase console → MySetlists iOS): crash-free users by build.
- **The first-launch report** (five taps on the version in Me → "First-launch sign-in"): what each install found on its first launch, over the Capacitor app. It stays until the cutover numbers are in (DECISIONS "Debug rows").
- **Send feedback** documents and roadmap drafts (Admin), and TestFlight feedback.
- **`pushTokens`** documents re-registering for testers who allowed push.

## 5. Decisions needed before cutover

1. **Q-02: Capacitor guests' shows.** A Capacitor or web guest's shows live only in that app's storage. When the native app installs over the Capacitor app, that storage is left behind, so a guest who never made an account loses their shows. Native guests are accounts on anonymous auth and aren't affected. SCOPING §7.4 step 2 proposed a last Capacitor release that (a) prompts guests to make an account and (b) optionally hands their shows to the native app through `@capacitor/preferences`; (b) was never tested. The Capacitor app has shown the "keep your shows" banner since 5.59.10, which covers (a) in part. **Size it first:** `node scripts/count-capacitor-guests.js` (new, read-only, counts only) gives the unconverted app guests with shows, and how many started in the last 30 and 90 days. The production read was refused from this session, so it needs running by you. Then choose: the banner as it is, a stronger last-release prompt, or the hand-off spike.
2. **The App Store version.** DECISIONS says "the native app ships as 4.0.0", but every native PR has bumped the patch version since (now 4.0.58), and App Store versions can only go up. The release can be the 4.0.x it reaches, or a minor bump such as **4.1.0** for the launch (CLAUDE.md: a minor bump only when you ask for one). `public/native/whats-new.json` then gets an entry for that version describing the native app.
3. **The App Store listing:** screenshots and description show the Capacitor app's UI (drawer, tabs). New screenshots of the native app are needed before release (App Store Connect).
4. **Privacy labels (Q-08)** in App Store Connect against `ios-native/App/Resources/PrivacyInfo.xcprivacy`: no tracking. Collected and linked to the account, for app functionality: email address, name, user ID, photos or videos, other user content. Not linked: crash data and other diagnostic data (Crashlytics). Product interaction is gone (no analytics SDK). Required-reason API: UserDefaults (CA92.1).

## 6. Cutover checklist (SCOPING §7.4)

| Step | Status |
|---|---|
| Same bundle ID and App Store record | Done (DECISIONS) |
| Sign-in carry-over tested (Q-01) | Done 2026-11-15: Google carries over; Apple and email sign in again with "Welcome back" (4.0.6) |
| Capacitor guests (Q-02) | **Open:** §5.1 |
| Internal TestFlight round | **This document**, §2 to §4 |
| Announcement email a few days ahead (`admin-send-announcement`) | To write at cutover. Draft: "MySetlists for iPhone is now a fully native app. Your shows are safe in your account. If you signed in with Apple or email, you'll sign in once more after the update. Using MySetlists as a guest? Create a free account first to keep your shows." |
| In-app message on first native launch | Done: "Welcome back" on the sign-in screen after an update from the Capacitor app (4.0.6) |
| Privacy policy's deletion path | At cutover: change "Profile → Delete My Account" to "Me → Delete my account" in `components/PrivacyPolicy.jsx` (DECISIONS "Data export and the offline cache") |
| Privacy labels, listing, version | **Open:** §5.2 to §5.4 |
| Phased release, watching Crashlytics, sign-in success and `pushTokens` | At release |
| Forcing updates | No new key needed: `minSupportedIosVersion` compares 4.x above every 3.x, so raising it to a 4.0.x retires every Capacitor build and older native builds alike |
| Freeze `ios/` for one release cycle as the rollback path, then remove Capacitor (web-only cleanup PR) | After release |
| Rollback | A Capacitor build from the frozen `ios/` with a version above the native one (DECISIONS "Xcode Cloud"); native writes stay readable by the web throughout |
| `GATED-CLEANUPS.md` (rules tightening on `minSupportedIosVersion`) | After release, once no Capacitor build is in use |
| Remove the first-launch report | After the cutover numbers are in |
