# Stage 4 audit: library screens

PR 4-1 of Stage 4, read against `main` at d60c19c (web 5.60.31, Capacitor 3.13.47, native 4.0.27). [`PARITY-AUDIT.md`](PARITY-AUDIT.md) is the inventory. This audit only confirms the server needs, the F-1 navigation and the PR split. The calls (§4) were approved on 2026-11-18, and DECISIONS.md "Stage 4" records them. Ships in native 4.0.28; web and Capacitor unchanged.

One change to the parity plan, from Phillip: "Listen to this night" (Internet Archive, through Relisten) and "Where to stream this show" move from Stage 6 (6-8) into Stage 4, with Songs (4-4).

## 1. Server needs (PR 4-2)

### 1.1 Per-year `userStats` (F-15)

Nothing per-year exists on the server. `computeUserStats` (`lib/stats/index.js`) returns all-time numbers and `showsByYear` only. The web's year picker runs `computeUserStats` on the device for each period (`lib/useStatsPeriod.js`, `app/stats/page.jsx`). The per-year `stats` on `yearInReviews/{uid}_{year}` can't stand in: they're written only onto Year in Review documents that already exist.

**Build:** a `years` map on `userStats/{uid}`, keyed by year. Each entry is `computeUserStats` run on that year's shows:
- the tiles: `showCount`, `songCount`, `ratedSongCount`, `uniqueSongCount`, `bandCount`, `venueCount`;
- `avgShowRating` and `ratedShowCount`;
- `topBands`, `topVenues`, `topSongs` (top 10);
- `showsByMonth` (`"01"`–`"12"`), for the monthly heatmap.

