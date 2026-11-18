# mysetlists.net Development Guide

## Routing: read before touching navigation

This app is a Next.js static export (`output: 'export'`, `trailingSlash: true` in next.config.js). Only pre-rendered routes exist as files in the build output. A dynamic route with runtime ids — `/shows/[id]`, `/festivals/[id]` — cannot be served:

- On the web, Netlify's catch-all rule (`/* → /index.html`) returns the root page's HTML for any missing route, making the URL work but the page render wrong
- On iOS, there is no Netlify at all. Capacitor serves bundled files directly; the catch-all doesn't exist, and the behavior is whatever the local server does with a missing path

**Detail views use a query parameter on a real route**, not a dynamic route:
- `/shows/?show=<id>` renders `ShowDetailView` on the `/shows` page, the same URL pattern songs, runs, and tours use
- The URL is a real pre-rendered route (`out/shows/index.html` exists)
- Back controls work because `lib/navRoutes.js` declares `detailParam: 'show'` for `/shows`, telling the mobile header this is a detail view inside a list
- Deep links (pasted URLs, shared links, Resend emails) redirect via `netlify.toml`: `/shows/<id>` and `/shows/<id>/` → `/shows/?show=<id>` (status 301)

**Verify any navigation change** against the contents of `out/` after `npm run build`, not against the source alone. The presence of a `.jsx` file says nothing about whether the route can be served.

In-app navigation goes through `showHref(id)` helper in `lib/showRouting.js` — use it everywhere so there is one place this can ever be wrong again.

Venue pages, venue dashboards and Year in Review were the same bug until 5.46.0 and now follow the same pattern: `venueHref(key)` → `/venues/?venue=`, `venueDashboardHref(key)` → `/venue-dashboard/?venue=`, `yearInReviewHref(uid, year)` → `/year-in-review/?user=&year=`, all in `lib/showRouting.js`, with 301s from the old path shapes in `netlify.toml`. No `[param]` directory should exist under `app/`.

This pattern has now cost three attempts to get right. The next session should not have to rediscover it.

## iPad and wide layouts

The iOS target is universal. Don't add an iPad check: iPadOS can resize the window to any width, so layout follows measured width.

- `md:` (768px) means wide, not "has a mouse". Anything that shrinks for a mouse, such as a 44pt tap target, also needs the `fine:` variant (`md:fine:min-h-0`), defined in `tailwind.config.js`.
- `md:` and `lg:` measure the screen, not the pane. Inside `components/layout/SplitView.jsx` a view can be 430px wide on a 1024px screen, so it needs the pane's width passed in (see `sideColumn` on `ShowDetailView`).
- Native-only wide layouts read `hooks/useContentColumnWidth.js`, which is 0 on the web, and compare it with the constants in `lib/platform.js`.
- Below `md` an iPad gets the phone shell, including an iPad mini in portrait (744pt) and narrow Split View or Slide Over windows.

## Netlify Blobs and background functions

The public band pages (`/artist/...`) read a snapshot from Netlify Blobs, written by `public-artist-snapshot-background.mjs`. Two things that cost three deploy-preview rounds to find:

- **A function that uses Blobs from a background function must be a v2 function (`export default`) that imports `@netlify/blobs` at the top level.** A `require('@netlify/blobs')` inside a function body is left out of the v2 bundle ("Cannot find module '@netlify/blobs'"). The Lambda-style page functions use `openBlobStore(event)` in `lib/publicArtistSnapshot.js`, which calls `connectLambda(event)`.
- **`netlify logs` without `--follow` shows only the first line of each invocation**, an empty `INFO`, so a failing background function looks like it ran and printed nothing. Stream with `netlify logs --deploy-id <id> --function <name> --follow` while you trigger it.

**A change to what the snapshot contains does not reach production on deploy.** A run only rebuilds artists that are due (by age, or because their stored `schemaVersion` differs from `SCHEMA_VERSION` in `netlify/functions/lib/publicArtistSnapshot.js`). A plain re-run right after the deploy reports every artist "fresh" and writes nothing. 5.47.13 added `overdueOriginals` / `notPlayedSince` this way and production went without them until a forced run. After merging such a change, either:

- run `node scripts/run-artist-snapshot.js --force` once the production deploy is live (an incremental rebuild of every artist; check it with `--report`), or
- bump `SCHEMA_VERSION`, but only when stored data must be refetched: it also makes every raw cache stale, so the next run refetches every band's full history.

`/api/artist` and the `/artist/...` pages are CDN-cached for up to an hour (`s-maxage=3600`, `stale-while-revalidate`), so the first request after a run can still show the old `fetchedAt`. Add any extra query parameter to bypass the cache when you check.

