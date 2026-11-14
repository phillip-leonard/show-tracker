# MySetlists native SwiftUI app: scoping audit

Audit of `main` at `24f3b0c` (web 5.59.4, iOS `MARKETING_VERSION` 3.13.4), taken on 2026-11-12 on branch `docs/swiftui-scoping`. This document is planning only. No app code was changed.

**How to read the citations.** Every `path:line` points at the file as it is at `24f3b0c`. A range `a–b` is the full span of a declaration. "Size" columns count the route's **transitive** import closure (components and `app/` files it reaches, excluding the shared `components/ui/*` kit and `context/AppContext.jsx`); closures overlap, so sizes don't add up. Where something can't be decided from the code, it says **Cannot be determined from the code** and the question goes to §7.5.

**Three findings change the plan, and are worth reading first:**

1. **Guest accounts lose their shows at cutover.** Guest mode is not Firebase anonymous auth. A guest's shows live only in WKWebView `localStorage` under `guest-shows` (`context/AppContext.jsx:947–968`, `lib/storage.js:55`). A native app can't read that storage, so every guest who hasn't signed up loses their history on the update. (§3.4)
2. **Google users may not have to sign in again; everyone else will.** `capacitor.config.ts:39–41` sets `skipNativeAuth: false`, so the Capacitor plugin also signs Google users into the native Firebase iOS SDK, which keeps its session in the Keychain. Apple sign-in overrides this per call (`lib/native-auth.js:142`) and email/password never touches the native SDK. Whether the Keychain session survives into a new binary under the same bundle ID needs a device test. (§3.4)
3. **Several numbers other users see are computed in the browser and written to shared documents.** The leaderboard reads `userProfiles.showCount/songCount/ratedSongCount/venueCount` (`netlify/functions/lib/communityStats.js:44–96`), and those fields are written by the client on every load (`context/AppContext.jsx:153–178`). A second (Swift) writer is exactly the drift problem this audit is meant to prevent. These move server-side first (§7.2).

---

## Part 1: What the iOS app does today

The iOS app is the Next.js static export (`out/`) loaded by Capacitor 8.5.1 into a `CAPBridgeViewController` (`ios/App/App/SceneDelegate.swift:27`). Everything below runs the same JavaScript as the website. Calls to Netlify functions go to `https://mysetlists.net` when native (`lib/api.js:18–26`).

**Navigation shell.** The live shell is the inline `AppShell` in `app/AppProviderWrapper.jsx` (lines 306–513): a slide-out `Sidebar` plus `MobileHeader`. There is **no tab bar**. `components/layout/MobileTabBar.jsx:9–24` and `components/layout/AppShell.jsx:9–15` both say they are not mounted. The five "root" routes that can't be navigated back out of are `ROOT_ROUTES` in `lib/navRoutes.js:24`: `/`, `/shows`, `/search`, `/stats`, `/profile`. Back-navigation parents are declared in `lib/navRoutes.js:44–150`.

**Native gating, in total.** There is no per-screen `isNative` gate and no "UGC stripping" for native: every signed-in screen ships in the iOS build. Guideline 1.2 is met by **moderation controls** (terms gate, filter, report, block, 24h review), not by removing social features (§5). The only `isNativePlatform()` branches in the UI are:

| Where | What changes on native |
|---|---|
| `components/layout/Sidebar.jsx:262–280` | Buy Me a Coffee donation link hidden (payments outside IAP) |
| `components/InstallPrompt.jsx:8` | PWA install prompt not shown |
| `components/LandingPage.jsx:52–56, 444, 449` | Web-only blocks of the signed-out landing page hidden |
| `app/AppProviderWrapper.jsx:178` | A signed-out `/bands/?band=` is not redirected to the public `/artist/` page (the bundle has no public pages) |
| `context/AppContext.jsx:352, 398` | "Songs I've heard" tool hand-off (`rememberHeardShows`, `pendingNext` return) skipped |
| `components/auth/LoginForm.js:68`, `SignupForm.js:98`, `context/AppContext.jsx:1328` | Google/Apple go through the native sheet, never `signInWithPopup` |
| `components/TicketScanner.jsx:283–290` | Native camera vs. library chooser (Guideline 5.1.1 in-context permission) |
| `components/notifications/NotificationSettings.js:206, 259–262` | Web-push section replaced by native push + in-app settings |
| `components/heard/PosterShare.jsx:47, 103–104` | Download button hidden; share sheet only |
| `components/shows/ArchivalAudioSection.jsx:24–26`, `lib/publicProfile.js:29–45`, `lib/spotify.js:17` | External links open in `@capacitor/browser` |
| `lib/heardLinks.js:64` | Links to `/heard/` use the absolute site URL |
| `lib/service-worker.js:28–29` | No service worker |
| `lib/firebase.js:56–66` | Auth persistence is `browserLocalPersistence` only (no IndexedDB) |

Separately, `PLAYLIST_CREATION_ENABLED = false` (`lib/constants.js:61`) hides Spotify/Apple Music playlist creation on **both** platforms, because a broken Apple Music button would be a Guideline 2.1 rejection (`lib/constants.js:53–55`).

### 1.1 Screen inventory

Gating key: **All** = rendered for signed-in users on web and iOS with no native branch. **Guest-hidden** = not in the guest sidebar (`components/layout/Sidebar.jsx:73–81`).

| Route | Main component | What it does | Native gating | Size (components / LOC; lib+hooks files / LOC) |
|---|---|---|---|---|
| `/` | `app/page.jsx` → `app/shows/page.jsx` | Signed-out: landing page (`components/LandingPage.jsx`). Signed-in: same as `/shows` (`app/page.jsx:1–16`) | Landing page has native branches (above) | 42 / 7,782; 50 / 8,094 |
| `/shows` | `app/shows/page.jsx` (889) | My Shows list, filters, saved searches, Relive this night, Year in Review banner, upcoming shows section, and the detail views by query: `?show=` → `components/shows/ShowDetailView.jsx` (1,029), `?upcoming=` → `components/upcoming/UpcomingShowDetailView.jsx`, `?venueKey=` → `components/shows/VenueShowsView.jsx` (`app/shows/page.jsx:47–49`). Split view on wide native screens (`components/layout/SplitView.jsx`) | All; editing callbacks off in guest mode (`app/shows/page.jsx:319–334`) | 41 / 7,765; 50 / 8,094 |
| `/search` | `components/SearchView.jsx` (898) | setlist.fm search by artist/venue/city, add a show or all shows, ticket scanner entry | All | 3 / 1,012; 7 / 908 |
| `/advanced-search` | `components/search/AdvancedSearchView.jsx` (388) | Filter your own shows (notes, songs, friends); saved searches in `localStorage` | All | 3 / 542; 11 / 1,749 |
| `/stats` | `app/stats/page.jsx` + `components/StatsView.jsx` (580) | Personal stats, period picker, year heatmap | All | 32 / 5,973; 43 / 7,404 |
| `/stats/songs` | `app/stats/songs/page.jsx` | Songs by plays/gaps | All | 3 / 287; 7 / 1,182 |
| `/stats/runs` | `app/stats/runs/page.jsx` | Multi-night runs | All | 2 / 76; 7 / 1,451 |
| `/stats/top-artists` | `app/stats/top-artists/page.jsx` | Top bands | All | 3 / 128; 2 / 410 |
| `/stats/top-venues` | `app/stats/top-venues/page.jsx` | Top venues | All | 3 / 132; 2 / 410 |
| `/songs` (`?song=`) | `components/songs/SongDetailView.jsx` | One song across your shows: times heard, gaps | All | 4 / 418; 9 / 1,315 |
| `/runs` (`?run=`) | `components/runs/RunDetailView.jsx` | One run | All | 5 / 580; 13 / 2,464 |
| `/tours` (`?tour=`) | `app/tours/page.jsx` (292), `components/runs/TourDetailView.jsx`, `components/tours/TourBrowseModal.jsx` (765) | Your tours, starred tours, browse a band's tour and bulk-add its shows | Guest-hidden | 7 / 1,570; 19 / 2,317 |
| `/festivals` (`?festival=`) | `components/festivals/FestivalListView.jsx`, `FestivalDetailView.jsx` | Festival attendance, shared catalog, lineups, picks | Guest-hidden | 13 / 2,052; 25 / 3,452 |
| `/discover` (`?band=`) | `components/discover/DiscoverView.jsx`, `FansAlsoSee.jsx` | "Bands you might like" from `bandAffinity` | Guest-hidden | 5 / 408; 13 / 2,519 |
| `/wishlist` | `components/WishlistView.jsx` (577) | Per-band songs you want to catch live | Guest-hidden | 4 / 785; 8 / 1,314 |
| `/bucket-list` | `components/bucketlist/BucketListView.jsx` (329) | Bands and venues to see | Guest-hidden | 4 / 608; 11 / 1,440 |
| `/setlist-photos` | `components/photos/SetlistPhotoDirectory.jsx` | Cross-concert feed of user-uploaded setlist photos (UGC) | Guest-hidden | 6 / 810; 10 / 1,757 |
| `/scan-import` | `components/ScanImportView.jsx` + `components/TicketScanner.jsx` (516) + `components/ImportView.jsx` (613) | AI ticket scan, ticket-site screenshot import, CSV/XLSX import | All (native camera path) | 4 / 1,207; 13 / 3,534 |
| `/venues` (`?venue=`) | `app/venues/VenueDetailClient.jsx` | Venue page: your shows there, ratings, photos, announcements | All | 9 / 624; 8 / 1,044 |
| `/venue-dashboard` (`?venue=`) | `app/venue-dashboard/VenueDashboardClient.jsx` | Verified venue owner's dashboard | All (owner-only in rules) | 5 / 328; 7 / 971 |
| `/bands` (`?band=`, `&song=`) | `components/bands/BandScreen.jsx`, `BandSongScreen.jsx` | Signed-in band page and song page from the public snapshot (`/api/artist`) | Signed-out redirect skipped on native (`app/AppProviderWrapper.jsx:178`) | 9 / 949; 19 / 3,718 |
| `/my-poster` (`?artist=`) | `components/heard/MyPosterView.jsx` | Personal "songs I've heard" poster, server-rendered PNGs | Download hidden native | 4 / 553; 15 / 3,106 |
| `/year-in-review` (`?user=&year=`) | `app/year-in-review/YearInReviewClient.jsx`, `components/yearInReview/YearRecapView.jsx` (327) | Year in Review / 2026 recap, share card | All | 8 / 1,158; 21 / 3,643 |
| `/profile` | `components/profile/ProfileView.js` (918) | Profile, display name/handle, email prefs, alerts, blocked accounts, delete account | All | 10 / 2,465; 20 / 3,793 |
| `/friends` (`?together=`) | `components/FriendsView.jsx` (674), `components/ShowsTogetherView.jsx` | Friends, requests, tags, suggestions, shows together | All | 15 / 3,257; 25 / 4,267 |
| `/invite` | `components/InviteView.jsx` | Email invites | All | 2 / 120; 0 / 0 |
| `/activity` | `components/activity/ActivityFeedView.jsx` | Friends' activity feed (UGC) | All | 6 / 714; 7 / 1,267 |
| `/notifications` | `components/notifications/NotificationCenter.jsx`, `AnniversaryCalendar.jsx` | In-app notifications, upcoming anniversaries | All | 3 / 369; 12 / 1,572 |
| `/meetups` (`?id=`) | `components/meetups/MeetupDetailView.jsx` | Meetup at a show, with discussion (UGC) | All | 6 / 884; 11 / 2,063 |
| `/community` | `components/CommunityStatsView.jsx` | Community leaderboard (`communityStats/global`) | All | 2 / 188; 0 / 0 |
| `/roadmap` | `components/RoadmapView.jsx` | Public roadmap, voting | All | 3 / 218; 3 / 626 |
| `/feedback` | `components/FeedbackView.jsx` | Feedback form | All | 2 / 259; 1 / 199 |
| `/how-to-use` | `app/how-to-use/page.jsx` | Help; App Store Support URL (`app/AppProviderWrapper.jsx:60–63`) | All; public when signed out | 3 / 313; 3 / 241 |
| `/release-notes` | `components/ReleaseNotesView.jsx` (1,801) | Release notes | All | 2 / 1,810; 1 / 64 |
| `/terms`, `/privacy`, `/cookies` | `components/TermsOfService.jsx`, `PrivacyPolicy.jsx`, `CookiePolicy.jsx` | Legal; reachable signed out (`app/AppProviderWrapper.jsx:64`) | All | 3 / 238; 3 / 195–205 |
| `/admin` | `components/AdminView.jsx` (3,292) + `components/admin/*` | Admin console (users, moderation queue, announcements, festivals, on-sale, resync) | Sidebar item when `isAdmin` (`Sidebar.jsx:226`); reachable on native | 22 / 7,151; 26 / 4,251 |
| `/admin/venue-verifications` | `app/admin/venue-verifications/page.jsx` | Approve venue owners | Admin | 1 / 173; 7 / 971 |
| `/upcoming` | `app/upcoming/page.jsx` | Redirect to `/shows/` only (feature removed 5.40.0, `app/upcoming/page.jsx:5–13`) | n/a | 1 / 23 |
| `/spotify-callback` | `app/spotify-callback/page.jsx` | Spotify OAuth return; dormant while `PLAYLIST_CREATION_ENABLED` is false | n/a | 1 / 141 |
| `/compare/setlist-fm`, `/compare/concert-archives`, `/switch/concert-archives`, `/best-concert-tracker-apps-jam-bands` | `components/compare/ComparePage.jsx` | SEO comparison pages; render outside the app shell (`app/AppProviderWrapper.jsx:202–204`) | Not in `lib/navRoutes.js` or the AASA file, so not reachable from in-app navigation | 4 / 322–368 |

**App-wide overlays, not routes** (all in `app/AppProviderWrapper.jsx`): `AuthModal` (lines 34, 294, 415), `TermsGate` (265), `SuspendedScreen` (240), guest-to-account migration prompt (309+), guest signup prompt, invite welcome modal (`welcomeState`), `HeardSaveModal` (422), `PushOfferModal` (458), `VenueRatingModal` (466), `InstallPrompt` (454, web only), toast. Plus `components/WhatsNewModal.jsx` and `components/PopupOverlay.jsx`/`AdminPopups.jsx`.

### 1.2 Flows