The field is additive, so `STATS_VERSION` stays 2 (as with C-2's top lists). `fixtures/user-stats/` gains a per-year case. A year's full lists (every artist, venue, song) still come from the cached shows, filtered with the shared keys (`fixtures/stats-keys/`), as PARITY-AUDIT §2.7 planned.

### 1.2 The welcome email

- **Account upgrades are already covered.** `account-linked` runs `processWelcomeEmail`, and native calls `account-linked` after a link (`SessionStore.upgrade`).
- **Missing:** a first show added straight into an account. The web asks for the email itself (`noteShowsAdded` in `AppContext`); native never does. **Build:** `normalize-show` calls `processWelcomeEmail` on a commit when the caller is an account, had no shows before, and a show was written. It's awaited, so only that account's first add gets a little slower.
- **Also missing:** `adopt-guest-shows` moves a guest's shows into an existing account and never sends it. **Build:** the same call after a commit that moved shows.
- **The web's own call stays** (D). It covers web offline adds, which the hourly sweep finishes later, and old Capacitor builds. `processWelcomeEmail` claims the send in a transaction, so a second call sends nothing.

### 1.3 Fixtures

- **Runs and tours:** `lib/runIndex.js` is already CommonJS. Runs group venues with `venuesFuzzyMatch` (`lib/showIdentity.js`), which native has no copy of, so the fixture has venue-pair rows, and the runs PR ports that function too.
- **Song key and gaps:** bigger than PARITY-AUDIT said. `lib/songIndex.js` is ES-module code with `@/` imports. It becomes CommonJS (`setGroups`, `showDate`, `stats/keys`, `artistSlug`), with "today" passed in so the gap in days is testable. The fixture covers the song key, times seen, first and last, the current gap (shows and days), the longest gap, by year, the place in the set, and best versions. It also pins `artistSlugFromName`, which native copied in #451 (`BandAlerts.slug`) without a shared fixture.
- **User count:** `lib/userCount.js` is CommonJS. One rule: 1,000 or more, and unknown counts as below. `communityStats` is readable by anyone, guests included.

### 1.4 Listening

- **"Listen to this night":** no server work. `archival-audio-lookup` is public, counted with `checkProxyLimit`, and answers JSON. It accepts only `YYYY-MM-DD` (`isoDay`, `lib/cacheGuard.js`). The web sends `show.date` as stored. Stored dates are ISO since 2026-11-14, so 4-2 checks whether any formatting step still sends `DD-MM-YYYY`, and fixes it if so. Native sends the ISO date from `ShowDate`.
- **"Where to stream this show":** `lib/streamingPlatforms.js` is ES-module code that only the browser runs. **Build (A):** it becomes CommonJS, and `archival-audio-lookup` adds a `streaming` list to its answer, built on every call and never cached. One call serves both sections, nothing is copied into Swift, and adding a band needs no app release.

### 1.5 "Hours of live music" (F-3)

Remove the tile from `app/stats/page.jsx`, and the "hours of live music" promise from the landing page (`components/LandingPage.jsx`).

## 2. F-1 navigation (PR 4-3)

- **Library at the top of Me:** Tours, Runs, Wishlist, Bucket List, Festivals, Setlist Photos. Each Stage 4 PR points its row at the native screen. **Festivals and Setlist Photos open the web until Stages 5 and 6** (B). Builds are internal TestFlight only until then.
- **Community on Stats.** **Activity on Friends** comes with the Stage 6 activity feed, not in Stage 4.
- **Guests** see Tours, Runs, Wishlist, Bucket List and Community. Festivals and Setlist Photos are hidden (guests can't join festivals or read UGC). Two refusals for later PRs:
  - a guest can't share a bucket list (no public shares);
  - a guest can't read or write venue ratings (`venueRatings` needs `isAccount()`).
- **Wide iPad:** a `TabSection("Library")` in `AppShell`. It appears in the `.sidebarAdaptable` sidebar, and `.defaultVisibility(.hidden, for: .tabBar)` keeps it off the phone's tab bar.
- **Deep links:** `fixtures/deep-links` already lists `/tours`, `/runs`, `/wishlist`, `/bucket-list`, `/community` and `/stats/*`. Each PR adds its native route; until then the link opens the web.
- **The guest's first-show account prompt** goes in 4-3.

## 3. PR split

| PR | Contents | Kind |
|---|---|---|
| 4-1 | This audit and the DECISIONS entry. | docs (native) |
| 4-2 | **Server:** per-year `years` block; welcome email from `normalize-show` and `adopt-guest-shows`; Hours tile and landing line removed; `songIndex` made CommonJS; fixtures for runs, songs and the user count; `streaming` in `archival-audio-lookup`'s answer; the archive date check. | server (web + Capacitor) |
| 4-3 | **Navigation:** Library, Community on Stats, the iPad sidebar section, the guest's first-show prompt. | native |
| 4-4 | **Songs and listening:** full song list, song page, "Listen to this night", "Where to stream this show". | native |
| 4-5 | **Bands:** band page from the public snapshot, band song page, artist info. | native |
| 4-6 | **Runs and tours.** | native |
| 4-7 | **Venues.** | native |
| 4-8 | **Stats:** year picker, heatmap, full lists, top-rated shows, average rating, runs list. | native |
| 4-9 | **Wishlist.** | native |
| 4-10 | **Bucket list.** | native |
| 4-11 | **Community.** | native |
| 4-12 | **Search tab.** | native |

Listening goes with Songs rather than Bands: Bands is already the largest PR, and both sections are small. PARITY-AUDIT 6-8 loses them.

## 4. Calls (approved 2026-11-18)

| Call | Decision |
|---|---|
| **A** | The streaming list comes from the server, in `archival-audio-lookup`'s answer. No Swift copy. |
| **B** | The Festivals and Setlist Photos rows in Library open the web until Stages 5 and 6. |
| **C** | Both song keys stay: the song page uses the strict artist slug (`artistSlugFromName`, "goose (US)" is its own page), Stats uses the loose band key (`bandKey`, merged). Unifying them would change the web's `/songs?song=` links. Stats' top songs keep opening the filtered show list, so the two never disagree on one screen. "Unify the song keys" goes on the post-launch list. |
| **D** | The web keeps its own welcome-email call alongside the server's. |

Also approved: the welcome email from `adopt-guest-shows`, and listening in 4-4 with Songs.
