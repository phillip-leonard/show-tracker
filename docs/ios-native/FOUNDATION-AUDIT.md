# SwiftUI foundation: Part 1 audit

Audit of `main` at `1b68950` (web 5.60.11, iOS 3.13.27), 2026-11-14. Report only: no app code changed. Production was read with two read-only scripts that print counts and type classes, never ids, names or addresses.

**Answered on 2026-11-14.** D-1 to D-7 were decided as recommended, except D-1 (guests see a "create an account to see comments" prompt) and D-7 (assume one product; Capacitor builds go manual). The decisions are in [`DECISIONS.md`](DECISIONS.md).

## What needs a decision from you

| # | Question | Recommendation |
|---|---|---|
| D-1 | Can a guest **read** other users' content (comments, photos, meetups, activity, venue reviews)? Guideline 1.2 expects anyone who can see UGC to be able to report it and block its author, but the defaults refuse reports to guests. | Guests don't see UGC. The rules refuse anonymous reads of those collections, and the app hides those surfaces. (§1.1) |
| D-2 | Can a guest follow bands and get push alerts? Following writes only the guest's own profile, but `resolve-artist` uses the shared Ticketmaster quota. | Allow it. The quota is already per-user limited. |
| D-3 | Roadmap votes and feedback from guests? | Refuse roadmap submissions and votes. Allow feedback, which only the admin reads. |
| D-4 | An anonymous user links Apple, Google or an email that **already has an account**. `link` fails with "credential already in use", and the guest's shows are left under the anonymous UID. | Add a server function that moves them (`adopt-guest-shows`, §1.2). It's missing today, so this is a flag, not something to build in Swift. |
| D-5 | Design tokens: the design guide says green `#34D399`, orange `#FB923C`, navy `#0F172A`. The shipped app (`app/globals.css`) uses green `#10B981`, amber `#FFB700`, indigo `#2A2A4E`/`#1F1F3A`. | Match the shipped app, so the update looks like the same app. Correct the guide afterwards. (§1.6) |
| D-6 | Universal link `/?ref=<token>` (referrals and tag-by-email invites) opens Safari today, because `/` isn't in the AASA file. | Add the component `{"/": "/", "?": {"ref": "*"}}` so an installed app claims the referral. (§1.4) |
| D-7 | Xcode Cloud: Apple's docs say "a bundle ID always matches exactly one Xcode Cloud product". | Check in App Store Connect whether the existing product can take a second workflow that points at `ios-native/MySetlists.xcodeproj`. If it can't, build the Capacitor app manually for the transition. (§1.5) |

---

## 1.1 Anonymous auth readiness

No rule or function checks the sign-in provider today. Every check is `request.auth != null` or "a verified token", so an anonymous user would pass all of them. Production has 45 Auth users (24 Google, 15 password, 6 Apple) and none anonymous.

### The check

`firebase.sign_in_provider == 'anonymous'` in the token, in both rules and functions. It's not documented whether that claim changes after `linkWithCredential` without a fresh sign-in, so the helper also requires an empty `firebase.identities`. A linked account always has at least one identity. Part 2's emulator tests must cover "anonymous → link → refreshed token is a full account".

```
// firestore.rules / storage.rules
function isAnonymous() {
  return request.auth != null
    && request.auth.token.firebase.sign_in_provider == 'anonymous'
    && request.auth.token.firebase.identities.keys().size() == 0;
}
function isAccount() { return request.auth != null && !isAnonymous(); }
```

Server side: `isAnonymous(decoded)` goes in `netlify/functions/lib/firebaseAdmin.js`, next to `isAdmin()`. `requestAuth.identity()` gains `isAnonymous`, and a new `requireAccount(event, headers)` returns 403 `{ code: 'account_required' }`. The Swift API client maps that code to a typed "sign in to use this" error.

### Firestore rules: where anonymous is refused

Line numbers are `firestore.rules` at `1b68950`. Each `request.auth != null` below becomes `isAccount()`.