| Flow | Files involved, in order |
|---|---|
| **Sign in: Google** | `components/auth/AuthModal.js:30–40` (terms tick, parked in `localStorage` by `lib/terms.js:84`) → `components/auth/LoginForm.js:52–75` → native: `lib/native-auth.js:39–59` (`FirebaseAuthentication.signInWithGoogle()`, then `signInWithCredential` into the JS SDK); web: `signInWithPopup` with the pre-warmed resolver (`lib/firebase.js:87–96`, `components/auth/OAuthButtons.js:67–74`) → `onAuthStateChanged` in `context/AppContext.jsx:975–1282` |
| **Sign in: Apple** | Same entry → `lib/native-auth.js:118–164` (`skipNativeAuth: true` per call, raw nonce, `adoptAppleDisplayName` runs the name through `lib/contentFilter.js`) |
| **Sign in: email** | `components/auth/LoginForm.js:31–49`, `SignupForm.js:73`, `ForgotPasswordForm.js:19` |
| **Guest** | `context/AppContext.jsx:1379–1398` `enterGuestMode` (sets state, writes an unauthenticated `guestSessions` doc) → shows in `localStorage` via `loadGuestShows`/`saveGuestShows` (947–968) → on sign-in, the auth effect marks the session converted (1083–1106) and opens the migration prompt (1116–1122) → `handleMigrateData` (1285–1313) |
| **Log a show: setlist.fm search** | `components/SearchView.jsx` → `/api/search-setlists` (`netlify/functions/search-setlists.js`) → `lib/setlistSearch.js:22–36` `setlistToShowData` (reverses DD-MM-YYYY) → `addShow` (`context/AppContext.jsx:1485–1587`) → `enrichShowDataWithBandSetlist` (`lib/bandSetlist.js:347`) → `buildShowDoc` (92–108) → `writeShowDoc` (121–124) |
| **Log a show: band-native source** | `lib/setlistSources.js:252–266, 326` `resolveSource` picks elgoose/ttbase/kglw/thecarton/goset (`config/songfish-sites.json`), phish.net, or the Internet Archive → `lib/bandSetlist.js:72–165` → `/api/band-setlist` (`netlify/functions/band-setlist.js`) → merge `lib/bandSetlistMerge.js:257` → fields `lib/bandSetlist.js:227–245`. Re-sync and review: `context/AppContext.jsx:1924–2085`, `components/shows/ArchiveProposalReview.jsx`, `ArchiveSetlistReview.jsx` |
| **Log a show: AI ticket scan** | `components/TicketScanner.jsx:50–110` (native camera/library via `lib/nativePermissions.js:53`) → `resizeImageForUpload` (`lib/utils.js:213`) → `POST /.netlify/functions/analyze-tickets` (`TicketScanner.jsx:125`; Claude model `claude-sonnet-5-5`, `netlify/functions/analyze-tickets.js:84`) → per show, `search-artists` + `search-setlists` (`TicketScanner.jsx:160–190`) → user picks → `addShow`. Screenshot import: `components/ImportView.jsx:182` → `analyze-screenshot` |
| **Log a show: tour bulk add** | `components/tours/TourBrowseModal.jsx` → `get-artist-tours`, `get-tour-shows` → `addShowsFromTour` (`context/AppContext.jsx:1614–1704`) |
| **Rate songs** | `components/shows/ShowDetailView.jsx` → `components/shows/SetlistView.jsx` → `updateSongRating` / `updateSongComment` / `batchRateUnrated` / `updateShowRating` (`context/AppContext.jsx:3521–3639`) → `saveShow` (1407–1421), which `setDoc(..., { merge: true })`s the **whole show including the full `setlist` array** |
| **Friend tagging** | `components/TagFriendsModal.jsx` → `tagFriendsAtShow` (`context/AppContext.jsx:2816–2875`): batch-creates `showTags` with a sanitized show copy (`sanitizeShowForTag`, 2801–2814), then emails each friend from the client via `lib/email.js:24` → `send-email` |
| **Accept a tag** | `components/notifications/NotificationCenter.jsx` / `components/FriendsView.jsx` → `acceptShowTag` (`context/AppContext.jsx:3278–3326`): reads the tag, `addShow`s its `showData` (or `addUpcomingShow` for an upcoming tag), sets `status: 'accepted'`. Bulk: `bulkAcceptAll` (3338), `bulkAcceptFromFriend` (3349). Email tags for non-users: `tagFriendByEmail` (3398–3429), `acceptPendingEmailTag` (3362–3386) |
| **Stats** | `app/stats/page.jsx`, `components/StatsView.jsx`, `lib/useStatsPeriod.js`, `lib/songCounts.js:50` `buildSongStats`, `lib/songIndex.js:71`, `lib/runIndex.js:204, 247` |
| **Year in Review** | Two calculators: `lib/yearInReviewStats.js:72` `computeYearInReview` (used by `app/year-in-review/YearInReviewClient.jsx:21`, cached to `yearInReviews/{uid}_{year}` by `lib/yearInReview.js:30–38`) and `lib/yearRecap.js:101` `computeYearRecap` (used by `components/yearInReview/YearRecapView.jsx:108`, `YearInReviewCard.jsx:39`, `RecapStatsCard.jsx:14`). Rarity: `lib/yearRecapRarity.js:93`. Share card: client posts the computed recap to `/api/my-poster` (`netlify/functions/my-poster.js`, `lib/yearRecapCard.js`). Emails: `netlify/functions/lib/yearRecapEmail.js` via `admin-send-announcement.js` |
| **Tours** | `app/tours/page.jsx`, `hooks/useRunIndex.js:17` `useTourIndex` → `lib/runIndex.js:247` `buildTourIndex`; stars in `favoriteTours/{uid}` (`lib/favoriteTours.js:40–83`, `hooks/useFavoriteTours.js`) |
| **Festivals** | `components/festivals/*`; `context/AppContext.jsx:2200–2661` (match, join, create, update, leave, attach/import/detach shows); canonical catalog `festivals/*`, attendance `users/{uid}/festivals/*`; lineups `festival-lineup`, `search-festival-lineup` |
| **Wishlist** | `components/WishlistView.jsx`, `components/wishlist/ArtistPicker.jsx`, `lib/wishlist.js:59–134` (`wishlists/{uid}_{artistKey}`); band catalog cached in `localStorage` `wishlist_catalog_<mbid>` (`WishlistView.jsx:89–100`) |
| **Posters and sharing** | Personal poster: `components/heard/MyPosterView.jsx` → `lib/myPoster.js:78` `buildMyPoster` → `PosterShare.jsx:57–70` posts to `/api/my-poster` (server SVG→PNG, `netlify/functions/lib/posterImage.js`) → `navigator.share` (`PosterShare.jsx:83`). Shared collection: `shareCollection` (`context/AppContext.jsx:3861–3921`) → `create-shared-collection`. Year in Review share: `components/yearInReview/ShareYearInReview.jsx` |
| **Upcoming shows** | `components/upcoming/UpcomingShowsSection.jsx`, `UpcomingShowForm.jsx`, `UpcomingShowDetailView.jsx`; `context/AppContext.jsx:2882–3119`; `users/{uid}/upcomingShows`; validation `lib/upcomingShows.js:67–92`. Ticket links per artist: `components/UpcomingShows.jsx` → `ticketmaster-events`, `seatgeek-events` (`lib/ticketEvents.js:90`) |
| **Push and band alerts** | Follow: `toggleFavoriteArtist` (`context/AppContext.jsx:3732–3785`) writes `userProfiles.favoriteArtists`, calls `resolve-artist`, then offers push once (`shouldOfferPush`, `lib/pushAlerts.js:151`) via `components/notifications/PushOfferModal.jsx`. Token: `lib/pushAlerts.js:63–170`. Sending: scheduled `followed-band-notifications` → `-background` → `netlify/functions/lib/followedBandAlerts.js` → `lib/pushDelivery.js`; also `anniversary-notifications`, `onsale-scan`, `onsale-reminder`. Settings: `components/notifications/NotificationSettings.js`, `OnsaleAlertSettings.jsx`, `lib/alertSettings.js` (`alertSettings/{uid}`) |
| **Account deletion** | `components/profile/ProfileView.js:280–302` → `POST /api/delete-account` (`netlify/functions/delete-account.js:56–163`) → `netlify/functions/lib/userDataPurge.js:214` `purgeUserData` → client `forgetPushToken` + `signOut` |
| **Report and block** | Report: `components/moderation/ReportButton.jsx`, `ReportModal.jsx` → `lib/moderation.js:140` `submitReport` → `report-content`. Block: `components/moderation/UserProfileSheet.jsx`, `components/friends/FriendCard.jsx` → `blockUser` (`context/AppContext.jsx:626–662`) → `lib/moderation.js:243` (writes `userBlocks`, clears pending items, calls `notify-block`). Unblock: `components/moderation/BlockedAccountsSection.jsx` → `lib/moderation.js:322`. Admin queue: `components/admin/ModerationQueue.jsx` → `moderate-report` |

### 1.3 Native plumbing

**Capacitor plugins** (`package.json:5–15`; SPM manifest `ios/App/CapApp-SPM/Package.swift`, which also pins iOS 15):

| Plugin | Used at | What it does |
|---|---|---|
| `@capacitor/core` | `lib/platform.js:89–96`, `lib/native-auth.js:24–30`, `lib/api.js:10–16`, `lib/firebase.js:56–66`, `lib/capacitor.js:16–24`, `lib/service-worker.js:28` | `isNativePlatform()` |
| `@capacitor-firebase/authentication` 8.1 | `lib/native-auth.js:43–44, 122–143`; config `capacitor.config.ts:39–42` | Native Google sheet and Sign in with Apple |
| `@capacitor-firebase/messaging` 8.1 | `lib/pushAlerts.js:52–170`; config `capacitor.config.ts:45–47`; `ios/App/App/AppDelegate.swift:56–66` | FCM token, permission, tap events |
| `@capacitor/app` | `components/layout/DeepLinkListener.jsx:55–60`, `components/PlaylistCreatorModal.jsx:94`, `components/notifications/NotificationSettings.js:211` | `appUrlOpen`, `getLaunchUrl`, resume listener |
| `@capacitor/browser` | `components/shows/ArchivalAudioSection.jsx:26`, `lib/publicProfile.js:31`, `components/PlaylistCreatorModal.jsx:93` | In-app Safari for external links |
| `@capacitor/camera` | `components/TicketScanner.jsx:70–80`, `lib/nativePermissions.js:55–100` | Camera/library pick and permission |
| `@capacitor/haptics` | `lib/capacitor.js:61–83` | One light impact when a swipe gesture commits |
| `@capacitor/keyboard` | `lib/keyboardInset.js:83–123`; config `capacitor.config.ts:26–29` | Keyboard height → CSS `--keyboard-height` |
| `@capacitor/splash-screen` | `lib/capacitor.js:45–50`; config `capacitor.config.ts:33–38` | Hide splash on mount |
| `@capacitor/status-bar` | `lib/capacitor.js:27–34` | Dark style, overlay WebView |

**Deep links and universal links.**
- Custom scheme `mysetlists` (`ios/App/App/Info.plist:23–32`) and the Google reversed client ID scheme (lines 33–40).
- Universal links: `applinks:mysetlists.net` (`ios/App/App/App.entitlements`, `AppRelease.entitlements`). `public/.well-known/apple-app-site-association` lists every app screen for `66N4YR3VP9.com.mysetlists.app` and leaves `/`, `/artist/`, `/heard/`, `/u/`, `/p/`, `/compare/` and the legal pages in Safari.
- Routing: `components/layout/DeepLinkListener.jsx:32–78` (warm `appUrlOpen`, cold `getLaunchUrl`, de-dup within 2s, `resetNavHistory`, `router.replace`) → `lib/deepLinks.js:57–85` (`deepLinkTarget`, which also rewrites the old path shapes in `LEGACY_SHAPES`, lines 34–41). Cold-start links depend on `SceneDelegateProxy` (`ios/App/App/SceneDelegate.swift:30–46`).
- **The deeplink/reload fix** is two changes: 5.46.0 (`CHANGELOG.md:1741`, details at 1792–1802) replaced the `[param]` dynamic routes with query-parameter routes (`lib/showRouting.js`) because `out/` had only a `_` placeholder and a reload or email link rendered the root page; and 5.47.18 (`CHANGELOG.md:1021–1060`) added `DeepLinkListener` and the AASA file, since before it nothing listened for links at all. 5.49.3 (`CHANGELOG.md:793–819`) added `signInLeavesRoute` (`lib/deepLinks.js:101–104`) so signing in from a link lands on it. CLAUDE.md's routing section is the standing rule.
- Query params consumed on load, all in `context/AppContext.jsx`: `?ref=` invite referrer (296–306), `?follow=` (312–321), `?heard=` (330–343), `?signup` (359–365), `?login`/`?next=` (376–395), `?tab=` friends tab (409–436).

**Push.** Registration is APNs at launch with no prompt (`ios/App/App/AppDelegate.swift:50–58`). Permission is asked only in context: first follow (`context/AppContext.jsx:3772–3774`) or "Turn on push alerts" in settings (`lib/pushAlerts.js:6–15`). The token is stored as `pushTokens/{fcmToken} = { userId, platform: 'ios', updatedAt }` (`lib/pushAlerts.js:73–84`), re-synced on every signed-in launch (`context/AppContext.jsx:550–552`), deleted on sign-out (`lib/pushAlerts.js:141–149`). Sending is server-side through FCM (`netlify/functions/lib/pushDelivery.js`) from the scheduled jobs; a push carries `data.link`, a universal link routed like any other (`lib/pushAlerts.js:161–170`). `aps-environment` is `development` in Debug and `production` in Release entitlements.

**Status bar, keyboard, haptics.** Status bar: `lib/capacitor.js:27–34` plus `UIViewControllerBasedStatusBarAppearance` (`Info.plist:94–95`). Keyboard: `lib/keyboardInset.js` (single owner of `--keyboard-height`), `hooks/useKeyboardInset.js`, used by `components/auth/AuthModal.js` and `components/ui/Modal.jsx`. Haptics: only `impact()` from the three swipe gestures (`hooks/useEdgeSwipeBack.js`, `hooks/useSheetDrag.js`, `hooks/useDrawerSwipeClose.js`), switched by `TOUCH_GESTURES_ENABLED` (`lib/platform.js:80`).

**Info.plist permission strings** (`ios/App/App/Info.plist`):
- `NSCameraUsageDescription` (48–49): ticket scan, or a photo at a gig.
- `NSPhotoLibraryUsageDescription` (52–53): pick a ticket stub, add photos/videos to a show.
- `NSPhotoLibraryAddUsageDescription` (50–51): save an image such as the Year in Review card.
- No location, contacts, microphone or tracking strings. `ITSAppUsesNonExemptEncryption = false` (44–45). Orientations: all on iPad, portrait + landscape on iPhone (81–93). `UIApplicationSupportsMultipleScenes = false` (57).

**Privacy manifest** (`ios/App/App/PrivacyInfo.xcprivacy`): `NSPrivacyTracking = false`; collected types, all linked, none tracking: email (11–22), name (23–34), user ID (35–46), photos/videos (47–58), other user content (59–70), product interaction for analytics and app functionality (71–83). Required-reason API: `UserDefaults` `CA92.1` (85–94).

---

## Part 2: Business logic in `context/AppContext.jsx` and what it delegates to

`context/AppContext.jsx` is 4,235 lines. `AppProvider` is lines 221–4226 and exports **184 keys** through `value` (3981–4226), read with `useApp()` (4227–4233). Every function, derived value and effect is classified below; plain `useState`/`useRef` holders are listed in one table after it.

**Category key:** FR Firestore read · FW Firestore write · DC derived calculation · API external/Netlify call · UI UI or session state · SE side effect (email, notification, push, activity).
**Home key:** **Server** = server-shared (Netlify/Cloud Function) · **Swift** = port to Swift · **Web** = web-only · **Native** = replaced by a native API rather than ported.

### 2.1 Module-level helpers (outside `AppProvider`)

| Name | Lines | Category | Touches | Must match web exactly? | Proposed home | Notes |
|---|---|---|---|---|---|---|
| `BULK_ADD_DELAY_MS` | 67 | UI | — | No | Swift | 120 ms between bulk writes |
| `HEARD_NEXT` | 80 | UI | — | No | Web | Return path for the heard tool; native skips it (398) |
| `mintShowId` | 81–85 | DC | show ids | **Yes** | Swift | Ids are millisecond-timestamp strings, monotonic per session (69–76). Every existing doc is keyed this way |
| `buildShowDoc` | 92–108 | DC | show shape | **Yes** | Swift (later Server) | The one place a show's shape is defined. `isManual = !setlistfmId && !isBandSourced` (105) is what `admin-populate-setlist.js` checks |
| `isBandSourced` | 113–116 | DC | `setlistSource` | Yes | Swift | |
| `writeShowDoc` | 121–124 | FW | `users/{uid}/shows/{id}` | Yes | Swift | Replaces local ISO `createdAt` with `serverTimestamp()` |
| `revokePendingTags` | 135–151 | FR+FW | `showTags` | Yes | Swift | Sets `status: 'revoked'` rather than deleting |
| `updateUserProfile` | 153–178 | DC+FW | `userProfiles/{uid}`: `showCount`, `songCount`, `ratedSongCount`, `venueCount`, `email`, `photoURL`, `lastLogin`, `createdAt`, and a misspelled `odubleserId` (173) | **Yes**: summed by `netlify/functions/lib/communityStats.js:44–96`, shown in Admin and friend cards | **Server** | venueCount counts raw `s.venue` (157), unlike every other venue count. Bug tickets B-03, B-04 |
| `ensureProfileCreatedAt` | 203–212 | FR+FW | `userProfiles.createdAt` | Yes | Swift (or server on create) | `Timestamp.fromDate(auth creationTime)` |

### 2.2 Inside `AppProvider`: functions, derived values and effects