Deploy previews always carry `X-Robots-Tag: noindex` (Netlify adds it). Lighthouse's `is-crawlable` and the Rich Results Test's "Indexing allowed?" fail there for that reason alone.

## Capacitor plugins: never return one from an async function

A Capacitor plugin (`FirebaseMessaging`, `FirebaseAuthentication`, `App`, …) is a Proxy that answers every property, `then` included. Returning one from an `async` function, or resolving a promise with it, makes JavaScript call `plugin.then(resolve, reject)`, which Capacitor sends to iOS as a method call: it rejects ("….then() is not implemented on ios") and the `await` never settles. This hung iOS logout from 3.11 to 3.13.13. Destructure and call (`const { X } = await import(…); await X.method()`) or return it wrapped (`return { fm }`). `lib/__tests__/signOut.test.js` fails if a plugin is returned. Sign-out goes through `performSignOut` (`lib/signOutFlow.js`), where no cleanup step can block it.

## Show data rules (5.59.10)

- **Show dates go through `lib/showDate.js`.** Stored as ISO `YYYY-MM-DD`; readers accept the legacy `DD-MM-YYYY`. No `.slice(0, 4)`, `.split('-')`, `new Date(show.date)` or `toISOString().slice(0, 10)` on a show date or for "today" (`today()` is the device's local day). `lib/__tests__/localToday.test.js` fails if the UTC idiom comes back.
- **A show document is made only by `buildShowDoc` with `mintShowId`** (`lib/showDoc.js`), and "the same show" is decided only by `lib/showIdentity.js` (`classifyDuplicate`: setlist.fm id, then artist + venue + day; a `possible` match only ever prompts the user).
- **New shows are built by `normalize-show`** (5.60.5): `lib/normalizeShow.js` turns each input kind into the canonical document (`lib/showInputs.js` documents the shape). The golden fixtures in `fixtures/shows/` are the Swift app's contract; change them only on purpose. The hourly `normalize-shows-sweep` normalizes documents written with `needsNormalization`.
- **Every add path in the app sends an input, not a document** (5.60.6): `addShow({ kind, … })`, `addShowsFromTour(inputs)`, `importShowsToFestival` go through `commitShowInputs` (`lib/showAdd.js`). When the server can't be reached the show is built on the device with the same `normalizeShowInput`, written with `needsNormalization`, and kept in the per-user outbox until it commits. Don't add a client-side show builder or duplicate check; use `classifyDuplicate`.
- **Every setlist change from a source happens on the server** (5.60.7): propose, accept, reject, resync and the missing-setlist scan are `netlify/functions/lib/setlistOps.js`, behind `propose-setlist`, `accept-proposal`, `reject-proposal`, `resync-show` and `scan-missing-setlists` (plus `scan-missing-setlists-scheduled`); the admin resync, populate and find-missing tools use the same module. The "never lose a rating" guard (`lostNotes`) runs there, inside a transaction against the stored show, and nowhere in the app. Don't merge or write a source's setlist from the client.
- **Festival matching is one rule on the server** (5.60.8): `lib/festivalMatch.js`, read against the catalog by `netlify/functions/lib/festivalMatchServer.js` (`match-festivals` for the create form; `festivalMatches` in `normalize-show`'s answer, a suggestion only). Every admin festival tool requires the same file.
- **A show is edited one field or one setlist edit at a time** (5.60.9, R-06): show-level fields with `updateShowFields` (an `updateDoc` of that field), friends with `arrayUnion`, the setlist with `editSetlist(showId, edit)` (`lib/setlistEdits.js`, applied in a transaction to the stored setlist). Never write a whole show from the app's copy (`setDoc` of every field): another device's edit made meanwhile would be erased.
- **A signed-in user's shows are a live listener that fails loudly** (5.60.10): `loadShows` runs `startShowsListener` (`lib/liveShows.js`). If the first snapshot misses its deadline, or the listener errors, the shows are read once with a deadline of their own, and loading always ends (the 5.36.4 hang, `lib/firebase.js`). Snapshots go through `mergeShowsSnapshot`, which keeps a show this device is still saving and the setlist of an edit in flight. `resetUserState` stops the listener; don't add another listener on the shows.
- **Logic the server and the app share is CommonJS in `lib/`**, required by the functions with a relative path (`lib/showDate.js`, `lib/stats`, `lib/showDoc.js`, `lib/showIdentity.js`, `lib/setlistSources.js`, `lib/bandSetlistMerge.js`, `lib/bandSetlistRules.js`, `lib/setlistParser.js`, `lib/showInputs.js`, `lib/normalizeShow.js`, `lib/yearInReviewStats.js`, `lib/yearRecap.js`, `lib/runIndex.js`, `lib/artistSlug.js`, `lib/festivalMatch.js`, `lib/setlistEdits.js`, `lib/setGroups.js`). No new server twin of a `lib/` module and no parity test to keep one in step: make the module CommonJS (no `@/` imports, nothing from Firebase's client SDK) and require it.
- **A venue count uses `countVenues`** (`lib/venueCount.js`), or `lib/stats`, which counts with the same key.
- **Guest shows leave the device only after their Firestore write is confirmed** (`lib/guestMerge.js`).
- **No user count is shown anywhere outside the admin portal until there are 1,000 users** (decision 2026-11-14): every display goes through `shouldShowUserCount(totalUsers)` (`lib/userCount.js`), and below the threshold the number is hidden entirely, with no vague wording in its place. `lib/__tests__/userCount.test.js` lists the displays.
- **The numbers people see are computed on the server** (5.59.15): `lib/stats` (one definition, CommonJS, golden-tested; top 10 bands, venues and songs since 5.60.27, `fixtures/user-stats/` for the native app) → `userStats/{uid}` and `publicUserStats/{uid}` (rules: no client writes), via `recompute-my-stats` and the 6-hourly `community-stats` job. Year in Review's `stats` and the 2026 `recap` (`lib/yearRecap.js`, 5.60.16) are written the same way onto every existing `yearInReviews/{uid}_{year}`; the rules refuse client writes of `recap`. Never read the `showCount`/`songCount`/`ratedSongCount`/`venueCount` fields on `userProfiles`: old iOS builds still write them and nothing trusts them. No client code reads every profile.

## Security invariants (5.59.6 to 5.59.12)

These closed real holes. `tests/rules/security.rules.test.js` and `tests/security/*.test.js` cover them; don't loosen them to make a feature easier.

- **No email address on any document other users can read.** `userProfiles` and `roadmapItems` must not carry one (the rules refuse `email`/`invitedByEmail` on profiles). Get an address from Firebase Auth on the server: `netlify/functions/lib/accountEmails.js`.
- **The browser never writes into another user's friends list.** Being in `users/{X}/friends/{me}` lets me read X's shows. Cross-user friendship writes go through `netlify/functions/friends.js`, which checks a pending request, an invite to the caller's own address or a signed referral link (`lib/referralToken.js`). Links that should auto-friend must be signed (`signReferral`).
- **The app never reads a friend's shows or writes their documents** (5.60.11): removing a friend, blocking and unblocking (`block`/`unblock`, 5.60.27: the block list, both sides of the friendship, requests and tags either way, the moderation notice), Shows Together (`showsTogether`, `showsTogetherCounts`) and show suggestions (`suggestionScan`) go through `netlify/functions/friends.js`, mutual friends only. The rules still allow the old direct reads because iOS 3.13.26 and earlier use them; tightening waits for `minSupportedIosVersion` (`docs/ios-native/GATED-CLEANUPS.md`, which lists every cleanup gated that way).
- **Tags, suggestion answers and engagement notifications are the server's** (5.60.29, Stage 3 C-2, C-3, C-5). Tags go through `friends.js` `tag`, `respondTag`, `revokeTag` and `refreshUpcomingTags`, built from the tagger's stored show. Suggestion answers go through `respondSuggestion` (`netlify/functions/lib/showSocialActions.js`). Reply and mention notifications are written by `moderate-content`, likes and meetup joins by `engagement-notify` (`lib/engagementNotifications.js`), never by the app. `tests/security/showSocial.test.js` fails if client code writes one. The old client-write rules wait for `minSupportedIosVersion` (GATED-CLEANUPS).
- **`send-email` builds every email on the server** from a record the caller wrote (`lib/emailAuthorization.js`, templates in `lib/notificationTemplates.js`). Never send HTML or an address from the browser.
- **Anything that spends a paid API key needs sign-in and a per-user limit** (`lib/aiScan.js`, `lib/rateLimit.js`).
- **A public function that spends a shared third-party quota (setlist.fm) is wrapped in `withProxyLimit`** (`lib/proxyLimit.js`, 5.59.8). `tests/security/auditFollowups.test.js` fails if a function reads the setlist.fm key without it. Our own server-to-server calls send `internalProxyHeader()`.
- **Client code reaches a function through `apiUrl()` or `authedFetch()`**, never a bare `/.netlify/...` or `/api/...` string: on iOS a relative URL resolves against `capacitor://localhost` (B-01).
- **Shared caches are written by the function that fetches the data**, never by the browser.
- **Guests (Firebase anonymous auth, native app) are not accounts** (5.60.13). Rules use `isAccount()` (`firestore.rules`, `storage.rules`) and functions use `requireAccount` (`lib/requestAuth.js`, 403 `account_required`) for anything social, user-generated, public or paid. A guest is `isAnonymous(decoded)` in `netlify/functions/lib/firebaseAdmin.js`: provider `anonymous` and no linked identity. Server jobs check Firebase Auth (`isAnonymousAuthUser`, `listAnonymousUids`), never a profile field. The list of what a guest can and can't do is in `docs/ios-native/DECISIONS.md`; `tests/rules/anonymous.rules.test.js` and `tests/security/anonymous.test.js` enforce it. A new feature that other users can see needs the same check.
- **One admin check: `isAdmin(decoded)`** in `netlify/functions/lib/firebaseAdmin.js` (the `admin` custom claim, or the allowlisted address with `email_verified`). No function keeps its own `ADMIN_EMAILS` check; `isAdmin()` in `firestore.rules` and `storage.rules` is the same rule. The client's `isAdminUser` (`lib/adminAccess.js`) is for showing UI only. A tool the Stage 3 calls gate on the claim alone (`send-test-push`, C-7) uses `hasAdminClaim(decoded)` from the same file.
- **A public function that writes a cache validates its input first** (`lib/cacheGuard.js`), builds the key itself, caches only a good upstream answer, and counts misses with `checkProxyLimit(event, 'metadata')`.
- **A public page made from a user's data is built on the server from their own documents**, never from the request body (`create-shared-collection`, 5.59.12).
- **`npm run lint` must pass with 0 errors** (`eslint.config.js`; the Lint workflow). Warnings are a backlog, not a gate.

## Native SwiftUI app

The approved decisions for the native app (`ios-native/`, 4.0.0) are in `docs/ios-native/DECISIONS.md`: architecture, tabs, guests on anonymous auth, what the server owns, design tokens, Xcode Cloud. Read it before any native work, and don't reopen a decision there without asking.

## Versioning: every PR bumps the App Store version

**Every PR opened for MySetlists bumps the App Store version**, in addition to the web version in `package.json` (and its `CHANGELOG.md` entry). The one exception is a native-only PR (below), which bumps only the native version.

- Change `MARKETING_VERSION` in `ios/App/App.xcodeproj/project.pbxproj`. It appears twice (Debug and Release); change both. `Info.plist` reads `CFBundleShortVersionString` from it, so nothing else needs editing.
- Default to a patch bump (3.6 → 3.6.1 → 3.6.2). Use a minor bump (3.6.x → 3.7) only when the user asks for one.
- Bump from the value on the latest `main`, not from your branch's starting point. If another open PR already took the next number, take the one after it and say so in the PR description.
- Leave `CURRENT_PROJECT_VERSION` (the build number) alone. Xcode Cloud sets it.
- Name the new version in the PR description, and in the `CHANGELOG.md` entry ("Ships in iOS 3.6.1").

**The native app (`ios-native/`) has its own version** (Q-09, decided 2026-11-14). The rule above still applies to every PR, `ios-native/` ones included. In addition:

- A PR that touches `ios-native/` also bumps the native `MARKETING_VERSION` in `ios-native/MySetlists.xcodeproj/project.pbxproj` (every build configuration). The project starts at 4.0.0 (Part 3); after that, patch bumps (4.0.0 → 4.0.1 → 4.0.2), with the same "bump from the latest `main`" rule.
- Name both versions in the PR description and the `CHANGELOG.md` entry ("Ships in iOS 3.13.30 (Capacitor) and native 4.0.1").
- **A native-only PR bumps only the native version** (decided 2026-11-15). That is a PR whose changes are all under `ios-native/`, `fixtures/` or `docs/`, or in `CLAUDE.md`, in any combination. It leaves `package.json`, `CHANGELOG.md` and the Capacitor `MARKETING_VERSION` alone, since neither the website nor the Capacitor app changes. Name the native version in the PR description ("Ships in native 4.0.10; web and Capacitor unchanged"). A PR that also touches anything else (`lib/`, `netlify/`, `app/`, `components/`, `ios/`, `package.json`, …) bumps all three, as above. Netlify builds no deploy preview for a PR that changes only `ios-native/`, so the required Smoke Tests check passes it with a notice instead of testing a preview (`.github/workflows/smoke-tests.yml`, 5.60.26).
- The Capacitor app stays on 3.x and never takes a 4.x number: build numbers can't collide while the two share one App Store record.
- Leave the native `CURRENT_PROJECT_VERSION` alone too. Xcode Cloud sets it.