| Collection (line) | Operation | Why refused |
|---|---|---|
| `users/{uid}/festivals` (86–88) | write | Joining festivals |
| `users/{uid}/friends` (106–108) | create, update | No friends for guests. Delete stays allowed. |
| `reports` (264–267) | create | Reports |
| `friendRequests` (349, 355) | create, update | Friend requests |
| `showTags` (390–418) | create, the 3 updates | Tagging and accepting tags |
| `venueRatings` (429–436) | create, update | Public review text and name (UGC) |
| `userActivity` (509–513) | create | Shown to friends |
| `showComments` (534), `showPhotos` (622) | update (likes) | UGC |
| `meetups` (571, 578) | create, update | UGC |
| `pendingEmailTags` (649, 653) | create, update | Invites by email |
| `invites` (668) | create | Invites |
| `showSuggestions` (686–704) | create, update, comments create/update | Suggestions and their comments |
| `roadmapItems` (772, 779), `voters` (790–797) | create, vote | D-3 |
| `notifications` (817) | create | Any signed-in user can create a notification for any uid. Refuse guests. |
| `venues` (835) | create | |
| `festivals` (900, 919) | create, update | Joining and creating festivals |
| `venueVerificationApplications` (950), `venueAnnouncements` (967), `venuePhotos` (976), `venueReports` (987) | create | Venue owner tools and reports |
| `yearInReviews` (1098, 1101) | create or update with `privacy == 'public'` | Publishing. A private review stays allowed. |
| **D-1 reads**: `showComments` 532, `meetups` 570, `meetupComments` 601, `showPhotos` 620, `userActivity` 510, `venueRatings` 430, `venueAnnouncements` 966, `venuePhotos` 975 | read | UGC without report and block (D-1) |

**Allowed for anonymous** (no change): `users/{uid}/shows`, `upcomingShows`, `discover` (owner); own `userProfiles` create/update; `userBlocks`, `pushTokens`, `alertSettings`, `commentViews`, `wishlists`, `favoriteTours`, `bucketList`, `bucketListVenues` (owner); `userStats` (own); `publicUserStats`, `communityStats`, `config/app`, `festivals`, `venues`, `handles`, `bandAffinity`, `bandPopularity`, `ticketCache` (read); `notifications` read/update own; `onsaleAlerts` read own; `feedback` create (D-3). `guestSessions` is the web's unauthenticated tracker, which the native app doesn't use.

### Storage rules

| Path | Change |
|---|---|
| `showPhotos/{concertKey}/{uid}/*` | write → `isAccount()`; read too under D-1 |
| `venueVerificationDocs/…` | write → `isAccount()` |
| `venuePhotos/…` | write → `isAccount()` |

### Netlify functions