| Name | Lines | Category | Touches | Must match web exactly? | Proposed home | Notes |
|---|---|---|---|---|---|---|
| `isReturningUser` | 285 | DC | `userCreatedAt` | No | Web | Feeds `lib/popupManager.js` (web popup system) |
| `navigateTo` | 290–293 | UI | router | No | Native | `NavigationStack` |
| effect: `?ref=` | 296–306 | UI | `localStorage invite-referrer` | No | Swift | Becomes a universal-link param handler |
| effect: `?follow=` | 312–321 | UI | `localStorage mysetlists_pending_follow` | No | Swift | |
| effect: `?heard=` | 330–343 | UI | `localStorage mysetlists_pending_heard` | No | Web (v1.x) | Heard tool save |
| `clearPendingHeard` | 344–347 | UI | localStorage | No | Web (v1.x) | |
| effect: `rememberHeardShows` | 351–354 | SE | localStorage | No | Web | Native-skipped (352) |
| effect: `?signup` | 359–365 | UI | — | No | Swift | |
| effect: `?login`/`?next=` | 376–395 | UI | localStorage | No | Web | |
| effect: `pendingNext` redirect | 397–403 | UI | — | No | Web | Native-skipped (398) |
| effect: `?tab=` | 409–425 | UI | — | No | Swift | Friends tab deep link |
| effect: apply `pendingDeepLink` | 428–436 | UI | router | No | Swift | |
| `isAdmin` | 499 | DC | `ADMIN_EMAILS` (`lib/constants.js:5`) | Yes | Web | Client-side email check. Rules have their own `isAdmin()` (`firestore.rules:19–22`) |
| `friendUids` | 505–508 | DC | friends − blocked | **Yes** (moderation) | Swift | |
| `isBlocked` | 510–513 | DC | `blockedUserIds` | **Yes** | Swift | |
| `visibleFriends` | 518–521 | DC | friends − blocked | **Yes** | Swift | |
| `pendingShowTags` | 526–529 | DC | `withoutBlocked` (`lib/moderation.js:366`) | **Yes** | Swift | |
| `myPendingSuggestions` | 532 | DC | `showSuggestions` | Yes | Swift | |
| `myConfirmedSuggestions` | 533 | DC | `showSuggestions` | Yes | Swift | |
| `pendingNotificationCount` | 535 | DC | invites + friend requests | Yes | Swift | |
| effect: `syncPushToken` | 550–552 | SE | `pushTokens` | Yes | Native | `Messaging.messaging().token` |
| effect: toast timer | 557–562 | UI | — | No | Swift | |
| effect: reset friends tab | 565–569 | UI | — | No | Swift | |
| effect: sweep setlist.fm cache | 573–575 | UI | localStorage | No | Web | `lib/setlistfmLocalCache.js`; native uses URLCache |
| effect: community stats | 578–589 | FR | `communityStats/global` (onSnapshot) | Yes | Swift | Server already computes it |
| `loadFriends` | 592–613 | FR | `users/{uid}/friends`, one `userProfiles` get per friend | Yes | Swift | N+1 reads for `showCount` |
| effect: subscribe blocks | 618–624 | FR | `userBlocks/{uid}` | **Yes** | Swift | |
| `blockUser` | 626–662 | FW+SE | `userBlocks`, `showTags` (revoke), `users/{uid}/upcomingShows` (`arrayRemove`), `notify-block` via `lib/moderation.js:243–320` | **Yes** (Guideline 1.2) | Swift | Must ship day one (§5) |
| `unblockUser` | 664–680 | FW | `userBlocks` | Yes | Swift | |
| effect: social listeners | 683–796 | FR | `friendRequests` (to/from), `showTags` (toUid), `showSuggestions`, `invites`, `pendingEmailTags`, `notifications`, `userProfiles/{uid}` | Yes | Swift | Eight `onSnapshot`s; filters `status === 'pending'` client-side |
| effect: upcoming listener | 800–820 | FR | `users/{uid}/upcomingShows` | Yes | Swift | |
| `checkForLocalData` | 823–836 | UI | `localStorage concert-shows` | No | Web | Pre-account legacy data; native has none |
| `calculateUserRank` | 839–849 | FR+DC | **all** of `userProfiles` | **Yes** | **Server** | Downloads every profile on each load and each add. Bug B-05 |
| `loadShows` | 852–874 | FR | `users/{uid}/shows` (one `getDocs`, no listener) | Yes | Swift | Also calls `updateUserProfile`, rank and the suggestion scan |
| `loadFestivals` | 890–944 | FR | `users/{uid}/festivals`, one `festivals/{id}` get each | Yes | Swift | Handles pre-5.30 unmigrated records (896–898) |
| `loadGuestShows` | 947–960 | UI | `localStorage guest-shows` | — | Swift (local file) | **Not migratable at cutover** (§3.4) |
| `saveGuestShows` | 962–968 | UI | `localStorage guest-shows` | — | Swift (local file) | |
| effect: auth listener | 975–1282 | FR+FW+SE | `userProfiles`, `guestSessions`, `users/{me}/friends` **and** `users/{them}/friends`, `invites`, `pendingEmailTags`; email `friendJoined` | **Yes** | **Server** (the referral/invite/auto-friend half) + Swift (session half) | Writes into other users' friend lists from the client (1137–1150, 1204–1217). Terms and ban checks (1023–1076) stay client-side |
| `handleMigrateData` | 1285–1313 | FW | `users/{uid}/shows` | Yes | Swift | Writes `createdAt: show.createdAt \|\| serverTimestamp()`, so migrated shows keep an ISO **string** (§3.2) |
| `handleSkipMigration` | 1315–1321 | UI | localStorage | No | Swift | |
| `handleLogin` | 1324–1340 | API | Firebase Auth | n/a | Native | Google Sign-In SDK |
| `handleLogout` | 1342–1366 | SE | `pushTokens`, Auth | n/a | Native | Must delete the push token first |
| `acceptTerms` | 1367–1371 | FW | `userProfiles.termsAcceptedVersion/At` via `lib/terms.js:100` | **Yes** (`TERMS_VERSION` = 1) | Swift | |
| `openAuthModal`, `closeAuthModal`, `switchAuthMode`, `handleAuthSuccess` | 1373–1376 | UI | — | No | Swift | |
| `enterGuestMode` | 1379–1398 | FW | `guestSessions` (unauthenticated create) | No | Swift (decision §7.5) | |
| `exitGuestMode` | 1400–1404 | UI | localStorage | No | Swift | |
| `saveShow` | 1407–1421 | FW | `users/{uid}/shows/{id}` merge | Yes | Swift | Whole-document write; web and iOS editing the same show is last-write-wins on the `setlist` array (risk R-06) |
| `findDuplicateShow` | 1424–1431 | DC | dedup: artist + venue (trim, lowercase) + **exact** date string | **Yes** | Swift (golden tests) | Misses a DD-MM-YYYY vs YYYY-MM-DD pair (B-07) |
| `mergeTagDataIntoShow` | 1434–1450 | FW | show `taggedBy`, `taggedByUid` | Yes | Swift | |
| `announceAddedShow` | 1458–1466 | UI | toast | No | Swift | |
| `noteShowsAdded` | 1477–1483 | SE | `send-welcome-email` | Yes | Swift (calls function) | Server decides eligibility (`netlify/functions/lib/welcomeEmail.js`) |
| `addShow` | 1485–1587 | FW+API+SE | show write, `guestSessions`, `band-setlist`, `userActivity`, profile counters, suggestions | **Yes** (shape) | Swift (core) + **Server** (counters, suggestions) | |
| `addShowsFromTour` | 1614–1704 | FW+API | shows | Yes | Swift | Sequential writes, 120 ms apart |
| `updateShowData` | 1706–1721 | FW | `updateDoc` show | Yes | Swift | |
| `backfillArtistImages` | 1725–1751 | API+FW | `artist-image`, show `artistImage` | No | Swift (or server job) | 2.5 s per show **Removed in 5.59.9: nothing displays `artistImage`.** |
| `scanForMissingSetlists` | 1754–1900 | API+DC+FW | `search-setlists`, `band-setlist`, shows | **Yes** | **Server** | Matching rules duplicate `admin-find-missing-setlists.js`. Bug B-06 |
| `proposeSetlistFromSource` | 1924–1951 | API+DC | `band-setlist`, `mergeSourceSetlist` | **Yes** | **Server** | Merge logic exists twice: `lib/bandSetlistMerge.js` and `netlify/functions/lib/bandSetlistMergeRule.js`, kept equal by `lib/__tests__/bandSetlistMergeParity.test.js` |
| `applySetlistProposal` | 1968–2010 | DC+FW | show setlist | **Yes** | **Server** | Refuses a merge that would lose ratings or comments (1994–1999) |
| `pendingProposalShows` | 2021–2024 | DC | `setlistProposal.status` | Yes | Swift | |
| `decideStoredProposal` | 2026–2031 | DC | — | Yes | Swift | `decidedAt` is an ISO string |
| `acceptStoredProposal` | 2033–2061 | FW | show | Yes | Server (via merge) | |
| `declineStoredProposal` | 2063–2069 | FW | show | Yes | Swift | |
| `clearSetlistReview` | 2072–2075 | FW | show `needsReview` | Yes | Swift | |
| `resyncSetlistFromSource` | 2077–2085 | API+FW | composes the two above | Yes | Server | |
| `deleteShow` | 2088–2115 | FW | `deleteDoc` show | Yes | Swift | |
| `FESTIVAL_CANDIDATE_LIMIT` | 2200 | UI | — | No | Swift | 20 |
| `findFestivalMatchesFor` (exported as `findFestivalMatches`) | 2224–2264 | FR+DC | `festivals` prefix and date-window queries; `lib/festivalMatch.js` | **Yes** | **Server** | Rule duplicated server-side in `netlify/functions/lib/festivalMatchRule.js`, parity test `lib/__tests__/festivalMatchParity.test.js` |
| `joinFestival` | 2270–2311 | FW | `users/{uid}/festivals` | Yes | Swift | |
| `createFestival` | 2320–2405 | FW | `festivals` (shared) + attendance | **Yes** (rules validate shape, `firestore.rules:688–770`) | Swift | |
| `CANONICAL_FESTIVAL_FIELDS` | 2412 | UI | — | Yes | Swift | |
| `whenPatch` | 2419–2430 | DC | `deleteField` on dates/year | Yes | Swift | |
| `updateFestivalData` | 2432–2489 | FW | `festivals`, attendance | Yes | Swift | |
| `leaveFestival` | 2497–2517 | FW | batch: shows, attendance | Yes | Swift | |
| `attachShowsToFestival` | 2524–2549 | FW | show `festivalId` | Yes | Swift | |
| `importShowsToFestival` | 2570–2642 | FW | batch: shows | **Yes** | Swift | Builds show docs without `buildShowDoc` (B-13); port through the single shape builder |
| `detachShowsFromFestival` | 2646–2661 | FW | batch: shows | Yes | Swift | |
| `sendFriendRequest` | 2665–2717 | FR+FW | `friendRequests`, `users/{uid}/friends` | Yes | Swift (Server later) | Rules let any signed-in user read or write any request (`firestore.rules:265–267`, S-02) |
| `sendFriendRequestByEmail` | 2719–2741 | FR | `userProfiles where email ==` | Yes | **Server** | Client-side email lookup of other users |
| `acceptFriendRequest` | 2743–2776 | FW | `friendRequests`, both users' `friends` | Yes | **Server** | Cross-user write |
| `declineFriendRequest` | 2778–2785 | FW | `friendRequests` | Yes | Swift | |
| `removeFriend` | 2787–2797 | FW | both users' `friends` | Yes | Server | Cross-user delete |
| `sanitizeShowForTag` | 2801–2814 | DC | tag `showData` | **Yes** (rules `hasOnly`, `firestore.rules:301–302`) | Swift | |
| `tagFriendsAtShow` | 2816–2875 | FW+SE | `showTags`, show `taggedFriendUids`, email per friend | Yes | Swift (writes) + **Server** (email) | Email HTML is built in the browser (`lib/emailTemplates.js:100`) and sent by `send-email` |
| `upcomingRef` | 2882 | UI | — | No | Swift | |
| `findDuplicateUpcoming` | 2884–2887 | DC | — | Yes | Swift | |
| `addUpcomingShow` | 2891–2935 | FW | `users/{uid}/upcomingShows` | Yes | Swift | |
| `updateUpcomingShow` | 2937–2961 | FW | upcoming + pending `showTags.showData` | Yes | Swift | |
| `deleteUpcomingShow` | 2963–2971 | FW | upcoming | Yes | Swift | |
| `tagFriendsAtUpcomingShow` | 2976–3028 | FW+SE | `showTags`, `arrayUnion`, email | Yes | Swift + Server (email) | |
| `untagFriendFromUpcomingShow` | 3030–3048 | FW | `arrayRemove` | Yes | Swift | |
| `loadUpcomingTagStatuses` | 3054–3073 | FR | `showTags where fromUid ==` | Yes | Swift | |
| `findSetlistForUpcomingShow` | 3078–3098 | API | setlist search | Yes | Swift | |
| `convertUpcomingShow` | 3104–3119 | FW | upcoming → show | Yes | Swift | |
| `getShowsTogether` | 3123–3137 | FR+DC | **all** of a friend's shows | **Yes** | **Server** | Key: `setlistfmId` or `artist\|venue\|date` on the raw date string (3131). Bug B-08 |
| `normalizeShowKey` | 3141–3144 | DC | — | **Yes** | Server | Same key, exported |
| `buildSuggestionDocId` | 3146–3149 | DC | — | **Yes** | Server | Doc id format |
| `createShowSuggestion` | 3151–3185 | FW | `showSuggestions` | Yes | Server | |
| `checkShowSuggestionsForNewShow` | 3187–3204 | FR | every friend's whole `shows` | Yes | **Server** | One full read per friend per show added |
| `runRetroactiveSuggestionScan` | 3207–3237 | FR+FW | `showSuggestions`, every friend's shows; `localStorage suggestionScan_<uid>` | Yes | **Server** | |
| `respondToSuggestion` | 3239–3275 | FW+SE | `showSuggestions`, email | Yes | Swift + Server (email) | |
| `acceptShowTag` | 3278–3326 | FR+FW | `showTags`, `addShow` | Yes | Swift | |
| `declineShowTag` | 3328–3335 | FW | `showTags` | Yes | Swift | |
| `bulkAcceptAll` | 3338–3346 | FW | — | Yes | Swift | |
| `bulkAcceptFromFriend` | 3349–3359 | FW | — | Yes | Swift | |
| `acceptPendingEmailTag` | 3362–3386 | FW+SE | `pendingEmailTags`, email | Yes | Swift + Server | |
| `declinePendingEmailTag` | 3388–3395 | FW | `pendingEmailTags` | Yes | Swift | |
| `tagFriendByEmail` | 3398–3429 | FW+SE | `pendingEmailTags`, email | Yes | Swift + Server | |
| `markNotificationsRead` | 3433–3440 | FW | batch `notifications` | Yes | Swift | |
| `loadInviteStats` | 3444–3456 | FR | `invites` | Yes | Swift | |
| `sendInvite` | 3458–3486 | FW+SE | `invites`, email | Yes | Swift + Server | |
| `resendInvite` | 3488–3509 | FW+SE | `invites`, email | Yes | Swift + Server | |
| `cancelInvite` | 3511–3518 | FW | `invites` | Yes | Swift | |
| `updateShowRating` | 3521–3540 | FW+SE | show `rating`, `userActivity` | Yes | Swift | Rating is an integer 1–10 (`components/ui/RatingSelect.jsx:5–7`) |
| `updateShowComment` | 3542–3551 | FW | show `comment` | Yes | Swift | |
| `updateArchivalAudioPick` | 3555–3564 | FW | show `archivalAudioPick` | Yes | Swift | |
| `addSongToShow` | 3566–3585 | FW | setlist append, `manuallyAdded: true` | Yes | Swift | Song id `Date.now().toString()` (3572) |
| `updateSongRating` | 3587–3603 | FW | setlist song `rating` | Yes | Swift | |
| `updateSongComment` | 3605–3621 | FW | setlist song `comment` | Yes | Swift | |
| `batchRateUnrated` | 3623–3639 | FW | setlist | Yes | Swift | |
| `deleteSong` | 3651–3665 | FW | `lib/setlistGrouping.js:153` | Yes | Swift | Returns `{song, index}` for undo |
| `restoreSongToShow` | 3674–3686 | FW | `lib/setlistGrouping.js:169` | Yes | Swift | |
| `updateSetlistOrder` | 3688–3696 | FW | setlist | Yes | Swift | |
| `getSongStats` | 3703 | DC | `lib/songCounts.js:50` | **Yes** | **Server** | |
| `getArtistStats` | 3705–3724 | DC | — | **Yes** | **Server** | Groups by raw `show.artist`, not `artistNameKeyLoose` as Year in Review does (`lib/yearRecap.js:14–16`) |
| `bandKey` | 3730 | DC | — | Yes | Swift | trim + lowercase |
| `toggleFavoriteArtist` | 3732–3785 | FW+API+SE | `userProfiles.favoriteArtists`, `get-artist-info`, `resolve-artist`, push offer | Yes | Swift | `addedAt` ISO string (3754) |
| `isArtistFavorite` | 3787–3789 | DC | — | Yes | Swift | |
| effect: pending follow | 3793–3803 | FW | localStorage → follow | No | Swift | |
| `getVenueStats` | 3805–3822 | DC | — | **Yes** | **Server** | Key `venue + ", " + city`, case-sensitive (3808) |
| `normalizeVenueKey` | 3826–3827 | DC | `venueRatings.venueKey` | **Yes** | Swift (exact) | `venue::city`, lowercased |
| `getVenueRatings` | 3829–3832 | FR | `venueRatings where venueKey ==` | Yes | Swift | |
| `computeVenueAggregate` | 3834–3851 | DC | ratings averages | **Yes** (community number) | **Server** | |
| `getTopRatedShows` | 3853–3858 | DC | — | Yes | Server | |
| `shareCollection` | 3861–3921 | API+DC | `create-shared-collection`, clipboard | Yes | Swift | Native share sheet instead of clipboard |
| `importedIds` | 3924 | DC | `setlistfmId` set | Yes | Swift | |
| `showIdBySetlistfmId` | 3927–3931 | DC | — | Yes | Swift | |
| `availableYears` | 3933 | DC | `lib/showFilters.js:33` | Yes | Swift | |
| `sortedFilteredShows` | 3937–3945 | DC | `lib/showFilters.js:17` | Yes | Swift | |
| `artistGroups` | 3947–3964 | DC | — | Yes | Swift | Raw `show.artist` |
| `summaryStats` | 3966–3978 | DC | — | **Yes** | **Server** | `uniqueVenues` counts raw `s.venue` (3976) |
| `value` / `useApp` | 3981–4233 | UI | — | n/a | Native | `@Observable` stores |

