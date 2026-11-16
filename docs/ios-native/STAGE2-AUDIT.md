# Stage 2 audit: Stats, Me, moderation

Part 1 of "MySetlists — SwiftUI Stage 2", read against `main` at 296d228 (native 4.0.13; #438 ticket scan open as 4.0.14). Nothing here is built yet. The calls (**C-n**) were approved on 2026-11-15 with the changes in §8, and DECISIONS.md "Stage 2" records them.

What native already has, so the parts below only list what's left:

- **Models:** `UserStats`, `PublicUserStats`, `CommunityStats` (`Core/Models/Stats.swift`), `UserProfile`, `YearInReview` decode the server documents.
- **Session:** delete account with the Apple sheet, guest upgrade (link Apple/Google/email, `account-linked`), credential-in-use adoption (`adopt-guest-shows` preview and commit), the suspended gate, the update-required screen with "Delete my account", sign-out that never hangs (`Core/Auth/SessionStore.swift`, `Features/Auth`).
- **Recompute:** `ShowsStore` calls `recompute-my-stats` 3 s after a change, as the web does.
- **Me:** identity, "Create your account", sign out, delete, legal links, version (`Features/Me/MeView.swift`).

## 1. Stats

### 1.1 What the server stores

`userStats/{uid}` (owner and admin read, no client writes), written by `lib/stats` through `recompute-my-stats` and the 6-hourly `community-stats` job:

| Field | Meaning (`lib/stats/index.js`) |
|---|---|
| `showCount`, `songCount`, `ratedSongCount`, `uniqueSongCount` | shows; setlist entries; rated entries; distinct song keys |
| `bandCount`, `venueCount`, `yearsActive` | distinct band keys (loose); `countVenues` keys; distinct years |
| `showsByYear` | `{ "2026": 29, … }` |
| `firstShowDate`, `lastShowDate` | ISO |
| `avgShowRating`, `ratedShowCount` | one decimal, number since 5.60.12 |
| `topBands`, `topVenues` | top **5**, `{ name, count }`, all time |
| `ranked`, `rank`, `rankedOf` | rank by show count among ranked accounts; `rankedOf` is a user count |

`publicUserStats/{uid}` (any signed-in reader): `showCount`, `songCount`, `ratedSongCount`, `venueCount`, `rank`, `rankedOf`. `communityStats/global`: leaderboards and `totalUsers` (public). `yearInReviews/{uid}_{year}`: `stats` and the 2026 `recap`, written by the server **only onto review documents that already exist** (one is created when the person opens their review).

Guests: `recompute-my-stats` takes a guest's token (`requireUser`) and writes their `userStats` with `ranked: false`. The rules let them read their own.

### 1.2 The web Stats pages, section by section

| Web section | Where its numbers come from | Server field for native | Gap |
|---|---|---|---|
| Profile tiles: Shows, Songs Heard, Songs Rated, Venues, Artists | `headlineStats` = `userStats` when its `showCount` matches the loaded shows, else `computeUserStats(shows)` in the browser | `showCount`, `songCount`, `ratedSongCount`, `venueCount`, `bandCount` | none |
| Profile: Rank "#N" (+ "of N" only via `shouldShowUserCount`) | `userStats.rank` / `rankedOf` | `rank`, `ranked` | none; native shows "#N" only (C-5) |
| Profile: Average Show Rating | `userStats.avgShowRating` (count from shows) | `avgShowRating`, `ratedShowCount` | none |
| `/stats` header line, period tiles (Shows, **Hours of live music** = shows × 2, Songs heard, Artists) | **browser**: `computeUserStats(periodShows)` for the chosen period (All-time or a year), and the shows/filters on screen | all-time only: `showCount`, `songCount`, `bandCount` | per-year numbers and "hours" aren't on the server (C-3, C-4) |
| `/stats` Show frequency heatmap (shows per month) | **browser** | none | monthly counts aren't on the server (C-3) |
| `/stats` Detailed breakdown tabs: Years, Songs, Artists, Venues, Top Shows | **browser** (`getSongStats`, `getArtistStats`, `getVenueStats`, `getTopRatedShows` over the filtered shows) | Years: `showsByYear`. Artists/Venues: `topBands`/`topVenues` (top 5). Songs: **none**. Top Shows: none | top songs and top-rated shows aren't on the server (C-2) |
| `/stats/top-artists` | **browser**: count by the **exact** artist string, top **8**, per period | `topBands` (loose band key, top 5, all time) | different key and length: "Goose" and "goose (US)" are one band on the server, two on this page (C-2) |
| `/stats/top-venues` | **browser**, per period | `topVenues` (top 5) | length and period (C-2, C-3) |
| `/stats/songs` (per artist) | **browser** | none | Stage 4 (songs and band pages) |
| `/stats/runs` | **browser** (`lib/runIndex.js`) | none | Stage 4 (runs) |
| `RecapStatsCard` ("Your 2026 in review") | **browser** `computeYearRecap(shows, 2026)`, shown while `recapPromoActive()` (Dec 2 – Jan 15, Pacific) | `yearInReviews/{uid}_2026.recap`, only if the document exists | native shows a link without numbers (C-9) |
| Streaks | not on the Stats page; Year in Review only | — | none for Stage 2 |
| Charts | heatmap (above); no other chart | — | native adds a shows-by-year chart from `showsByYear` |

**What "Stats match the web for Phillip's account" can mean today:** the totals, rank and average match exactly (both read `userStats`). The top lists can't match `/stats/top-artists` as it stands, because that page counts exact names, top 8, per period. They match the server's definition (`topBands`, the same key Year in Review uses). C-2 picks which.

### 1.3 Tapping a band, song or venue

v1 opens a list of your shows for it, filtered from `ShowsStore`'s cached shows. That's a filter of your own data for display, not a stat. To keep one definition of "the same band" and "the same venue", the filter needs the server's keys. Port `lib/stats/keys.js` (`bandKey`, `songKey`) and `lib/venueCount.js`'s key to Swift with a small shared fixture (`fixtures/stats-keys/`), run by a JS test and a Swift test. That's the same pattern as `setlistEdits`. The counts on the list come from the server; the list itself is your shows.

## 2. Me and Profile

Every setting on the web's `components/profile/ProfileView.js`:

| Setting | Write path | Guest |
|---|---|---|
| Display name | `moderate-content` (server filter; the rules refuse client writes of `displayName`/`firstName`/`handle`), then Firebase Auth `updateProfile` | **No**: `moderate-content` returns 403 `account_required` |
| Photo | a **typed "Photo URL" field**: `updateProfile` + `userProfiles.photoURL` field write. No upload, no Storage path for avatars | rules allow; hide for guests (public UGC) |
| Bio | **doesn't exist** on the web or the server | — (C-6) |
| Handle (needed for a public profile) | `moderate-content` (`lib/handles.js claimHandle`) | No |
| Public profile | `userProfiles.publicProfile` field write; needs a handle | No (needs a handle) |
| Activity feed sharing | `userProfiles.shareActivity` field write | the feed is UGC, v1.x; hide |
| Community leaderboard opt-out | `userProfiles.showOnLeaderboard` field write (rules require a bool), then `recompute-my-stats` | No (guests are never on it) |
| Email: "Product news & announcements", "All emails" | `GET`/`POST /api/email-preferences` → `update-email-preferences` (server; opt-out flags plus address-level suppression) | No address; hide. Check in Part 3 what the function answers for a token with no email |
| Data export | **doesn't exist** (C-1) | — |
| Connected accounts | not on the web. Native reads `providerData` (already in `SessionStore.User.providerIDs`) | shows "Guest" |
| Bands you follow | `userProfiles.favoriteArtists` (push alerts) | Stage 3 |
| My Comments | read from shows | v1.x |
| Help & support, How to Use, Release notes, Feedback, Roadmap | web links (`/how-to-use`, `/release-notes`, `/feedback`, `/roadmap`) | Feedback yes; roadmap read only (D-3) |
| Terms, Privacy, app version and build | links; `AppInfo` | yes |
| Delete account | `delete-account` (§3) | yes |

Every write above is one field (`updateData`) or a server call, never a whole profile. `userProfiles` update rules allow these fields for the owner, and nothing in Stage 2 needs a rules change except C-6 if it's taken.

## 3. Account lifecycle

### 3.1 Deletion (built; gaps listed)

- **Server:** `delete-account` takes `{ confirmText: "DELETE" }` plus, for Apple, `{ appleToken, appleTokenType: "CODE" }`. It writes an audit record, revokes Apple's tokens, disables the Auth account, revokes refresh tokens, then purges everything in `lib/userDataPurge.js`: the user subtree, owned documents, array memberships, tombstones (reports keep the record, not the identity) and Storage. The purge is idempotent.
- **Native today:** the Apple sheet first (cancel = no deletion; a different Apple ID = no code), the POST, then `termsRecord.forget` and `signOut()`. Every sign-out step is bounded at 4 s.
- **Gap 3-a: queues aren't cleared.** `signOut()` deletes `ShowOutbox` and `SetlistEditQueue` only for guests, so a deleted account's files stay on the phone. Part 4 deletes both for the deleted uid.
- **Gap 3-b: timeout.** `APIClient` requests time out at 30 s, and a heavy purge can take longer. The account is disabled before the purge starts, so a timeout can leave a deleted account with the message "couldn't be deleted". Part 4: give this one call a longer timeout. On a timeout, check the account: a forced token refresh fails with `user-disabled` or `user-token-revoked` once it's gone. In that case treat it as deleted and sign out.
- **Landing:** after deletion, the signed-out screen (`AccountGate` → sign-in). The 5.60.x rule holds: deletion never waits on push cleanup or Apple.

### 3.2 Guest upgrade (built; one gap)

- **Same-uid link:** `user.link(with:)`, refresh the token, `account-linked` (claims invites, uses a kept referral, sends the welcome email if due, recomputes stats so the account is ranked, marks the profile converted), then the display name through `moderate-content`. The outbox, edit queue and terms record are keyed by uid, so they survive as they are.
- **Credential already has an account:** sign in to that account, `adopt-guest-shows` preview, the user picks any `possible` matches, then commit. The server moves the shows, upcoming shows and followed bands, then deletes the guest.
- **Gap 3-c: unsynced guest changes are lost on adoption.** The guest's queued adds (`ShowOutbox`) and song edits (`SetlistEditQueue`) are under the guest uid. After the switch nothing sends them, and the server only moves what it has. Part 4 flushes both while still signed in as the guest, before the switch. If anything is still queued (offline), it doesn't start the adoption: "Connect to the internet first: N changes haven't synced, and they'd be lost."
- **Wording:** "That sign-in already belongs to a MySetlists account." and "An account already uses that email. Sign in instead." Part 4 checks these against the web's link errors and offers the sign-in-and-bring-your-shows path.
- **Entry points to add:** Stats ("Create an account to see your rank") and the existing Me and ticket-scan prompts, all opening `GuestUpgradeView`.

### 3.3 Device files per event

| Event | `ShowOutbox` | `SetlistEditQueue` | `TermsAcceptanceRecord` |
|---|---|---|---|
| Account sign-out | kept (sent at next sign-in; the sign-out prompt counts them) | kept | kept |
| Guest sign-out | deleted | deleted | forgotten |
| Delete account | **kept today (3-a)** → delete | **kept today (3-a)** → delete | forgotten |
| Upgrade, same uid | kept, sent as the account | kept | kept |
| Upgrade, adoption | **lost today (3-c)** → flush first | **lost today (3-c)** → flush first | the account's own applies |

## 4. Moderation

| Feature | Web path | Server or rules |
|---|---|---|
| Block | `lib/moderation.js blockUser`: `userBlocks/{uid}.blockedUserIds` arrayUnion (rules: owner only), then **deletes both friends documents, including the other user's**, deletes pending `friendRequests`/`showTags` between them, then `notify-block` (a `reports` record with recent posts, never tells the blocked user) | the block itself is a rules-only write; side effects are client writes (C-7) |
| Unblock | arrayRemove on `userBlocks/{uid}`; the friendship isn't restored | rules-only |
| Blocked accounts list | `BlockedAccountsSection`: profiles of the blocked uids (`userProfiles` is readable by any signed-in user), Unblock | rules-only reads |
| Report | `report-content` with `{ contentType, contentId, reason, details? }`. Types `showComment`, `meetupComment`, `showMedia`, `profile`. Reasons: Spam or scam · Harassment or hate · Sexual content · Violence or threats · Copyright or impersonation · Something else (needs details). One report per person per item; 3 open reports auto-hide by moving the item to `moderationHidden` | server; 403 `account_required` for guests |
| Hiding blocked users | each screen filters with `withoutBlocked` / a `blocked` set: comments, meetups, activity, photos, community lists, upcoming tags, profile sheet | client filter of the user's own block list |
| Suspension | `moderate-report` ban: `banned: true`, **disables the Auth account**, revokes refresh tokens, quarantines their posts. The web's `SuspendedScreen` covers the hour the current ID token stays valid; signing in again fails with `auth/user-disabled` | server |
| Suspended screen | web: message + Sign out only. Native: the same (`SuspendedView`) | — |

**What native shows of other people in Stage 2:** nothing yet. The leaderboard and community are Stage 4, friends and tags Stage 3, and show-page comments, photos and tags are hidden. So "blocked users hidden wherever native shows other people" has no screen to apply to yet, and Block/Report have no entry point (C-8).

**Suspended accounts and deletion:** `delete-account` verifies the ID token without checking revocation, so deletion works from the suspended screen while that token lasts (up to an hour). After that the account can't sign in, so deletion and a copy of the data go through support. The suspended screen gets "Delete my account" and "Email support@mysetlists.net to delete this account or get a copy of your data later" (approved; no export in v1, C-1). The sign-in error for a disabled account says the same.

## 5. Debug rows

Both are already behind a hidden gesture (five taps on the version in Me):

- **"Developer"** (test error, test crash, Crashlytics in Debug) is `#if DEBUG`, so it's not in TestFlight or App Store builds.
- **"First-launch sign-in"** is in every build on purpose (DECISIONS, Q-01): at cutover it measures how many updates carried a session over, then it's removed.

**Proposal:** no change in Stage 2. Remove the first-launch row and report once the cutover numbers are in. If Phillip wants it out of App Store builds sooner, keep it for Debug and TestFlight only, by checking for a sandbox receipt (`Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"`).

## 6. Gaps

**Server or web changes needed before the native part that uses them:**

1. **No data export** (C-1). DECISIONS (2026-11-15) says "No data export in v1", with copies by email to support and `export-my-data` as a post-launch idea. The Stage 2 brief asks for "the existing export path"; there isn't one.
2. **No top songs on the server** (C-2). `userStats` has `topBands` and `topVenues` (top 5), no songs. Proposal, additive to `lib/stats`:
   - `topSongs`: top 10 by distinct shows seen (`lib/stats/perShow.js` `forEachSongOncePerShow`, the web's "times seen"), keyed by band + song so two bands' "Intro" stay apart, `{ name, artist, count }`;
   - `topBands`/`topVenues` raised to top 10.

   The fields are additive, so `STATS_VERSION` stays 2 and old builds are unaffected. The next 6-hourly rebuild writes them for everyone, and no forced run is needed. Golden tests in `lib/__tests__` cover it.
3. **Block side effects are client writes into other users' data** (C-7). Since 5.60.11 the app never writes another user's documents (CLAUDE.md), but the web's `blockUser` deletes `users/{target}/friends/{me}` and queries `friendRequests`/`showTags`. Native shouldn't copy that. Proposal: `notify-block` (renamed or not) does the unfriend and clears pending items on the server, after checking the caller's own `userBlocks` contains the target. The web moves to it in the same PR.
4. **Avatar upload and bio don't exist** (C-6). An avatar upload needs a Storage path and rules (nothing under `storage.rules` is for profiles). A bio is public text, so it needs `moderate-content`, a protected field in the rules and the `profile` report type to cover it.
5. **The recap window lives in an ES module** (`lib/recapLaunch.js`). Proposal: `fixtures/recap-launch/window.json` (launch, promo end, year, href), checked against the module by a JS test and read by Swift tests, so the dates can't drift.

**Native only:**

6. 3-a, 3-b, 3-c above (deletion queues, deletion timeout, adoption flush).
7. `SuspendedView` has no deletion (§4).
8. Stats keys port for the tap-through lists (§1.3).

**Decoding and rules:** every Stage 2 document decodes with the existing models (the `UserStats` decoder already takes the number-or-string `avgShowRating`). New `topSongs` needs a field on `UserStats`, optional so older documents decode. No rule refuses a Stage 2 native write: profile field writes, `userBlocks` writes and the server calls are all allowed. The exceptions are C-6 (needs rules) and the cross-user friend delete, which native won't do (C-7).

**User counts:** `rankedOf` and `communityStats.totalUsers` are user counts; native never shows either in Stage 2 (C-5). `communityStats.topSongsBySightings[].userCount` ("seen by N people") is one too, for Stage 4 to keep behind the same rule.

## 7. PR split (approved)

Each from the latest `main`. A web or server PR bumps the web, Capacitor and native versions; a native-only PR bumps only the native one (CLAUDE.md).

| PR | Contents |
|---|---|
| **A. Server: stats lists and block side effects** (web PR) | `lib/stats`: `topSongs` (top 10 by distinct shows, keyed by band + song, `{ name, artist, count }`), `topBands` and `topVenues` raised to top 10, golden tests; additive, `STATS_VERSION` stays 2, and the next 6-hourly rebuild writes them. `notify-block` (or a renamed function) unfriends both ways and clears pending friend requests and show tags on the server, after checking the caller's own `userBlocks` holds the target; the web's `blockUser` calls it instead of writing those documents itself. `fixtures/stats-keys/` and `fixtures/recap-launch/` with their JS tests. |
| **2. Stats tab** (native) | `StatsStore` on `userStats` (listener, cache first, no endless spinner); totals; top bands, songs and venues; shows by year (Swift Charts); rank "#N" for ranked accounts; "Create an account to see your rank" for guests; new-account empty state; tap-through lists of your shows from the cached Shows data (keys port); "Your 2026 in review" link (accounts, Dec 2 – Jan 15 Pacific). **Built in native 4.0.17.** |
| **3. Me and Profile** (native) | Display name (`moderate-content`); handle and public profile; leaderboard opt-out (+ recompute); email preferences; connected accounts; How to Use, Release notes, Feedback, Roadmap, Terms, Privacy links; version and build. The photo as a web address, as on the web (no upload, C-6). Copies of your data: a pre-filled email to support. **Built in native 4.0.18.** |
| **4. Deletion and upgrade fixes** (native) | 3-a (deletion clears the outbox and edit queue), 3-b (deletion timeout that checks whether the account is gone), 3-c (flush guest changes before adoption, or don't start it); "Delete my account" and the support email on the suspended screen; upgrade prompts in Stats and Shows; the web's wording for credential-in-use. |

The block, unblock, blocked-accounts and report UI moves to Stage 3, with the first screens that show other people.

## 8. Calls (approved 2026-11-15)

| | Call |
|---|---|
| **C-1** | No data export in v1: copies go through support@mysetlists.net, as DECISIONS already says. A data export is on the post-v1 list. |
| **C-2** | The server's definitions, top 10, all time; `topSongs` is added to `userStats`. Follow-up: switch the web Stats page to the server lists. |
| **C-3** | No per-year stats in Stage 2. "This year" stats are on the v1.x list. |
| **C-4** | "Hours of live music" is dropped in native. |
| **C-5** | Rank shows as "#N" only, never "of N". |
| **C-6** | Avatar upload and bio are deferred. |
| **C-7** | Block side effects move to the server (PR A). |
| **C-8** | The moderation server side is done now, with C-7; the block and report UI moves to Stage 3. |
| **C-9** | Year in Review: a link only, accounts only, Dec 2 – Jan 15 Pacific, opening `mysetlists.net/year-in-review/?year=2026` in SFSafariViewController. |
| — | All three native bugs (3-a, 3-b, 3-c) are fixed in the deletion PR, which also adds "Delete my account" and the support email to the suspended screen. |

## Follow-ups

- **Web Stats page on the server lists** (C-2): `/stats/top-artists`, `/stats/top-venues` and the breakdown tabs show the same all-time top lists as `userStats`, so the web and native agree.
- **"This year" stats** (C-3, v1.x): a per-year block on the server (`byYear`), then the web's period chips and native read it.
- **Data export** (C-1, post-v1): `export-my-data`, as sketched in DECISIONS "Data export and the offline cache".
- **Avatar upload and bio** (C-6): a Storage path and rules for avatars; `moderate-content`, a protected field and the `profile` report type for a bio.