| Function | Today | Anonymous |
|---|---|---|
| `normalize-show` | `requireUser` | **Allowed** for their own shows. Refuse kinds `tag` and `email-tag` (a guest can't have tags; refusing makes that explicit). |
| `propose-setlist`, `accept-proposal`, `reject-proposal`, `resync-show`, `scan-missing-setlists` (`lib/setlistOpsHandler.js`) | `requireUser` | **Allowed** (re-sync) |
| `recompute-my-stats` | `requireUser` | **Allowed**, written with `ranked: false` (see below) |
| `delete-account` | `verifyIdToken` | **Allowed**. Apple revocation doesn't apply. |
| `update-email-preferences` | `verifyUser` | Allowed. It's harmless with no address. |
| `resolve-artist` | `verifyUser` | Allowed (D-2) |
| `my-poster` | `verifyUser` | `image` allowed, `share` refused: `/p/<code>` is a public page |
| `analyze-tickets`, `analyze-screenshot` (`lib/aiScan.js` gate) | optional user | **Refuse** an anonymous token with 403. Tokenless calls still pass until `REQUIRE_AUTH_AI=true` (GATED-CLEANUPS), so the gate is the app not offering scanning, plus this 403. |
| `send-email` | `requireUser` | **Refuse** every type |
| `friends.js` | `verifyUser` | **Refuse** every action, including `lookupByEmail` and `referralLink` |
| `moderate-content` | `verifyIdToken` | **Refuse** every target (comments, meetups, captions, `profileName`, handle) |
| `report-content`, `notify-block` | `verifyIdToken` | **Refuse** |
| `create-shared-collection` | `requireUser` | **Refuse** (public page) |
| `match-festivals`, `festival-lineup` | `requireUser` / `verifyUser` | **Refuse** (festivals) |
| `spotify-api`, `spotify-token` | `requireUser` | Refuse (dormant) |
| `send-welcome-email` | `verifyUser` | **Defer**: return `{ status: 'deferred_anonymous' }` without writing the profile (§1.2) |
| `admin-*`, `cache-stats`, `clear-cache`, `delete-user`, `notify-roadmap-completion`, `moderate-report` | `isAdmin` | No change. An anonymous token carries no email or `admin` claim. |
| Public proxies (`search-setlists`, `band-setlist`, `api/artist`, …) | none / `withProxyLimit` | No change |

### Rankings and totals

- `lib/stats` `isRanked(profile, stats)` doesn't know about anonymous accounts. `buildCommunityStats` counts every non-test profile in `totalUsers`, and that number feeds `shouldShowUserCount` (the 1,000-user rule). Guests would push it up.
- The fix for Part 2: `rebuildAllStats` builds the set of anonymous uids from Auth with `listUsers` (anonymous = no `providerData`), passes it to `isRanked` and leaves those uids out of `totalUsers`. `recomputeUserStats` takes `isAnonymous` from the caller's token. A profile field can't be the source, because the client writes profiles.

---

## 1.2 Upgrade path (anonymous → Apple, Google or email)

`link(with:)` keeps the UID, so `users/{uid}/shows`, `upcomingShows`, `userProfiles/{uid}`, `userStats`, `publicUserStats` and `yearInReviews` stay where they are. What does **not** happen by itself:

1. **The auth-state listener doesn't fire on link** (same user), and the web runs its first-sign-in steps from that listener (`context/AppContext.jsx:1000–1175`). After a successful link, the native app must run the account steps explicitly:
   - set the display name through `moderate-content` `profileName`, using the name Apple or Google sent and passing it through the content filter, as `lib/native-auth.js` does
   - `friends.js` `claimInvites` (the account now has an address)
   - `referral` if one was captured
   - the `pendingEmailTags` lookup by address
   - `recompute-my-stats` (the account becomes ranked)
   - `send-welcome-email`
   - set `convertedFromGuest` and `guestConvertedAt` on the profile. The rules allow it, and it replaces the web's `guestSessions` conversion marker.
2. **The token has to be refreshed** (`getIDTokenForcingRefresh`) before those calls, so rules and functions see the linked identity.
3. **Welcome email.** If a guest's first show triggered `send-welcome-email` today, the server would record `welcomeEmail.status = 'skipped_no_email'` (`netlify/functions/lib/welcomeEmail.js:174`). That status is permanent, so the account would never get the email after linking. Part 2 makes the function defer for anonymous callers without writing anything. Eligibility uses the Auth `creationTime`, which is the guest's start date. That date is after `WELCOME_EMAIL_START`, so a linked guest qualifies.
4. **`userProfiles`**: the rules refuse `email` on profiles, so linking doesn't add one. The address stays in Auth (`netlify/functions/lib/accountEmails.js`). The terms acceptance written at guest start carries over, because the terms gate applies before "Continue as guest" as it does before any provider.
5. **Server hook (proposed).** Netlify has no Auth trigger. Rather than six calls from Swift, add one `account-linked` function, called with the new token, that does steps 1 and 3 on the server: claims invites, sends the welcome email if due, recomputes stats and stamps the profile. The display name stays a `moderate-content` call, because the name comes from the device.
6. **Credential already in use (D-4).** `adopt-guest-shows` would take the anonymous ID token in the body and the account token in the header. It would move each show through `normalizeShowInput` and `classifyDuplicate` (duplicates are skipped, `possible` matches are returned for the user to decide), then purge the anonymous account with `purgeUserData`. Missing today.
7. **Abandoned guests.** Anonymous accounts that never link stay in Auth for good, unless the project moves to Identity Platform's automatic cleanup. A scheduled purge (for example, anonymous and inactive for 90 days, using `purgeUserData`) is new server work. Missing today.

---

## 1.3 Models: production vs. SCOPING §3.2

Counts from production. Nothing that identifies a person was printed.

### `users/{uid}/shows` (1,501 docs)

| Field | Production | Swift consequence |
|---|---|---|
| doc id | 1,472 ms-timestamp (13 digits), 29 `seed-*` (review accounts) | `String` |
| **stored `id` field** | **58 docs carry `id` equal to the doc id** | **Don't use `@DocumentID var id`**: Firestore's Swift decoder throws a field-name conflict when the data has a field with that name. Take the id from the snapshot. |
| `date` | **1,501 `YYYY-MM-DD`**. 230 also carry `dateNormalizedFrom` (`DD-MM-YYYY`). | Plain ISO day. The `lib/showDate.js` port still accepts the legacy form (tags, below). |
| `createdAt` | 1,243 Timestamp, **258 ISO strings** (29 `migratedFromLocal`, 229 other) | `FlexibleDate` needed |
| `tour` | 833 string, 507 null, 73 `""`, 88 absent | `null`, `""` and absent all mean none |
| `city`, `country` | 72 `""` each (country absent on 243) | Empty string means none |
| `artistMbid` | present on only 3 | Optional |
| `rating` | 348 int, 72 null | `Int?`. No doubles found. |
| `festivalId` | 88 string, 7 null | Optional |
| `needsReviewReason` | null on all 3 present | Optional |
| `setlistProposal` | **none stored** | Optional, not exercised in production |
| `setlistFetchedAt`, `setlistScanAt` | ISO datetime strings | `String` (ISO) |
| Undocumented fields | `venueRating` int (72), `importedByAdmin` **bool** (49, the 5.60.3 scrub), `artistImage` (73), `posterCheckedQuick/Deep`, `posterUrl`, `posterSource(Url)`, `setlistFetchAttempted`, `festivalName` and `isFestival` (9), `normalizedVersion`, `dateNormalizedFrom` | Decode the ones the app shows. Field-level writes (`updateShowFields`) leave the rest untouched. |
| `setlist[]` (22,108 songs) | `id` string on all; `name` `""` on 16; `set` **absent on 5,225** (never null); `cover` null on 14,624; `tape` bool on 16,861; **`setBreak`** string or null on 4,273 (undocumented); `rating` int 429 / null 262 | `set` optional, `setBreak` added, empty names tolerated |
| `setlist[].set` values | `Set I`…`Set VIII`, `Set 9`, `Encore`, `Encore II` | String, not an enum |
| `setlistSource` | `setlistfm` 755, `phishnet` 119, `elgoose` 48, `archive` 3 | String |

### Other collections

| Collection | Count | Findings |
|---|---|---|
| `userProfiles` | 45 | `favoriteArtists[]` is **mixed: 7 objects, 9 plain strings**. SCOPING couldn't tell; custom decoding is now confirmed necessary. `createdAt` is absent on 5, `displayName` is `""` on 2, `bustOutSensitivity` is a double, `notificationPrefs` is a nested map. The legacy counts are still present on 44 and are never read. No `email` field (good). |
| `userStats` | 45 | **`avgShowRating` is a string** (`"8.3"`) or null. `firstShowDate`/`lastShowDate` are YMD or null. `rank`/`rankedOf` are null when unranked. `showsByYear` is `{ "2026": Int }`. `topBands`/`topVenues` are `[{name, count}]`. |
| `publicUserStats` | 45 | As documented |
| `communityStats/global` | 1 | `topSongsByRating[].avgRating` is a **string**. Entries carry both `userId` and `odubleserId`. |
| `yearInReviews` | 2 | **`privacy` is absent on both** (read absent as private). `stats` keys match `fixtures/year-in-review` `expected.yearInReview`. `statsComputedAt` is a Timestamp. |
| `config/app` | 1 | `minSupportedIosVersion`, `latestIosVersion` (strings), `iosPushOfferEnabled` bool, `reason` (`""`), `updatedAt`, `updatedBy` |
| `showSuggestions` | 0 | Nothing in production to test against; the model comes from `netlify/functions/lib/showSuggestions.js` |
| `showTags` | 127 | **`showData.date` is `DD-MM-YYYY` on 108** (16 of them pending, 5 pending are ISO). The 2026-11-14 migration didn't reach tags. Songs are `{id, name}`, `tour` is `""` on 44. |
| `pendingEmailTags` | 8 | **`showData.date` is DMY on 7** (4 pending) |
| `users/{uid}/friends` | 15 | `friendEmail` on all 15 (owner-read only) |
| `friendRequests` | 7 | **`fromEmail`/`toEmail` on all 7, readable by both parties.** That breaks the "no address on a document other users can read" invariant. Today's rules refuse those keys on create, so these are pre-5.59 leftovers. A scrub like `scripts/strip-profile-emails.js` would close it (separate fix). |
| `users/{uid}/upcomingShows` | 2 | As documented |

**Date variants still in production:** show dates are all ISO. The legacy form remains in `showTags.showData.date` (108) and `pendingEmailTags.showData.date` (7). These reach a show only through `normalize-show` kinds `tag` and `email-tag`, which normalize them, so the Swift app only needs to read them for display. `createdAt` ISO strings (258) are the other variant.

---

## 1.4 Universal links

AASA (`public/.well-known/apple-app-site-association`) claims 36 app routes (each with its `/*`) for `66N4YR3VP9.com.mysetlists.app`. It leaves `/`, `/artist/*`, `/heard/*`, `/u/*`, `/p/*`, `/shared/*`, `/compare/*`, `/reset/*` and the legal pages to Safari. The Capacitor app is the same app ID during the transition, so the file can't shrink before cutover: **every claimed path opens the native app**, including screens it doesn't have yet.

| Link | Shape | Native v1 |
|---|---|---|
| Show | `/shows/?show=<id>`; legacy `/shows/<id>` | Shows tab → detail (placeholder in Part 6) |
| Band | `/bands/?band=<slug>` (push `data.link`, `lib/pushAlerts.js:22`) | Search or Shows → band placeholder |
| Song | `/bands/?band=<slug>&song=<slug>`, `/songs/?song=` | Band song / song placeholder |
| Tag (app user) | email/push → `/notifications/`, `/friends?tab=requests` | Friends tab (`?tab=`) |
| Tag-by-email / invite (non-user) | `https://mysetlists.net?ref=<signed>` (`emailAuthorization.js:196, 270`) | **Opens the web today** (`/` not claimed). D-6: claim `/?ref=*` and store the ref for `friends.js referral` after sign-in. |
| Referral | same `?ref=` shape (`friends.js:278`) | same as above |
| Password reset | `/reset/<token>` → `/reset/?token=` | **Stays web.** The page sets the password, then the user signs in in the app. Not claimed, and it shouldn't be. |
| Year in Review | `/year-in-review/?user=&year=` | Stats placeholder |
| Venue | `/venues/?venue=` | placeholder |
| Everything else claimed (`/admin`, `/roadmap`, `/meetups`, `/community`, `/setlist-photos`, …) | | **Fallback: open the same URL in `SFSafariViewController`**, so no link dead-ends |

Also: the custom scheme `mysetlists://` (same paths) and the Google reversed-client-id scheme. Port `lib/deepLinks.js` `LEGACY_SHAPES` and its test table as the router's golden cases.

---

## 1.5 Xcode Cloud (Q-07)

- **Two products for one app?** Apple's docs say "a bundle ID always matches exactly one Xcode Cloud product". Forum reports of a second onboarding *moving* the existing product's workflows to the new one agree. Since the native app keeps `com.mysetlists.app`, there is **one product**.
- **Can that product build both projects?** The docs don't say whether a workflow can point at a different `.xcodeproj` in the same repository. Two options:
  1. **Try first (5 minutes, App Store Connect):** duplicate the Capacitor workflow and look for a project or workspace setting to point at `ios-native/MySetlists.xcodeproj`. Give it a start condition of Files and Folders → Custom → `ios-native/`, and add "Don't Start a Build" for `ios-native/` to the Capacitor workflow. Each project finds its own `ci_scripts/` next to it.
  2. **Fallback:** move the Capacitor app to manual archive and upload for the transition (`docs/build-testflight-3-1-32.md` already describes it), and onboard the native project as the product's project. Do this **only after** the last Capacitor build you need from Xcode Cloud.
- **Highest build number so far:** the repo can't tell. Xcode Cloud overrides `CURRENT_PROJECT_VERSION` (32 in the pbxproj), and the 2026-09-17 rejection notice names build **130** for 3.1. App Store Connect → TestFlight shows the current number. **Read it there before the first native upload.**
- **Uniqueness:** App Store Connect requires a unique (marketing version, build) pair. On iOS a new version may reuse lower build numbers. Xcode Cloud's counter is one per app record (App Store Connect → Xcode Cloud → Settings → Next Build Number), so builds from both workflows share it.
- **Answer to Q-07:** **4.0.0 makes it moot.** No Capacitor build has used 4.0.0 (Capacitor is on 3.13.x), so a native 4.0.0 build can't collide with one, whatever the counter says. The one rule to keep: Capacitor never ships 4.x during the transition, and a rollback Capacitor build must use a version above the native one. The shared counter keeps build numbers increasing anyway.
- **Native versioning rule (Q-09, added to CLAUDE.md in Part 2):** a PR that touches `ios-native/` bumps the native `MARKETING_VERSION` (4.0.0 → 4.0.1 …). The Capacitor rule for `ios/` and the web version stay as they are.

---

## 1.6 Design tokens

**What ships is `app/globals.css`, not `DESIGN_SYSTEM_GUIDE.md`.** The guide's palette (`#34D399`, `#FB923C`, `#0F172A`) doesn't appear in any component. Usage counts across `components/` and `app/`: `brand` 936, `amber` 408, `bg-hover` 392, `brand-subtle` 129; `emerald-*` and `orange-*` 0.

| Token (CSS var → Tailwind) | Value | SwiftUI |
|---|---|---|
| `--green-primary` → `brand` | `#10B981` | `Color.brand`, also `.tint` |
| `--green-light` / `--green-subtle` | `#10D98A` / `#10B981` at 12% | `brandLight`, `brandSubtle` |
| `--amber` (+ light, subtle) | `#FFB700`, `#FFC94D`, 12% | `Color.amber…` (ratings, highlights) |
| `--accent-purple` | `#D946EF` | `Color.accent` |
| `--bg-base` | `#2A2A4E` | `Color.bgBase`, the root background on iOS 18. On iOS 26, behind system materials. |
| `--bg-surface` / `--bg-elevated` / `--bg-sidebar` | `#1F1F3A` | `Color.surface` |
| `--bg-hover` | `#35355E` | `Color.surfaceHover` (pressed and selected rows) |
| `--text-primary` / `secondary` / `muted` | `#F5F5F5` / `#B0B0B0` / `#82829C` | `.primary` / `.secondary` / `.tertiary` styles, mapped |
| `--border-subtle` / `--border-active` | `#10B981` at 15% / 40% | `Color.separatorBrand` |
| `--success` / `--danger` | `#4BC86A` / `#E05555` | `Color.success` / `Color.danger` (the destructive role) |
| Shadows sm–xl | black, 30–45%, 1–20 radius | `.shadow` presets. Not used on glass. |

**Theme.** The web is dark-only (`:root` only, no light or `prefers-color-scheme` block). v1 sets `.preferredColorScheme(.dark)`, so the Liquid Glass materials match. Tokens go in an asset catalog with a dark appearance, so a light theme can come later without code changes.

**Type.** Plus Jakarta Sans (OFL, `app/fonts/OFL.txt`) is variable, weights 300–700. The repo has only `.woff2`, which iOS can't register. Bundle the variable `.ttf` from Google Fonts (same license) and register it with `UIAppFonts`. Use it through `Font.custom(_:size:relativeTo:)` so Dynamic Type scales it:

| Tailwind (uses) | px | `relativeTo:` |
|---|---|---|
| `text-xs` (475) | 12 | `.caption` |
| `text-sm` (810) | 14 | `.subheadline` |
| `text-base` (17) | 16 | `.body` |
| `text-lg` (117) | 18 | `.title3` |
| `text-xl` (66) | 20 | `.title3` |
| `text-2xl` (48) | 24 | `.title2` |
| `text-3xl` (17) / `4xl` (4) | 30 / 36 | `.title` / `.largeTitle` |

Weights: `font-semibold` 414, `font-medium` 362, `font-bold` 218, `font-extrabold` 54. Extra-bold is past the variable font's 700, so it maps to `.bold`. Navigation and tab bar titles stay the system font, so the platform's Liquid Glass bars look native.

**Radii** (uses): `rounded-xl` 12pt (257), `lg` 8 (145), `full` capsule (135), `2xl` 16 (120), `3xl` 24 (11). Use `RoundedRectangle(cornerRadius:style: .continuous)`, or `.containerShape` on iOS 26.

**Spacing:** Tailwind's 4pt scale (`Space.x1 = 4`…`x8 = 32`). Touch targets are 44pt minimum (`min-h-touch`).
