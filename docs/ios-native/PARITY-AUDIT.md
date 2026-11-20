# Native parity audit (2026-11-17)

**The requirement (Phillip, 2026-11-17):** before launch, the native app reaches full parity with the web and Capacitor app, except the admin portal. Several "web link" and "v1.x" calls in [`DECISIONS.md`](DECISIONS.md) are reversed by this. This document lists everything the web and Capacitor app does, says where native stands on each item, and proposes the work to close the gap. No code changes.

**Decided 2026-11-17:** Phillip accepted every recommendation in §3 except F-9: **playlists are left out of the native app** and out of the plan. DECISIONS.md records the calls ("Parity before launch"). **2026-11-19:** meetups are left out of native too, and stay on the web.

Read against `main` at 083e0e8 (#450 merged) plus #451 (native 4.0.25), which has since merged. Ships in native 4.0.27; web and Capacitor unchanged.

## How to read the tables

**Status:**
- **Native**: built, with its PR.
- **Planned**: already in Stage 4 (tours, runs, songs, bands, venues, wishlist, bucket list, Community) or Stage 5 (festivals, read and attach), per DECISIONS "Build order".
- **Web link**: the native app opens the page in `SFSafariViewController` today.
- **Missing**: no native screen and no web link; the feature is simply absent.
- **Web by design**: not an app screen (public SEO pages, password reset). Not a parity gap; listed so the inventory is complete.

**Size:** **S** is part of a PR (under a day). **M** is one PR. **L** is more than one PR, or one PR that also needs server or rules work.

**Stage:** where the item should land in the proposed plan (§4). "6" is the new parity stage.

**Server work:** "none" means the data and functions already exist and native only reads or calls them. Every native screen that shows a number the server already computes reads it from the server (CLAUDE.md, "The numbers people see"). Logic shared with `lib/` gets a Swift port with golden fixtures run by both test suites, as `setlistEdits` and the stats keys do.

---

## 1. Summary

Counted from the rows in §2 (the admin portal excluded; the public pages in §2.23 are one paragraph, not rows):

| Status | Rows |
|---|---|
| Native (merged), some partly | 81 |
| Planned (Stage 4 or 5) | 38 |
| Web link today | 7 |
| Missing | 56 |
| Decided in §3: no native build, or the web (Hours of live music, Fans also see, Discover, venue owner tools, playlists) | 5 |
| Web by design | 3 |
| Other (the first-show animation, which the web removed; help links, partly native) | 2 |
| **Total** | **192** |

What's left falls into five groups:

1. **Stage 4 as planned, plus four additions:** a way to reach the secondary screens (native has no equivalent of the web's menu drawer), per-year stats, advanced search, and adding a whole tour at once.
2. **Stage 5 grows** from "read and attach" to everything Festivals does on the web: create, join, leave, notes, lineup search and picks.
3. **User content** (comments, photos, videos, posters, setlist photos, meetups), which was v1.x (C-4) and is now required. This is the largest single block.
4. **Imports, posters and Year in Review**, which were web links or v1.x.
5. **Many small items** on the show page, profile and help screens (streaming links, archive audio, play counts, achievements, roadmap, feedback).

Playlists were in group 4; they're left out by decision (F-9).

Two gaps aren't screens, and both should be fixed whatever else is decided:
- **The welcome email after a first show** is requested by the web client (`requestWelcomeEmail` in `AppContext`). Native never asks for it, so a native-only user never gets it. **Fix:** move the trigger into `normalize-show`, on the server.
- **Native has no way into the secondary screens.** The Capacitor app reaches Tours, Festivals, Wishlist, Bucket List, Community and Setlist Photos through its menu drawer (`Sidebar.jsx`). Native's four tabs have no such entry (flag F-1).

---

## 2. Inventory, page by page

### 2.1 App shell and things on every page

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Tabs | Capacitor: Shows, Search, Stats, Upcoming, Me (`MobileTabBar`). Web: sidebar | Shows (Upcoming inside), Friends, Stats, Me, Search | Native #426 | | | |
| Menu drawer for secondary pages | `Sidebar.jsx`: My Shows, Stats, Community, Discover (hidden), Tours, Festivals, Wishlist, Bucket List, Profile, Setlist Photos, Feedback, How to Use, Release Notes | None | Missing | S | none | 4 (flag F-1) |
| Deep links and universal links | `lib/deepLinks.js`, AASA | Ported, shared fixture | Native #426 | | | |
| Version gate (update required) | `VersionGate` | Same table, `fixtures/app-version/` | Native #425 | | | |
| Sign in: Apple, Google, email, guest; terms gate; suspended screen | `auth/*` | All | Native #425, #437, #443 | | | |
| Forgot password | `ForgotPasswordForm` | On the sign-in screen | Native #429 | | | |
| Password reset page (`/reset`) | Web page | Opens the web | Web by design | | | |
| Welcome back after the Capacitor update | none | Native only | Native #429 | | | |
| Offline: cached shows, outbox, "Waiting to sync" | `lib/liveShows.js`, outbox | Same | Native #432, #436 | | | |
| Guest rescue banner ("Create a free account to keep your shows") | `GuestRescueBanner` on every page | The prompt is in Me and the Shows empty state; no banner | Native, partly | S | none | 6 |
| Guest's first show opens the account prompt | `AppContext` (`setShowGuestPrompt`) | No prompt after a guest's first show | Missing | S | none | 4 |
| Welcome email after a first show | Client calls `send-welcome-email` | Never requested | Missing | S | Move the trigger into `normalize-show` (first show for an account) | 4 (server PR) |
| "Added X" toast with Open | `announceAddedShow` | "Open it" alert after an add | Native #436 | | | |
| First-show animation | Removed from the web ("Straight to Your First Show" release note) | None | Nothing to build | | | |
| Haptics | Only on custom swipe gestures: swipe back, drawer close, sheet drag (`impact('light')` in `lib/capacitor.js`) | System gestures carry their own haptics | Native (by the platform) | | | flag F-8 |
| Admin announcements popups (`PopupQueue`, `PopupOverlay`, `AdminPopups`) | Shown to users once | None | Missing | M | none (reads what admin writes); confirm the rules let native read them | 6 |
| What's New modal | `WhatsNewModal`, after an update | None | Missing | S | none | 6 (flag F-5) |
| PWA install prompt | `InstallPrompt` | n/a | Web by design | | | |
| Cookie notice and `/cookies` | Web | n/a (native sets no cookies) | Web by design | | | |
| Report content or a user; blocked accounts; person sheet | `moderation/*` | All | Native #446 | | | |
| Crash reporting | none | Crashlytics | Native #426 | | | |

### 2.2 Shows list (`/`, `/shows`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Timeline list, search, sort | `app/shows/page.jsx` | Yes | Native #432 | | | |
| Filters: year, date, artist, venue | `ShowFilters` | Year, band, venue | Native #432 | | | |
| "By artist" tab (artist table, expand to shows) | `ArtistShowsRow` | None | Missing | S | none | 4 |
| Saved searches applied to the list | `activeSavedSearch` | None | Missing | S | none | 4 (with advanced search) |
| `?artist=` / `?venue=` filter links from elsewhere | Yes | Tap-through from Stats | Native #441 | | | |
| Venue's shows (`?venueKey=`) | `VenueShowsView` | The venue page's "Your shows here" (newest 10, then all in your show list); a `?venueKey=` link still opens the web | Native 4-7 | | | |
| Empty state: "Your concert journey starts here" | Yes | Yes | Native #432 | | | |
| Loading skeleton | `ShowsListSkeleton` | Progress view | Native #432 | | | |
| "Relive this night" card (show anniversaries) | `ReliveThisNightCard` | None | Missing | S | none | 6 |
| Year in Review card on the list | `YearInReviewCard` | On Stats instead (C-9) | Native #441 | | | |
| Internet Archive backfill card ("Look them up") | `ArchiveBackfillCard` → `ArchiveSetlistReview` | None (`scan-missing-setlists` endpoint defined, no UI) | Missing | M | none | 6 |
| Archive proposals to review | `ArchiveProposalReview` | Yes | Native #435 | | | |
| Delete a show from a row | Yes | Swipe and show menu | Native #433 | | | |

### 2.3 Upcoming shows

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| List, add (search or by hand), edit, delete | `upcoming/*` | Yes | Native #436 | | | |
| Tickets link | Yes | Yes | Native #436 | | | |
| "Did you go?" → move to shows with setlist | Yes | Yes (`normalize-show` kind `upcoming`) | Native #436 | | | |
| Who's going (friends), tag friends | Yes | Yes | Native #448 | | | |
| Empty state ("Going to a show?") | Yes | Yes | Native #436 | | | |

### 2.4 Show page (`/shows/?show=`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Artist, date, venue, city header | Yes | Yes | Native #433 | | | |
| Artist name → band page | `bandHref` | Band stand-in (Follow + web link) | Planned | | | 4 |
| Venue → venue page | Yes | The venue row in the card under the header | Native 4-7 | | | |
| Tour line → tour page | Yes | Card under the header (your tours only) | Native 4-6 | | | |
| "Night N of M — view the full run" | Yes | Same card | Native 4-6 | | | |
| Festival badge → festival page | Yes | Label only | Native #433 (label); link planned | | | 5 |
| Follow the band (bell) | `FollowBandButton` | Show ⋯ menu | Native #451 | | | |
| Tag friends | Yes | Yes | Native #448 | | | |
| Share | Owner link | Public show page, or how to get one | Native #451 | | | |
| Create playlist (Spotify, Apple Music) | `PlaylistCreatorModal`, `/spotify-callback` | None | Left out of native (F-9, decided) | | | |
| Play counts toggle (#: how many times you've seen each song) | Yes | None | Missing | S | none (counts from cached shows with the shared song key) | 6 |
| Delete show | Yes | Yes | Native #433 | | | |
| Show rating, venue rating | Yes | Yes | Native #433 | | | |
| Show note | Yes | Yes | Native #433 | | | |
| Setlist by set, encore labels | `SetlistView` | Yes | Native #433 | | | |
| Edit setlist: add, delete, reorder, move to set | Yes | Yes | Native #435 | | | |
| Song ratings | No (web rates in the editor) | Yes | Native #433 | | | |
| Song → song page | Yes | Touch and hold → "Your history with this song" | Native 4-4 | | | |
| setlist.fm and band-source attribution | Yes | Yes | Native #433, #435 | | | |
| "Check this setlist" (needs review, compare with archive.org) | Yes | Yes | Native #435 | | | |
| Proposal diff, accept, decline; re-sync | Yes | Yes | Native #435 | | | |
| Show stats: songs, duration, tour, debuts | Sidebar card | Songs and debuts | Native #433, partly | S | none | 4 |
| Friends who were there | Yes | Yes | Native #448 | | | |
| Shows to confirm (suggestions) | Yes | Yes | Native #448 | | | |
| "Where to stream this show" (nugs.net, playdead, Relisten, archive.org) | `StreamingLinks`, `lib/streamingPlatforms.js` | `StreamingSection`, from the lookup's `streaming` | Native 4-4 | | `archival-audio-lookup` answers the list (Stage 4 call A, 5.60.32) | |
| "Listen to this night" (Relisten / Internet Archive recordings, link-out) | `ArchivalAudioSection`, `archival-audio-lookup` | `ListenSection`: the pick is saved (`archivalAudioPick`), three rows then "Show all" | Native 4-4 | | none | |
| Photos and videos | `ShowMediaSection` | `ShowMediaSection`: three galleries, one listener | Native 6-4 (4.0.49) | L | `showMedia` checks the Storage file since 5.60.38 (6-2a) | 6 |
| Posters | `ShowMediaSection` | Yes | Native 6-4 (4.0.49) | (with photos) | | 6 |
| Setlist photos | `ShowMediaSection` | Yes | Native 6-4 (4.0.49) | (with photos) | | 6 |
| Comments: post, reply, delete, like, report | `CommentsSection` | `CommentsSection` | Native 6-3 (4.0.48) | L | likes through `engagement-notify` since 5.60.38 (6-2a) | 6 |
| Meetups on a show | `MeetupCard` | None | Left out of native (decided 2026-11-19); stays on the web | | 6-2a's server fixes apply | |
| Empty setlist: "No setlist yet" | Yes | Yes | Native #433 | | | |

### 2.5 Adding shows (web `/search`, Capacitor Search tab)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| setlist.fm search by show or artist | `SearchView` | + → Search | Native #436 | | | |
| Pick among several artists | Yes | Yes | Native #436 | | | |
| Add by hand | `ShowForm` | Yes | Native #436 | | | |
| Duplicate check | `classifyDuplicate` | Server answer | Native #436 | | | |
| "Add all shows" of an artist or tour, tour browser | `TourBrowseModal`, `get-tour-shows`, `addShowsFromTour` | `TourBrowseSheet` (Search tab, Tours, a tour page): band, tour, nights; "band + tour" text; maybe-yours nights; select all; by month | Native 4-12 | | none | |
| Ticket scan | `TicketScanner`, `analyze-tickets` | Yes | Native #438 | | | |
| Guest scan prompt | `GuestScanPrompt` | Yes | Native #438 | | | |
| Screenshot import (`/scan-import`) | `ScanImportView`, `analyze-screenshot` | Add a show → Import shows → a screenshot, into the same review | Native 6-7 (4.0.51) | M | none | 6 |
| CSV / Excel import, template, column matching, preview | `ImportView` | `ImportShowsView`: file, columns, review with setlists, import, not-imported CSV, template | Native 6-7 (4.0.51) | L | `import-sheet` (5.60.39, 6-2b) | 6 |
| Search tab | Capacitor: add-show search | Search over your shows (F-2): quick search, Advanced search, By artist, Add shows from a tour | Native 4-12 | | none | |

### 2.6 Advanced search (`/advanced-search`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Filters: artist, venue, city, country, date range, presets (this month, this year, last year), tour, festival, minimum rating, with friend, notes contain, setlist song | `AdvancedSearchView` | `AdvancedSearchScreen` (`ShowSearch`), live results | Native 4-12 | | none | |
| Sort: newest, oldest, highest rated, artist A–Z | Yes | Yes | Native 4-12 | | | |
| Saved searches, recent searches | Yes (stored on the device) | Yes, on the device (`SavedSearches`); a recent search reopens its filters | Native 4-12 | | | |
| Empty state: "No shows match these filters" | Yes | Yes | Native 4-12 | | | |

### 2.7 Stats (`/stats` and its sub-pages)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Headline tiles: shows, songs heard, artists | Yes | Yes | Native #441 | | | |
| "Hours of live music" | Shows × 2 | Dropped (C-4) | Flag F-3 | | | |
| Period picker: each year, or all time | `useStatsPeriod` | Chips: All time and each year (`userStats.years`) | Native 4-8 | | per-year block (4-2) | |
| Show frequency by month (heatmap) | `YearHeatmap` | `MonthHeatmap`, the web's shades | Native 4-8 | | per-year block | |
| Shows by year | Yes | Every year incl. empty ones, read by touch and drag, tap to pick the year | Native #441, 4-8 | | | |
| Rank | Profile tile | "#N" only (C-5) | Native #441 | | | |
| Top artists, top venues, top songs (with tap-through) | `/stats/top-artists`, `/stats/top-venues`, Songs tab | Top 10 each, tap-through | Native #441 | | | |
| Full lists: every artist, venue, song (times played, average rating) | `StatsView` tabs, `/stats/songs` | `StatsListScreen` for the period (`StatsLists`); songs per year | Native 4-8 | | none | |
| Top-rated shows | `StatsView` | Top 3 on Stats, all 10 behind it, for the period | Native 4-8 | | none | |
| Runs list (`/stats/runs`) | Yes | `RunListView` (4-6), linked from Stats | Native 4-6, 4-8 | | | |
| Venue tab: "Rate Venue", community average | `VenueRatingModal` | On the venue page; Stats' venue rows still open your shows there | Native 4-7 (venue page) | | | |
| "How many Goose songs have you heard?" (Songs I've heard tool) | `HeardToolCard`, a web tool | None | Missing | S | none; the tool is a web page (flag F-11) | 6 |
| Year in Review entry | Card | Card, Dec 2 – Jan 15, opens the web (C-9) | Native #441 (web link) | | | |
| Empty state: "No stats yet" | Yes | Yes | Native #441 | | | |

### 2.8 Songs (`/songs?song=`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Song page: times seen, first, last, current gap, every time seen, by year, where it lands in the set, your best versions | `SongDetailView`, `SongHistoryModal` | `SongPage` (`SongIndex`, `fixtures/song-index/`) | Native 4-4 | | none | |
| Empty state: "No dated performances yet" | Yes | By year is left out when no performance has a date | Native 4-4 | | | |
| Every song you've seen: times seen, average rating, search, sort | Stats → Songs tab (title only), `/stats/songs` (per band, gap) | `SongListView` from Stats → All your songs, `/stats/songs` | Native 4-4 (one row per song page, below) | | none | |

### 2.9 Bands (`/bands?band=`, `&song=`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Band page: your shows, songs heard, your first and last, your most heard; the band's own stats (shows, first and last show, top songs) | `BandScreen`, public snapshot | `BandScreen` (any band; the snapshot for public bands) | Native 4-5 | | none: reads the snapshot through `/api/artist` (CDN-cached JSON) | |
| Band song page: times heard, first and last heard, your gap; times played, last played, shows since, longest gap, recent performances | `BandSongScreen` | `BandSongScreen` (`/api/artist-song`) | Native 4-5 | | none | |
| Artist info: Wikipedia summary, members, MusicBrainz and Discogs links | `EntityInfoPanel`, `get-entity-info` | "About <band>" on the band page (`get-entity-info`, `enrich-artist`) | Native 4-5 | | none | |
| Follow | Yes | Yes | Native #451 | | | |
| "Fans also see" | `FansAlsoSee` (Discover) | None | Flag F-4 | | | |
| Make my poster | `MakePosterButton` | None | Missing | (with posters) | | 6 |
| "Band stats" link from Stats | `BandStatsLink` | "<band>'s page" on your shows of a band | Native 4-5 | | | |

### 2.10 Runs and tours (`/runs?run=`, `/tours?tour=`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Run page: nights, unique songs, total songs, average rating, night by night, best night, combined setlist | `RunDetailView` | `RunPage` (`RunIndex`, `fixtures/runs/`) | Native 4-6 | | none | |
| Tours list | `app/tours/page.jsx` | `ToursListView`: search, sort, band filter, favorites only | Native 4-6 | | none | |
| Tour page: stops you caught, first stop, venues, countries, unique songs, average rating, new songs on this tour, add more shows | `TourDetailView` | `TourPage`, `TourBrowseSheet` (`get-tour-shows` → `normalize-show`) | Native 4-6 | | | |
| Favorite a tour | `TourFavoriteButton`, `lib/favoriteTours.js` | `FavoriteToursStore` (same document and keys) | Native 4-6 | | none | |
| Tour info (active tour, recent tours, song analysis) | `TourInfoModal` (from Profile → Tour Info) | `TourInfoSheet`, from a tour page | Native 4-6 | | none (`get-artist-tours`, `get-artist-song-stats`) | |
| Empty states: "No runs yet", "No tours match that filter" | Yes | Yes | Native 4-6 | | | |

### 2.11 Venues (`/venues?venue=`, `/venue-dashboard`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Venue page: info, capacity, official website, your shows here | `VenueDetailClient` | `VenueScreen` (`VenueService`: `venues/{key}`) | Native 4-7 | | none | |
| Community ratings, average | Yes | Count and average (the web's `toFixed(1)`); accounts only | Native 4-7 | | none | |
| Rate a venue: overall, optional sub-ratings, review | `VenueRatingModal` (`venueRatings`) | `VenueRatingSheet` (same document id and fields); accounts only | Native 4-7 | | none | |
| Venue bucket list button | `VenueBucketListButton` | On the venue page (same `bucketListVenues` document); guests too | Native 4-7 | | none | |
| Venue photos (gallery) | `VenuePhotoGallery` | Grid and full-size viewer, read only; accounts only | Native 4-7 | | none | |
| Venue announcements | `VenueAnnouncements` | Read only; accounts only | Native 4-7 | | none | |
| Report a venue | `ReportVenueModal` | `ReportVenueSheet` (same reasons and fields); accounts only | Native 4-7 | | none | |
| Verify a venue (claim), Manage venue, venue dashboard (bio, capacity, photos, announcements) | `VerifyVenueButton`, `VenueDashboardClient` | The verified badge; "Verify this Venue" (⋯ menu) and "Manage Venue" (owner) open the web | Web by design (F-6) | | | |
| Empty state: "No shows here yet" | Yes | Yes | Native 4-7 | | | |

### 2.12 Wishlist (`/wishlist`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Your wishlists by artist; change artist | `WishlistView` | `WishlistHome` (setlist.fm band search), guests too | Native 4-9 | | none | |
| Star songs from the artist's catalog; songs you've seen; "You've seen everything" | Yes (`get-artist-song-stats`) | `WishlistArtistScreen` (same documents and keys) | Native 4-9 | | none | |
| Empty and error states ("Couldn't save — try again", "No catalog data") | Yes | Yes | Native 4-9 | | | |

### 2.13 Bucket list (`/bucket-list`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Shows: add, filter, tickets, mark attended, remove | `BucketListView` | `BucketListScreen`; past shows listed for "I went" | Native 4-10 | | none | |
| Add to Calendar | Yes (Google Calendar link) | EventKitUI event editor, all day | Native 4-10 | | none | |
| Share with friends (text, `navigator.share`) | `BucketListView` | Share sheet, the same text | Native 4-10 | | none | |
| Venue bucket list: add, remove, "We'll notify you…" | `VenueBucketListSection` | Venues part; each opens its venue page | Native 4-10 | | none | |
| Empty states | Yes | Yes | Native 4-10 | | | |

### 2.14 Festivals (`/festivals`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Your festivals list, filters, empty states | `FestivalListView` | `FestivalsScreen`: newest first, show counts, band/venue/name filter and a year menu, empty and offline states | Native 5-3 | M | none | 5 |
| Festival page: stats (shows, artists, days, average rating), artists, shows | `FestivalDetailView` | `FestivalScreen`: tiles from `FestivalStats` (`fixtures/festivals/stats.json`), artists and shows by day | Native 5-3 | (same PR) | | 5 |
| Attach shows ("Pick from my shows"), remove from festival | `AttachShowsModal` | `AttachShowsSheet`, swipe to remove; `festivalId` alone (`ShowsStore.setFestival`) | Native 5-3 | S | none | 5 |
| Lineup (read) | Yes | Shared lineup with its credit, or the typed one; `festival-lineup` for an upcoming festival | Native 5-3 | S | | 5 |
| Festival notes | Yes | `FestivalNotesSheet` (one `updateData` of `notes`) | Native 5-3 | S | none | 5 |
| Create a festival, or join one someone else created | `FestivalFormModal`, `match-festivals` | `FestivalFormSheet` (matches with Join; the creator's edit too), `festivals.js` | Native 5-4 | M | Confirmed (STAGE5-AUDIT): the web writes `festivals` from the client; create, join, leave and edit move to `festivals.js` (5-2) | 5 |
| Leave a festival (shows kept) | `LeaveFestivalModal` | `festivals.js` `leave`, with the web's wording | Native 5-3 | S | | 5 |
| Search the lineup ("Find who played", setlist.fm) | `FestivalLineupModal`, `search-festival-lineup` | `LineupSearchSheet`; import through `normalize-show` preview and commit (`ShowsStore.importLineup`) | Native 5-4 | M | none | 5 |
| Your picks (lineup ranked by band affinity), enter lineup | `FestivalPicks`, `band-affinity` | `FestivalPicksSection` from `festival-lineup` `picks`; `LineupEditorSheet` (`myLineup`) | Native 5-4 | M | Picks scored on the server in `festival-lineup` (STAGE5-AUDIT call B) | 5 |

### 2.15 Community (`/community`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Top show-goers, top raters, top rated songs, top venues | `CommunityStatsView`, `community-stats` | `CommunityScreen`: top five of each, blocked people left out, a name opens their card, "Add" sends a request (a guest's asks for an account) | Native 4-11 | | none | |
| Totals (users, shows, songs) | Yes, user count through `shouldShowUserCount` | `Community.totals`; `UserCount` checked against `fixtures/user-count/threshold.json` | Native 4-11 | | none | |
| Empty states | Yes | Yes, plus no-document and offline | Native 4-11 | | | |

### 2.16 Discover (`/discover`, hidden)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Bands you might like, not interested, bring back, fans also see | `DiscoverView`, hidden behind `DISCOVER_NAV_ENABLED` | None | Flag F-4 | | | |

### 2.17 Friends, activity, invites

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Friends list, remove, block | `FriendsView` | Friends tab | Native #446 | | | |
| Requests: accept, decline; sent requests, cancel | Yes | Yes | Native #446 | | | |
| Add by email or handle | Yes | Yes | Native #446 | | | |
| Invites by email: send, resend, cancel; invite link (`/invite`) | `InviteView` | Yes | Native #446 | | | |
| Show tags: "Were you there together?" | Yes | Yes | Native #448 | | | |
| Tagged shows waiting for someone to join | Yes | Yes | Native #448 | | | |
| Shows Together (`/friends?together=`) | `ShowsTogetherView` | Yes | Native #448 | | | |
| Referral links (`/?ref=`) credited on sign-up or upgrade | `AppContext` | Yes | Native #451 | | | |
| Activity feed (`/activity`) | `ActivityFeedView` | Newest three on Friends, `ActivityScreen` with filters and paging | Native 6-6 (4.0.50) | M | `friends.js` `activity` and `rated` (5.60.38, 6-2a) | 6 |
| "Show my activity to friends" setting | Profile | Me → Activity feed | Native 6-6 (4.0.50) | S | none | 6 |

### 2.18 Notifications (`/notifications`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Inbox, mark all read, presale codes, "See the event" | `NotificationCenter` | Yes | Native #449 | | | |
| Push registration, tap to open | Capacitor push | Yes | Native #450 | | | |
| Push offer after a follow | `PushOfferModal` | Yes (flag-gated, off) | Native #451 | | | |
| Alert settings: four alerts × push, email, in-app; replies and likes | `NotificationSettings` | Yes | Native #451 | | | |
| On-sale settings: home city, radius, time zone | `OnsaleAlertSettings` | Yes | Native #451 | | | |
| Upcoming anniversaries calendar | `AnniversaryCalendar` | None | Missing | S | none | 6 |
| Empty states: "No notifications yet", "No band alerts yet" | Yes | Yes | Native #449 | | | |

### 2.19 Profile and Me (`/profile`)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Profile hero: shows, artists, venues, friends | `ProfileHero` | Stats tab | Native #441 | | | |
| Achievements (First show, Centurion, Venue hopper…) | `app/profile/page.jsx` | None | Missing | S | none | 6 |
| Average show rating | Yes | None | Missing | S | none (server stats) | 4 (with Stats) |
| Display name, photo URL | Yes | Yes | Native #442 | | | |
| Handle: claim | Yes | Yes | Native #442 | | | |
| Public profile on or off | Yes | Yes | Native #442 | | | |
| Preview of the public profile ("what strangers would see") | Yes | None | Missing | S | none (open `/u/<handle>`) | 6 |
| Leaderboard opt-out | Yes | Yes | Native #442 | | | |
| Bands you follow | Yes | Yes | Native #451 | | | |
| Recent shows | Yes | Shows tab | Native #432 | | | |
| "My Comments" (your show notes, each → the show) | Yes | None | Missing | S | none | 6 |
| Email preferences | Yes | Yes | Native #442 | | | |
| Delete account | Yes | Yes | Native #425, #443 | | | |
| Connected accounts | none | Yes | Native #442 | | | |
| Help and support: Community Guidelines, How to Use, Send feedback | Links | How to Use (web link), Terms, Privacy | Partly; see §2.21 | | | 6 |
| Request a copy of your data | Email to support | Email to support | Native #442 | | | |

### 2.20 User content (`/setlist-photos`, `/meetups`, show media)

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| Upload photo or video (YouTube link), captions | `UploadMediaModal`, Storage, `moderate-content` | `MediaUploadSheet`: library picker, HEIC → JPEG, MOV → MP4 under 10 MB, a caption each | Native 6-4 (4.0.49) | L | none: the same Storage paths and rules | 6 |
| Media gallery, zoom, next/previous | `MediaGalleryView` | `MediaViewer`: swipe, pinch and double-tap zoom, video, YouTube opens YouTube | Native 6-4 (4.0.49) | (same PR) | | 6 |
| Like, report, delete own | Yes | Yes | Native 6-4 (4.0.49) | (same PR) | `engagement-notify` `liked` (5.60.38) | 6 |
| Setlist photo directory, search | `SetlistPhotoDirectory` | `SetlistPhotosScreen`, the Library row | Native 6-4 (4.0.49) | M | none | 6 |
| Meetups: create, join, leave, edit details, discussion, delete message | `MeetupDetailView`, `lib/meetups.js` | Notifications open `/meetups` on the web | Left out of native (decided 2026-11-19); stays on the web | | `meetups.js` and the `attendeeNames` rule (6-2a) | |

### 2.21 Help, feedback and roadmap

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| How to Use, FAQ | `/how-to-use` | Web link | Web link | M | none | 6 (flag F-7) |
| Send feedback: type, category; idea goes on the roadmap | `FeedbackView` (`feedback`, `roadmapItems`) | None | Missing | S | none (rules allow it); stays email-free (security invariant) | 6 |
| Roadmap, vote, "Most requested" | `RoadmapView` (`roadmapItems`, transaction) | Roadmap notifications link to the web | Web link | S | none | 6 |
| Release notes | `/release-notes` | None | Missing | S | none | 6 (flag F-5) |
| Terms, Privacy, Community Guidelines | Web pages | Terms and Privacy as web links | Web link | S | none | 6 (add Community Guidelines; flag F-12) |

### 2.22 Posters, share images, Year in Review

| Item | Web / Capacitor | Native today | Status | Size | Server work | Stage |
|---|---|---|---|---|---|---|
| My poster (`/my-poster?artist=`): your most heard songs for a band, sort, add setlist | `MyPosterView`, `my-poster` | None | Missing | M | none | 6 |
| Poster share: download image, share link | `PosterShare`, `heard-share`, `public-poster` | None | Missing | (same PR) | none | 6 |
| Save to "Songs I've heard" | `HeardSaveModal`, `heard-import` | None | Missing | S | none | 6 |
| Year in Review page: top bands, top songs, rare ones, show buddy, highlights (rarest catch, bust-outs, shows together, first and last show, busiest month, longest run), recap card, year picker, "Missing a show? Add it" | `YearRecapView` (server-written `recap`) | Web link (C-9) | Web link | L | none (the server writes `recap`) | 6 (flag F-13) |
| Year in Review share image: share, download, email, X | `ShareYearInReview` (drawn in the browser) | None | Missing | M | none (native draws its own with `ImageRenderer`) | 6 |

### 2.23 Public and SEO pages (not app screens)

Landing page, `/compare/*`, `/switch/*`, `/best-concert-tracker-apps-jam-bands`, public profiles (`/u/<handle>`), public show pages, public band pages (`/artist/...`), shared collections (`/shared`), public posters and Heard images, `/privacy`, `/terms`, `/cookies`, `/reset`. **Web by design:** native shares links to them, and they open in Safari. No change.

### 2.24 Admin (excluded)

`/admin`, `/admin/venue-verifications`, and the native debug rows (test push, first-launch report, Developer screen). Out of scope by the requirement.

---

## 3. Where exact parity is a bad idea: flags for Phillip

Each flag has a recommendation. **Decided 2026-11-17:** every recommendation is accepted except F-9, where playlists are left out of native instead.

**F-1. A home for the secondary screens.** Native has four tabs and Search. Tours, Runs, Songs, Venues, Festivals, Wishlist, Bucket List, Community, Setlist Photos and Activity need a way in, like the Capacitor menu drawer. **Recommend:** don't add a drawer, which isn't an iOS pattern. Instead:
- a **Library** section at the top of Me: Tours, Runs, Festivals, Wishlist, Bucket List, Setlist Photos;
- **Community** on Stats;
- **Activity** on Friends;
- songs, bands and venues reached from where they appear.

On a wide iPad window the sidebar (`.sidebarAdaptable`) can list them all.

**F-2. What the Search tab is.** In the Capacitor app, Search is the add-show search. Native puts that under +. **Recommend:** Search becomes advanced search over your own shows (§2.6), with saved and recent searches. Native search over setlist.fm stays under +.

**F-3. "Hours of live music."** The web shows shows × 2 as an hours figure. C-4 dropped it from native because it's a guess presented as a number. **Recommend:** keep it dropped, and remove it from the web too (one line), so both apps show the same tiles. The alternative is a server field labelled "about N hours".

**F-4. Discover and "Fans also see".** Both are hidden on the web (`DISCOVER_NAV_ENABLED` off since 5.60.2). **Recommend:** not part of parity. Build them natively only when the web turns them on, behind the same config switch.

**F-5. Release notes and What's New.** `/release-notes` is the web's changelog in web version numbers (5.60.x); native has its own versions (4.0.x). Copying it would show native users web release numbers. **Recommend:**
- a short native What's New sheet per native release, from a JSON file in the repo;
- Release Notes stays a web link.

**F-6. Venue owner tools.** Verify a venue, Manage venue, the venue dashboard, and venue photo and announcement management. These are for a few verified venue managers, who reach them from a computer. **Recommend:**
- native shows venue photos, announcements and the verified badge;
- "Manage venue" and "Verify this venue" open the web.

Exact parity here is a large form-heavy build for very few people.

**F-7. How to Use.** The web page describes the web and Capacitor UI (menu drawer, swipe gestures, tabs that native doesn't have). **Recommend:** a native How to Use screen with content written for the native app, from a JSON file in the repo so it can change without a release. Copying the web page would tell native users to tap things that aren't there.

**F-8. Haptics.** The web adds haptics only to its own swipe gestures, which native gets from the system. There's nothing to copy. **Recommend:** native adds `.sensoryFeedback` in a few places that suit iOS: saving a rating, a show added, follow. This is small and goes in with Stage 6.

**F-9. Playlists.** The web uses Spotify's web sign-in and an Apple Music web token. **Recommend:**
- Apple Music natively with MusicKit (better: no sign-in sheet, uses the phone's own subscription);
- Spotify through `ASWebAuthenticationSession` against the existing `spotify-token` function, which needs a native redirect URI registered with Spotify.

**Decided:** not accepted. Playlists are left out of the native app and out of the plan. The show page has no playlist button, and there's no web link in its place.

**F-10. CSV and Excel import.** The web parses the file in the browser. A Swift copy of the parser, column matching and date-format guessing would be a second implementation to keep in step, which CLAUDE.md steers away from. **Recommend:** a server function that parses the file with the web's own code and returns the rows, and a native file picker and review screen on top. The alternative is to keep it a web link, since most people import from a computer.

**F-11. "Songs I've heard" tool.** It's a web tool, and the Capacitor app opens it in the browser too. **Recommend:** native links to it the same way (this is parity, not a gap). Revisit only if the tool becomes an app screen on the web.

**F-12. Legal pages.** **Recommend:** Terms, Privacy and Community Guidelines stay web pages in `SFSafariViewController`. They're documents, the same text everywhere, and Apple accepts links. Add the missing Community Guidelines link.

**F-13. Year in Review timing.** The recap peak is Dec 2 to mid-January, and DECISIONS says no cutover in that window. A native Year in Review can't be ready by Dec 2 alongside Stages 4 to 6. **Recommend:**
- the 2026 season keeps the web link (C-9 as it is);
- native Year in Review is built in Stage 6;
- cutover follows parity, after the peak (late January).

**F-14. Calls that stay, because the web doesn't have the feature either:**
- avatar upload and bio (C-6);
- data export (C-1);
- a native-only song rating on the show page (native has more here, not less).

Parity doesn't add these.

**F-15. Per-year stats (C-3).** The web's Stats page has a year picker. C-3 put "this year" stats on the v1.x list pending a per-year server block. Parity now needs it. **Recommend:** build the per-year block in `userStats` in Stage 4's server PR, not on the device, per "the numbers people see are computed on the server".

---

## 4. Proposed plan

The order stays: Stage 4, then Stage 5, then a new **Stage 6 (parity)**, then internal TestFlight and cutover. Each stage opens with an audit PR as Stages 1 to 3 did. The per-stage audits can be short, because this document is their inventory.

**Version rules** are those in CLAUDE.md:
- a native-only PR bumps only the native version;
- a server PR also bumps the web and Capacitor versions.

The numbers below are placeholders: each PR takes the next free number from `main` when it opens. #451 holds native 4.0.25.

### Stage 4: library screens (grown)

| PR | Contents | Kind |
|---|---|---|
| 4-1 | **Stage 4 audit.** Confirms the server needs below and the F-1 navigation. | docs |
| 4-2 | **Server:** per-year block in `userStats` (F-15); the welcome email from `normalize-show`; "Hours of live music" off the web's Stats page (F-3); fixtures for runs (`lib/runIndex.js`), the song key and gaps, and the user-count threshold. | server (web + Capacitor + native bump) |
| 4-3 | **Navigation:** the Library section, Community on Stats (F-1); the guest's first-show account prompt. | native |
| 4-4 | **Songs and listening:** the full song list and the song page; "Listen to this night" and "Where to stream this show" (moved from 6-8, 2026-11-18). | native |
| 4-5 | **Bands:** the band page from the public snapshot, the band song page, artist info. Replaces the #451 stand-in. | native |
| 4-6 | **Runs and tours:** run page, tours list, tour page, favorite tours, tour info; show-page links for tour, run and venue. | native |
| 4-7 | **Venues:** venue page, community ratings, rate a venue, photos and announcements (read), report; manage and verify open the web (F-6). | native |
| 4-8 | **Stats:** year picker, monthly heatmap, full artist, venue and song lists, top-rated shows, average rating, runs list. | native |
| 4-9 | **Wishlist.** | native |
| 4-10 | **Bucket list:** shows and venues, Add to Calendar, share. | native |
| 4-11 | **Community.** | native |
| 4-12 | **Search tab:** advanced search, saved and recent searches, the "By artist" view (F-2); add a whole tour (`TourBrowseModal`'s flow). | native |

### Stage 5: festivals (full)

| PR | Contents | Kind |
|---|---|---|
| 5-1 | **Stage 5 audit.** Includes whether festival create and join move to the server (today the web writes `festivals` from the client). | docs |
| 5-2 | **Server, if the audit says so:** festival create, join and leave actions. | server |
| 5-3 | **List and festival page:** attach and remove shows, lineup, notes, leave. | native |
| 5-4 | **Create and join** (`match-festivals`), **lineup search**, **your picks**. | native |

### Stage 6: parity (new)

| PR | Contents | Kind |
|---|---|---|
| 6-1 | **Stage 6 audit.** Covers the activity feed's reads (§2.17), the rules native needs for Storage and announcements, and the import parse function (F-10). | docs |
| 6-2 | **Server:** the import parse function; any rules change from 6-1. | server |
| 6-3 | **Comments** on shows: post, reply, like, delete, report. | native |
| 6-4 | **Photos, videos, posters and setlist photos** on shows: upload, gallery, like, report; the setlist photo directory. | native |
| ~~6-5~~ | ~~**Meetups.**~~ Skipped: meetups are left out of native and stay on the web (decided 2026-11-19). | — |
| 6-6 | **Activity feed** and the "Show my activity" setting. | native |
| 6-7 | **Imports:** screenshot import and CSV/Excel import (F-10). | native |
| 6-8 | **Show extras:** play counts, archive backfill card, "Relive this night" card, the anniversary calendar. | native |
| 6-9 | **Posters:** my poster, share image, share link, Save to "Songs I've heard". | native |
| 6-10 | **Year in Review** natively, with its share image (F-13). | native |
| 6-11 | **Profile and help:** achievements, notes list, public profile preview, feedback, roadmap and voting, How to Use (F-7), What's New (F-5), announcements popups, Community Guidelines link, guest banner, haptics (F-8). | native |
| 6-12 | **Parity check:** this table re-run against the build, every row native, web by design, or a decided flag. | docs |

Then **internal TestFlight and cutover** (DECISIONS, Build order item 6), after the Year in Review peak.

### What changed in DECISIONS.md

Done 2026-11-17, in "Parity before launch" and in notes on each call it reverses:

- **"v1 scope":**
  - Festivals become full;
  - screenshot and CSV import become v1;
  - comments, photos and meetups become v1;
  - "Any v1.x screen opens its web page" becomes "only the screens §3 keeps on the web".
- **Build order:** add Stage 6 and move cutover after it.
- **Stage 1:** "No web links inside the show screen" gains the new show-page sections.
- **Stage 2:**
  - C-3 (per-year stats) is reversed;
  - C-4 ("Hours of live music") per F-3;
  - C-9 per F-13.
- **Stage 3:** C-4 (comments, photos and meetups stay on the web) is reversed.