**`useState` / `useRef` holders (all UI or session state, home Swift):** `searchParams` 229, `shows` 232, `latestShows` 237, `bulkAdd` 242, `festivals` 248, `festivalsLoading` 252, `activeView` 253, `statsTab` 254, `friendsInitialTab` 255, `showForm` 256, `bucketListPrefill` 259, `selectedShow` 260, `searchTerm` 261, `filterYear` 262, `filterDate` 263, `shareSuccess` 264, `isLoading` 265, `showsLoadedFor` 268, `sortBy` 269, `selectedArtist` 270, `user` 273, `authLoading` 274, `showMigrationPrompt` 275, `localShowsToMigrate` 276, `authModal` 277, `guestMode` 278 (seeded from `localStorage`), `showGuestPrompt` 279, `userCreatedAt` 282, `pendingHeard` 329, `pendingNext` 375, `pendingDeepLink` 407, `communityStats` 439, `userRank` 440, `setlistScanning` 443, `setlistScanProgress` 444, `sidebarOpen` 447, `friends` 450, `pendingFriendRequests` 451, `sentFriendRequests` 452, `incomingShowTags` 453, `upcomingShows` 457, `upcomingLoaded` 460, `tagFriendsShow` 461, `showSuggestions` 464, `pendingInvites` 467, `inviteStats` 468, `sentPendingEmailTags` 470, `blockedUserIds` 476, `termsAccepted` 482 (tri-state), `isSuspended` 488 (tri-state), `favoriteArtists` 492, `favoritesLoaded` 493, `unreadNotifications` 496, `welcomeState` 538, `pendingTagsForReview` 539, `toast` 542, `pushOffer` 546, `venueRatingShow` 555, `lastSignedInUidRef` 973.

`withoutBlocked` is re-exported from `lib/moderation.js:366` through `value`.

### 2.3 `lib/` helpers

| File | Exports (line) | Category | Must match web? | Proposed home | Notes |
|---|---|---|---|---|---|
| `lib/activityFeed.js` | `logActivity` 50, `subscribeFriendActivity` 85 | FR+FW+SE | Yes | Swift | Reads own profile for `shareActivity` first |
| `lib/adminUsers.js` | `buildUserRows` 66, `filterRows` 137, `sortRows` 164, `computeTotals` 200 … | DC | — | Web | Admin |
| `lib/advancedSearch.js` | `matchShow` 41, `filterShows` 94 | DC | Yes | Swift | |
| `lib/alertChannels.js` | `alertChannels` 15, `withChannel` 24 | DC | Yes | Swift | |
| `lib/alertSettings.js` | `loadAlertSettings` 35, `saveAlertSettings` 40, `searchCities` 87 … | FR+FW | Yes | Swift | `alertSettings/{uid}` |
| `lib/anniversaries.js` | `nextOccurrence` 22, `buildUpcomingAnniversaries` 35 | DC | Yes | Swift | UTC-today and DD-MM-YYYY bugs already fixed here (10–12) |
| `lib/api.js` | `apiUrl` 25 | UI | — | Native | Base URL |
| `lib/appleMusic.js` | `loadMusicKit` 12 … | API | — | v1.x (MusicKit) | Disabled by flag |
| `lib/artistImage.js` | `fetchArtistImage` 6 | API | — | Swift | Relative URL, no `apiUrl` (B-01) **Removed in 5.59.9.** |
| `lib/bandScreens.js` | `loadBandIndex` 130, `loadBand` 176, `loadBandSong` 186, `buildBandPersonal` 265 … | API+DC | Yes | Swift | Reads `/api/artists`, `/api/artist`, `/api/artist-song` |
| `lib/bandSetlist.js` | `fetchBandSetlistWithReason` 72, `bandSetlistShowFields` 227, `mergeSourceSetlist` 274, `mergeNeedsWrite` 325, `enrichShowDataWithBandSetlist` 347 | API+DC | **Yes** | **Server** | |
| `lib/bandSetlistMerge.js` | `mergeBandSetlist` 257, `chooseCandidate` 169, `titleAliasesFor` 73 | DC | **Yes** | **Server** | 535 lines; already mirrored server-side with a parity test |
| `lib/bucketList.js`, `lib/bucketListVenues.js` | add/remove/list | FR+FW | Yes | Swift | |
| `lib/capacitor.js` | `initCapacitorPlugins` 12, `impact` 80 | UI | — | Native | |
| `lib/commentViews.js` | `getLastViewed` 30, `markViewed` 40 | FR+FW | Yes | Swift | |
| `lib/comments.js` | `subscribeComments` 54, `postComment` 84, `toggleCommentLike` 108, `deleteComment` 114 | FR+API+FW | Yes | Swift | Posts go through `moderate-content` |
| `lib/comparePages.js` | — | UI | — | Web | SEO |
| `lib/constants.js` | `ADMIN_EMAILS` 5, `PLAYLIST_CREATION_ENABLED` 61 … | UI | Yes | Swift (subset) | |
| `lib/contentFilter.js` | `checkContent` 317, `contentProblem` 349, `BLOCKED_TERMS` 44 … | DC | **Yes** | **Server** (already); Swift copy for instant feedback only | Server copy `netlify/functions/lib/contentFilterRule.js`, parity test `lib/__tests__/contentFilterParity.test.js` |
| `lib/deepLinks.js` | `deepLinkTarget` 57, `signInLeavesRoute` 101 | DC | Yes | Swift | Port with its test cases |
| `lib/discover.js` | `loadAffinity` 21, `dismissBand` 53 … | FR+FW | Yes | Swift | |
| `lib/email.js` | `sendEmailIfAllowed` 24 | SE | Yes | **Server** | Client-built HTML |
| `lib/emailTemplates.js` | 10 templates, 49–181 | DC | Yes | **Server** | Templates live in the browser bundle |
| `lib/favoriteTours.js` | load/add/remove 40–83 | FR+FW | Yes | Swift | |
| `lib/festivalCatalog.js`, `festivalDates.js`, `festivalGrouping.js` | `catalogFields` 28, `festivalWhenFields` 58, `buildFestivalStats` 31 … | DC | Yes | Swift | |
| `lib/festivalMatch.js` | `findFestivalMatches`, `festivalsMatch` 285 … | DC | **Yes** | **Server** | Parity-tested twin |
| `lib/firebase.js` | `auth`, `db`, `storage`, `authProviders` | UI | — | Native | |
| `lib/handles.js` | `claimHandle` 71, `saveDisplayName` 99, `isHandleAvailable` 115 | API+FR | Yes | Swift | Writes go through `moderate-content` (`firestore.rules:101–125`) |
| `lib/heardLinks.js` | `rememberHeardShows` 70 … | UI | — | Web | |
| `lib/importMatch.js`, `lib/importSheet.js` | `importShows` 274, `planShows` 414 … | DC+API | Yes | v1.x | CSV/XLSX import |
| `lib/keyboardInset.js` | — | UI | — | Native | |
| `lib/meetups.js` | `subscribeMeetup` 61, `createOrJoinMeetup` 78, `postMeetupComment` 181 … | FR+FW+API | Yes | Swift | |
| `lib/moderation.js` | `submitReport` 140, `blockUser` 243, `unblockUser` 322, `withoutBlocked` 366, `AUTO_HIDE_THRESHOLD` 119 | FR+FW+API | **Yes** | Swift | Day-one compliance |
| `lib/myPoster.js` | `canMakeMyPoster` 48, `buildMyPoster` 78 | DC | **Yes** (rendered by server) | **Server** | |
| `lib/native-auth.js` | `nativeGoogleSignIn` 39, `nativeAppleSignIn` 118 | API | — | Native | |
| `lib/nativePermissions.js` | `requestNativePermission` 53, `openAppSettings` 102 | UI | — | Native | |
| `lib/navRoutes.js` | `ROOT_ROUTES` 24, `resolveRoute` 216 | UI | — | Native | |
| `lib/notifications.js` | `createEngagementNotification` 47, `subscribeAllNotifications` 89 | FR+FW | Yes | Swift | |
| `lib/photos.js` | `uploadShowMedia` 188, `subscribePhotos` 115, `listAllSetlistPhotos` 143 … | FR+FW+API | Yes | Swift | Storage upload + `moderate-content` |
| `lib/platform.js` | layout constants, `isNativePlatform` 89 | UI | — | Native | |
| `lib/playlistCreator.js`, `lib/spotify.js` | — | API | — | v1.x | Disabled |
| `lib/popupManager.js`, `lib/popups.js`, `lib/usePopup.js` | — | UI | — | Web | |
| `lib/publicProfile.js` | `openExternalUrl` 28 … | UI | — | Native | `SFSafariViewController` |
| `lib/pushAlerts.js` | 63–170 | SE | Yes (doc shape) | Native | |
| `lib/recapLaunch.js` | `recapLive` 31, `defaultReviewYear` 59 … | DC | Yes | Swift | |
| `lib/recommendations.js` | CommonJS, `module.exports` 378 | DC | **Yes** | Server (already shared with `band-affinity.js`) | |
| `lib/reliveThisNight.js` | `pickReliveShow` 22, `reliveShowFor` 60, `dismissReliveShow` 81 | DC | Yes | Swift | Per-device flag (§3.4) |
| `lib/runIndex.js` | `buildRunIndex` 204, `buildTourIndex` 247, `newSongsOnTour` 325 | DC | **Yes** | **Server** | |
| `lib/savedSearches.js` | 34–55 | UI | — | Swift | `localStorage advSearch:<uid>:*` |
| `lib/service-worker.js` | — | UI | — | Web | |
| `lib/setlistGrouping.js` | `groupSongsBySet` 25, `moveSongToSet` 95 … | DC | Yes | Swift | |
| `lib/setlistParser.js` | `extractSongsFromSetlist` 14 | DC | **Yes** | **Server** | Have the function return parsed songs |
| `lib/setlistSearch.js` | `setlistToShowData` 22, `fetchAllSetlistPages` 54 | DC | **Yes** | **Server** | Date reversal lives here |
| `lib/setlistSources.js` | `resolveSource` 326, `SETLIST_SOURCES` 252, `artistNameKey` 64, `artistNameKeyLoose` 92 | DC | **Yes** | **Server** | |
| `lib/setlistfmAttribution.js` | `fetchSetlistfmLink` 70 … | API | Yes | Swift | setlist.fm compliance (`docs/setlistfm-compliance.md`) |
| `lib/setlistfmLocalCache.js` | — | UI | — | Web | |
| `lib/showFilters.js` | `applyShowFilters` 17, `availableYearsFor` 33 | DC | Yes | Swift | |
| `lib/showRouting.js` | hrefs 6–70 | UI | — | Native | Universal-link shapes must stay |
| `lib/signedInHint.js` | — | UI | — | Web | |
| `lib/songCounts.js` | `songTitleKey` 16, `buildSongStats` 50 | DC | **Yes** | **Server** | |
| `lib/songIndex.js` | `buildSongIndex` 71 | DC | **Yes** | **Server** | Gap uses UTC today (B-02) |
| `lib/storage.js` | `STORAGE_KEYS` 51 | UI | — | Native | See §3.4 |
| `lib/streamingPlatforms.js` | `getStreamingPlatforms` 49 | DC | No | Swift | |
| `lib/swipeGesture.js` | — | UI | — | Native | |
| `lib/terms.js` | `TERMS_VERSION` 64, `recordTermsAcceptance` 100, `fetchTermsAcceptance` 121, `TERMS_SUMMARY` 142 | FR+FW | **Yes** | Swift | |
| `lib/ticketEvents.js` | `fetchArtistEvents` 90 | API+FR | Yes | Swift | |
| `lib/tourBrowse.js` | `resolveTourQuery` 116, `buildExistingShowIndex` 151 … | DC | Yes | Swift | |
| `lib/upcomingShows.js` | 35–173 | DC | Yes | Swift | Uses local today (39–44) |
| `lib/utils.js` | `formatDate` 6, `parseDate` 21, `toIsoDate` 50, `localIsoDate` 61, `parseImportDate` 131 … | DC | **Yes** | Swift (golden tests) | The date parser every count depends on |
| `lib/venues.js` | `venueKeyFor` 59 … | FR+FW | Yes | Swift | |
| `lib/welcomeEmailTrigger.js` | `isFirstShowTransition` 19, `requestWelcomeEmail` 28 | SE | Yes | Swift | |
| `lib/wishlist.js` | 41–134 | FR+FW | Yes | Swift | |
| `lib/yearInReview.js` | `saveYearInReview` 30, `getYearInReview` 40 | FR+FW | Yes | Swift | |
| `lib/yearInReviewStats.js` | `computeYearInReview` 72 | DC | **Yes** | **Server** | One of two Year in Review calculators |
| `lib/yearRecap.js` | `computeYearRecap` 101, `computeShowBuddy` 219 | DC | **Yes** | **Server** | The other one |
| `lib/yearRecapData.js`, `lib/yearRecapRarity.js` | 13; 93 | FR+API+DC | Yes | Server | |

### 2.4 Hooks

| Hook | Lines | Category | Proposed home | Notes |
|---|---|---|---|---|
| `hooks/useArchivalAudio.js` | 13 | API | Swift | `archival-audio-lookup` |
| `hooks/useBandScreens.js` | 22–81 | API+DC | Swift | |
| `hooks/useContentColumnWidth.js` | 19 | UI | Native | `GeometryReader` |
| `hooks/useDrawerSwipeClose.js`, `useEdgeSwipeBack.js`, `useSheetDrag.js` | — | UI | Native | System gestures |
| `hooks/useFavoriteTours.js` | 15 | FR+FW | Swift | |
| `hooks/useFestivalShows.js` | 13 | DC | Swift | |
| `hooks/useIsMobile.js`, `useSplitView.js`, `useKeyboardInset.js` | — | UI | Native | `NavigationSplitView`, size classes |
| `hooks/useMyBands.js` | 16 | DC | Swift | |
| `hooks/useRunIndex.js` | 12, 17 | DC | Server | Wraps `lib/runIndex.js` |
| `hooks/useShowFilters.js` | 12 | DC | Swift | |
| `hooks/useSongIndex.js` | 14 | DC | Server | Wraps `lib/songIndex.js` |
| `lib/useStatsPeriod.js` | 17 | DC | Swift | |

### 2.5 Known bugs found while reading (separate tickets, not fixed here)

The two bugs named in the brief are **already fixed**. `lib/anniversaries.js:10–12, 22–29` uses `localIsoDate()` and `toIsoDate()`, and the server job reads dates through `isoDate` (`netlify/functions/lib/anniversaryMatch.js:7–10, 29`). The server job's UTC "today" is deliberate and documented (`anniversaryMatch.js:12–18`). The tickets below are what is still open.

| ID | Where | Bug | Effect |
|---|---|---|---|
| B-01 | `lib/artistImage.js:9–10` | Fetches `/.netlify/functions/artist-image` with a relative URL, not `apiUrl()` | On iOS the origin is `capacitor://localhost`, so the request can't reach Netlify: artist images likely never load in the app. Needs a device check **Fixed in 5.59.8; moot since 5.59.9, which removed the fetching (no screen has shown artist photos since 2026-08-26).** |
| B-02 | `components/ShowForm.jsx:11`, `components/bucketlist/BucketListView.jsx:169`, `components/search/AdvancedSearchView.jsx:27`, `lib/songIndex.js:182` | UTC "today" (`toISOString().slice(0,10)` / `split('T')[0]`) | On a US evening a new show defaults to tomorrow's date; bucket-list and search "today" cut-offs and song "current gap" days are off by one **Fixed in 5.59.10.** |
| B-03 | `context/AppContext.jsx:173` | Writes `odubleserId` (typo of `userId`) to every `userProfiles` doc | The profile field itself is not read (the leaderboard builds its own from the doc id, `netlify/functions/lib/communityStats.js:30`), but the misspelled key **is** the contract between `communityStats/global` and `components/CommunityStatsView.jsx:26–74` (noted at `communityStats.js:14` and `scripts/seed-review-account.js:195`). Swift models must decode `odubleserId` until both sides are renamed together **Fixed in 5.59.10.** |
| B-04 | `context/AppContext.jsx:157, 3976`, `3808` | Venue counts use the raw `venue` string (or case-sensitive `venue, city`), while Year in Review uses name + city lowercased (`lib/yearRecap.js:17`) | Profile, leaderboard, Stats and Year in Review can show different venue counts for the same shows **Fixed in 5.59.10.** |
| B-05 | `context/AppContext.jsx:839–849` | `calculateUserRank` reads the entire `userProfiles` collection on every load and every add | Cost and latency grow with users; every client downloads every profile (including `email`, S-01) |
| B-06 | `context/AppContext.jsx:1828` | `scanForMissingSetlists` takes the year as `show.date.split('-')[0]` and matches against `YYYY-MM-DD` only (1777) | Legacy shows stored as `DD-MM-YYYY` search setlist.fm for year "23" and are never matched **Fixed in 5.59.10.** |
| B-07 | `context/AppContext.jsx:1424–1431` | `findDuplicateShow` compares the raw date string | A show stored `DD-MM-YYYY` and the same show added as `YYYY-MM-DD` aren't recognised as duplicates **Fixed in 5.59.10.** |
| B-08 | `context/AppContext.jsx:3131, 3143` | Shows Together and suggestion keys use the raw date string when there's no `setlistfmId` | Two friends at the same show miss each other if their dates are stored in different formats **Fixed in 5.59.10.** |
| B-09 | `lib/utils.js:131–171` `parseImportDate` | Excel serial and the `new Date(s)` fallback go through `toISOString()` | The fallback can shift a date by a day for non-UTC devices **Fixed in 5.59.10.** |
| B-10 | `netlify/functions/analyze-tickets.js:4–9`, `analyze-screenshot.js` | No authentication, `Access-Control-Allow-Origin: *` | Anyone can spend the Anthropic key's budget. Not a client-bundle secret, but the same exposure **Fixed in 5.59.6 (#398).** |
| B-11 | `netlify/functions/delete-account.js` | No Sign in with Apple token revocation (grep finds no call to Apple's revoke endpoint; only `revokeRefreshTokens` for Firebase, line 120) | Apple expects apps that support SIWA to revoke the user's Apple tokens on account deletion. Needed before or with the native app (§5) **Fixed in 5.59.8.** |
| B-12 | `netlify/functions/lib/phishnetAdapter.js:23–37`, `components/LandingPage.jsx:178–183` | phish.net adapter field names unverified and `PHISHNET_API_KEY` not set | Phish setlists still come from setlist.fm. Not a native blocker, but the doc/marketing copy (`app/compare/setlist-fm/page.jsx:14`) says phish.net |
| B-13 | `context/AppContext.jsx:2583–2598` | `importShowsToFestival` builds show documents itself instead of through `buildShowDoc`: ids from `String(idSeed++)` seeded at `Date.now()` rather than `mintShowId`, `isManual: !candidate.setlistfmId` (ignores band sources, unlike line 105), and no band-source enrichment | Festival-imported Goose shows are marked manual and keep their setlist.fm setlist; ids can collide with ids minted by `mintShowId` in the same millisecond window. Contradicts the "change the shape here or not at all" rule at 87–91 **Fixed in 5.59.10.** |

Security findings from the rules, also separate tickets (Part 3 has the detail):

| ID | Where | Finding |
|---|---|---|
| S-01 | `firestore.rules:127–128` | `userProfiles` is readable by any signed-in user and carries `email` (written at `context/AppContext.jsx:174`) **Fixed in 5.59.7.** |
| S-02 | `firestore.rules:265–267`, `537–553` | `friendRequests`, `ticketCache`, `pendingEmailTags`, `invites`, `adminAuditLog` allow read **and** write to any signed-in user **Fixed in 5.59.7.** |
| S-03 | `firestore.rules:45–48` | Every user's `shows` are readable by any signed-in user (for Shows Together) **Fixed in 5.59.7.** |
| S-04 | `firestore.rules:81–85` | Anyone may write `users/{X}/friends/{me}`, i.e. add themselves to anyone's friends list. The invite and accept flows depend on it **Fixed in 5.59.7.** |
| S-05 | `firestore.rules:605–609`, `615–632` | `guestSessions` create/update `if true`; `roadmapItems` and `feedback` writable by any signed-in user **Fixed in 5.59.7.** |
| S-06 | `netlify/functions/send-email.js:74–117` | Any signed-in user can send arbitrary HTML to any address, 30/hour (`RATE_LIMIT_PER_HOUR`, line 32), through the app's Resend domain **Fixed in 5.59.6 (#398).** |

---

## Part 3: Data and auth

### 3.1 Firestore collections

Rules are `firestore.rules` (901 lines); composite indexes are `firestore.indexes.json`. "Client" means the browser/WKWebView JS SDK; "Admin" means a Netlify function with the Admin SDK, which bypasses rules. Types are as the code writes them; **TS** = Firestore `Timestamp` (from `serverTimestamp()` or `Timestamp.fromDate`), **ISO** = an ISO-8601 string from `new Date().toISOString()`, **YMD** = a `"YYYY-MM-DD"` string.

**Core collections (v1 must decode these):**

| Collection | Shape as written | Writers | Readers | Rules | Indexes |
|---|---|---|---|---|---|
| `users/{uid}/shows/{showId}` (id = ms-timestamp string, `context/AppContext.jsx:81–85`) | `artist` str, `venue` str, `city` str, `country` str, `state` str (imports only, `lib/importSheet.js:387`), `date` str (**YMD or DD-MM-YYYY**, §3.2), `tour` str \| null \| `''`, `setlist` [Song], `setlistfmId` str \| null, `setlistfmUrl` str \| null, `artistMbid` str (may be `''`, `components/SearchView.jsx:145`), `isManual` bool, `createdAt` **TS or ISO**, `rating` int 1–10 \| null, `comment` str, `artistImage` str, `festivalId` str \| null, `taggedBy` str, `taggedByUid` str, `taggedFriendUids` [str], `archivalAudioPick` str, `migratedFromLocal` bool, band-source fields from `lib/bandSetlist.js:227–245`: `setlistSource` str, `sourceShowId` str, `sourcePermalink` str, `setlistNotes` str, `setlistFetchedAt` **ISO**, `sourceLicenseUrl` str \| null, `needsReview` bool, `needsReviewReason` `{with, overlap}` \| null; `setlistProposal` map with `decidedAt` **ISO** (`context/AppContext.jsx:2030`, written by `admin-resync-setlists.js:339`) | Client (`AppContext` add/save/update paths); Admin (`admin-bulk-import`, `admin-populate-setlist`, `admin-resync-setlists`, `admin-cleanup-duplicates`) | Owner; any signed-in user for Shows Together; Admin jobs (`communityStats.js:112`, `bandAffinityJob.js:40`, `yearRecapEmail.js:98`) | 45–48: read any signed-in, write owner | none composite; collection-group reads by Admin only |
| Song (element of `setlist`) | setlist.fm: `{id, name, set, cover, tape}` (`lib/setlistParser.js:32–38`); band source: adds `transitionMark`, `footnote`, `jamchart`, `jamchartNote`, `sourceGap` int, `debut`, `songId`, `songSlug`, `sourceOpener` (`netlify/functions/lib/bandSetlistShape.js:179–215`); user: `rating` int \| null, `comment` str, `manuallyAdded` bool | as above | as above | — | — |
| `users/{uid}/upcomingShows/{id}` | `artist`, `venue`, `city` str; `date` YMD; `time` str \| null; `notes` str ≤1000; `source` `'manual'\|'ticketmaster'\|'seatgeek'`; `sourceEventId`, `ticketUrl` str \| null; `taggedFriendUids` [str]; `taggedBy`, `taggedByUid`, `originUpcomingId` str \| null; `createdAt`, `updatedAt` TS (`lib/upcomingShows.js:67–79`, `context/AppContext.jsx:2915–2924`) | Client | Owner | 56–58 owner only | — |
| `users/{uid}/festivals/{id}` (attendance) | `festivalId` str, `notes` str, `rating` int \| null, `createdAt`, `updatedAt` TS (`context/AppContext.jsx:2279–2285`). Pre-5.30 records instead carry their own `name`/dates and no `festivalId` (`firestore.rules:67–68`, `AppContext.jsx:896–898`) | Client; Admin migration | Owner | 69–71 | `festivalId` collection-group override |
| `users/{uid}/friends/{friendUid}` | `friendUid`, `friendName`, `friendEmail`, `friendPhotoURL` str; `addedAt` TS (`context/AppContext.jsx:2754–2768`) | Client, **including the other user** | Owner; Admin purge (`userDataPurge.js:328`) | 81–85: owner reads; write by owner **or the friend** | `friendUid` collection-group override |
| `users/{uid}/discover/{doc}` | `dismissed` [str] (`lib/discover.js:54`) | Client | Owner | 76–78 | — |
| `userProfiles/{uid}` | Client: `showCount`, `songCount`, `ratedSongCount`, `venueCount` int, `email`, `photoURL` str, `lastLogin` TS, `createdAt` TS, `odubleserId` str (`context/AppContext.jsx:172–178`); `favoriteArtists` [`{name, mbid, addedAt ISO}`] (3754); `termsAcceptedVersion` int, `termsAcceptedAt` TS (`lib/terms.js:100–110`); guest/referral fields `convertedFromGuest`, `guestSessionId`, `guestConvertedAt` TS, `guestShowsAdded`, `invitedByUid`, `invitedByName`, `invitedByEmail`, `inviteAcceptedAt` TS; `shareActivity`, `publicProfile` bool. Server only: `displayName`, `firstName`, `handle`, `handleLower` (via `moderate-content`), `banned`, `isTestUser`, `welcomeEmail` | Client + Admin | Any signed-in user | 127–163 (four text fields, `banned`, `isTestUser`, `welcomeEmail` client-immutable) | — |
| `showTags/{id}` | `fromUid`, `fromName`, `toUid` str; `showData` map (sanitized show, `context/AppContext.jsx:2801–2814`; `upcoming: true` for upcoming tags); `status` `pending\|accepted\|declined\|revoked`; `createdAt` TS; `upcomingShowId` str; `revokedAt` | Client | The two parties | 283–331 (tested by `tests/rules/showTags.rules.test.js`) | single-field only (comment at `context/AppContext.jsx:131–133`) |
| `friendRequests/{id}` | `from`, `to`, `fromName`, `fromEmail`, `toName`, `toEmail` str; `status`; `createdAt` TS (`context/AppContext.jsx:2702–2711`) | Client | Client listeners | 265–267: **any signed-in user, read and write** | — |
| `userBlocks/{uid}` | `userId` str, `blockedUserIds` [str], `updatedAt` TS (`lib/moderation.js:246–250`) | Client | Owner | 189–196 | — |
| `pushTokens/{fcmToken}` | `userId`, `platform: 'ios'`, `updatedAt` TS (`lib/pushAlerts.js:79–83`) | Client | Owner; Admin push jobs | 208–214 (`hasOnly` those three keys) | — |
| `festivals/{id}` (shared catalog) | `name`, `nameNormalized`, `location`, `edition` str; `startDate`, `endDate` YMD **or** absent with `year` int only; `year` int; `createdBy` str; `createdAt`, `updatedAt` TS (`context/AppContext.jsx:2333–2345`); `lineup`, `lineupSource`, `lineupUrl`, seed fields (`lib/festivalCatalog.js:28`) | Client + Admin seeders | Signed-in | 688–770 (validates date regex and year/date agreement) | — |
| `notifications/{id}` | `uid`, `type`, `message`; `concertKey`, `artist`, `venue`, `date`, `fromUid`, `fromName` str \| null; `read` bool; `createdAt` TS (`lib/notifications.js:55–67`) | Client + Admin (anniversary job) | Owner | 637–643 | `uid` + `createdAt desc` |
| `showSuggestions/{uid1_uid2_key}` | `participants` [2], `names` map, `showKey`, `showData` map, `responses` map, `overallStatus`, `emailSentToUid`, `emailSentAt`, `lastViewedAt` map, `createdAt`, `updatedAt` TS (`context/AppContext.jsx:3163–3180`); subcollection `comments` | Client | Participants | 557–580 | — |
| `invites/{id}` | `inviterUid`, `inviterName`, `inviterEmail`, `inviteeEmail` str; `status`; `createdAt` TS (`context/AppContext.jsx:3469–3476`) | Client | Client | 547–549 **open to any signed-in user** | — |
| `pendingEmailTags/{id}` | `fromUid`, `fromName`, `fromEmail`, `toEmail`, `toName`; `showData`; `personalMessage` str \| null; `status`; `createdAt` TS (`context/AppContext.jsx:3404–3414`) | Client | Client (by `toEmail`) | 542–544 **open** | — |
| `wishlists/{uid}_{artistKey}` | `userId`, `artistKey`, `artistName`, `artistMbid` \| null, `songs` map `{songKey: {title, addedAt ISO}}`, `updatedAt` TS (`lib/wishlist.js:77–86`) | Client | Owner | 342–359 | — |
| `favoriteTours/{uid}` | `userId`, `tours` map `{key: {tourName, artistName, addedAt ISO, …}}`, `updatedAt` TS (`lib/favoriteTours.js:50–58`) | Client | Owner | 367–373 | — |
| `yearInReviews/{uid}_{year}` | `userId`, `year`, `generatedDate` TS, `privacy`, `stats` map (`lib/yearInReview.js:30–38`) | Client | Owner / by privacy | 890+ | — |
| `venueRatings/{id}` | `venueKey`, `venueName`, `venueCity`, `venueDisplayName`, `venueCityDisplay`, `userId`, `userDisplayName`, `overallRating`, `subRatings` map, `review` \| null, `updatedAt` TS (`components/VenueRatingModal.jsx:60–70`) | Client | Signed-in | 334–338 | — |
| `communityStats/global` | Server-computed leaderboard; entries keyed `odubleserId` (`netlify/functions/lib/communityStats.js:30`) | Admin only | Anyone | 259–262 | — |
| `alertSettings/{uid}` | `uid`, `updatedAt` TS, home location/radius fields (`lib/alertSettings.js:41`) | Client | Owner + Admin jobs | 848+ | — |

**Other collections** (not core to v1 decoding; shape lives with the writer named): `handles` (174, `moderate-content.js`), `reports` (230, `report-content.js`), `moderationHidden` (244), `moderationCounters` (251), `ticketCache` (537, open), `adminAuditLog` (552, open), `publicArtistStats` (582), `bandAffinity` / `bandPopularity` (593–599, `bandAffinityJob.js`), `guestSessions` (605, `{startedAt TS, converted, showsAdded, userAgent}`, `context/AppContext.jsx:1386–1391`), `roadmapItems` + `voters` (615–626), `feedback` (628), `userActivity` (414, `lib/activityFeed.js:67`), `showComments` (436), `commentViews` (452), `meetups` (474), `meetupComments` (505), `showPhotos` (524, `lib/photos.js`), `bucketList` / `bucketListVenues` (384–404), `venues` (654), `venueVerificationApplications` (770), `venueAnnouncements` (786), `venuePhotos` (795), `venueReports` (807), `announcements` (825), `emailSuppressions` (831), `unsubscribeEvents` (834), `emailRateLimits` (837), `onsaleAlerts` (870), `presaleIntel` (877), `inboundEmails` (881), `artists` (885). Server-only collections with no client rule: `setlistCache` (TTL override on `expiresAt`), `jobTriggers` (`followed-band-notifications.js:20`), `sharedCollections` (`userDataPurge.js`).

**Composite indexes** (`firestore.indexes.json`): `showPhotos` (concertKey, createdAt desc), (category, createdAt desc); `showComments` (concertKey, createdAt); `meetupComments` (meetupId, createdAt); `notifications` (uid, createdAt desc); `userActivity` (userId, timestamp desc); `venueAnnouncements`, `venuePhotos` (venueKey, createdAt desc); `reports` (status, createdAt), (contentId, status), (reportedUserId, reason); `venueReports` (status, createdAt desc); `venueVerificationApplications` (status, submittedDate desc). Field overrides: `friends.friendUid` and `festivals.festivalId` (collection-group), `setlistCache.expiresAt` (no index). A native client using the same queries needs no new indexes.

### 3.2 Fields with inconsistent types or formats (will break naive `Codable`)

| Field | Variants found | Where each comes from |
|---|---|---|
| `shows.date` | `"YYYY-MM-DD"` and `"DD-MM-YYYY"` | Most paths reverse setlist.fm's date (`lib/setlistSearch.js:30`). The ticket scanner stored setlist.fm's `eventDate` verbatim until it began normalizing (`components/TicketScanner.jsx:229` now `toIsoDate(...) \|\| eventDate`), so older scanner shows are DD-MM-YYYY (`lib/utils.js:31–36`). `parseDate` accepts both (`lib/utils.js:21–29`) |
| `shows.createdAt` | `Timestamp` and ISO string | `writeShowDoc` writes TS (`context/AppContext.jsx:123`); `handleMigrateData` keeps the guest/local ISO string (1299); the in-memory copy is ISO until reload (97) |
| `shows.tour` | string, `null`, `''` | `null` from `lib/setlistSearch.js:35`; `''` from imports (`lib/importSheet.js:391`) and tag copies (`AppContext.jsx:2806`) |
| `shows.artistMbid` | string, `''`, absent | `components/SearchView.jsx:145` writes `''` when unknown |
| `shows.setlist[].id` | decimal ms string (`AppContext.jsx:3572`), base-36 + random (`lib/setlistParser.js:33`), server `mintSongId()` (`bandSetlistShape.js:191`) | Always a string; format varies |
| `shows.setlist[].set` | `"Set I"`, `"Encore"`, `"Encore II"`, … or `null` (soundcheck) | `lib/setlistParser.js:22–28`, `phishnetAdapter.js:238`, `songfishAdapter.js:274` |
| `shows.rating`, song `rating` | integer 1–10 or `null` | `RatingSelect.jsx:7` (`Number`), `lib/importSheet.js:239–247` (`Math.round`). Admin bulk import: **cannot be determined from the code** whether it rounds; decode as a number and round |
| `shows.setlistFetchedAt`, `setlistProposal.decidedAt` | ISO string | `lib/bandSetlist.js:234`, `AppContext.jsx:2030` |
| `favoriteArtists[].addedAt`, `wishlists.songs.*.addedAt`, `favoriteTours.tours.*.addedAt` | ISO string, while sibling `updatedAt`/`createdAt` are TS | `AppContext.jsx:3754`, `lib/wishlist.js:83`, `lib/favoriteTours.js:52` |
| `favoriteArtists[]` element | object `{name, mbid, addedAt}` | Every reader assumes an object (`AppContext.jsx:3735`). Whether any legacy profile stores plain strings **cannot be determined from the code** (no migration found); decode defensively |
| `festivals.startDate/endDate/year` | dated (`startDate`+`endDate` YMD, optional `year`) or year-only (`year` int, no dates) | `firestore.rules:700–715`, `lib/festivalDates.js:58` |
| attendance records | new (`festivalId` + notes) or pre-5.30 (own `name`/dates, no `festivalId`) | `firestore.rules:60–68` |
| `userProfiles.createdAt` | TS from auth creation time or `serverTimestamp()` | `AppContext.jsx:208–211` |
| `communityStats` entries | key `odubleserId` (typo) | `communityStats.js:30` |

### 3.3 Swift `Codable` sketches for the core types

`FirestoreSwift` can map `Timestamp` to `Date`, but the mixed fields above need hand-written decoding. Field notes marked **custom** need it.

```swift
/// Accepts a Firestore Timestamp, an ISO-8601 string, or nothing.
/// custom: shows.createdAt is either (see §3.2); in-memory adds are ISO.
struct FlexibleDate: Codable, Hashable { let date: Date? }

/// A show's calendar date exactly as stored, plus the parse the web app uses.
/// custom: "YYYY-MM-DD" or "DD-MM-YYYY"; must replicate lib/utils.js parseDate/toIsoDate
/// (local calendar, no UTC shift). Keep `raw` so writes don't rewrite old data.
struct ShowDate: Codable, Hashable {
    let raw: String
    var isoDay: String? { /* port of toIsoDate */ nil }
}

struct Show: Codable, Identifiable {
    @DocumentID var id: String?            // ms-timestamp string; mint with the same rule as mintShowId
    var artist: String
    var venue: String
    var city: String?
    var country: String?
    var state: String?
    var date: ShowDate                     // custom
    var tour: String?                      // custom: null and "" both mean none
    var setlist: [Song]                    // default [] when absent (AppContext.jsx:859)
    var setlistfmId: String?
    var setlistfmUrl: String?
    var artistMbid: String?                // custom: "" means nil
    var isManual: Bool?
    var createdAt: FlexibleDate?           // custom
    var rating: Int?                       // custom: decode any number, round
    var comment: String?
    var artistImage: String?               // legacy: written until 5.59.9, never displayed
    var festivalId: String?
    var taggedBy: String?
    var taggedByUid: String?
    var taggedFriendUids: [String]?
    var archivalAudioPick: String?
    var setlistSource: String?             // "setlistfm" | songfish id | "phishnet" | "archive"
    var sourceShowId: String?
    var sourcePermalink: String?
    var setlistNotes: String?
    var setlistFetchedAt: String?          // ISO string, not a Timestamp
    var sourceLicenseUrl: String?
    var needsReview: Bool?
    var needsReviewReason: ReviewReason?
    var setlistProposal: SetlistProposal?  // decidedAt is an ISO string
    // Unknown keys must survive a write: saveShow merges, so encode only fields we own.
}

struct Song: Codable, Identifiable, Hashable {
    var id: String                         // custom: three id formats, always a string
    var name: String
    var set: String?                       // null = soundcheck
    var cover: String?
    var tape: Bool?
    var rating: Int?                       // custom: number → round
    var comment: String?
    var manuallyAdded: Bool?
    var transitionMark: String?
    var footnote: String?
    var jamchart: Bool?
    var jamchartNote: String?
    var sourceGap: Int?
    var debut: Bool?
    var songId: String?
    var songSlug: String?
    var sourceOpener: Bool?
}

struct UserProfile: Codable, Identifiable {
    @DocumentID var id: String?
    var displayName: String?               // server-written only
    var firstName: String?
    var handle: String?
    var email: String?
    var photoURL: String?
    var showCount: Int?; var songCount: Int?; var ratedSongCount: Int?; var venueCount: Int?
    var favoriteArtists: [FollowedBand]?   // custom: decode defensively (string or object)
    var termsAcceptedVersion: Int?
    var banned: Bool?
    var shareActivity: Bool?
    var publicProfile: Bool?
    var createdAt: Date?
}

struct FollowedBand: Codable, Hashable { var name: String; var mbid: String?; var addedAt: String? } // addedAt ISO

struct ShowTag: Codable, Identifiable {
    @DocumentID var id: String?
    var fromUid: String; var fromName: String; var toUid: String
    var showData: TagShowData              // custom: `upcoming: true` switches to the upcoming shape
    var status: String                     // pending | accepted | declined | revoked
    var createdAt: Date?
    var upcomingShowId: String?
}

struct TagShowData: Codable { var artist: String; var venue: String?; var date: String; var city: String?
    var tour: String?; var setlistfmId: String?; var setlistfmUrl: String?; var isManual: Bool?
    var setlist: [TagSong]?; var upcoming: Bool? }
struct TagSong: Codable { var id: String; var name: String }

/// Tours are not stored; they are derived from shows (lib/runIndex.js:247).
/// Only the user's stars are stored, in favoriteTours/{uid}.
struct FavoriteTours: Codable { var userId: String; var tours: [String: FavoriteTour] }
struct FavoriteTour: Codable { var tourName: String; var artistName: String; var addedAt: String } // addedAt ISO

struct Festival: Codable, Identifiable {          // festivals/{id}
    @DocumentID var id: String?
    var name: String; var nameNormalized: String
    var startDate: String?; var endDate: String?  // custom: both absent for a year-only festival
    var year: Int?
    var location: String?; var edition: String?
    var createdBy: String?                        // null after the creator deletes their account
    var lineup: [String]?                         // shape not audited beyond Array check (AppContext.jsx:925)
}

struct FestivalAttendance: Codable, Identifiable { // users/{uid}/festivals/{id}
    @DocumentID var id: String?
    var festivalId: String?                       // custom: nil on pre-5.30 records, which carry name/dates
    var notes: String?; var rating: Int?
    var name: String?; var startDate: String?; var endDate: String?
}

/// Band pages come from /api/artist (public snapshot in Netlify Blobs), not Firestore.
/// Shape is whatever netlify/functions/lib/publicArtistPages.js returns; not modelled here.
struct BandSummary: Codable { var slug: String; var name: String }
```

Ratings have no collection of their own: show and song ratings are fields on the show (above), and venue ratings are `venueRatings` docs.

### 3.4 Auth

**Providers and configuration.** Firebase project `show-tracker-d7a4d`. Web config with production fallbacks is in `lib/firebase.js:14–37`; `authDomain` is `mysetlists.net`, served by the `/__/auth/*` proxy (comment 16–30). Providers: Google, Apple (`OAuthProvider('apple.com')` with `email`, `name` scopes, `lib/firebase.js:125–133`), and email/password (`components/auth/SignupForm.js:73`, `LoginForm.js:44`, `ForgotPasswordForm.js:19`). iOS: `ios/App/App/GoogleService-Info.plist`, Google URL scheme in `Info.plist:33–40`, Apple entitlement `com.apple.developer.applesignin` in both entitlements files. Guest mode is **not** Firebase anonymous auth (no `signInAnonymously` anywhere): it is local state plus an unauthenticated `guestSessions` doc.

**The Google sign-in popup fix (web).** `initializeAuth` deliberately omits `popupRedirectResolver` so first paint doesn't wait on Google's iframe (`lib/firebase.js:46–54`). That made the first click's `window.open` lose its user activation, so the popup was blocked. Two fixes: `warmAuthPopupResolver()` (`lib/firebase.js:87–96`) initializes the resolver as soon as the buttons render (`components/auth/OAuthButtons.js:67–74`), and persistence is applied by an effect when "Remember me" changes rather than awaited inside the click (`components/auth/LoginForm.js:23–30, 59–62`). Native never takes this path: `signInWithPopup` silently does nothing in WKWebView, which caused the 2026-03-24 Guideline 2.1(a) rejection (`lib/native-auth.js:4–12`).

**What the native app needs.**
- **Sign in with Apple** through `AuthenticationServices` (`ASAuthorizationAppleIDProvider`) with a SHA-256 nonce, exchanged with `OAuthProvider.appleCredential(withIDToken:rawNonce:fullName:)`. Keep today's two behaviours: copy the name Apple sends on first authorization onto the Firebase user, and drop it if it fails the content filter (`lib/native-auth.js:67–90`). Capture the authorization code for token revocation (B-11).
- **Google Sign-In SDK** (`GoogleSignIn` via SPM) with the existing iOS client ID and URL scheme.
- **Email/password, password reset**: `Auth.auth()` directly.
- **Guest mode**: decide whether to keep it as local-only, or to switch to Firebase anonymous auth and `link(with:)` on sign-up, which would make the migration prompt unnecessary. Open question Q-03.
- **Terms gate before any provider**, the tri-state `termsAccepted`/`isSuspended` checks (`context/AppContext.jsx:478–490, 1023–1076`) and the launch-time `TermsGate` (`app/AppProviderWrapper.jsx:243–270`).

**Will existing users have to sign in again?** Partly confirmed, partly needs a device test.
- **Email/password and Apple users: yes.** The JS SDK keeps its session in WKWebView `localStorage` (`browserLocalPersistence`, `lib/firebase.js:58–61`), which a native binary can't read. Apple sign-in passes `skipNativeAuth: true` (`lib/native-auth.js:142`), so the native SDK never holds an Apple session.
- **Google users: maybe not.** `skipNativeAuth: false` (`capacitor.config.ts:40`) means the plugin also completes the Firebase sign-in in the native Firebase iOS SDK (`lib/native-auth.js:139–141` says Google "signs in twice"). The native SDK persists that user in the Keychain. A SwiftUI app with the same bundle ID, team, and `GoogleService-Info.plist` may find `Auth.auth().currentUser` already set. **Cannot be determined from the code**: it depends on the plugin's Keychain access group and the SDK's storage key. Test on a device by installing a native build over a signed-in Capacitor build (Q-01).
- Plan the message for everyone; treat Google carry-over as a bonus if it works.

**What lives only in WKWebView storage and will reset** (`lib/storage.js:51–74` plus direct uses):

| Key | Holds | Effect of losing it |
|---|---|---|
| `guest-shows` | **A guest's entire show list** | **Data loss** unless handled (Q-02) |
| `guest-session-id` | Guest session doc id | Conversion tracking lost |
| `concert-shows` | Pre-account legacy shows | Same as above, for very old installs |
| `mysetlists_relive_this_night:<uid>` | Day "Relive this night" was last shown (`lib/reliveThisNight.js:55`) | Card may show again once |
| `mysetlists_recap_banner_dismissed_<year>` | Year in Review banner dismissal (`components/yearInReview/YearInReviewCard.jsx:17`) | Banner reappears |
| `mysetlists.archiveBackfillChecked.v1` | Archive backfill card (`components/shows/ArchiveBackfillCard.jsx:22`) | Card reappears |
| `mysetlists.pushToken`, `mysetlists.pushOffered` | Last FCM token, "offered push once" (`lib/pushAlerts.js:35–36`) | Push offer may show again; stale `pushTokens` doc until the job prunes it |
| `mysetlists_terms_pending` | Terms tick taken before an account exists (`lib/terms.js:80–89`) | Re-tick; server value is what gates |
| `advSearch:<uid>:saved`, `advSearch:<uid>:history` | Saved searches and history (`lib/savedSearches.js:12–13`) | **User-visible loss** of saved searches |
| `suggestionScan_<uid>` | Retroactive suggestion scan done (`context/AppContext.jsx:3209`) | Scan runs once more (moot if moved server-side) |
| `mysetlists_whats_new_seen`, `mysetlists_popup_dismissals`, `hasSeenOnboardingTooltips`, `mysetlists_playlist_tooltip_seen`, `mysetlists_lastVisit` | Onboarding/what's-new state | Popups reappear |
| `mysetlists_show_play_counts` | Setlist editor play counts (`components/SetlistEditor.jsx:46`) | Recomputed |
| `wishlist_catalog_<mbid>`, tour info cache, setlist.fm 24h caches | Caches | Refetched |
| `invite-referrer`, `mysetlists_pending_follow`, `mysetlists_pending_heard`, `mysetlists_pending_next`, `mysetlists_signed_in` | In-flight hand-offs | Negligible |
| `sessionStorage` (Spotify PKCE, import column mapping) | Transient | Negligible |

---

## Part 4: Backend APIs

### 4.1 Netlify functions

There are **no `.mts` files**. The 88 functions are CommonJS `.js` (Lambda-style `exports.handler`) plus two v2 `.mjs` (`public-artist-snapshot.mjs`, `public-artist-snapshot-background.mjs`). A native client is not subject to CORS, so any function reachable over HTTPS can be called from Swift; the question is authentication. Functions that verify a Firebase ID token accept `Authorization: Bearer <idToken>` (`netlify/functions/lib/firebaseAdmin.js:39–53`), which the Firebase iOS SDK's `getIDToken()` provides. "As-is" below means a native client can call it today without server changes.

Auth key: **none**, **user** (valid ID token), **admin** (ID token whose email is in `ADMIN_EMAILS`), **sched** (scheduled by `netlify.toml:14–73`, not for clients), **nonce** (background job started by a one-shot `jobTriggers` doc or Blobs token), **token** (signed link token), **webhook** (signature secret).

| Function | Purpose (from its header) | Auth | Request → response | Native as-is? |
|---|---|---|---|---|
| `search-setlists` | setlist.fm setlist search, cached in `setlistCache` | none | GET `artistName`, `artistMbid`, `year`, `venueName`, `cityName`, `p`, `date` → setlist.fm JSON | Yes |
| `search-artists` | setlist.fm artist search | none | GET `artistName` → `{artist: [...]}` | Yes |
| `search-artist-shows` | Recent shows for top matching artists | none | GET `artistName` | Yes |
| `get-artist-info` | setlist.fm artist → mbid | none | GET `artistName` → `{mbid, …}` | Yes |
| `get-artist-song-stats` | Song play counts from setlist.fm | none | GET `mbid` | Yes |
| `get-artist-stats` | "Public endpoint" artist stats | none | GET | Yes **Removed in 5.59.12 (no callers).** |
| `get-artist-tours` | Every tour setlist.fm knows for an artist | none | GET `mbid` | Yes |
| `get-tour-shows` | Every show on one tour | none | GET `mbid`, `tourName` | Yes |
| `setlistfm-links` | setlist.fm attribution URL per setlist id | none | GET | Yes |
| `band-setlist` | One date-addressed setlist from the band source that owns the artist | none | GET `source`, `artist`, `date`, `venue` (`band-setlist.js:6`) | Yes |
| `archival-audio-lookup` | Archival recordings (Relisten, phish.in, …) | none | GET `artist`, `date` | Yes |
| `artist-image` | Artist photo via MusicBrainz + Wikipedia | none | GET `artist` | Yes **Removed in 5.59.9.** |
| `enrich-artist` | MusicBrainz/Discogs enrichment, Firestore-cached | none | GET `name` | Yes |
| `get-entity-info` | Wikipedia-style info for artist/venue | none | GET `name`, `type` | Yes |
| `ticketmaster-events` | Upcoming events for an artist | none | GET `artistName`, `attractionId` | Yes |
| `seatgeek-events` | Upcoming events for an artist | none | GET `artistName` | Yes |
| `analyze-tickets` | Claude reads ticket images, returns shows | **none** (B-10) | POST `{images:[{base64, mediaType}]}` → `{shows}` | Yes, but should require a user token first |
| `analyze-screenshot` | Claude reads a ticket-site screenshot | **none** (B-10) | POST `{image, mediaType}` | Yes, same caveat |
| `send-email` | The one browser-initiated email path | user (rate-limited 30/h) | POST `{to, subject, html, type}` | Yes, but S-06 |
| `send-welcome-email` | Welcome email after first show | user | POST | Yes |
| `create-shared-collection` | Snapshot of your shows for `/shared/{id}` | user | POST `{shows, stats, ownerName}` → `{url}` | Yes |
| `get-shared-collection` | Read a shared collection | none | GET | Yes |
| `delete-account` | Self-service deletion (Guideline 5.1.1(v)) | user | POST `{confirmText:'DELETE'}` or `{confirmEmail}` | Yes |
| `moderate-content` | Write path for all published free text (comments, meetup messages, captions, display name, handle) | user | POST | Yes |
| `report-content` | File a report | user | POST `{contentType, contentId, reason}` | Yes |
| `notify-block` | Tell the developer about a block | user | POST | Yes |
| `resolve-artist` | Cache a band's Ticketmaster id on follow | user | POST `{artistName}` | Yes |
| `festival-lineup` | A festival's lineup for picks | user | POST `{festivalId}` | Yes |
| `search-festival-lineup` | Bands logged at a festival for bulk add | none | GET | Yes |
| `my-poster` | Draw a personal poster or recap card, or store a share | user (for share and recap; `my-poster.js:50–56`) | POST `{action:'image'\|'share', kind, record\|recap}` → PNG or `{code,url}` | Yes |
| `heard-import` | Import a setlist.fm user's attended shows for the heard tool | none | GET `slug`, `user`, `page` | Yes |
| `heard-share` | Store/read a heard share code | none | POST `{slug, code}` / GET | Yes |
| `update-email-preferences` | Profile email switches | user | GET → `{emailOptOut, announcementsOptOut}`; POST | Yes |
| `unsubscribe`, `unfollow-band` | Email footer links | token | GET/POST | n/a (email) |
| `spotify-token`, `spotify-api` | Spotify PKCE token exchange and playlist calls | none | POST | Dormant (flag off) |
| `apple-music-token` | MusicKit developer token | none | GET | Dormant; env vars not set (`lib/constants.js:49–51`) |
| `artist-api` | `/api/artists`, `/api/artist`, `/api/artist-song` from the Blobs snapshot | none | GET `slug`, `song` | Yes |
| `public-artist`, `public-artist-songs`, `public-artist-song`, `public-artists-index`, `public-heard`, `public-heard-image`, `public-poster`, `public-profile`, `public-shared`, `public-show`, `sitemap` | Server-rendered public HTML/PNG pages | none | GET | Web-only |
| `community-stats`, `band-affinity`, `anniversary-notifications`, `followed-band-notifications`, `onsale-scan`, `onsale-reminder`, `inbound-email-cleanup`, `moderation-sla-reminder`, `public-artist-snapshot` | Scheduled jobs | sched | — | n/a |
| `followed-band-notifications-background`, `onsale-scan-background`, `parse-presale-email-background`, `admin-resync-setlists-background`, `public-artist-snapshot-background` | Background workers | nonce | — | n/a |
| `inbound-email` | Resend webhook for the presale inbox | webhook (`RESEND_WEBHOOK_SECRET`) | — | n/a |
| `admin-bulk-import`, `admin-cleanup-duplicates`, `admin-delete-guest-trials`, `admin-find-missing-setlists`, `admin-list-auth-users`, `admin-list-unsubscribes`, `admin-merge-festivals`, `admin-migrate-festivals`, `admin-onsale`, `admin-populate-setlist`, `admin-repair-festival-split`, `admin-resync-setlists`, `admin-seed-festival-lineups`, `admin-seed-festivals`, `admin-send-announcement`, `cache-stats`, `clear-cache`, `delete-user`, `moderate-report`, `notify-roadmap-completion` | Admin console | admin | POST/GET | Web-only (admin) |
| `run-tests` | Pre-deploy API health checks | `TEST_ADMIN_SECRET` | POST | n/a |

Routing: `/api/*` aliases are `netlify.toml:114–231`; `apiUrl()` prefixes `https://mysetlists.net` on native (`lib/api.js:18–26`). Several handlers keep CORS allowlists that include `capacitor://localhost` (`send-email.js:35–39`, `send-welcome-email.js:35–38`); URLSession sends no `Origin`, which these accept (the header is only set when the origin matches).

### 4.2 Secrets and keys in the client bundle

Searched `app/`, `components/`, `lib/`, `hooks/`, `context/` for `NEXT_PUBLIC_*` and hard-coded keys. **No paid third-party API key ships in the client today.** setlist.fm, Ticketmaster, SeatGeek, Anthropic, Discogs, Resend, Apple Music and phish.net keys are server-side environment variables only. The setlist.fm fallback key that used to be hard-coded was removed (`netlify/functions/lib/setlistfmKey.js:6, 22`).

| What ships in the client | Where | Secret? | Native app |
|---|---|---|---|
| Firebase web config (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, `measurementId`) | `lib/firebase.js:14–37` (env with literal fallbacks) | No, public by design; rules and Auth protect the data | Replaced by `GoogleService-Info.plist` (also public by design) |
| Firebase VAPID key | `lib/firebase.js:182` (`NEXT_PUBLIC_FIREBASE_VAPID_KEY`) | Public | Not needed |
| Spotify client ID | `components/PlaylistCreatorModal.jsx:382` | Public (PKCE) | Feature dormant |
| Google OAuth iOS client ID | `ios/App/App/Info.plist:38`, `GoogleService-Info.plist` | Public | Same |
| `ADMIN_EMAILS` | `lib/constants.js:5` | Not a secret, but an email address in the bundle | Leave out of the native app |

So nothing has to move behind a function for secrecy. What does need hardening before a native binary depends on them: `analyze-tickets` and `analyze-screenshot` are unauthenticated and open-CORS (B-10), and `send-email` lets any user send arbitrary HTML (S-06). Both are listed in §7.2.

### 4.3 Setlist source integrations

All third-party setlist APIs are called **server-side**; the client calls our functions only. There is no direct client call to any of these hosts (no client `fetch` to an external absolute URL was found).

| Source | Called from | Function / module | Status |
|---|---|---|---|
| setlist.fm | Server | `search-setlists.js:72–73`, `search-artists.js`, `get-artist-info.js:34`, `get-artist-tours.js`, `get-tour-shows.js`, `get-artist-song-stats.js`, `setlistfm-links.js`, `heard-import.js`, `search-festival-lineup.js`; key from `lib/setlistfmKey.js` | Live |
| elgoose.net (and ttbase, kglw, thecarton, go-set: Songfish sites in `config/songfish-sites.json`) | Server | `band-setlist.js` → `lib/songfishAdapter.js` | Live for Goose (`components/LandingPage.jsx:178–184`) |
| phish.net | Server | `band-setlist.js:135–138` → `lib/phishnetAdapter.js` | Wired, **not live**: no `PHISHNET_API_KEY`, field names unverified (B-12) |
| Internet Archive | Server | `band-setlist.js` → `lib/archiveAdapter.js` (archive.org advancedsearch/metadata/download), plus `admin-resync-setlists.js` proposals | Live behind `SETLIST_SOURCES.archive` with review (`lib/setlistSources.js:264`) |
| Songfish | Server | Same as elgoose above | Live |

Client-side source *selection* (`lib/setlistSources.js:326 resolveSource`) and the merge (`lib/bandSetlistMerge.js`) do run in the client and are on the server-move list.

---

## Part 5: App Review and compliance carry-over

Past rejections on record: **2026-03-24, Guideline 2.1(a)**, Google and Apple sign-in buttons did nothing in WKWebView (`lib/native-auth.js:4–12`); **2026-09-17, Guideline 1.2**, build 3.1 (31), four of five UGC requirements missing (`CHANGELOG.md:2662–2680`, `docs/app-review-1-2-reply.md:3–5`). The native app must ship every item below on day one.

| Requirement | Current implementation to match | Native note |
|---|---|---|
| **Terms agreed before sign-in or sign-up** | Unticked checkbox above all three providers; buttons and email submit disabled until ticked (`components/auth/AuthModal.js:17–40`, `components/auth/TermsAgreement.jsx`, `LoginForm.js:35, 52`). Tick parked locally before the account exists (`lib/terms.js:80–89`) and written to `userProfiles.termsAcceptedVersion` on sign-in (`context/AppContext.jsx:1033–1037`, `lib/terms.js:100–110`) | Same gate on the native sign-in screen, Apple button included |
| **Existing accounts gated at launch** | `TermsGate` replaces the whole app while `termsAccepted === false` (`app/AppProviderWrapper.jsx:243–270`); `null` means unknown and never flashes the gate | Root view switch on a tri-state, not an overlay |
| **Terms content** | Community Guidelines section with zero tolerance, flag/block, 24h review (`components/TermsOfService.jsx:79–90`), summary `TERMS_SUMMARY` (`lib/terms.js:142`), `TERMS_VERSION = 1` (64) | Bump rule (`lib/terms.js:56–60`) applies to both apps |
| **Content filter** | `lib/contentFilter.js:317 checkContent` client-side for instant feedback; enforced server-side by `netlify/functions/moderate-content.js` with `lib/contentFilterRule.js`, kept equal by `lib/__tests__/contentFilterParity.test.js`. The client can't write comments, meetup messages, photo captions, display names or handles directly (`firestore.rules:101–125, 436–438, 505–507, 524–526`). Apple-supplied names are filtered too (`lib/native-auth.js:76–89`) | Call `moderate-content` for every free-text write; don't port the word list as the gate |
| **Flagging** | Report affordance on comments, meetup messages, photos/videos and profiles (`components/comments/CommentsSection.jsx:9`, `components/meetups/MeetupDetailView.jsx:7`, `components/photos/MediaGalleryView.jsx:10`, `SetlistPhotoDirectory.jsx:14`, `components/moderation/UserProfileSheet.jsx:3`, `ReportButton.jsx`, `ReportModal.jsx`) → `lib/moderation.js:140 submitReport` → `report-content`. Reasons `REPORT_REASONS` (`lib/moderation.js:89`). Three distinct reporters auto-hide by moving the doc to `moderationHidden` (`AUTO_HIDE_THRESHOLD`, 119; rationale 44–74) | Every UGC surface in v1 gets the report action |
| **Blocking** | `blockUser` (`context/AppContext.jsx:626–662` → `lib/moderation.js:243–320`): writes `userBlocks/{uid}`, removes the friendship both ways, clears pending tags, notifies the developer (`notify-block`). Content from blocked users filtered with `withoutBlocked` (`lib/moderation.js:366`) across feeds (`components/activity/ActivityFeedView.jsx:9`). Reachable from a profile sheet and friend card without a confirm dialog (`UserProfileSheet.jsx:142`, `components/friends/FriendCard.jsx:9`). Undo in Profile (`components/moderation/BlockedAccountsSection.jsx`) | Same filtering on every list that shows other users' content |
| **24-hour action** | Admin queue oldest first (`components/admin/ModerationQueue.jsx:3–8`); actions dismiss / delete / eject via `moderate-report` (eject revokes sessions, `moderate-report.js:122`); reminder every 4h for reports open 12h+ (`netlify/functions/moderation-sla-reminder.js:1–20`, `netlify.toml:58–59`) | Server-side; nothing to port. Native must honour `banned` |
| **Ejected users** | `userProfiles.banned` → `SuspendedScreen` ahead of the terms gate (`app/AppProviderWrapper.jsx:229–241`); rules refuse new UGC via `isNotBanned()` (`firestore.rules:37–42`) | Same ordering |
| **Published contact info** | Footer and Profile (`components/Footer.jsx:6`, `components/profile/ProfileView.js:595–613`); `/terms`, `/privacy`, `/how-to-use` reachable signed out (`app/AppProviderWrapper.jsx:64`) | Link from the sign-in screen and Profile |
| **Account deletion** | Profile → `delete-account` (`components/profile/ProfileView.js:280–302`, `netlify/functions/delete-account.js`), which purges 30+ collections and Storage files and deletes the Auth user (`netlify/functions/lib/userDataPurge.js:20–130, 214–380`), covered by `tests/deletion/*`. Client then deletes its push token and signs out | Same endpoint. **Gap:** no Sign in with Apple token revocation (B-11) |
| **Sign in with Apple alongside Google** | Guideline 4.8 note at `lib/firebase.js:117–124` | AuthenticationServices |
| **Camera and photo permission strings** | `Info.plist:48–53` (camera, library, add-only); requested one at a time, only when the user picks camera or library (`lib/nativePermissions.js:25–100`, `components/TicketScanner.jsx:283–290`); `limited` counts as granted; denied → Settings path (`openAppSettings`, 102) | Keep the same three strings; PhotosPicker needs no library permission for picking, so the read string may become unnecessary |
| **Push permission timing** | Never at launch. Offered once on the first band follow (`context/AppContext.jsx:3772–3774`, `components/notifications/PushOfferModal.jsx`) or from Notifications settings (`lib/pushAlerts.js:6–15, 103–118`). APNs registration at launch shows nothing (`AppDelegate.swift:50–58`) | Same; `UNUserNotificationCenter.requestAuthorization` only from those two places |
| **Privacy manifest** | `ios/App/App/PrivacyInfo.xcprivacy` (§1.3) | Re-derive for the native binary; Firebase iOS SDK and GoogleSignIn bring their own manifests. If FirebaseAnalytics is added natively, the collected types change |
| **Privacy nutrition labels** | Not in the repo. **Cannot be determined from the code** (App Store Connect) | Re-check against the new SDK set before submission (Q-08) |
| **Payments** | Donation link hidden on native (`components/layout/Sidebar.jsx:262–280`) | Don't add one |
| **No half-working features** | Playlist creation hidden everywhere (`lib/constants.js:53–61`) | Leave out of v1 |
| **Review account** | `scripts/seed-review-account.js` | Reuse for the native submission |

---

## Part 6: Native opportunities (list only; not in v1)

| Opportunity | Value | Rough size |
|---|---|---|
| Widgets: upcoming shows, "on this day" | Daily reason to open the app; anniversary logic already exists (`lib/anniversaries.js`) | M (App Group + shared cache) |
| Live Activity on show night | Upcoming show with doors time and a "log tonight's show" action; `upcomingShows.time` exists | M |
| App Intents and Shortcuts ("log tonight's show") | Logging without opening the app; pairs with the Live Activity | M |
| VisionKit / Live Text ticket scan | On-device text extraction before or instead of the Claude call; cheaper and works offline; could feed `analyze-tickets` text instead of images | M |
| Native share sheet + `ImageRenderer` for posters and Year in Review | Replaces the server PNG round trip for previews; server render still needed for `/p/` links | M |
| Spotlight indexing of shows | Search "Goose Red Rocks" from the home screen | S |
| Handoff with the website | Continue a show page on the Mac; universal-link shapes already exist (`lib/showRouting.js`) | S |
| Also seen while reading: MusicKit playlist creation (currently disabled), `PhotosPicker` without library permission, offline cache via Firestore's native persistence (the web disabled it, `lib/firebase.js:98–110`) | — | S–M each |

---

## Part 7: Proposed v1 plan

### 7.1 Scope table

Sizes: **S** ≤ 1 week, **M** 1–3 weeks, **L** > 3 weeks of one engineer, including tests. Core flows plus compliance are the floor.

| Screen / flow | Bucket | Size | Reason |
|---|---|---|---|
| Auth: Apple, Google, email, reset, terms gate, suspended screen | v1 must-have | M | Compliance floor; three providers plus tri-state gates |
| Guest mode + migration to an account | v1 must-have | M | Without it guests lose data; scope depends on Q-02/Q-03 |
| My Shows list, filters, sort, by-artist grouping | v1 must-have | M | Home screen |
| Show detail (setlist, ratings, comments, song add/reorder/delete/undo, attribution) | v1 must-have | L | 1,029-line view plus `SetlistView`, review/proposal UI |
| Add a show: setlist.fm search, add all | v1 must-have | M | Core logging |
| Add a show: band-native sources + review/resync | v1 must-have | M | Goose fans rely on it; easier once the merge is server-side (§7.2) |
| Add a show: manual form | v1 must-have | S | |
| AI ticket scan | v1 must-have | M | Shipped feature people use; camera permissions |
| Ticket-site screenshot import, CSV/XLSX import | v1.x | M | Lower use; `lib/importSheet.js` is 431 lines |
| Tour browse + bulk add, tours list, starred tours | v1 must-have | M | Shipped feature; 765-line modal |
| Runs, songs, song detail | v1 must-have | M | Stats depth users already have |
| Stats (overview, songs, runs, top artists, top venues) | v1 must-have | M | Numbers come from server (§7.2) |
| Year in Review / recap + share card | v1 must-have | M | Seasonal: launches Dec 2 (`lib/recapLaunch.js:27`); if v1 ships after the season, v1.x |
| Upcoming shows (add, detail, tag friends, convert) | v1 must-have | M | |
| Friends, requests, invites, shows together, suggestions | v1 must-have | M | Social core; server moves simplify it |
| Tag friends at a show; accept/decline tags, bulk accept | v1 must-have | M | |
| Notifications center, anniversaries | v1 must-have | S | |
| Push: token, offer, tap routing; band follow; alert settings, on-sale settings | v1 must-have | M | Users rely on band alerts |
| Report, block, unblock, UGC filtering | v1 must-have | M | Guideline 1.2 |
| Comments on shows, show photos/videos upload | v1 must-have | M | UGC that exists today; must carry moderation |
| Profile, display name/handle, email preferences, delete account | v1 must-have | M | Deletion is required |
| Festivals (list, detail, create/join, attach, lineup, picks) | v1 must-have | L | Large surface (2,052 LOC + 460 lines of context logic) |
| Wishlist | v1 must-have | S | |
| Bucket list (bands, venues) | v1 must-have | S | |
| Venue page, venue ratings | v1 must-have | M | Venue rating modal is prompted app-wide |
| Band screens and band song screens | v1 must-have | M | Push taps land here (`lib/pushAlerts.js:21–23`) |
| Personal poster ("songs I've heard") | v1.x | S | Server renders; native shares |
| Discover / fans also see | v1.x | S | Read-only from `bandAffinity` |
| Activity feed | v1.x | S | UGC; needs filtering |
| Meetups | v1.x | M | UGC with its own moderation |
| Setlist photo directory | v1.x | S | UGC feed |
| Advanced search + saved searches | v1.x | S | Saved searches reset anyway (§3.4) |
| Community leaderboard | v1.x | S | |
| Shared collection link | v1.x | S | |
| Archival audio links | v1.x | S | |
| Venue dashboard (owners), venue verification | v1.x | M | Small audience |
| Feedback, roadmap | v1.x | S | Can link to the web |
| How to use, release notes, terms, privacy | v1 must-have (as web links) | S | `SFSafariViewController` |
| Admin, admin venue verifications | web-only | — | Admin works on the web |
| Compare/switch/best-of pages, landing page | web-only | — | SEO and marketing |
| Public band/song/heard/profile/show/poster pages | web-only | — | Server-rendered |
| Playlist creation, Spotify callback | web-only (dormant) | — | Disabled by flag |
| `/upcoming` redirect | web-only | — | Removed feature |
| Heard-tool hand-off (`?heard=`, `?next=`) | web-only | — | Native already skips it |

### 7.2 Server-side moves before native work starts

In order. Each is a proposal; none is done here.

1. **Profile counters and rank** (`updateUserProfile`, `context/AppContext.jsx:153–178`; `calculateUserRank`, 839–849). A Firestore-triggered or callable function recomputes `showCount`, `songCount`, `ratedSongCount`, `venueCount` from `users/{uid}/shows`, and rank comes from a server count. *Why first:* these numbers are shown to other people (`communityStats.js:44–96`), and a second client writer guarantees drift; it also removes the read-every-profile cost (B-05).
2. **Lock down the two open AI endpoints and add Apple token revocation** (B-10, B-11). Small, and a native binary shouldn't ship pointing at unauthenticated paid endpoints.
3. **Show normalization endpoint.** One function that takes a setlist.fm id, band-source hit, ticket-scan row or manual entry and returns a normalized show document: date as `YYYY-MM-DD`, setlist parsed (`lib/setlistParser.js`), source resolved (`lib/setlistSources.js:326`), band setlist merged (`lib/bandSetlist.js`, `lib/bandSetlistMerge.js`), `isManual` set (`buildShowDoc` rule), duplicate check. *Why:* the show shape must be byte-identical from both apps; this logic already has a server twin with parity tests, and it is where the date bugs live (B-06, B-07, B-13).
4. **Setlist resync, proposals and missing-setlist scan** (`context/AppContext.jsx:1754–2085`) as server operations that write the show. *Why:* the "never lose ratings" guard (1994–1999) must not be reimplemented.
5. **Email composition by type** (`lib/emailTemplates.js`, `lib/email.js`, call sites in `tagFriendsAtShow`, invites, suggestions, friend-joined). Client sends `{type, ids}`; the server builds the HTML. *Why:* otherwise Swift re-implements HTML templates; then `send-email` can stop accepting arbitrary HTML (S-06).
6. **Cross-user social writes**: invite/referral auto-friend (auth effect, 1129–1245), accept/remove friend (2743–2797), email lookup (2719–2741), Shows Together and suggestions (3123–3275). *Why:* the client writes into other users' documents (S-04) and reads friends' entire show histories; one server implementation fixes both apps and allows tightening rules later.
7. **Stats and Year in Review numbers**: one server computation (or a shared spec with golden fixtures, Q-05) for summary stats, song counts, artist stats, venue stats, runs/tours, and both Year in Review calculators (`lib/yearInReviewStats.js`, `lib/yearRecap.js`). *Why:* today Stats, profile, leaderboard and Year in Review already disagree on venues and bands (B-04); a Swift port would add a third answer.
8. **Festival matching** (`findFestivalMatchesFor`, 2224–2264) via the existing server rule. *Why:* the rule is already duplicated with a parity test; a third copy in Swift isn't worth it.

### 7.3 Project structure

**Where it lives: `ios-native/` alongside `ios/` (recommended).**
- *For:* rules, indexes, functions, CHANGELOG and the versioning rule stay in one repo with one PR history; Xcode Cloud finds `ci_scripts/` next to each project, so each gets its own (`ios/App/ci_scripts/ci_post_clone.sh` runs `npm install`, `next build` and `cap sync`, none of which the native build should run); `ios/` stays buildable for rollback.
- *Against:* Swift tooling and SPM caches in a Node repo; `netlify.toml` has no `ignore` command today, so an `ios-native/`-only commit would still trigger a site build; add one if that matters.
- A separate repo only wins if a separate team owns it.

**Minimum iOS version.** Current: `IPHONEOS_DEPLOYMENT_TARGET = 15.0` (`ios/App/App.xcodeproj/project.pbxproj:255, 312, 332, 360`; `ios/App/CapApp-SPM/Package.swift:7`). App analytics: **none in the repo**. Firebase Analytics is only used for ticket-click events on the web (`components/UpcomingShows.jsx:34–38`), and the iOS app doesn't link FirebaseAnalytics (`Package.swift`). The OS-version distribution has to come from App Store Connect → Analytics (Q-04).
- **iOS 18 (recommended floor).** The Observation framework needs iOS 17; iOS 18 adds the newer `Tab` API and is where most SwiftUI navigation fixes landed. Excludes few active devices.
- **iOS 26.** Liquid Glass and the newest APIs by default, one design target, fewer `#available` branches. Drops every device that can't run iOS 26 and anyone who hasn't updated.
- Decide from the App Store Connect numbers: if ≥ 95% of sessions are on iOS 26+, take 26; otherwise 18.

**Architecture.** SwiftUI, `@Observable` stores (no Combine), `TabView` with a `NavigationStack` per tab on iPhone, `NavigationSplitView` where width allows (CLAUDE.md "iPad and wide layouts": layout follows measured width; no iPad checks). Firebase iOS SDK via SPM (`FirebaseAuth`, `FirebaseFirestore`, `FirebaseMessaging`, `FirebaseStorage`), `GoogleSignIn` via SPM. No third-party UI libraries. Tabs proposed from `ROOT_ROUTES` (`lib/navRoutes.js:24`): Shows, Search, Stats, Me; whether to add a fifth (Friends or Upcoming) is a product decision (Q-06), since the web app has never shipped a tab bar (`components/layout/MobileTabBar.jsx:9–24`).

**Folder and module layout.**
```
ios-native/
  MySetlists.xcodeproj
  ci_scripts/ci_post_clone.sh        # no npm
  App/                                # @main, scene, AppDelegate (push), entitlements, Info.plist, PrivacyInfo
  Packages/
    Core/                             # Swift package, no UI
      Models/                         # Show, Song, UserProfile, ShowTag, Festival… + FlexibleDate, ShowDate
      Firestore/                      # repositories per collection, listeners
      API/                            # Netlify function client (apiUrl, ID-token auth)
      Auth/                           # Apple, Google, email, terms state, ban state
      Moderation/                     # report, block, withoutBlocked
      Dates/                          # parseDate/toIsoDate port + golden tests
    Features/                         # one folder per area: Shows, ShowDetail, Search, Scan, Stats,
                                      #   Tours, Festivals, Friends, Tags, Upcoming, Notifications,
                                      #   Profile, Bands, Venues, Wishlist, BucketList, YearInReview
    DesignSystem/                     # tokens from tailwind.config.js / DESIGN_SYSTEM_GUIDE.md
  Tests/
    CoreTests/                        # decoding fixtures for every §3.2 variant
    UITests/                          # XCUITest core flows
```

**Testing.**
- Unit (Swift Testing): decode fixture JSON for every variant in §3.2; port the date cases from `lib/__tests__` (`anniversaries.test.js`, `yearInReview.test.js`, `importSheet.test.js`) and the deep-link cases (`deepLinks.test.js`) as golden tables shared with the JS tests.
- Rules: the existing emulator suite (`npm run test:rules`) already covers the paths the native app will use; add cases only for new server functions.
- UI (XCUITest) against a test project or the emulator: sign in (each provider where automatable), terms gate, add a show from search, rate songs, tag a friend and accept, block and report, delete account.

**Xcode Cloud during the transition.** Two workflows: the existing Capacitor workflow (unchanged), and a native workflow whose start condition is limited to `ios-native/**`. Both target the same App Store app if the bundle ID is shared. Whether two Xcode Cloud products for one app share a build-number sequence **cannot be determined from the repo**; App Store Connect refuses a duplicate build number for a version, so check before the first native upload (Q-07). CLAUDE.md's rule ("every PR bumps `MARKETING_VERSION` in `ios/App`") needs a native equivalent (Q-09).

### 7.4 Cutover plan

1. **Same bundle ID (`com.mysetlists.app`) and App Store record.** Keeps ratings, reviews, the AASA team/app ID (`66N4YR3VP9.com.mysetlists.app`), push setup, and is the only way the Google Keychain session can carry over (§3.4).
2. **Before the native release, ship a final Capacitor version** that (a) prompts guests to create an account, which runs the existing migration (`handleMigrateData`); and (b) optionally copies `guest-shows` and saved searches into `UserDefaults` via `@capacitor/preferences`, which the native app (same bundle ID) can read. (b) is not verified and needs a spike (Q-02).
3. **TestFlight period alongside the Capacitor app.** A device can have only one build of a bundle ID, so "alongside" means separate tester groups: internal testers on native builds, the public App Store and external testers on Capacitor. Run the Google carry-over test (Q-01) in this phase.
4. **Sign-in-again message.** In-app on first native launch, plus an announcement email (`admin-send-announcement.js`) a few days ahead: "MySetlists for iPhone is now a fully native app. Your shows are safe in your account. You'll need to sign in once more." Mention that guests should create an account first.
5. **Release with phased release** (pausable). Watch Crashlytics-equivalent signals (Q-10: no crash reporting is set up today), sign-in success, and `pushTokens` re-registration.
6. **Afterwards:** freeze `ios/` for one release cycle as the rollback path, then remove it, `capacitor.config.ts`, the `@capacitor*` dependencies, `lib/capacitor.js`, `lib/native-auth.js` and the `isNativePlatform()` branches in a web-only cleanup PR.
7. **Rollback.** The App Store can't revert a version. Rolling back means shipping a new Capacitor build with a higher version number from the frozen `ios/` project, then telling users to sign in again (in the other direction). Keep the native app's writes compatible with the web's readers throughout (no new shapes until the Capacitor app is gone), so a rollback never strands data.

### 7.5 Risks and open questions (ranked by likely effect on the estimate)

| # | Risk / question | Why it matters |
|---|---|---|
| R-01 / Q-02 | **Guest data at cutover.** How many active guests are there, and is the `@capacitor/preferences` hand-off viable? | Silent data loss for every guest otherwise. Count from `guestSessions where converted == false` |
| R-02 / Q-05 | **How much moves server-side first.** Full server stats vs. shared golden fixtures | §7.2 items 3–7 are each S–M of server work; this can double the pre-native phase |
| R-03 | **Show detail and setlist editing are large** (`ShowDetailView.jsx` 1,029 lines, setlist grouping, proposals, undo) | The biggest single native screen; easy to underestimate |
| R-04 | **Festivals** carry ~460 lines of context logic and a rules-validated shared catalog | L by itself |
| R-05 / Q-01 | **Re-authentication.** Does the Google Keychain session carry over? | Changes the cutover message and support load |
| R-06 | **Concurrent edits.** `saveShow` writes the whole show; web and iOS editing the same show is last-write-wins on `setlist` | More likely once two first-class clients exist; may need field-level updates |
| R-07 | **Date and type variants** (§3.2) in production data | Decoding failures are crashes or missing shows; needs a production data scan to size |
| R-08 / Q-06 | **Information architecture.** Tabs vs. today's drawer; which five | Product decision that blocks navigation work |
| R-09 / Q-04 | **Minimum iOS version** without analytics in the repo | Drives API choices |
| R-10 / Q-07, Q-09 | **Xcode Cloud** build numbers across two products; native versioning rule | Can block the first upload |
| R-11 / Q-03 | **Guest mode design**: keep local-only or move to anonymous auth | Changes auth and migration code |
| R-12 / Q-08 | **Privacy labels** live in App Store Connect, not the repo | Submission blocker if wrong |
| R-13 / Q-10 | **No crash reporting** in either app today (no Crashlytics/Sentry found) | Hard to judge a phased release |
| R-14 | **Security rules** (S-01 to S-05) are permissive; tightening them later may break the Capacitor app still in the field | Sequence rule changes after cutover |
| R-15 | **B-01** artist images may be broken in the current iOS app | Users may expect images the old app never showed; confirm on device **B-01 fixed in 5.59.8 (iOS 3.13.8).** |
