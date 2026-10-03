# Changelog

All notable changes to mysetlists.net are documented here.

---

## [5.42.0] — 2026-10-03

### New: search without an artist, and add every result at once

- **The artist is optional on Search → Search by Show.** A venue or a
  city, with or without a year, is a search of its own: "Madison Square
  Garden" + 2024 lists every show there that year, across artists.
  `netlify/functions/search-setlists.js` now accepts a venue or city
  without an artist. A year on its own is still refused (400) because
  that's every show on setlist.fm for twelve months. The form's button
  stays disabled until there's an artist, venue or city, and reads
  "Search Shows" when there's no artist. Enter in any field now runs the
  search. Before, Year and Venue did nothing until an artist was picked.
- **Add all.** Search results with more than one show get an "Add all N"
  button (signed-in accounts only; guest shows are added one at a time).
  It fetches every page of the search one at a time, 600 ms apart, to
  stay inside setlist.fm's rate limit. The cap is 10 pages / 200 shows,
  and it says so when a search has more. It then opens a review grouped
  by venue: setlist.fm matches venue names loosely, so "Madison Square
  Garden" also brings back the Hulu Theater at Madison Square Garden, and
  each venue can be unticked. Shows already in the account are excluded
  and counted. Confirming writes through `addShowsFromTour`, the same
  throttled, de-duplicating bulk add the tour browser uses, so the shows
  are identical to ones added one at a time.
- Paging and Add all use the query that produced the results on screen,
  not whatever the form says after it was edited.
- Shared helpers in `lib/setlistSearch.js` (`hasSearchTarget`,
  `setlistToShowData` — now also used by the single Add Show button,
  `fetchAllSetlistPages`, `groupShowsByVenue`), with unit tests in
  `lib/__tests__/setlistSearch.test.js`. Integration tests cover a
  venue + year search with no artist and the year-only 400.

---

## [5.41.0] — 2026-10-01

### Added: one show filter on My Shows, Stats, Tours and Festivals

- The My Shows filter (text search on artist or venue, Year, single date)
  is now one component, `components/shows/ShowFilters.jsx`. It includes the
  collapsing "Filters" toggle with a count badge on phones. The matching
  logic moved out of `AppContext`'s `sortedFilteredShows` into
  `lib/showFilters.js` unchanged, and that memo now calls it, so My Shows
  filters exactly as before. Page-specific controls sit in the component's
  two slots: `actions` and `children`.
- **Stats** (overview): the breakdown tabs, the period tiles and the
  heatmap are all computed from the filtered shows. `getSongStats`,
  `getArtistStats`, `getVenueStats` and `getTopRatedShows` take an optional
  show list. `useStatsPeriod` takes an optional source list, and falls back
  to the newest remaining year if the selected one is filtered out.
  - The separate Songs-tab Artist/Venue/Year filter in `StatsView` is
    replaced by the shared one. A show opened from Stats still sees the
    whole library (`allShows`) for its play counts and runs.
- **Tours**: the list is rebuilt from the filtered shows, so a filter
  narrows both which tours show and their stop counts. The tour page
  itself always uses the full index.
  - The shared filter replaces the Tours search and Year select. The
    tour-only Artist select, Favorites and Sort stay in the slots.
  - Search now matches artist or venue, as on My Shows, not tour name.
- **Festivals**: with a filter on, only festivals with a matching show are
  listed, and each count is the matching shows.
- Every option applies on every page, so none are hidden.

### Changed: a song played twice in one show counts once

- "Times seen" is now the number of distinct shows a song was played at.
  A sandwich (song > other song > song) or a reprise counts once. The rule
  lives in `lib/songCounts.js` and is used by:
  - Stats → Songs (`buildSongStats`)
  - the song index (`timesSeen`, and gaps now measured between shows, so a
    sandwich no longer produces a −1 longest gap)
  - the show page's "Seen N×" pills
  - the artist page's "Songs I've Seen"
  - Year in Review's most-seen song
- The setlist editor and the song history modal already counted per show.
  Stored setlists are untouched, and both occurrences still render in the
  setlist and in a song's performance list.

### Fixed

- **archive.org link uses YYYY-MM-DD.** `getStreamingPlatforms` normalizes
  the show date with `toIsoDate` before building any link. Ticket-scanner
  shows store setlist.fm's DD-MM-YYYY. The same fix covers the Relisten and
  PlayDead links, which had the same bug.
- **Public profile links.** `/u/{handle}` pages are Netlify functions, not
  app routes, so the Activity feed's relative `/u/…` links were dead in the
  iOS app. They are now absolute and open via the Capacitor Browser plugin
  (`lib/publicProfile.js`). Profile gains Open and Copy link buttons for
  your own public page. `public-profile.js` and `public-show.js` now
  format and sort DD-MM-YYYY dates correctly (`isoDate` /
  `formatShowDate` in `netlify/functions/lib/publicPageHtml.js`).
- **Password reset copy.** The "check your email" screen no longer says
  whether an address has an account, and the unreachable "No account found
  with this email" error is gone. Firebase email-enumeration protection is
  on for the project.

### Removed

- **"Select shows" on My Shows**, and everything that only it used:
  - selection state and the bulk action bar
  - `ArtistShowsRow`'s checkbox mode
  - `TagFriendsModal`'s bulk mode
  - `bulkTagFriendsAtShows` and the `skipEmail` option on
    `tagFriendsAtShow`
  - the `bulkShowTagNotification` email template

  Festival bulk-select is unchanged.
- **The landing page footer's "Product" column** (Browse shows, Artists,
  Venues, Stats). The pages themselves and the signed-in navigation are
  unchanged.

### Changed: landing copy and logo size

- "Built for the fan who calls the opener."
- The "Auto-import your shows" description and Step 01 both read "Scan a
  ticket, upload a photo of past ticket purchases, or search for a show".
- The Pick + wordmark lockup is 10% larger on the mobile header, the
  sidebar and the landing nav. The sizes live in one place,
  `BRAND_LOCKUP` in `components/brand/Wordmark.jsx`.

---

## [5.40.0] — 2026-09-27

### Changed: My Shows fits a show above the fold on phones

- **The first show card is now fully visible on load on a phone.** At
  390×844 its bottom edge moved from ~1035px to ~587px on the web (~634px
  in the iOS app with safe areas, against 810px of usable height), and it
  also fits on a 375×667 iPhone SE. Everything below is phone-only (below
  `md:`) — the desktop layout is pixel-identical at 768px and 1280px.
  - Tighter spacing in the page header (new `compact` prop on
    `PageHeader`), and the two action buttons now share one row.
  - **Smaller stats**: Shows / Artists / Venues / Avg Rating are one
    four-across row with an 18px figure (was a 2×2 grid at 22px), via a new
    `compact` prop on `StatFigure`. Desktop keeps the original sizes.
  - **Filters collapse**: the search/year/date/sort/saved-search card sits
    behind a "Filters" toggle, collapsed by default on phones. A count
    badge shows how many filters are applied, and they keep applying while
    the panel is closed. The toggle is a `button` with `aria-expanded` /
    `aria-controls`. Always open on desktop, as before.
- **The "Invite Friends" button is gone from My Shows.** Inviting is still
  on Profile and at `/invite`.

### Changed: Festivals moved up in the menu

- The sidebar and the mobile menu (one list, `components/layout/Sidebar.jsx`)
  now read Tours → Festivals → Wishlist → Bucket List.

### Removed: Upcoming

- **The Upcoming page and its nav entry are gone.** `/upcoming` now
  redirects to My Shows: a 301 in `netlify.toml` on the web, and a
  client-side redirect in `app/upcoming/page.jsx` for the iOS app, which
  never sees Netlify's rules. Also removed: `components/UpcomingShowsView.jsx`,
  the unused `components/upcoming/UpcomingItem.jsx`, the
  `upcomingShowsBadgeCount` state in `AppContext`, the How to Use section,
  and the Upcoming row in the landing page's app mock-up.
- **Kept, because other features use them:** the per-artist Upcoming Shows
  panel (`components/UpcomingShows.jsx`, in My Shows' expanded By artist
  rows and in `SetlistEditor`, used by Shows Together and Admin), the `ticketmaster-events` / `seatgeek-events` functions,
  the `ticketCache` collection and its rules, and `TICKET_CACHE_TTL` /
  `mergeTicketEvents` / `formatTicketDate`. No Firestore data was touched.

---

## [5.39.0] — 2026-09-26

### New: Saved searches, on My Shows

- **A search you save in Advanced Search now shows up on My Shows too**, as
  a toggle button next to the Sort row (Sort: Artist / Rating · Saved: your
  search names). Tapping one filters the list right there using that
  search's full criteria (artist, venue, date range, tour, festival,
  rating, friend, notes, setlist song) — not just the simple text/year
  filter the page already had — and tapping it again turns it back off.
  Previously a saved search only did anything from the Advanced Search
  page itself.
- Applying a saved search clears the simple search/year/date filter (and
  vice versa) — they're two different filtering systems under the hood
  (`lib/advancedSearch.js` vs. the context's plain text match), so mixing
  them silently would produce results neither system actually asked for.
  The "By artist" table view and the Timeline/By-artist tab switcher are
  hidden while a saved search is active, the same way Advanced Search's
  own results are a single list rather than tabs.
- "Clear" now also turns off an active saved search, and "Select shows" /
  "Select All" now selects what's actually on screen rather than
  whatever the plain filter would have shown underneath it.

---

## [5.38.2] — 2026-09-26

### Changed: Tagline

- **"Your Show History" is now "Track All Your Shows."** Updated everywhere
  it appeared as the standalone tagline: the sidebar/drawer lockup under the
  wordmark, `public/logo.svg` (embedded live in every transactional and
  announcement email via `netlify/functions/lib/emailLayout.js`'s
  `LOGO_URL`), the PWA manifest's app name, and the page `<title>`/Open
  Graph/Twitter metadata in `app/layout.jsx`. Left alone: body copy that
  happens to use the words "show history" in a sentence rather than as the
  tagline (the landing page, How to Use), and the historical changelog
  entry recording when the browser tab title was first set to the old
  wording — that's a record of the past, not a live string.
- **"track every show you've ever been to" is now "track all your
  shows"** in the transactional-email footer. Fixed in the one shared
  place (`emailLayout.js`'s `wrapEmail()`, used by the unsubscribe page,
  the admin announcement sender, and others) plus two functions that build
  their own email HTML independently rather than going through it
  (`venue-bucket-list-notifications.js`, `anniversary-notifications.js`).

---

## [5.38.1] — 2026-09-26

### Changed: Back to the green color scheme

- **The brand color is green again, not gold.** At some point the app's
  accent color was recolored gold while the underlying tokens stayed named
  `--green-primary` / `--green-light` / `--green-subtle` — a rename that
  only ever touched the values, never the names. That's restored here,
  using the exact green (`#10b981` / `#10d98a`, Tailwind's emerald) still
  sitting untouched in `public/app-icon-1024.svg`, which had been orphaned
  since the gold rebrand and never actually shipped anywhere.
- Every place that read `--green-primary`/`--green-light`/`--green-subtle`
  (buttons, links, badges, borders, focus rings, the landing page's own
  duplicate token set in `components/LandingPage.css`) picks this up
  automatically. A handful of spots had hardcoded the gold independently of
  the tokens — mainly button hover/shadow states
  (`components/ui/Button.jsx`, `Sidebar.jsx`'s "Create account" CTA,
  `TicketScanner.jsx`, `ArtistPicker.jsx`) and the unsubscribe-page email
  template (`netlify/functions/unsubscribe.js`, which now matches the
  green `lib/emailTemplates.js` had been using the whole time and never
  needed touching) — those are fixed individually.
- The logo (favicon, `public/logo.svg`, the sidebar/header `<Pick>` mark)
  is recolored to match — same shape, same everywhere-else usage, just
  green instead of gold.
- The app icon and PWA icons (`public/icon-192.png`, `icon-512.png`, and
  the iOS `App Icon.png`) are regenerated in the same green, matching the
  live logo's teardrop shape — the compiled icon had actually drifted to a
  different silhouette entirely along the way, not just a different color.
- Not touched: the separate amber accent (`--amber`, used for "setlists"
  in the wordmark, debut badges, etc.) — that was never part of the green
  rename and stays as its own thing. `public/og-image.svg` (the social
  share preview) already carries its own green, from a still-earlier design
  generation with a different logomark and a slightly different shade —
  left alone since it was never gold to begin with, flagged here as a
  known minor inconsistency rather than silently fixed.

---

## [5.37.0] — 2026-09-24

### Removed: Bust-out badges

- **The "bust-out" flame badges are gone** — the show detail page, the song
  page, and the per-user sensitivity setting in Profile. The badge's gap
  count came from setlist.fm's ~200-most-recent-shows window per artist,
  which for any band with a real touring history is a small, silently
  shrinking slice of their catalog: a song that hasn't surfaced in that
  window looks identical to a song that was never played, so the badge
  either said nothing about a genuine bust-out or asserted an exact "N shows
  since last played" figure the window couldn't actually prove. On top of
  that, the show page and the song page computed it two different ways — one
  against the *band's* show count, the other against the *user's own* — so
  the same song could show as a bust-out on one page and not the other, both
  under the identical badge. Rather than patch a feature whose underlying
  data can't support what the badge claims, it's removed outright:
  `lib/bustOuts.js`, `hooks/useBustOutAnalysis.js`,
  `hooks/useBustOutSensitivity.js`, `components/profile/BustOutSettings.jsx`,
  and the setlist-import-time `bustout`/`bustoutNote` tagging in
  `admin-populate-setlist.js`. `get-artist-song-stats.js` stays — it's shared
  with the Tour Info modal's Songs tab and Wishlist — but no longer computes
  or returns the per-show `showDates` list that existed solely to feed this.

### Fixed: "All shows at this venue"

- **It's now a real, dedicated page** — a "Your shows at [Venue]" heading
  with a count, the same venue info dropdown you clicked in from, and your
  shows at that venue rendered as the standard show card, reused unchanged
  from My Shows. Previously the link was a plain anchor tag (a full page
  reload, not an in-app navigation) that dumped you back on the ordinary My
  Shows list with the venue name typed into the free-text search box — no
  dropdown, no heading, no count, and matched by a loose substring check
  instead of the venue-key matching the rest of the app already uses, so a
  differently-spelled or CSV-imported venue could silently fail to match.
  Reachable directly at `/shows/?venueKey=<key>`, survives a reload, and has
  its own back control on both the mobile header and desktop.

### Fixed: My Shows nav didn't clear the venue/artist filter

- **Tapping "My Shows" from a filtered view (via Top Venues, Top Artists, or
  the venue page above) now actually returns to the full, unfiltered list.**
  The filter lived in shared app state that a navigation to the bare list
  never told to reset — the code that seeds the filter from a `?venue=` /
  `?artist=` / `?year=` link only ever *set* it, with no corresponding
  "nothing in the URL, so clear it" branch. That's now symmetric: landing on
  `/` or `/shows/` with none of those params present clears the search term,
  year, date and the "filtered to X" breadcrumb in one place. The existing
  filtered entry points (Top Venues, Top Artists, tour/run/festival venue
  and artist links) are unchanged.

### Also fixed in passing

- `lib/navRoutes.js` was missing a `/shows/:id` entry, which is what its own
  test (`navRoutes.test.js`) was failing on — a pre-existing gap unrelated to
  the work above, fixed because it was blocking `npm run test:unit` from
  running past that file. The app itself never links to `/shows/<id>`
  (everything goes through `showHref()`'s `?show=` pattern, since a static
  export can't serve a dynamic route with a runtime id), but a raw
  `/shows/<id>` URL can still reach the client router directly on native,
  where there's no Netlify redirect to rewrite it first.

### Known, not fixed here

- `search-setlists.js` and `get-artist-song-stats.js` both fall back to a
  hardcoded setlist.fm API key when `SETLISTFM_API_KEY` isn't set. Pre-
  existing, out of scope for this change.

---

## [5.36.5] — 2026-09-20

The TestFlight build cut from this release is the first to carry 5.36.3,
5.36.4 and the navigation fixes below. The last upload, 3.1 (32), shipped
5.36.2, so everything in those three releases reaches the app for the first
time here.

### Removed: The Cookie Banner

- **The web no longer shows a cookie consent banner.** 5.36.1 hid it on the
  native build on the grounds that a binary shipping its own content sets
  nothing for the notice to govern; the website kept it. It is now gone from
  both. Sign-in state lives in IndexedDB and `localStorage` rather than in
  tracking cookies, so there was no non-essential storage left for the banner
  to ask about.
- `/cookies` stays where it is and the footer still links to it. Removing the
  prompt is not the same as removing the policy.
- The e2e helpers that existed only to click the banner out of the way are
  gone with it. `dismissCookieBanner` was load-bearing for any test touching
  the bottom of the sidebar, which the banner used to cover.

### Fixed

- Show navigation from My Shows, My Profile, comments, stats and search, which
  5.36.4 left either reloading the list or landing on a blank detail page.
- Profile action buttons no longer wrap out of alignment on a phone.
- The show detail page waits for Firestore instead of flashing "Show not
  found" on a direct link.
- Firestore offline persistence is enabled, so edits made on a flaky
  connection survive until they can sync — the cause of the changes lost in
  the app but not on the web.

---

## [5.36.2] — 2026-09-17

App Review rejected 3.1 (31) under Guideline 1.2 (Safety: User-Generated
Content) on 2026-09-17. Apple named five requirements; the app met one and a
half of them. This release is the other three and a half, plus the camera
permission bug.

### Added: Terms You Actually Agree To

- **Nobody had ever agreed to the Terms.** They existed at `/terms`, said the
  right things, and were reachable while signed out — and none of that is an
  agreement, which is what Guideline 1.2 asks for. An unchecked checkbox now
  sits above the sign-in options with a plain-language summary of the rules,
  and Sign in with Apple, Sign in with Google and the email form are all
  disabled until it is ticked. The flag lives on `AuthModal`, not on either
  form, so one gate covers all three providers and switching between Sign in
  and Sign up does not silently drop a consent already given.
- **Existing accounts are gated too**, at their next launch. "Agree before
  logging in" is not a requirement that can be satisfied for new registrations
  only. The gate is an early `return` ahead of the app shell rather than an
  overlay, so there is no live screen underneath to swipe or scroll past.
- Acceptance is parked in `localStorage` and flushed to the user's profile once
  sign-in completes — at the moment the box is ticked there is no account to
  write to, which is exactly what "before registering" means.
- Guest mode is deliberately not gated: every surface that shows another user's
  content already short-circuits on `guestMode`, so there is nothing for the
  terms to govern.

### Added: A Profile You Can Open, With Block On It

- **The app had no screen for another user's profile.** Blocking was reachable
  from the friends grid and from a checkbox inside the report sheet — so
  blocking someone who had commented on a show required already being their
  friend. Section 4 of the Terms already told users they could block "from
  their profile", which was not true.
- Tapping any name — on a comment, a photo, a meetup message, an activity row —
  now opens that person's profile with **Block** and **Report** on it.

### Added: Blocking Tells Us

- Guideline 1.2 asks that blocking notify the developer, not only that it hide
  content. It was silent. A block now files a record in the moderation queue
  and emails us, with a count of how many separate users have blocked that
  account — a pattern no single report shows.
- Blocking also clears what was still in flight between the two: a friend
  request either way, and any show tag one had put on the other. Unfriending
  alone left those behind, and each is a way back in.

### Changed: Ejection Now Ejects

- The ban action set a flag and stopped, and the confirmation dialog said so
  out loud: "They keep their account and their existing posts, but cannot post
  again." Apple's wording is "ejecting the user". It now also disables the
  Firebase Auth account, revokes its refresh tokens — without which a session
  already open elsewhere keeps working for up to an hour — and sweeps every
  comment, message and photo that account posted into an admin-only
  quarantine. Moved, not deleted: mass-deleting a history on one report is not
  reversible.
- An ejected account now sees an explanation and a support address rather than
  an app where every action fails with a permission error.

### Added: The 24-Hour Commitment Has Something Keeping It

- A scheduled job re-sends the list of anything still open after 12 hours —
  half the window, because a reminder at the deadline is a post-mortem. It does
  not escalate or auto-action: an automated moderation decision taken because
  nobody looked is exactly the kind that should never be automatic.

### Changed: The Filter Is Now A Gate

- Display names, public handles and meetup descriptions were filtered in the
  browser and then written straight to Firestore, which the rules permitted. A
  filter a client can skip is advice, not a gate. All three now go through the
  server, and the rules refuse a direct client write to every one of them.
- **The signup form never filtered the display name at all** — only the profile
  editor did. The fastest route to a slur on every comment and friend card in
  the app was to sign up with one.
- The name Apple hands back on first sign-in is filtered too. Apple's sheet
  lets the user edit it, so it is user-supplied text, not something the
  provider vouches for.

### Fixed: "Spicy" Was A Slur

- `spic` is on the wordlist and the suffix allowance turned "spices" and
  "spicy" into matches — in an app whose users are jam band fans, for whom
  "spicy" is everyday vocabulary for a good jam. This was live, and rejecting
  real comments.
- Compound insults sailed through in the other direction: "fuck" was blocked
  and "fuckwit" was not, likewise "shithead", "cuntface", "shithole". The
  suffix list only allowed inflections.

### Fixed: Nobody Could Ever Claim A Handle

- `handles/{handleLower}` had no rule in `firestore.rules`, and Firestore
  denies every path without one — so the client transaction behind "claim your
  handle" was rejected on every attempt since the feature shipped. Moving the
  uniqueness check to the server repairs it.

### Fixed: The Camera Prompt That Never Appeared

- The ticket scanner asked for camera and photo-library access at the same
  time, with a comment claiming that was the fix. It was the cause:
  `@capacitor/camera` fires both iOS requests concurrently from two threads,
  iOS shows one system alert per window, and the camera alert was the one
  dropped. The scanner then failed against a permission the user was never
  asked for.
- Permissions are now requested one at a time, for the source the user actually
  chose, at the moment they choose it. A refused permission offers a route into
  Settings instead of "please try again", which could never have worked — iOS
  will not show the prompt a second time.
- All three permission descriptions rewritten to say what is accessed and why.

---

## [5.36.1] — 2026-09-14

### Changed: Three Surfaces The App Store Binary Should Not Carry

- **The Buy Me a Coffee link no longer renders in the native app.** Guideline 2.1(b) reads a link out to a tip jar as a business model that was never reviewed, and it is the most likely reason the question was asked. It is gated on `isNativePlatform()`, not deleted — mysetlists.net and the installed PWA still show it, because neither is the binary under review. Both call sites render client-side only, so neither reaches the exported HTML and neither can flash before it is removed. There is no `/support` route to close off; the link existed only as two anchors.
- **The cookie notice no longer renders in the native app.** The content it would govern is bundled in the binary and the app sets no advertising or tracking cookies, so on device the notice described something that was not happening. The website still shows it exactly as before.
- **The app stopped naming Spotify and Apple Music.** `PLAYLIST_CREATION_ENABLED` has been `false` since 5.32.0 (#297), but the copy never moved with it: the signed-out landing page — the first screen a reviewer sees — carried a "One-click Spotify playlists" feature card, two data-source badges and two more mentions in body copy, all for a feature that cannot be reached. The copy now hangs off the same flag that gates the feature, so it goes and returns in step with it rather than drifting again.

### Fixed: A Link That Came Back Through The Back Door

- `EntityInfoPanel` labelled a link "Spotify" when the URL looked like one, and those links arrive from MusicBrainz at runtime under the generic type `streaming`. Dropping the label alone would have left the link on the page under a different name. The destinations are filtered out instead, so the panel is quiet about it rather than coy.
- `/spotify-callback` rendered "Connecting to Spotify…" to anyone who typed it, long after the OAuth flow that redirects there stopped running. With the flag off it redirects home.
- The invite email offered to "import shows from Spotify listening history" — a feature that was never built.

### Fixed: Every Modal In The App Threw On Open

- `components/ui/Modal.jsx` lost its `useSheetDrag()` call in 5.36.0 while the four values it returns — `sheetRef`, `backdropRef`, `scrollRef` and `dragHandleProps` — stayed in the markup. They became free variables, so **opening any Modal threw a `ReferenceError` before it painted**: the delete-account confirmation in `profile/ProfileView.js`, the block-user and bulk-action confirmations in `FriendsView.jsx`, and the photo directory. `if (!open) return null` meant a closed Modal rendered fine, which is why it survived a release — the crash needed someone to actually open one.
- Nothing caught it. There is no ESLint config in the repo, so `no-undef` never ran, and a free variable is not a build error. The bundle proves it: at the grabber `<div>`, the broken build emits `{...dragHandleProps,` verbatim while the fixed build emits `{...j,`. A minifier renames locals and cannot rename frees, so a name surviving intact there is a global lookup — and spreading an undeclared identifier throws.

### Changed: The Three Swipe Gestures Are Off

- Edge-swipe-back, sheet swipe-down and drawer swipe-close are disabled behind one constant, `TOUCH_GESTURES_ENABLED` in `lib/platform.js`. None of the three had run on a device, and each fires a haptic through `impact`, **which `lib/capacitor.js` has never exported** — so all three threw a `TypeError` partway through their commit handler, before the navigate, the dismiss or the close that followed. A gesture that strands an overlay on the deletion or moderation flow is the one failure this build cannot carry.
- Each gesture was already built with its own switch, so this is three guards and no restructuring. Every caller passes `enabled: isMobileViewport`, so the master switch is ANDed inside `useSheetDrag` and `useDrawerSwipeClose` rather than changed as a default, which would have had no effect.
- **Nothing else from the navigation work is affected** — the back control on every screen, the safe-area insets, 16px inputs and 44pt targets all stay. Each gesture was an enhancement over a control that still works by tap: `Modal` still closes by Escape, by its backdrop and by its close button, and the drawer by its own control. The release notes no longer promise a swipe the build does not do.
- To re-enable: export a real `impact`, flip the constant, and do the device pass.

### Note

- Nothing was deleted to achieve any of this. The token functions, the `spotify.com` entry in the moderation link allowlist and the reserved `spotify-callback` handle are all untouched; the allowlist in particular is what keeps a user's comment containing a Spotify link from being flagged as spam. Historical release notes are filtered at render, not edited — flipping the flag back on restores every entry word for word.

---

## [5.36.0] — 2026-09-13

### Added: Navigation Built For A Phone

- The navigation was designed for the web and shipped to a handset. On device there was no back gesture at all, and **nineteen routes had no back affordance of any kind** — `/activity`, `/friends`, `/notifications`, `/wishlist`, `/bucket-list`, `/setlist-photos`, `/scan-import`, `/meetups`, `/community`, `/advanced-search`, `/roadmap`, `/feedback`, `/how-to-use`, the four `/stats` sub-pages and more. In a browser the back button covered for that. In the Capacitor shell there is no browser chrome, so the only way off those screens was to open the drawer and pick somewhere else.
- **Swipe from the left edge to go back.** The content follows the finger, an iOS-style parallax shim trails behind it, and reversing mid-drag cancels. Committing fires a light haptic on native.
- **Swipe down to dismiss a bottom sheet**, and swipe left to close the nav drawer.
- **Every screen now has a header with a back control**, labelled with the parent screen's name where it fits. One component (`components/layout/MobileHeader.jsx`), mounted once, deriving what to show from the route — which is why nineteen screens gained a back control without being edited one at a time.
- Desktop and tablet are untouched. Verified rather than assumed: the six main routes were captured from `main` and from this branch at 1440×900 and compared at `maxDiffPixels: 0`. Pixel-identical.

### Added: A Gesture That Knows What Is On Screen

- **We deliberately did not enable `webView.allowsBackForwardNavigationGestures`.** It is the five-line version and it is the wrong one. It walks WKWebView history rather than app state, so its interactive preview animates a snapshot of the previous route — which, for a client-rendered static export, is stale or blank. iOS 17.5+ lands the gesture on the first history entry rather than the previous one. And fatally, it has no idea a modal is open: swiping with a sheet up navigates the page underneath and strands the sheet. Nothing in `ios/` sets it, and nothing should.
- Instead the gesture reads app state, through a new **dismiss stack** (`context/DismissStackContext.jsx`). Every overlay registers while it is open — one registration inside `components/ui/Modal.jsx` covers its fifteen call sites, and each of the fourteen ad-hoc `fixed inset-0` overlays registers for itself. On release the gesture closes the topmost overlay if there is one, and only then navigates.
- **"Can we go back?" does not come from `window.history.length`**, which in a Capacitor SPA is never zero and counts entries that are not ours — it would report "yes" on a cold deep link where going back leaves the app. The provider keeps its own stack of visited paths instead. It counts query-string navigations too, because `/songs?song=x` renders a song rather than the song list and `usePathname` cannot see the difference.
- **The five tab-bar roots plus `/` are floors.** You can never go back out of one; the gesture rubber-bands instead. There are no dead-end swipes off the app.
- On a cold deep link with no in-app history, the back control routes to a parent **derived statically from the route** (`lib/navRoutes.js`) rather than calling `router.back()` into nothing. `/venues/[venueKey]` was doing exactly that.
- The recognizer aborts inside a text field, inside `[data-no-swipe]`, inside a genuinely horizontally-scrollable ancestor, and whenever the keyboard is up. The scroller check tests `scrollWidth > clientWidth` as well as `overflow-x`, because several of this app's chip strips declare `overflow-x: auto` and fit anyway on a wide phone.
- `touch-action: pan-y` is applied only while a drag is claimed, never as a standing rule on the content wrapper. `touch-action` is intersected down the ancestor chain and a descendant cannot opt back in, so a permanent `pan-y` there would have disabled horizontal panning for the `Tabs` strip and every other scroller in the app.

### Added: Safe-Area Tokens, And One Inset That Was Counted Twice

- `env(safe-area-inset-*)` is now defined once in `app/globals.css` and consumed through the Tailwind spacing scale (`pt-safe-top`, `pb-safe-bottom`, `pt-header`), rather than being spelled out in each component.
- **The top inset was being applied twice.** `body` padded down by `env(safe-area-inset-top)`, and the content column then offset by `inset + 56px` on top of that — leaving roughly one notch of dead space under the header on a Dynamic Island device. `body` no longer pads the vertical insets; the header and the content column own them. The horizontal insets stay on `body`, because in landscape the notch genuinely eats into the content column.
- `100vh` and `h-screen` are `100dvh`/`h-dscreen` where the intent was "fills the visible viewport" — the sheet height calc in `ui/Modal.jsx` and the drawer in `Sidebar.jsx`. Not a blind find-and-replace: the eleven `min-h-screen` uses genuinely mean "at least a screen tall" and are unchanged.

### Fixed: A Delete Button You Could Not Reach On A Phone

- The per-show delete in `components/StatsView.jsx` was `opacity-0 group-hover:opacity-100`. On a touchscreen there is no hover, so it was invisible and unreachable — the control simply did not exist on a phone. It is visible by default below `md:` now, and stays hover-revealed on desktop where a pointer exists.

### Fixed: Focusing Any Input Zoomed The Whole Page

- `ui/Input`, `ui/Textarea` and `ui/Select` all set `text-[15px]`. Safari zooms the page whenever a focused field's font size is under 16px, so **every form in the app** — search, auth, ratings, notes, the setlist editor — jolted the layout on focus. They are 16px below `md:` and keep 15px from `md:` up, where the rule does not apply.
- `inputMode`, `enterKeyHint`, `autoComplete` and `autoCapitalize` appeared **zero times in the codebase**. An email field got the same alphabetic keyboard and the same capitalised first letter as a comment box. They are derived from the input's `type` in `ui/Input.jsx` — one table, ~60 call sites, each overridable — and set explicitly on the `/search` fields, which submit on Enter without being `type="search"`.

### Fixed: Controls Under 44pt

- `ui/Button` `sm` was ~32px tall and `md` ~42px; `ui/Tag` — the `/stats` period selector and every filter chip — was ~26px. All meet 44pt below `md:` via `min-h-touch`, with the padding, and therefore the desktop height, untouched. `Tag`'s remove button was a 16px target nested inside another one and now has a 44pt hit area without its 12px glyph changing size.
- Also raised: the setlist chip buttons in `ShowDetailView` (~30px, and 6px apart, under the 8pt minimum), the `SearchView` text buttons (~16px), the `/stats/songs` sort headers, the `ArtistAIChat` header controls, and the sort/clear controls that had no vertical padding at all.
- Tap delay and the iOS grey tap flash are gone globally, and interactive elements have a pressed state — on touch, press feedback is the only confirmation a tap registered.

### Fixed: The Empty Library Scrolled Sideways On A Phone

- The `animate-ping` halo on the "Search for a Show" button in the `/shows` empty state scales to 2× its element. The button is near full-width when that row stacks, so the ring's bounding box ran past a 390px viewport and gave the page a horizontal scroll. Kept from `sm:` up, where the button is narrow enough for the halo to fit.

### Changed: One Definition Of "This Is A Phone", And One Of The Keyboard Height

- There was no JS notion of a small screen at all — no `useIsMobile`, no `matchMedia`, no UA sniffing. Everything was Tailwind's `md:`. The gesture layer needs a JS answer, and two sources of truth that can drift is how a header ends up thinking it is on mobile while a gesture thinks it is not. `hooks/useIsMobile.js` is the one definition, derived from the same 768px `md:` uses.
- **`--keyboard-height` was written and never read.** `lib/capacitor.js` maintained it from the Capacitor Keyboard plugin and nothing in the app consumed it, while `ui/Modal.jsx` kept a second, unrelated `visualViewport` implementation that was the only one that actually worked — and only inside that one component. Both now live in `lib/keyboardInset.js`: the plugin on native, `visualViewport` on web, one custom property and one subscriber list.
- Standalone-PWA detection (`display-mode: standalone`) did not exist anywhere. It does now, and an installed PWA gets the full gesture set: there is no browser chrome, so the user has no back affordance of their own either.
- `@capacitor/haptics` had been a dependency since the iOS target was set up and was never called. It is now, once per committed gesture — never per frame, never on cancel.

### Note: Edge-Swipe-Back Is Off In A Mobile Browser Tab

- Native and installed-PWA get the left-edge gesture. An ordinary mobile browser tab does not, because iOS Safari and Chrome both own the left edge and a JS gesture competing with the browser's own back gesture is a fight the user always loses. Everything else — swipe-down sheets, drawer swipe-to-close, the headers, the safe-area and touch-target work — is on everywhere.
- It is one constant, `EDGE_SWIPE_BACK_IN_BROWSER_TAB` in `lib/platform.js`, so it is a one-line change if device testing says otherwise.

### Note: The Tab Bar Is Still Not Mounted

- `components/layout/MobileTabBar.jsx` has existed for some time and **nothing imports it**. The app has never shipped a bottom tab bar; the live shell is the inline `AppShell` in `app/AppProviderWrapper.jsx`, which renders the header and the drawer and no tab bar.
- Left dormant on purpose. Mounting it changes the app's information architecture, which is a product decision rather than part of a navigation fix. Its five routes are still treated as navigation floors, so the hierarchy it describes is real even though the bar is not rendered. Its safe-area and touch-target handling is now correct for whenever it is mounted, but page-level padding to keep content clear of it would still have to be added at that point.
- `components/layout/AppShell.jsx` is unused too, and is the only remaining importer of the stale `components/MobileHeader.jsx` duplicate. Both are labelled rather than deleted; removing them is unrelated to this work.

### Note: One Desktop Pixel Difference, And The Bug Behind It

- Desktop was verified rather than assumed: six routes captured from `main` and from this branch at 1440x920 and compared at `maxDiffPixels: 0`. Four are pixel-identical. **Two — `/stats/songs` and `/how-to-use` — differ by ~380 pixels in a 20x26 box**, which is the sidebar's 32px logo.
- The cause is a pre-existing bug rather than a layout change. `components/brand/Pick.jsx` hard-codes its gradient id, so two `<Pick>`s on one page both declare `mys-pick-g` and every reference resolves to whichever is first in document order. The gradient is `gradientUnits="userSpaceOnUse"`, so a 32px Pick borrowing a 24px Pick's gradient renders a subtly different fill — and that is what happened on **every** screen, because the old mobile header rendered a 24px Pick above the sidebar's 32px one.
- The new header shows a screen title instead of the wordmark on pushed routes, so on those the sidebar is now alone and uses its own, correctly-scaled gradient. **The new rendering is the correct one.** Tab roots still render both and are unchanged.
- Fixing the id properly (a per-instance id via React's `useId`) would alter the logo's rendering slightly on every route, desktop included, so it is deliberately not bundled into a navigation change. It is noted in the component.

### Note: What Is Tested, And What Needs A Device

- Playwright cannot drive a native-feeling pointer gesture, so the decidable half — both commit thresholds, the direction lock, every abort condition — is a pure function in `lib/swipeGesture.js` with 31 unit tests, and the route table has 21 more. `hooks/useEdgeSwipeBack.js` is then only plumbing.
- 16 Playwright tests cover what is driveable at a 390px viewport: the header's back control on pushed routes and its absence on tab roots, back from a cold deep link landing on the parent, no horizontal overflow, the sticky header not covering the content, and input font sizes.
- The feel of the gesture is still a physical-device check, and so is every overlay's swipe-down, a notched device against one without, and a sheet with the keyboard up.

---

## [5.35.0] — 2026-09-13

### Added: Delete A Song From A Setlist

- The setlist editor could move a song between sets and reorder it within one, but not remove it. An archive occasionally lists a song that wasn't played, a soundcheck creeps in, or you add one by hand and change your mind — and the only way out was to leave it there.
- The **Edit** button on a show's setlist now gives every song a delete control, alongside the existing up/down and set controls.
- **It asks twice.** The first tap arms the row — the icon becomes a red *Delete?* button, wider and explicitly labelled rather than the same icon again, so confirming is a deliberate act rather than a double-tap that happened to land twice. An armed row disarms itself after five seconds, because a delete button left armed on screen is a trap.
- **And it can be undone.** A deleted song takes its rating and its comment with it, and nothing else in the app holds a copy — an archive can supply the song again, never the 9/10 and the note that said why. So the removed song is offered back for twelve seconds, and restoring it puts it at the index it came from with its id, set, rating, comment and *added by you* flag intact. The banner names the rating that went with it, so the cost of the deletion is visible before the undo expires.

### Changed: One Rule For Removing A Song

- `deleteSong` in the app context already existed, used by the older Shows Together setlist editor. Rather than adding a second removal path beside it, that one now runs on a shared `removeSongFromSetlist` helper and reports what it removed and from where — so both screens delete a song the same way, and the new undo is possible at all.
- It no longer writes when there is nothing to remove. The save is a whole-array replace, so a no-op write from a double-tap or a stale view could stamp an old setlist over a newer one; a missing id now returns null and writes nothing.
- The removal splices rather than round-tripping through `groupSongsBySet`, which infers set membership from the `set` label *and array order*. Grouping on the way through could re-file a song's neighbours across a set boundary, and removing one song must change exactly one thing.

---

## [5.34.4] — 2026-09-12

### Fixed: Half A Library Worked, Split By Which Screen Added The Show

- **Show documents do not all store dates the same way.** setlist.fm's API returns `eventDate` as `28-05-2025` (DD-MM-YYYY). Every add path reverses that into `2025-05-28` before saving — except the **ticket scanner**, which stored it verbatim (`components/TicketScanner.jsx:202`). So a library contains both spellings, split by which screen added each show.
- That difference was invisible, because `parseDate` in `lib/utils.js` accepts both: such a show sorts correctly, renders correctly, and reads correctly everywhere in the app. And then the band-source lookup asked elgoose.net for `/setlists/showdate/28-05-2025`, which is not a date it has — or, after 5.33.0's validation, got a 400 from our own function for a date not in ISO form. Either way the show quietly kept its setlist.fm setlist, with no error to see.
- **Same artist, same archive, same button, two outcomes decided by which screen had added the show.** That is the "works on some of my Goose shows but not others" report, exactly.
- Fixed in four places, so it is closed from every direction: a `toIsoDate` helper in `lib/utils.js` built **on** `parseDate` rather than beside it (whatever date the app displays is the date it asks the archive about); the ticket scanner now saves ISO like everything else; the client normalizes before building the request; and `/api/band-setlist` accepts DD-MM-YYYY from any caller and works in ISO from there down — which fixes every already-deployed client, including an installed app version that cannot be updated.
- A date that cannot be read at all is now its own reported reason (`bad-date`) rather than an empty result, and the admin re-sync reports the conversion it made per show (`askedDate`) rather than hiding it.

### Note: The Stored Dates Are Not Migrated

- Shows added by the ticket scanner still hold `DD-MM-YYYY` in Firestore. Nothing needs them converted for setlists to work now — every lookup normalizes — and rewriting dates across a live library is a data migration that deserves its own dry run rather than riding along with a bug fix.
- Worth knowing while it stands: `admin-cleanup-duplicates` keys on the raw `date` string, so the same show saved once by the scanner and once by search would not be seen as a duplicate, and the My Shows date filter compares raw strings too.

---

## [5.34.3] — 2026-09-12

### Fixed: A Corrected Field Mapping Was Served Stale For Up To A Day

- The cache key was source + artist + date + venue, and a cached response is a snapshot of what the **adapter** produced rather than of what the archive sent. So every correction to a field mapping changed the meaning of every entry already stored — and those entries kept being served for up to 24 hours after the fix shipped.
- This feature shipped four adapter corrections in one afternoon (5.33.4's permalink fix, then 5.33.5's `jamchart_notes`, `song_id`, `original_artist` and `shownotes`). Any date fetched between them is cached against the old mapping, and whether a given show looks fixed depends on nothing more than whether anyone happened to ask for that date before the deploy. **That is exactly the shape of "it works on some shows and not others."**
- The key now carries a `CACHE_VERSION`, bumped whenever the adapters' output changes meaning. It costs one re-fetch per date and it is the difference between a fix being live and a fix being live eventually.

### Fixed: One Date, Two Bands

- `/setlists/showdate/<date>` is addressed by **date, not by artist**, and elgoose.net's Songfish instance carries Goose-adjacent projects alongside Goose itself. The adapter never filtered by artist, so a date where two of them played returned both, and the caller picked between them on venue alone — a coin flip between two different bands' setlists whenever the venue didn't disambiguate.
- Rows carry the artist, so the filter sits in the adapter, before grouping. It **fails open**: if it recognizes nothing, every row is kept and the result is exactly what it was before. The archive's `artist` and `artist_id` values aren't verified against a live response, and a filter that can't recognize its own artist must not turn a working lookup into an empty one.
- The artist filter is part of the cache key too, since it is now part of what the response contains.

### Fixed: Venue Spellings That Are Not Differences

- Disambiguating two shows on one date compared venue strings exactly. The stored venue comes from setlist.fm or from whatever the user typed; the candidate's comes from the archive. `Ascend Amphitheater` against `Ascend Amphitheatre`, `The Capitol Theatre` against `Capitol Theatre`, `Barclays Center` against `Barclays Centre` — all failures, and a failed venue match on a two-show date means the wrong setlist.
- British and American spellings are folded now, with punctuation and articles dropped. Not fuzzy beyond that: two genuinely different venues must still not match.
- And when no venue matches, the **fullest** setlist is returned rather than whichever the archive listed first. A festival day is usually one full set plus a sit-in, and returning the three-song guest spot over the sixteen-song set because of array order is the worse of the two wrong answers. It is still reported as ambiguous with every candidate attached, because it is still a guess.

---

## [5.34.2] — 2026-09-12

### Fixed: An Artist Name With A Qualifier On It Never Reached El Goose

- The registry matched artist names **exactly**, and that is the most likely reason three releases of El Goose work have produced nothing visible. A show stored as `Goose (US)` normalizes to the key `goose-us`, matches no entry, and resolves to setlist.fm — after which every part of the band-source path correctly does nothing. No button on the show, no rows in the admin re-sync, and **no error anywhere**, because resolving to setlist.fm is a legitimate answer rather than a failure. The same is true of `The Goose`.
- Artist strings pick up qualifiers by entirely ordinary means: setlist.fm disambiguates same-named acts with a parenthetical, imports and ticket scans carry "The" inconsistently, and a hand-typed show carries whatever was typed. So a second, looser key is tried **after** the exact one fails — bracketed qualifiers and a leading article removed, `Goose (US)` → `goose` — and it reports itself as `name-loose` rather than passing as an exact hit.
- Deliberately narrow. It strips qualifiers; it does not go fuzzy. `Goose Island`, `Mother Goose`, `Gooseberry`, `Goose & Friends` and `Phish Food` all still resolve to setlist.fm, and a **denied mbid still overrules a loose name match** — the loosening applies to the name heuristic only, never to the one piece of evidence that is trustworthy.
- One existing test changed: `The Phish` used to be asserted as a non-match. A leading article is a spelling difference rather than a different band — `scanForMissingSetlists` has always retried setlist.fm under both `X` and `The X` for exactly that reason — so it now matches, and the test says why it moved.

### Added: The Admin Re-Sync Names The Artist Strings It Scanned

- 5.34.1 made the re-sync distinguish "no Goose shows found" from "already in sync". That was the right distinction and still left the useful half unsaid: *which* artist strings were scanned, and what did each one normalize to?
- The report now carries every distinct artist string the walk saw, with its exact key, its loose key, whether it reached a band source and how it matched. When no show resolves, the panel prints that list — so `Goose (US) → goose-us / goose · setlist.fm · 7 shows` is a diagnosis you can read in one click instead of a zero you have to guess at.
- Capped at 40 distinct artists, so a large account reports its spellings rather than its whole library.

---

## [5.34.1] — 2026-09-12

### Added: A Re-Fetch Button On The Show Itself

- A Goose show logged before 5.33.0 keeps its setlist.fm setlist **forever**, and until now there was nothing in the app that would change that. *Find Missing Setlists* only looks at shows where the setlist is empty — which is correct, since it is a backfill for gaps and re-running it must never rewrite setlists people have been rating for months — and the admin re-sync added in 5.34.0 works an entire account at a time from a panel only an admin sees. Neither answers "this one show is showing the wrong source; fix it."
- So the setlist on a show page now carries a **Re-fetch from El Goose** button, for any show whose *artist* has a band source, whether or not that show's setlist came from one. Where the setlist is still setlist.fm's it reads *Get setlist from El Goose* and says what the swap gains — segues, footnotes, jam charts — and that ratings and hand-added songs are kept.
- It goes through the same merge rule as every other write, so pressing it cannot cost a rating, a note or a song added by hand. Re-fetching a setlist that is *already* from El Goose is worth doing too: these are reviewed archives that correct setlists after the fact, which is why the cache is capped at 24 hours.

### Fixed: "Nothing Happened" Now Says Which Nothing

- The re-fetch reports its outcome inline, and the outcomes that matter are the ones where nothing changed. `fetchBandSetlist` collapses every failure onto `null`, which is exactly right for the add paths — a volunteer archive having a bad night must never turn into a failed show add — and exactly wrong for a button someone pressed on purpose. There is now a `fetchBandSetlistWithReason` alongside it, and the reasons are distinct: the archive has no show on that date, it has the show but returned no songs, the request failed, the service answered with an error, or the setlist already matches.
- **"A show but no songs" is kept apart from "no show" on purpose.** The first means a field mapping in this app is wrong — it is the exact shape of the bug 5.33.5 fixed four of — and reporting it as the archive having a gap sends you to elgoose.net to look for a show that is sitting right there. The message says so: *that's a problem on our end, not theirs.*
- The admin panel's re-sync had the same flaw one level up. It reported every zero as "already in sync with elgoose.net", which is true for exactly one of the three ways to get a zero and actively misleading for the case where **no show ever resolved to El Goose at all** — a plan of zero changes over zero Goose shows looked identical to a plan of zero changes over a synced account. It now distinguishes them, shows how many shows were scanned, prints the endpoint's own error messages verbatim instead of only counting them, and keeps the whole report behind a *Raw report* disclosure.

---

## [5.34.0] — 2026-09-12

### Added: A Re-sync From El Goose Button In The Admin Panel

- `admin-resync-setlists` was only reachable by `curl`, which meant getting a Firebase ID token out of IndexedDB by hand and pasting a uid alongside it. That is how the endpoint returned `{"error":"Forbidden"}` on its first real use — an unset shell variable, not a permissions problem — and tokens expire after an hour, so the whole dance had to be repeated. Every other admin function in this app is a button that calls `auth.currentUser.getIdToken()` for itself; this one now is too.
- It sits beside the existing **Find Missing Setlists** tool on the user detail panel and reuses that view's selected user, so there is no uid to copy and no console to open.
- **Two steps, deliberately.** *Preview Changes* runs the dry run — which writes nothing, because the endpoint defaults to `dryRun: true` and the button relies on that default rather than restating it — and the *Apply* button only appears once a plan has come back and only when there is something to change. A migration over other people's setlists should make "show me first" the path of least resistance rather than an extra step to remember.
- The per-show plan shows the count going in and out, songs added, songs removed, how many of the user's own hand-added songs were kept, and **how many ratings and notes carried over**. That last number is the one to read: a rating survives only when the normalized song title matches, and setlist.fm and elgoose.net do not always spell a song the same way — `Seekers on the Ridge pt I` against `Seekers on the Ridge, Pt. 1`, or `Mas Que Nada` against `Más Que Nada`, whose accent the app's normalizer does not fold. A show with songs removed and nothing carried over is flagged inline, because that is the shape of a lost rating.
- Scoped to `source: 'elgoose'`. Phish.net has no API key configured, so including it would make every Phish show return a 503 and bury the El Goose results among them.
- A partial run says so — the endpoint stops on its own 8-second budget well inside Netlify's 10-second window — and previewing again continues from where it stopped.

### Note: Two Things This Button Does Not Solve

- **The user walk is still unbounded.** `admin-resync-setlists` reads every user document with no limit when no `userId` is given, and its time budget is only checked inside the per-show loop, so a large user base could exhaust the window before a single show is processed. Running per user — which is all this button does — is unaffected, since that path reads one document. Sweeping every account still wants the user query paged first.
- **`normalizeSongTitle` does not fold accents**, so `Más Que Nada` and `Mas Que Nada` are different songs to it. That normalizer is shared with the song index, the wishlist and bust-out detection, so changing it would silently merge entries those features currently keep apart — a deliberate change with its own migration, not a side effect of this one.

---

## [5.33.5] — 2026-09-12

### Fixed: Four Guessed El Goose Field Names, Now Read Off The Archive Itself

The `?debug=1` diagnostic added in 5.33.4 did its job on its first real use. Pointed at Goose at Ascend Amphitheater, 2024-10-24, it reported every key elgoose.net actually puts on a setlist row — and four of the guessed mappings were wrong. The El Goose test fixtures now use those real key names, so the adapter tests check the mapping instead of merely confirming the guess they were written from.

- **`jamchart_description` → `jamchart_notes`.** The flag was arriving and the text was not, so a jam-charted song rendered a badge with nothing behind it — visible in the live response, where "Into the Myst" came back flagged but with no note.
- **`songId` now reads `song_id`, not `uniqueid`.** `uniqueid` identifies one *rendition*: on that show "Echo of a Rose" and "Time to Flee" were each played twice and came back with two different values apiece, while `slug` was identical. `song_id` is the song. The field claiming to be "the source's stable song identifier" was the one that could never be.
- **Covers are real data, not a guess.** The adapter used to set `cover: null` and state that elgoose does not name the covered artist on a setlist row. It does, in `original_artist`. Goose plays a lot of covers — that one show had Creedence, Sergio Mendes and Bob Marley in it — so this is a visible gain: they render with the existing cover badge now. Guarded on `isoriginal` so a Goose original is never labelled a cover of itself.
- **Show notes are real data too.** The adapter hardcoded `setlistNotes: ''` and called show-level prose a phish.net-only field. elgoose sends `shownotes`. Both archives write HTML in that field, so it is stripped to plain text — block tags becoming newlines so paragraph breaks survive — rather than rendered as literal `<a href=…>` markup. Applied to phish.net's `setlistnotes` as well.

### Note: There Is No Gap Data On This Endpoint At All

- `sourceGap` was absent from every song, and the reason is not a misspelling. `/setlists/showdate/` sends no gap field of any kind — confirmed against the complete key list. The former `gap: 'gap'` entry mapped a key that has never existed, which is exactly why the feature looked wired up and silently produced nothing. **A mapping that cannot resolve is worse than no mapping**, so the entry is gone and a test asserts the absence, to stop it being re-added on the strength of the documentation that suggested it.
- Getting the archive's official gap count therefore needs a different Songfish endpoint and a second request per show or per song — how to batch and cache that is a real design decision rather than a field rename, and it is deliberately not attempted here. The "what this unlocks" note from 5.33.0 stands, but the prerequisite is larger than a one-line fix.
- Everything else checked out: song titles, set and encore structure, transition marks with `>` and `->` staying distinct, footnotes, venue, city, state, country, tour name, show id, slug, soundcheck handling and the response envelope — all confirmed correct against the live response. The envelope's `error` node also turned out to be a boolean `false` rather than the numeric `0` the docs implied, which the existing explicit check already handled.

---

## [5.33.4] — 2026-09-12

### Fixed: The El Goose Attribution Link Pointed At Our Own Site

- The first successful live lookup (Goose at Frost Amphitheater, 2026-08-15 — 15 songs, two sets) confirmed most of the field mapping: song titles, set structure, transition marks with `>` and `->` staying distinct, footnotes, venue, city, state, country, tour name, show id and song slug all came through correctly.
- It also showed that elgoose.net returns `permalink` as a **bare filename** rather than a URL — `goose-august-15-2026-frost-amphitheater-stanford-ca-usa.html`, no scheme and no host. Stored and rendered as-is that is a *relative* href, so the "Setlist from El Goose" credit on a show page resolved against mysetlists.net and 404'd on our own site instead of reaching the archive. These are volunteer-run archives and the link back is the least the app owes them, so a broken one is worse than none.
- Resolved in the adapter now, at the edge of the system, so nothing downstream needs to know: a relative permalink is joined to the archive's setlist path, and an already-absolute one (which is what phish.net sends) passes through untouched.

### Added: A Way To Check A Field Mapping Against What The Archive Actually Sends

- 5.33.3 made a lookup that returned *nothing* explain itself. The same live response showed the other half of the problem: songs came back fine and yet **every one of them was missing `sourceGap`**, along with the jam-chart flag and the opener flag. Songs present but one field absent throughout is invisible to a diagnostic that only fires on an empty result.
- `?debug=1` now attaches the same upstream report to a **successful** fetch — the envelope's top-level keys, the type of `data`, the row count, and the first row's key names. That last one is the answer to "which key is this actually called", and it reports key names and counts only, never row values; everything it exposes is already public on the archive's own API.
- It **bypasses the cache in both directions**. The cache key is source + artist + date + venue and deliberately not `debug`, so without the bypass the flag would return a stored body with no diagnostics on exactly the date you were investigating — and a debug-shaped response would then be served to every other caller for the rest of the TTL.

### Note: `sourceGap` Is Not Arriving, And Two Things Were Mislabelled

- **`sourceGap` is absent on every song** the live response returned. Either `gap`, `isjamchart` and `opener` are spelled differently on the showdate endpoint, or that endpoint does not carry them at all and they live on another one. This is a headline feature — the archive's own gap count is the number that needs no backfill — so the adapter's header now states plainly that it is unresolved rather than assumed, and names the `debug=1` call that will settle it. A jam chart being absent on a four-week-old show may simply mean nobody has charted it yet, so an older date is the better test.
- **`uniqueid` is a per-performance id, not a stable song id.** On that response "Hot Love & The Lazy Poet" was played twice in one set and came back as `80312` and `80319`, while `slug` was `"hot-love"` both times. So `songSlug` is the field that can address the archive's song page and `songId` identifies one rendition; the comment claiming otherwise is corrected, and both fields are kept, now labelled for what they really are.

---

## [5.33.3] — 2026-09-12

### Fixed: Two Error Messages That Sent You Looking In The Wrong Place

Both of these are the same mistake in different files — several genuinely different causes collapsed into one message, so the message told you nothing. Both turned up while actually trying to use 5.33.2.

**A band-source lookup that found nothing could not say why.** Verifying the El Goose field mapping against production returned `{ "ok": true, "message": "No show on 2023-12-30", "songs": [], "shows": [] }`. That proves the URL, the `/api/` rewrite and the envelope check all work — elgoose returned a 200 and its error node was not 1 — and then stops being useful, because `readEnvelope` did `Array.isArray(payload.data) ? payload.data : []`. "The archive has no show on that date" and "the `data` node is not shaped the way this adapter assumes" produced byte-identical output, which is precisely the distinction that matters while the field names are unverified.
- A 200 whose `data` is not a list is now a **shape failure**, not an empty result. The merge rules treat that identically to an empty setlist, so it is no less safe — just no longer silent.
- Any response that comes back with no songs now carries what the upstream actually sent: the envelope's top-level keys, the type of `data`, the row count, the error value and message, and the keys of the first row. **That last field is the whole diagnosis** — rows present but none of them carrying the keys the adapter reads means the mapping is wrong, and it names the spelling that is really there. A row count above zero with no songs produced also logs a warning naming the adapter file to check.

**The admin backfill said "Forbidden" when it meant "you have no token".** Running the dry run with an unset `$ID_TOKEN` shell variable returned `{"error": "Forbidden"}`, which reads as a permissions problem and is not one. `curl` sent `Authorization: Bearer` with the trailing space trimmed; the parser was `.replace('Bearer ', '')`, which only strips the prefix when exactly one space follows it, so nothing was stripped and **the literal string `"Bearer"` became the token** — non-empty, so it passed the missing-token check and failed verification instead.
- Parsed with a regex now, accepting a lowercase scheme and extra whitespace, both of which are legal. The unset-variable case yields an empty token and a **401** that says to check whether the shell variable is actually set.
- `verifyAdmin`'s bare `catch` reported all three of its failure modes as "Forbidden", including a missing `FIREBASE_*` env var. Now: **500** for a server misconfiguration (naming the variables, and saying it is not an authorization problem), **403** only when a verified account genuinely is not on `ADMIN_EMAILS`, and **401** for a malformed or expired token — with the reminder that Firebase ID tokens last an hour, which is the usual answer.
- `admin-populate-setlist.js` has the same bare-catch pattern; it is shipped working code and is left alone, but it will mislead the same way.

---

## [5.33.2] — 2026-09-12

### Fixed: The Setlist Backfill Could Never Have Finished a Single Run

- Going to run the 5.33.0 dry run for the first time turned up the reason it would not have worked. `admin-resync-setlists.js` shipped with a 1200ms delay between requests and a default limit of 50 shows — **60 seconds of sleeping alone**, inside a Netlify function that is killed at 10 seconds. Nothing in `netlify.toml` raises that limit.
- So every invocation would have been killed at 10s having processed about eight shows, and because the report is only assembled and returned at the very end, the caller would have got a 502 and **nothing at all**. The whole point of the endpoint is a plan you can read; it could not produce one. Worse, a real run (`dryRun: false`) would have written a partial set of changes and then died without reporting which ones — the single worst failure mode available to a migration.
- The 1200ms was chosen on politeness grounds, and that reasoning was weaker than it looked. The real protection against hammering elgoose.net is the cache in `band-setlist.js`, which fetches each distinct date once however many users attended that night, and the delay only applies on a cache miss at all. It is now **300ms**, which is what every other admin function in this repo already uses, and the default limit is 25.
- The walk now stops on **its own time budget** (8s, leaving headroom under Netlify's 10s) rather than being killed, so a truncated run still returns its report with everything it managed to look at.
- **`nextCursor` was a dead field.** The header comment said a full backfill "runs as several `limit`-bounded invocations — that is what `limit` and the returned `nextCursor` are for", but the handler never accepted a cursor as input, so there was no way to resume. It does now: `cursor` takes the previous run's `nextCursor` and picks up at the exact show it stopped on, users and shows both walked in document-id order so the paging is deterministic.
- The cursor also had to handle stopping on a user's *first* show, where nothing has been looked at yet. Reporting no cursor there would have restarted the whole walk — an infinite loop for any user with more band-source shows than one invocation's budget, which on a Phish tracker is an ordinary user. That case now returns a "start at this user, from the beginning" cursor.
- Verified by running the real handler against a mocked Firestore and a mocked `/api/band-setlist`: paging through the whole fixture database one show at a time covers exactly the same shows as a single unbounded run, with no gaps and no duplicates. The `limit`, `userId`, `source` and `budgetMs` filters and the dry run's write-nothing guarantee were all exercised the same way.
- If several invocations ever becomes tedious, the real fix is a background function — Netlify allows those 15 minutes instead of 10 seconds. Not done here, because a background function returns 202 immediately and puts its results only in the logs, and a dry run you can read the output of is the entire purpose of this endpoint.

---

## [5.33.1] — 2026-09-12

### Fixed: A Mis-Mapped Field Name Could Have Blanked a Setlist and Taken the Ratings With It

- 5.33.0 shipped the El Goose and Phish.net adapters with their upstream field names transcribed from documentation rather than read off a live response — the branch had no network route to either API, and the PR said so. The mapping being unverified was a known, accepted risk. What was not understood at the time is that **one particular way of getting it wrong destroyed data**, and this fixes that.
- Get the song-title key wrong — `song_name` where the archive says `songname` — and nothing else looks wrong at all. Every row still carries a valid `settype`, `setnumber`, `position` and `gap`, so the setlist comes out structurally perfect, correctly ordered, correctly split into sets, and **entirely nameless**.
- That case walked straight past every guard. The merge rule refuses to write an *empty* incoming setlist, which is the rule that makes a failed fetch and an artist-name false positive both harmless — but this array is full. The blank titles then normalize to `''`, so nothing matched any existing song, so every existing song counted as removed. The result written to the document was a setlist of blank rows, with the user's per-song ratings and comments gone. Precisely the data loss the merge rules exist to prevent, arriving through the one door they were not watching.
- **Untitled rows are now dropped in the adapter**, which turns a mapping error back into the empty result the merge already refuses to write. A song with no title is not a song; it is either corrupt upstream data or a wrong key. Verified by simulating exactly that mis-transcription: before, a rated two-song setlist came back as two blank rows; after, the fetch yields no songs and the existing setlist is left untouched, ratings and comments intact.
- The merge rule gained the same check as a second line of defence — an incoming setlist with no usable title in it anywhere is treated as empty. Unreachable today because the adapter drops those rows first, and deliberately kept anyway so a future adapter that builds its songs some other way still cannot write nameless rows over a good setlist. It fires only when *nothing* incoming has a title, so one bad row among real ones is not grounds for discarding a fetch.
- The dropped-row count rides on the response as `droppedUntitledCount` and gets a `console.warn` naming the likely culprit file, because the symptom otherwise is just "the feature quietly does nothing" — which is a much harder thing to notice than a setlist that has visibly gone blank.
- No user-facing change and no Release Notes entry: nobody's setlist was actually harmed, since a wrong key would have had to ship *and* be exercised before anyone saw it. This is the guard that was missing from 5.33.0, added before the mapping is verified rather than after.

---

## [5.33.0] — 2026-09-12

### Added: The Setlist Source Is Now a Function of the Artist

- For Goose and Phish, setlists now come from the archives the people who care about those bands actually maintain — [elgoose.net](https://elgoose.net) and [phish.net](https://phish.net) — instead of from setlist.fm's lossier mirror of them. Every other artist is untouched: setlist.fm stays the default, and a source is opt-in per artist rather than ever inferred.
- What those archives carry that setlist.fm does not: **per-song transition marks**, so a segue renders as the actual `>` or `->` rather than a generic "segue" line; **footnotes** ("with a Tom Sawyer tease", "guest: Marcus King on guitar"); **jam-chart flags with descriptions**; and **official band-wide gap counts** — the real number of shows since a song was last played, from the archive, rather than a figure reconstructed from a ~200-show setlist.fm window or from your own logged shows. Phish.net also carries show-level setlist notes, which now render under the setlist.
- The registry lives in `lib/setlistSources.js` and is **data, not a switch statement**. Adding Grateful Dead later is one new entry plus one new adapter file under `netlify/functions/lib/`, not a refactor. That was the point of building it this way, since dead.net publishes HTML rather than JSON and needs a parser and caching strategy of its own — deliberately not in this release. Dead shows keep using setlist.fm.
- One new function, `netlify/functions/band-setlist.js`, with one adapter per source. It mirrors `search-setlists.js` exactly — Firestore-backed cache, `X-Cache: HIT|MISS|STALE`, stale-on-upstream-failure fallback, hit counting, the same lazy Firebase init that degrades to "works, just uncached" when the env vars are missing — in a separate `bandSetlistCache` collection so it cannot collide with `setlistCache`.
- **Both APIs are addressable by show date, which is the whole win.** `scanForMissingSetlists` currently finds one night on setlist.fm by walking up to three pages of twenty results under up to three artist-name variants, reversing setlist.fm's `DD-MM-YYYY` into `YYYY-MM-DD` to compare each candidate — up to nine requests to answer one question. For a Goose or Phish show it is now a single request. That loop exists for no reason other than setlist.fm's search having no date endpoint, and every other artist keeps it unchanged.
- Cache TTL is capped at **24 hours** for both sources rather than reusing the 7-day tier `determineTtlHours` gives old setlist.fm shows. Phish.net's docs are explicit about this: cache locally, but not longer than a day, because setlists get corrected after review. A corrected Phish setlist should reach the app the next day, not the next week. The only thing ever served older than that is the explicit `STALE` fallback when the upstream is down, and it says so in the header.

### Added: A Re-Fetch Can No Longer Discard Your Ratings

- A show's setlist array was never purely source data — your per-song ratings and comments live in it, so do songs you added by hand, and so do set and order edits from the setlist editor. Re-fetching a setlist had to be taught the difference, because a re-fetch that silently dropped any of that would be worse than not re-fetching at all: there is no undo and no way to notice.
- So the new merge rule in `lib/bandSetlistMerge.js` is conservative in one direction only. The incoming setlist decides **what was played and in what structure**; the existing setlist decides **everything you authored about it**. Ratings, comments and your hand-added songs are carried across; a song you added that the archive has never heard of is kept and stays in the set you put it in, rather than being deleted because the source disagrees.
- **An empty or failed fetch writes nothing at all.** That single rule is what makes the rest of this safe, including the artist-name matching described below — a source with no data for a date, a mistyped date and a wrong-band false positive are all indistinguishable to the app, and all three leave the existing setlist exactly where it was.
- A matched song also keeps its existing `id`, because the id is identity everywhere downstream — `groupSongsBySet`, the song index's per-song set lookup, and the editor's reorder and rating controls all address songs by it. Minting a fresh one for a song that is demonstrably the same performance would invalidate all of that for nothing.

### Added: A Backfill for Existing Shows, Which Dry-Runs by Default

- `netlify/functions/admin-resync-setlists.js` walks every user's shows, finds the ones whose artist resolves to a band source, and re-fetches them. Admin-only and shaped after `admin-populate-setlist.js`.
- **`dryRun` defaults to true**, and only the literal `dryRun: false` turns writing on — a missing field, a null, or the string `"false"` all leave it a dry run. This is a migration over show documents people care about, so the default has to be the harmless one; forgetting a parameter reports a plan instead of rewriting a few thousand setlists. The plan is generated by the same merge rule a real run uses, so it is not an approximation of what would happen.
- It reports the shows where **the source returned nothing** as their own list rather than lumping them in with "unchanged", because those are the interesting ones: a bad date, a side project the registry doesn't cover, or an artist-name false positive. Dates carrying more than one show are reported too, with every candidate.
- Requests are spaced 1200ms apart — under one per second sustained, slower than correctness requires and deliberately so. These are small volunteer-run projects and there is no deadline on a backfill. The cache means each distinct date is fetched upstream once however many users attended that night, and the delay is skipped entirely on a cache hit since that never touches the archive.

### Note: `tape` Still Means "Segue", and Still Should Not

- Worth writing down since this release touches every consumer of it. setlist.fm's `tape` flag means "played over the PA, not performed". This codebase has never used it that way — since the transitions work it has meant "this song segues into the next one", `lib/songIndex.js` derives `segueOut: !!song.tape` from it, and `lib/__tests__/songIndex.test.js` asserts exactly that.
- Band sources keep writing `tape` with the codebase's meaning, and add `transitionMark` alongside it carrying the literal `>` or `->`. So the boolean every existing consumer reads is unchanged, and the UI can render the real mark where there is one.
- **Renaming `tape` to `segue` is the right end state and is not in this release.** It touches seven files and every stored show document, and it deserves its own change rather than riding along inside a data-source migration.

### Fixed: A Rules Denial Told You To "Try Again", Which Could Never Work
- Blocking an account failed with "Failed to block that account. Please try again." Retrying a Firestore rules denial never clears it, and v5.30.1 already fixed exactly this wording for festival creation and wrote down why. `blockUser`/`unblockUser` now name what was actually refused when `error.code` is `permission-denied`, matching `createFestival`.
- **The underlying cause is not in this repo's code.** `userBlocks` is a new collection in v5.32.0, and Firestore denies any path it has no matching rule for, so a correct rule that has not been *deployed* looks exactly like this from the UI.

### Note: The Rules Auto-Deploy Workflow Has Never Actually Run
- v5.30.1 added `.github/workflows/deploy-firestore-rules.yml` and its release note claimed "security rules now publish themselves whenever they change, so a feature can no longer ship with the permission it needs still missing." **That claim is not yet true.** The workflow has run twice — on v5.30.1 and on v5.32.0 — and failed both times, in about seven seconds, at its own credentials guard:

      ##[error]FIREBASE_SERVICE_ACCOUNT_JSON is not set.

- The guard is doing its job; the secret was simply never added, so the workflow has never deployed anything. Production runs whatever ruleset was last pushed by hand. That is why `userBlocks` has no rule, and it means the v5.32.0 `reports`, `moderationHidden` and `moderationCounters` rules, the closed `allow create` on the comment and photo collections, and the fix stopping a banned user lifting their own ban are all merged but **not live**.
- To fix it, once: add `FIREBASE_SERVICE_ACCOUNT_JSON` under Settings → Secrets and variables → Actions (the service account needs `roles/firebaserules.admin` and `roles/datastore.indexAdmin`, as v5.30.1 noted), then run the workflow from the Actions tab — it has a `workflow_dispatch` trigger for exactly this. `npm run deploy:rules` does the same thing from a machine already logged into the Firebase CLI.
- Worth saying plainly: a green release and a red deploy workflow sitting next to each other is the failure mode this note exists to make visible. The workflow fails loudly in its own run and silently everywhere else.


### Fixed: The Cookie Banner Never Unmounts, and the Authenticated Tests Hung on It
- With sign-in finally working, all 8 `smoke-auth` tests failed in `beforeEach` with a 30s timeout in `dismissCookieBanner`. The call log shows it waiting on `…filter({ hasText: /cookie|accept/i }).getByRole('button').first()` — the container matched, the button never resolved.
- `CookieConsentBanner` stays mounted by design (a freshly-inserted fixed element counts toward Cumulative Layout Shift; a transform on an existing one does not). Dismissed, it keeps its `fixed bottom-0` classes and slides away with `translate-y-full pointer-events-none`, setting `aria-hidden="true"`.
- Playwright's two notions of "there" then disagree. `isVisible()` is layout-based: a translated element still has a non-empty bounding box, so the dismissed banner answers **true**. `getByRole()` reads the accessibility tree, where an `aria-hidden` subtree has no buttons. The guard passed and the click waited out the whole test timeout for a button that could not appear.
- Only the authenticated specs were affected, which is why #287 didn't catch it: they restore the storage state `auth.setup.js` captures *after* accepting the banner, so they start with `cookie-consent` already set and the banner already hidden. A signed-out test gets a fresh context and sees the real banner.
- The helper now anchors on the button rather than the container, so both halves agree — no accessible button means dismissed, and it falls through in 2s. The click is bounded to 5s so any future variant costs seconds rather than the full timeout, and the post-click wait watches the button leave the accessibility tree instead of waiting for a container that never goes away.
- With the hangs gone, two assertions underneath them turned out to be stale in the same way the `/roadmap/i` one was — they had simply never run before. `session.smoke.spec.js` asserted sidebar links named `/friends/i` and `/search/i`; `Sidebar.jsx` has neither (`/friends` is a real page, but nothing links to it, and "Search for a Show" is a control on the Shows page). It now checks My Shows, Stats, Tours, Festivals and Upcoming. `shows.smoke.spec.js` waited for a heading `/search shows/i`; the search page's H1, from `PageHeader`, is "Search". Anchored to `level: 1` and `/^search$/i` so it cannot drift onto SearchView's "Select Artist" / "Artists Found" / "Search Results" h2s.

### Fixed: The Smoke Tests Were Rate-Limiting Themselves Out of Existence
- Every authenticated smoke test signed in for itself: four standalone calls in `auth.smoke.spec.js`, a `beforeEach` across the five tests in `shows.smoke.spec.js`, and a deliberate wrong-password attempt. Ten Firebase sign-ins per run, twenty with `retries: 1`, all from one CI IP against one account. Firebase throttles exactly that, and the block outlives the run — so the suite failed with `auth/too-many-requests` ("Too many attempts. Please try again later.") and stayed failed. The tests were not detecting a broken app or bad credentials; they were breaking themselves.
- New `e2e/auth.setup.js` signs in **once** per run as a Playwright setup project and saves the session; the authenticated specs opt into it with `test.use({ storageState })`. Only the two tests that exercise the sign-in flow itself still authenticate for real, so a run makes **2 sign-in attempts instead of 10** (4 instead of 20 with retries).
- `indexedDB: true` on `context.storageState()` is load-bearing and not optional: Firebase Auth keeps its session in IndexedDB, not cookies or localStorage, so a state captured without it restores nothing and every dependent test silently starts logged out. Playwright's own docs name Firebase for this option. Needs Playwright ≥ 1.51; the repo is on 1.58.
- The wrong-password test now uses an address that cannot exist rather than the real `TEST_EMAIL`. Firebase weighs *failed* attempts most heavily, so spending one every run against the account every other test signs in with was a meaningful part of the problem. It exercises the same rejected-credentials path at no cost to the real account.
- The authenticated specs run as their own `smoke-auth` project, which is the only thing that depends on the setup project. My first attempt made the *whole* smoke project depend on it, and CI showed exactly why that was wrong: a still-throttled account failed setup and reported `1 failed, 36 did not run` — the two dozen tests that never touch authentication (API health, email endpoints, legal pages, guest mode) stopped reporting at all. That is strictly worse signal than the problem being fixed. Now a sign-in outage costs only the nine tests that genuinely need a session; verified by forcing setup to fail and confirming the other 28 still run.
- The signed-in tests that don't exercise signing in moved into `e2e/smoke/session.smoke.spec.js`, because Playwright selects projects by file and `auth.smoke.spec.js` holds both signed-out and signed-in cases. Storage state is configured once on the `smoke-auth` project rather than per file.
- `test:smoke` / `test:all` and the workflow now run `--project=smoke --project=smoke-auth`. `e2e/.auth/` is gitignored — it holds a live session.

### Fixed: A Guest-Mode Test Asserted a Sidebar Link That Has Never Existed
- `core.smoke.spec.js` walked the guest sidebar clicking `/stats/`, "Search for a Show" and **`/roadmap/`**. There is no Roadmap link in `Sidebar.jsx`, `MobileHeader.jsx` or `Footer.jsx` — it exists only as a page and some cards — so that step could never pass. It was masked for a long time behind the sign-in failure above.
- The walk now uses links a guest actually has: Stats, "Search for a show", Upcoming and "How to Use". `Sidebar.jsx` hides Tours, Wishlist, Bucket List, Festivals, Profile and Setlist Photos behind `!isGuest`. "Support" is deliberately excluded — it is an external `<a>` to buymeacoffee.com, and clicking it would navigate the test off the site entirely.

### Fixed: The Guest-Mode Walk Still Failed, Now on the Cookie Banner
- The fix above swapped `/roadmap/` for links a guest really has, ending with "How to Use" — but that link sits at the bottom of the sidebar, underneath the cookie-consent banner. The banner is `fixed bottom-0 left-0 right-0 z-50`, so Playwright reports `<div …> intercepts pointer events`, retries for the full 30s and times out. Same test, same red, one link further along.
- Verified against a local build of `main`: `enter guest mode and navigate pages` still fails there, on `/how to use/i` rather than `/roadmap/i`.
- The banner is dismissed before the walk instead of dropping "How to Use" from it, so the link keeps its coverage. The sibling test `exit guest mode returns to landing` already had to do this — "Exit Guest Mode" is under the banner too — and its inline copy is now the same helper.
- That helper, `dismissCookieBanner`, is factored out of `dismissOverlays` in `e2e/utils/test-helpers.js` (which already contained this exact block) and exported, so there is one definition rather than a third copy. `dismissOverlays` calls it; behaviour there is unchanged. It no-ops when the banner is absent, so it is safe to call unconditionally.
- After: `enter guest mode and navigate pages` goes from a 30s timeout to passing in 4.8s, and `core.smoke.spec.js` runs 15 passed / 3 failed. The three are the API Health checks, which need Netlify functions a static local server cannot route to; they pass in CI.

The CI and test-harness fixes above this line were written when there was
nothing user-facing to ship with them, and the note here said so — no
version bump, on the grounds that a patch bump restamps the service worker
and invalidates every user's cache for a change that ships no app code.
That reasoning still holds; what changed is that there is now app code to
ship. They ride along with 5.33.0 rather than getting a bump of their own,
and they still get no Release Notes entry, because none of them is
something a user can see.

---

## [5.32.0] — 2026-09-05

### Added: Report, Block, and a Filter That Runs Before Anything Is Published
- App Store Review Guideline 1.2 requires four things of an app with user-generated content: a filter for objectionable material, a way to report it, a way to block abusive users, and published contact information. This app shipped **one** of them — the support address — while carrying comments, uploaded photos and video, meetup threads, friend tagging and a public activity feed. This is the single most likely cause of a first-submission rejection, and this release closes all four.
- **The filter** (`lib/contentFilter.js`) normalizes before it matches, which is the only part that matters: both the input and the wordlist go through the same fold — diacritics stripped, leet expanded, repeated characters collapsed, punctuation treated as a separator — so `fück`, `sh1t`, `fuuuuck` and `f.u.c.k` all land on the plain entry instead of each needing their own. Whole-word matching with a short suffix allowance, so plurals and `-ing` forms are caught without the Scunthorpe problem. It also refuses contact-harvesting spam: emails (including `bob (at) example (dot) com`), phone numbers, and links to anything outside a small allowlist of setlist sources.
- **What is deliberately NOT on the wordlist, and why.** This is a concert app, and a list that would be uncontroversial elsewhere rejects real posts here. "Cum On Feel the Noize" is a Slade song, "Ho Hey" is a Lumineers song, Dick Dale and David Lynch are artists people have seen live, "Piss Up A Rope" is Ween, and "fag" is a cigarette in half the English-speaking world. Every one of those was in the first draft and every one would have refused a legitimate comment about a real show. Mild profanity is left out for the same reason — Guideline 1.2 is about objectionable material, and a filter that fires on Ween song titles costs more trust than it earns. 23 unit tests, and the half that checks false positives is the half that matters.
- **The filter is enforced server-side, because a browser-only filter is a suggestion.** The `showComments`, `meetupComments` and `showPhotos` create rules used to allow any signed-in user to add a document, which meant anyone with the Firebase SDK could post straight past the check. Creating any of the three now goes through `netlify/functions/moderate-content.js` and their client create rules are `if false`. The function runs the identical rule from a generated CommonJS copy, and `lib/__tests__/contentFilterParity.test.js` runs both over a 408-case grid — every blocked term against every obfuscation — plus the generator's own `--check`, so the two cannot drift. Verified by removing one term from the server copy and confirming three independent assertions fail.
- The file bytes still upload straight to Cloud Storage; only the metadata document, which carries the caption, is written server-side. Routing tens of megabytes of photo through a Netlify function would be slower, costlier and no safer — `storage.rules` already enforces size and content type, and bytes are not text a wordlist can read.
- **Reporting.** A flag icon sits in the existing control row on every comment, photo, video, setlist photo and meetup message, hidden on your own content. One report per person per item, enforced by a deterministic document id (`{contentId}_{reporterId}`) rather than by a read-then-write a client could race. Reporting hides the item for the reporter immediately, rather than making them keep looking at it while an admin gets to the queue.
- **Auto-hide at three reports**, counted and applied by `netlify/functions/report-content.js` inside a transaction, so two people reporting the same comment at the same moment cannot both read a count of 2. The report's facts — who wrote the content, what it says — are read from the content document on the server, never taken from the request: a client that could supply `reportedUserId` could get someone else banned for a comment they never wrote.
- **The 24-hour SLA is a commitment, so it has machinery behind it.** Each report emails the admin through the existing Resend integration the moment it is filed, and the queue sorts oldest-first with each row aged against the 24-hour clock. Newest-first — the default everywhere else in this app — buries the report closest to breaching the commitment under every report filed since.
- **Blocking.** A blocked user's comments, media, meetup messages and activity disappear, and the friendship is removed in both directions, which is the part that actually stops them reaching you — a blocked friend would otherwise keep tagging you at shows and appearing in your tag picker. Block from the report dialog, from a friend card, or from the friends grid; undo under Profile → Blocked accounts.
- **Admin queue** as a new Moderation tab in `AdminView`, placed directly after Users because it is the only tab with a deadline attached. Dismiss (restores auto-hidden content), Delete content, or Delete + ban. Every action closes *every* open report against that content, not just the clicked one — three reports about one comment are one decision — and writes to `adminAuditLog` like the roadmap and venue-verification flows already do.

### Changed: Auto-Hidden Content Is Moved, Not Flagged
- The obvious design is `hidden: true` on the content document. It does not survive contact with Firestore, for two reasons that compound. **Rules are not filters**: a query fails outright if any document it returns fails the read rule, so an "only the author and admins may read hidden content" rule breaks the entire comment thread for everyone the moment one comment is hidden, rather than quietly omitting one row. And **adding `where('hidden', '==', false)` fixes that only for documents that have the field** — every comment, photo and caption already in production predates it, and both `== false` and `!= true` exclude documents where a field is absent, so shipping the query filter would have made every existing comment in the app vanish until a backfill caught up.
- So an auto-hidden document is copied into `moderationHidden` (admin-read-only) and deleted from its own collection. It drops out of every query because it is genuinely no longer there: no backfill, no query changes, no deploy-order hazard, and "hidden content is not readable by third parties" is enforced by one rule on one collection instead of a condition on five. Dismissing restores it under its original document id, so replies and links to it still resolve.
- The trade is that an author cannot see their own content while it is under review. That is what every report-and-review system does, and the 24-hour commitment is what bounds it.

### Fixed: The Terms, Privacy Policy and Cookie Policy Were Unreachable and Broken
- Two separate bugs, both found while checking that the new Community Guidelines could actually be read by the people Guideline 1.2 cares about — and both of which had been shipped for a long time.
- **`AppProviderWrapper` rendered the landing page for every route when signed out.** Following the footer link to the Terms while logged out put you back on the landing page. So the Terms, the Privacy Policy and the Cookie Policy were unreachable without an account — a problem on its own, and a blocking one for Guideline 1.2, which wants contact information and community guidelines findable by someone who has not signed up. A small allowlist of those three static, self-contained pages now renders its own content when signed out; every other route still needs the signed-in shell.
- **All three pages crashed anyway.** They used `<Link to="/">` — react-router's prop, not `next/link`'s `href` — so `/terms` rendered "Application error: a client-side exception has occurred" for everyone, signed in or out. This went unnoticed because the existing smoke test asserted `getByText(/terms/i)`, which matched the *landing page's* "Terms" footer link, so the check passed against a page that had never rendered. Seven replacements across the three files.
- The new smoke tests follow the link from the landing page for real rather than navigating to the anchor directly, so what they assert is the thing that was broken.

### Added: Community Guidelines, and Contact Information Without an Account
- A Community Guidelines section in the Terms stating zero tolerance, that content is filtered before publication, the report and block mechanisms, the 24-hour review commitment, and what a ban does. Linked by its own anchor from both footers.
- The support address is now on the signed-out landing page, in the app footer, and in a Help & support card on the Profile page, rather than only in the body of the Terms.

### Security
- **A banned user could have lifted their own ban with one write.** `banned` lives on `userProfiles`, which the user owns, and the rule was `allow write: if request.auth.uid == userId`. Split into create/update rules that pin `banned` to its existing value, so only the admin flow (through the Admin SDK, which bypasses rules) can set it. Uses `.get('banned', false)` rather than a bare field read — a bare read of a missing field fails rule evaluation outright, which would have locked every existing user out of editing their own profile.
- Block lists are stored in a private `userBlocks/{uid}` document, **not** on `userProfiles`. That document is readable by every signed-in user, so a block list on it would tell the person you blocked that you blocked them — the one thing a block must never do. (The Guideline 1.2 brief called for `users/{uid}.blockedUserIds`; `users/{uid}` has no root document in this app, and `userProfiles` would leak it.) Keyed by uid with the docId pinned to the caller, like `favoriteTours` — matching on the `userId` field alone would let anyone overwrite someone else's block list.
- `reports` are readable only by an admin. A report names its reporter, and a reporter whose name is visible to the person they reported is a reporter who stops reporting.
- Banned accounts cannot like, upload, or create or join meetups. 21 rules tests against the Firestore emulator (`npm run test:rules`) cover all of it: create closed on all three collections, banned writes refused, self-unban refused, ordinary users unaffected, reports and hidden content unreadable by non-admins, and block lists private and unforgeable.

## [5.31.0] — 2026-09-04

### Added: Admin Tooling to Merge Duplicate Shared Festivals
- Dedup at create time is advisory by design — it surfaces matches inline and never blocks creation, because a wrong auto-join is worse than a duplicate. So duplicates accumulate, and until now nothing could clear them: the client cannot delete a canonical festival (`allow delete: if false`), and there was no admin path either, so every un-merge needed a one-off function. This is the tool the note in `context/AppContext.jsx` said would go here, in the place it said it would go.
- `netlify/functions/admin-merge-festivals.js` has two actions. `scan` clusters the whole canonical catalog by the shared match rule and returns every group of 2+ with attendee counts, a suggested survivor and any users already on more than one member; it writes nothing, ever. `merge` repoints every attendance record from the duplicates onto the survivor and then deletes the duplicate canonicals. `dryRun` defaults to **true**.
- Never touches a show, a note or a rating. Shows link to a festival by the *attendance record's* id, and only that record's `festivalId` pointer is ever rewritten — so every attached show stays attached, and no show document is read or written at all. The survivor is never edited either: disagreements with the duplicates are reported for a human, not merged in.
- Repoint happens before delete, so an interrupted merge leaves records pointing at a festival that still exists rather than at a dangling id. Re-running finishes the job.
- **The edition guard.** The one thing this must never do is collapse Bonnaroo 2025 into Bonnaroo 2026 — the failure the match rule's date gate exists to prevent, now reachable by hand. Pairs the rule matches are allowed; pairs it refuses that start more than 60 days apart, or whose start date is too malformed to measure, are refused outright with **no override flag**; pairs it refuses that start close together are allowed only with an explicit `confirmUnmatched`. The gap is measured in days rather than by comparing calendar years, which would be the obvious way and is wrong: a festival running 30 Dec to 2 Jan starts in a different year from a duplicate recorded as starting 1 Jan, and a year comparison would call that an edition collapse and refuse a plainly correct merge.
- **Shared attendees.** If someone holds a record on both the survivor and a duplicate, repointing leaves them with two cards on one festival. Combining those records is not safe to automate — each carries its own notes, rating and attached shows, and shows hang off the record id — so the merge refuses by default and names the users affected, proceeding only with an explicit `allowSharedAttendees`.
- Cluster membership is anchored rather than transitive. A matching B and B matching C does not put A and C together when the rule itself would refuse A and C; without that, the tool would offer a merge the rule forbids.
- Admin UI beside the migration tool in `components/AdminView.jsx`: scan, pick which copy to keep per group, preview, merge. Each row shows its document id, because the migration's original conflict list omitted ids and that made a real incident materially harder to fix.

### Changed: The Match Rule Is Now Shared Between Netlify Functions
- `netlify/functions/lib/festivalMatchRule.js` is one CommonJS copy of the rule that functions require, following the arrangement three public-page functions already use for `netlify/functions/lib/publicPageHtml.js`. Previously every function that needed the rule re-implemented it inline.
- That scaled badly, and the cost was real: the bound that stops a mistyped year absorbing unrelated festivals had to be applied by hand to each copy, and a copy that missed it would have gone on mis-merging silently.
- `lib/__tests__/festivalMatchParity.test.js` runs both the ESM module and the CommonJS one over the same inputs — a 4,608-case name x window grid, plus the exact production pair behind the 2011-into-2008 mis-merge and the Bonnaroo 2025/2026 case — and asserts identical answers, so the two definitions cannot drift silently. Verified by reintroducing the original year bug into the shared copy and confirming the test fails.
- The older inline ports in `admin-migrate-festivals.js` and `admin-repair-festival-split.js` are deliberately left alone: they are shipped, working code, and rewriting them is a larger change than the one that introduced the shared module. New functions should require the shared module.
- No security rules changed. Deleting a canonical festival is done with the admin SDK, which bypasses rules; the client-facing `allow delete: if false` stays exactly as it is.

---

## [5.30.4] — 2026-09-04

### Fixed: A Mistyped Year Could Merge Two Different Festival Editions
- Found in production, by the shared-festival migration itself. One record's `startDate` had been typed `0011-08-12` instead of `2011-08-12`. Year 11 AD parses perfectly well — four digits is four digits — so that record carried a **~2001-year-wide** date window that overlapped every festival in the catalog. Its name ("Outside Lands") is contained by another edition's ("Outside Lands Music & Arts Festival"), so the name gate passed too, and a 2011 festival was merged into a 2008 one. That is precisely the edition collapse the date gate exists to prevent.
- `lib/festivalMatch.js` now bounds both ends of the problem: a year outside `MIN_FESTIVAL_YEAR`–`MAX_FESTIVAL_YEAR` (1900–2100) is not a date, and a window wider than `MAX_FESTIVAL_DAYS` (30) is a mistyped year rather than a range. Either way the record matches **nothing** instead of everything — the worst outcome here is a wrong merge, so a record that can't be dated confidently is left to stand alone. The same bounds are mirrored into the rule ported inside `admin-migrate-festivals.js`.
- Five regression tests, including the exact production pair, both corruption directions (bad start, bad end), the range boundaries, and a check that the record still matches its own true edition once the date is corrected.

### Added: `admin-repair-festival-split`
- The rule fix prevents recurrence but cannot undo a merge that already happened — the migration is idempotent and re-running it will not un-merge anything. This admin-only function moves one user's attendance record off a canonical festival it was wrongly merged into and onto the right one, reusing a matching canonical if one exists.
- `action: "inspect"` lists a user's attendance records joined to their canonical festivals (read-only). `action: "split"` does the repair, dry-run by default.
- It never touches a show (shows link by attendance id, which never changes), never deletes notes or a rating, and never edits the canonical being left, since other users are still attending it. Corrected dates are validated against the same bounds the match rule uses, so the typo that caused the problem cannot be re-entered through the repair.
- This is the admin moderation tooling previously noted as "where it would go, but not built" — built now because it was needed, not for tidiness.

### Fixed: The Migration's Conflict List Omitted the Document Id
- `AdminView` rendered conflicts as `festival · uid`, dropping the `docId` the function already returns. That is the one field a repair needs to address the record, which made a real mis-merge materially harder to fix. Conflicts now read `users/{uid}/festivals/{docId}`.

### Fixed: Smoke Tests on a Pull Request Tested Production, Not the Pull Request
- `TEST_BASE_URL` was `${{ inputs.base_url || 'https://mysetlists.net' }}` for every event. `inputs` only exists on `workflow_dispatch`, so both `push` and `pull_request` fell through to production — a PR run exercised the live site and said nothing whatsoever about the branch under review. This is why the v5.30.0 tour-browse crash (fixed in v5.30.2) shipped past a workflow that had "run" on its PR.
- A pull request now runs against its own Netlify deploy preview; `push` still targets production; `workflow_dispatch` still honours its input.
- The run waits for **this commit's** deploy rather than sleeping. On a PR it polls the Netlify check runs posted against the head SHA, because the deploy-preview URL keeps serving the *previous* build until the new one is ready — polling for HTTP 200 alone would cheerfully test stale code on any re-push. Netlify posts those checks only for previews, not for production, so a push to main instead waits until `/service-worker.js` names the version being released (`scripts/stamp-service-worker.js` writes it on every build). Not every push bumps the version, so that one warns rather than fails. Replaces a blind `sleep 90`/`sleep 120`.
- Added a `concurrency` group so a second push to a PR cancels the superseded run instead of racing it and reporting on a preview that has already been replaced.
- `ENVIRONMENT` is reported as `deploy-preview` for PR runs so results logged to Notion aren't mistaken for production runs.
- `integration-tests.yml` is deliberately unchanged: it already skips pull requests and is *supposed* to exercise the live site's Netlify functions with real secrets.

### Fixed: A Failed Sign-in in the Smoke Tests Gave No Reason
- Every authenticated smoke test funnels through `loginUser`, so when sign-in breaks, ten tests fail on one line with `expect(locator).toBeVisible() failed ... element(s) not found`. Bad credentials, a disabled account, Firebase being unreachable and a real app regression all produced that identical, undiagnosable output.
- The wait now races the signed-in sidebar against the login form's own error message and reports whichever arrives, so a rejected sign-in fails with Firebase's actual reason. Verified by driving the built export in Chromium with deliberately bad credentials.

---

## [5.30.3] — 2026-09-04

### Added: Expand a Song on Stats → Songs to See Every Show You Heard It At
- Clicking a song row on `/stats/songs` now expands it in place, listing every performance of that song in the user's own logged shows — date, venue and city, set label and position within the set, segue markers, and the user's rating of that specific performance. Clicking again collapses it. No navigation, no modal, no drawer.
- Toggles are **independent**, not an accordion: comparing two songs' histories side by side is the obvious next thing to do on this page, and nothing about the list makes several open panels awkward.
- Each expanded row is itself a link to that show, opening it the same way every other list in the app does (`setSelectedShow` + `/shows/`) rather than a per-id URL, which static export can't serve.
- The row is a real `<button>`: it takes focus, toggles on Enter and Space, shows the same focus ring the rest of the page uses, and carries `aria-expanded` plus an `aria-controls` pointing at the panel. The chevron is the same `ChevronDown` + `rotate-180` affordance already used for expandable rows on My Shows and the legacy Stats tables.
- The row previously navigated straight to the song page; that link is preserved as a "Song page →" link inside the expansion, so nothing that was reachable before became unreachable.

### Technical
- `components/songs/SongPerformanceRow.jsx` is the performance row, extracted verbatim from `components/songs/SongDetailView.jsx` where it was inlined. Both the song page and the new expansion render it; a `compact` prop swaps only the wrapper's padding and chrome, never the content, so the two can't drift into two implementations of the same timeline. The song page's rendering is byte-for-byte what it was.
- Both use the same `lib/songIndex.js` — one normalizer (`normalizeSongTitle`), keyed `artistSlug:normalizedTitle`, so `"Ashes//Dust"`, `"Ashes // Dust"` and `"ASHES//DUST"` collapse into one expansion while a title two different artists both play stays on two.
- Expansion causes **no Firestore reads**. It renders from `hooks/useSongIndex`, which is memoized on the `shows` array already in `AppContext`. Verified in a real browser with 550 shows / 12,100 setlist entries: the index is built exactly once and stays at one build across 22 expand/collapse toggles and a sort change; zero backend requests are issued while toggling; expand latency stayed under 100ms including the test driver's own round-trip.
- `segueIn` added to each indexed performance. Segues are stored one-directionally (`tape` on a song means it ran into the next one, which is what the show detail setlist renders as its `> segue` line), so a song's segue-*in* is the previous song's flag. Rendered with the same `>` and "segue" vocabulary the show detail view uses.
- Missing set data still degrades to no set label rather than `Set undefined`/`Set null`, and a manually-added song renders identically to a setlist.fm-sourced one (with the existing "added by you" badge). Both are covered by tests.
- Six new cases in `lib/__tests__/songIndex.test.js` cover performance ordering, completeness and de-duplication, the single-performance case, the "no song can have zero performances" invariant, a song played twice in one show, and segue in/out direction. 14 tests pass.
- Fixed in passing: the numeric columns on this page were fixed-width `w-24` at every breakpoint, which left the song title roughly 20px wide on a 390px phone — unreadable before this change and worse with a chevron added. They are now `w-16 sm:w-24`, restoring a readable title column on mobile.

---

## [5.30.2] — 2026-09-04

### Fixed: Opening a Tour from "Add shows from a tour" Crashed the Page
- Picking any tour with a dozen or more shows blanked the page with "Application error: a client-side exception has occurred". Since most real tours are longer than that, the feature was effectively unusable.
- Root cause: `components/tours/TourBrowseModal.jsx` imported lucide-react's icon named `Map`. That import shadows the global `Map` constructor for the whole module, so the `new Map()` that groups a long tour's shows by month threw `Map is not a constructor`. The icon is now imported as `MapIcon`.
- Why nothing caught it: the shadowing is valid JavaScript, so it built cleanly and the deploy preview rendered fine — the throw only happens once a tour's show list crosses the twelve-show month-grouping threshold, which no build-time or unit check ever reached. Reproduced in a real browser against the built export before fixing.
- Also fixed in the same flow: when a setlist.fm function returned HTML instead of JSON (what the SPA catch-all serves if a function isn't deployed), the raw parser error `Unexpected token '<', "<!DOCTYPE "...` was shown to the user as though it were an explanation. All three lookups now report a readable message.

### Technical
- New `lib/__tests__/iconShadowing.test.js` scans `app/`, `components/`, `lib/` and `hooks/` for any module that imports a lucide icon whose name shadows a global constructor (`Map`, `Set`, `Image`, `Text`, `File`, …) *and* calls `new <Name>(`. lucide exports a lot of these names, and this repo's icon imports span multiple lines, so the scan is multi-line aware and strips comments from the whole import block before splitting on commas — doing that in the other order lets a comma inside a comment glue prose onto the next name, which made the first version of this scan pass on the very bug it was written for. It carries self-checks so it fails loudly rather than vacuously.

---

## [5.30.1] — 2026-09-02

### Fixed: Creating a Festival Failed With a Permission Error
- 5.30.0 split a festival into a shared canonical record (`festivals/{id}`) plus a private attendance record. `firestore.rules` gained a rule for that new collection — but **rules are not deployed by any build**, so in production the new collection had no rule at all, and Firestore denies every path it has no matching rule for. Creation died on its very first write.
- The rule itself was correct all along. **The fix is to deploy it** (`npm run deploy:rules`, or the workflow in #280); the changes below stop this class of failure from being invisible next time.
- A permission denial no longer says "Please try again" — retrying can never clear a rules denial. It now names what was actually refused.
- Festival names are validated against the same 120-character limit the rule enforces, as a form error naming the field. `normalizeFestivalName` expands `&` into ` and `, so a name comfortably under the limit could produce a normalized form over it and be rejected by Firestore with nothing pointing at the cause.
- Create now writes the user's own attendance record before the shared canonical one. Both writes can't be atomic (different collections, one of them shared), so one must fail second — and the orders are not equivalent. Canonical-first stranded a festival in the shared catalog that nobody attends, and `festivals` has `allow delete: if false`, so no client could ever remove it and it would surface forever in other users' join suggestions. Failing the other way leaves a record private to that user, already rendered as "Unavailable festival", which they can simply leave.

### Fixed: Security Rules Now Deploy Themselves
- The root cause above is not specific to festivals: security rules live in this repo but nothing deployed them. Netlify's build runs `test:pre-deploy && next build` and never touches Firebase, so `firestore.rules` only reached production when someone remembered `npm run deploy:rules` by hand. It broke favoriting a tour in 5.29.0 and creating a festival in 5.30.0, and would have broken the next rule change too.
- New `.github/workflows/deploy-firestore-rules.yml` deploys the same three targets as the local script (`firestore:rules`, `firestore:indexes`, `storage`) on any push to `main` that touches them, plus a manual trigger for deploying rules already on main.
- Authenticates with the `FIREBASE_SERVICE_ACCOUNT_JSON` repo secret the integration-test workflow already uses — no new credential to mint. The credentials file is written to the runner's temp directory rather than the workspace so it can't be swept into an artifact upload, and is removed even when the deploy fails.
- **Requires the service account to hold `roles/firebaserules.admin` and `roles/datastore.indexAdmin`.** The existing account was provisioned for Admin SDK reads and may not have them; the workflow fails with the IAM error naming the missing role if so.

### Technical
- `lib/festivalMatch.js` gains `FESTIVAL_NAME_MAX` and `festivalNameProblem`, so the form and the security rule state the same limit in one place.
- Unit tests: 5 new cases in `lib/__tests__/festivalMatch.test.js` covering the raw limit, the normalized-longer-than-raw case, and whitespace.

---

## [5.30.0] — 2026-09-02

### New: Add Every Show You Caught on a Tour, in One Go
- People don't remember their history one show at a time — they remember "I did five stops on Goose's Summer Tour 2025". **Add shows from a tour** on the Tours page does exactly that: pick the artist, pick the tour, tick the nights you were at, add them all in one action.
- Typing the whole thing at once works too — `Goose Summer Tour 2025` in the search box goes straight to that tour's show list. If it can't tell for certain where the artist name ends or which tour you meant, it drops you on the picker with what it did work out already filled in, rather than guessing and opening the wrong tour.
- Every show on the tour is listed in date order with its venue, city and whether a setlist exists yet — grouped by month for a long tour, filterable by city or venue, with select all / clear all and a live count on the button.
- **Shows you already have are marked and can't be re-added**, so this can't duplicate your history. A night at the same venue on the same date that you'd added by hand is caught even if you spelled the venue differently; one that's close but not certain is flagged as "may already have" and left for you to decide.
- A night with no setlist filed yet is still addable, flagged as setlist pending.
- Adding shows the progress as it goes. If some fail, the ones that worked are kept, the ones that didn't are named with the reason, and you can retry just those — it never claims success for a batch that partly failed, and never rolls the successes back. You can close the modal and it keeps going.
- Bulk-added shows are ordinary shows: full setlist, venue, artist, tour name, the lot. They appear on Tours, in runs, and in festivals exactly as hand-added ones do.
- A tour you already have shows from gets **Add more shows** on its own page, jumping straight to that tour's list with the nights you have already ticked off.

### Changed: Festivals Are Shared Now
- Festivals used to be private to whoever created them, so two friends who both went to Bonnaroo 2026 kept two unrelated copies. Now there's one festival, and each of you keeps your own shows and notes against it.
- **If someone's already added the festival you went to, you'll see it while you're typing** — name, dates, location — and joining it is one tap. Creating your own anyway is still one click, with the match still on screen; nothing is ever joined on your behalf, and nothing blocks you from creating.
- Different years never match each other. Bonnaroo 2025 and Bonnaroo 2026 are different festivals however identically they're spelled.
- Two festivals with the same name in different cities are both offered rather than one being picked for you.
- **Joining creates only your own record.** Your notes, your rating and the shows you attach are yours — invisible to everyone else at the same festival.
- The person who created a festival can edit its name, dates and location, and their changes show up for everyone. Everyone else edits their own notes, and the form says so plainly instead of showing greyed-out boxes.
- **Leaving** replaces deleting. It removes the festival from your list and keeps every show you'd attached — they go back to being ordinary shows in your history. It never affects anyone else's copy, not even if you're the one who created the festival.

### Fixed
- Firestore rules for starred tours (added in 5.29.0) checked only the `userId` field and not the document id, so a signed-in user could overwrite another user's starred tours. Landed on `main` after the 5.29.1 notes went out; documented here.

### Technical
- **setlist.fm still has no tours endpoint** — verified against the current 1.0 resource list (artist, setlist, venue, city, country, search, user; `tour` is a filter on `/search/setlists`, not a resource). Tour discovery therefore aggregates distinct `tour.name` values off an artist's setlists. `netlify/functions/get-artist-tours.js` is reworked for it: the 8 most recent pages walked *serially* with a 200 ms gap and an 8 s budget (the old version fired 3 pages in parallel, exactly the burst that earns a 429), results cached 24 h in the existing `setlistCache` collection under a `tours_` prefix, and 404 / 429 / timeout each surfaced distinctly — a failed request never renders as an empty tour list. Tour groups are keyed by normalized name *plus year*, so a name reused across years stays two entries.
- New `netlify/functions/get-tour-shows.js` pages `/search/setlists?artistMbid=&tourName=` for one tour's full show list, same paging discipline, cached 12 h under `tourshows_`.
- New `lib/tourBrowse.js` (+ 24 unit tests): tour-name normalization, the conservative free-text parse (leading tokens tried as an artist name, capped at three, resolved only on an exact name match), and the already-added rule — `setlistfmId` first, then artist + date + `venuesFuzzyMatch`, with a same-artist-same-date-different-venue case reported as a weaker signal rather than folded into either answer.
- `addShow` was not safe to call in a loop: it derives its doc id from `Date.now()` and closes over the render's `shows` array. Its document construction and Firestore write are now `buildShowDoc`/`writeShowDoc`, ids come from a monotonic counter, and the new `addShowsFromTour` writes through the same pair — so there is one add path, not two. It writes one document at a time rather than as a batch, because a batch is all-or-nothing and partial failure is the normal case here. Aggregates (profile, community stats, rank, artist image) run once at the end instead of per show.
- **Festivals are now two documents.** `festivals/{id}` is the shared canonical record (`name`, `nameNormalized`, `startDate`, `endDate`, `location`, `edition`, `createdBy`, timestamps) and holds nothing personal; `users/{uid}/festivals/{id}` keeps its existing path and id and now holds `festivalId` plus the user's own notes and rating. No canonical field is copied onto the attendance record — that duplication is exactly the drift being removed, and it's why a creator's date correction is immediately visible to everyone who joined. `loadFestivals` joins the two at read time.
- A show's `festivalId` still points at the **attendance** record, not the canonical festival, so no show document had to be rewritten and pre-5.30.0 `/festivals/?festival=<id>` links still resolve.
- New `lib/festivalMatch.js` (+ 24 unit tests) holds the match rule with named constants, the way the run rule is defined: `MAX_START_DATE_GAP_DAYS = 3`, `MIN_NAME_SIMILARITY = 0.6` (token-overlap/Jaccard, chosen over edit distance because festival names differ by whole words), `MIN_NAME_LENGTH = 3`. Names are normalized (lowercase, punctuation and leading articles stripped, whitespace collapsed, trailing year dropped); the date test is a hard gate that no name similarity can override, which is what keeps Bonnaroo 2025 and Bonnaroo 2026 apart; location is a ranking tiebreaker and never rejects a candidate on its own.
- The dedup lookup is two bounded queries, both single-field ranges served by Firestore's automatic single-field indexes — a `nameNormalized` prefix range and a `startDate` window — unioned and then run through the real rule client-side. No composite index is needed, so `firestore.indexes.json` is unchanged.
- `firestore.rules` gains one collection, `festivals`, modelled on the existing `venues` block: readable by any signed-in user, creatable by any signed-in user with field validation (required keys present, no extra keys, name 1–120 chars, both dates `yyyy-MM-dd`, end not before start), updatable only by `createdBy` or the admin account with `createdBy` pinned, and **never deletable by a client**. The per-user rule is unchanged. This is the only place anything became readable to more people — festival names, dates and locations, which is the entire point of the change; no personal field did.
- New `netlify/functions/admin-migrate-festivals.js`, dry-run by default, following the `admin-cleanup-duplicates` conventions. Groups every user's existing festivals by the same match rule (ported into the function, since it's CommonJS with no `@/lib` resolution), creates one canonical per group with the earliest-created record winning every field, and repoints each user's record in place. It reads and writes no shows, deletes no notes or ratings, logs every disagreement between group members instead of silently picking, and leaves any record that fails to write exactly as it was — which still renders on that user's Festivals page. Idempotent in both directions: it seeds its grouping from the canonical festivals already in the catalog, so a rerun reuses them and a record that failed the first time joins the canonical the first run created. `scripts/festival-migration-dryrun.js` exercises the planner offline against fixtures covering the merge, the edition guard, same-name-different-city, single-day, and year-boundary cases.
- `DeleteFestivalModal` becomes `LeaveFestivalModal`.

---

## [5.29.1] — 2026-09-02

### Changed: Festival Lineup Search Uses the Festival's Own City and Dates
- The lineup search no longer asks you to type anything. A festival already knows its name, location and date range, so the search just uses them — the modal shows what it's searching and you press one button.
- **How it finds a lineup now:** setlist.fm has no festival entity *and no date-range parameter* — only an exact `date` and a `year`. A festival is therefore reconstructed as "everything logged in this city on these days", querying one exact date per festival day. This matters: a year-scoped city query returns that city's whole year newest-first, so for anywhere busier than a small town the festival's dates fall off the end long before the page cap. The per-day query returns the festival and nothing else.
- City is now the primary key rather than the venue, because a festival's setlist.fm venue is its grounds, not its name — BottleRock is logged at "Napa Valley Expo", Bonnaroo at "Great Stage Park". Searching the city on the right days finds those without having to know either. Venue-name resolution, and a year-scoped venue/tour-name search, remain as fallbacks when a festival has no location set.
- **New "By artist" mode** — for a festival setlist.fm covers thinly, type just the band you saw; the dates and city are already filled in from the festival. Same bulk-select, same dedup, same one-action add.
- A festival with no location gets a note explaining that adding its city sharpens the search, rather than silently returning worse results.

### Technical
- `netlify/functions/search-festival-lineup.js` reworked around day-scoped queries: `daysInWindow` enumerates the festival's days in UTC (so month/year boundaries are exact and no local timezone shifts a day, capped at 10), and each day's query is issued in parallel rather than in series. Strategy order is now city+date → venue+date → venue+year → tour/venue-name, with the chosen one reported back as `strategy` for debugging. New `artist` parameter drives the single-artist mode.
- Unit tests: 11 new cases in `lib/__tests__/festivalLineup.test.js` covering day enumeration (multi-day, single-day, month and year boundaries, the cap, malformed and reversed windows) and location parsing.

---

## [5.29.0] — 2026-09-02

### Fixed: Festivals You'd Already Created Didn't Open
- Root cause: 5.28.0 moved a festival's detail page onto a `/festivals/<id>` dynamic route. This app is a static export (`output: 'export'`), where a dynamic segment only ever serves the exact paths listed in `generateStaticParams` — in practice just the `_` placeholder. Every real festival id fell through `netlify.toml`'s `/* → /index.html` catch-all, which boots the app on the My Shows page: clicking one of your festivals silently dumped you somewhere else, so festivals you'd created looked like they'd vanished. (The same constraint is why `/songs`, `/runs` and `/tours` all use query params.)
- Festival detail now lives at `/festivals/?festival=<id>`, the form 5.28.0 had been *redirecting away from*. Old `/festivals/<id>` links 301 to the new URL.
- The list also shows a loading state on first paint instead of the "no festivals yet" empty state, and a festival read that Firestore rejects now says so rather than looking like an empty account.
- Fixed a related crash: every error path in the app calls `setToast({ message, type })`, but the toast rendered its value directly as a React child — an object, which throws and takes the whole page down. So a failed festival write showed a blank screen instead of an error. Toasts now render the message (in red for errors).
- The create/edit festival form no longer keeps the previous festival's values the next time it's opened.

### New: Search a Festival's Lineup and Bulk-Add the Bands You Saw
- Adding shows to a festival no longer means picking one at a time from shows you'd already logged. "Search lineup" on a festival looks the event up on setlist.fm and returns every band that played it inside the festival's own dates, as one checkbox list — tick everyone you actually saw, add them all in one action.
- Each pick does double duty: it's logged as one of your shows (with its full setlist, same as a normal setlist.fm import) *and* attached to the festival.
- Anything you'd already logged is detected and attached rather than duplicated, using the same artist + venue + date check the manual add and setlist.fm import already run. Already-logged results are labelled as such in the list.
- A set that's already in a *different* festival is reported instead of being moved silently, with a "move it here anyway" confirmation — same behaviour as the existing picker.
- If setlist.fm has no lineup for what you typed, the search says so and points you back at the "pick from my own shows" flow. Festival creation never depends on the search succeeding.

### New: Tours Filtering, Favorites, and First-Timers
- The Tours list gains filters for year, artist, and favorites, plus a text filter, and now sorts by the number of stops you caught by default (the tour you followed hardest first) — with Recent / Artist / Rating as alternatives.
- Tours can be starred as favorites, from either the list or a tour's page. Same star convention as the Wishlist.
- A tour's page gains "New songs on this tour": every song whose first-ever performance in *your* logged history landed on one of that tour's stops, with the date and venue you first heard it and a link to the song's page. A tour with no first-timers gets a proper empty state.
- Everything on a tour's page that represents something else now links to it: each stop opens that show, the artist and each stop's venue drill into your shows there, and every new song opens its song page — with the same chevrons and hover states as the rest of the app.
- A show's tour name is now a link to that tour, on both the show detail header and the Show Stats card. Shows whose tour name doesn't resolve to a tour in your history stay plain text rather than linking somewhere empty.

### Changed: Wishlist Page Order
- The per-artist Wishlist now reads, top to bottom: **Songs I want to see** (your starred songs), **All songs**, then **The songs I've seen** — stacked full-width rather than side-by-side columns, so it reads the same way on a phone.
- "All songs" is new: setlist.fm's full live catalog for that artist unioned with everything you've logged, so seen, unseen and starred songs are all in one list, all starrable, with play counts and a "you've seen this N×" marker. It replaces the old "songs you haven't seen" list rather than adding a fourth section.
- Star toggles, play counts and persistence are unchanged.

### Technical
- New `lib/favoriteTours.js` + `hooks/useFavoriteTours.js` — one `favoriteTours/{uid}` doc holding a map of starred tour keys. Top-level collection + owner-uid field, the same shape (and for the same security-rule reason) as `wishlists`; `firestore.rules` gains a matching owner-only block including the `resource == null` read clause.
- New `netlify/functions/search-festival-lineup.js`. setlist.fm has no festival entity and no date-range parameter, so a festival lookup resolves the typed name to venues via `/search/venues`, pages that venue's `/search/setlists` for the year, filters to the festival's window client-side, and collapses to one entry per artist/date (keeping the fuller setlist when an artist played twice in a day). Caches into the existing `setlistCache` collection under a `festival_` key prefix.
- New `importShowsToFestival` in `context/AppContext.jsx`: one batched Firestore write for the new shows, then the existing `attachShowsToFestival` for all of them, so there's still only one attach path. It doesn't loop `addShow`, which derives its doc id from `Date.now()` and closes over the current `shows` array — N calls in a row would collide ids and clobber state.
- `lib/runIndex.js` gains `tourHref`, per-tour `years`, and `newSongsOnTour` (cross-references a tour's stops against `lib/songIndex.js`'s existing `firstSeen`, rather than aggregating performances a second time). `lib/festivalGrouping.js` gains `festivalHref`, now the single source for festival links.
- Removed `app/festivals/[festivalId]/`; `app/festivals/page.jsx` serves both list and detail.
- Unit tests: 7 new cases in `lib/__tests__/runIndex.test.js`, new `lib/__tests__/festivalLineup.test.js` (8 cases).

---

## [5.28.0] — 2026-09-01

### New: Create & Manage Festivals
- Festivals are now something you create, not something the app guesses at: give one a name, a date range, an optional location and notes, then attach any of your existing shows to it from a searchable picker (defaults to shows within the festival's dates, but you can search outside that range too).
- The Festival detail page groups your attached shows by day, lists every artist you caught (each linking to that artist's shows), and shows attended / distinct artists / days / your average rating across the festival.
- Shows attached to a festival get a small badge on the Shows list and on the show detail page (alongside the "Night N of M" run badge when both apply — a show can be part of a run and a festival at the same time).
- A show can only belong to one festival at a time — trying to attach a show that's already in a different one surfaces that instead of silently double-attaching, so you can choose to move it.
- Deleting a festival only removes the grouping — the shows in it are never touched.
- **Known limitation:** festivals are private to the account that creates them (same per-user storage as the rest of your data) — they aren't shared or deduplicated across users yet. Two friends at the same festival each create and maintain their own copy. A cross-user festival directory is a possible future migration, not part of this release.

### Changed: Tours Get Their Own Page; Notifications & Activity Move Under Profile
- Tours moves out from a tab on the Shows page into its own sidebar entry at `/tours`, with a proper landing list (sorted most-recent-first) in addition to the existing per-tour detail view.
- Notifications and Activity are no longer top-level sidebar entries — they're now reached from the Profile page (same pattern as the existing Friends link), at their same URLs (`/notifications`, `/activity`). Profile's sidebar badge now combines pending friend requests/invites and unread notifications, since it's the one place that count surfaces now.

### Removed: Auto-Detected Festivals
- The 5.27.0 "Tag a Show as a Festival" auto-detection/tagging feature (`lib/festivalIndex.js`, the `isFestival`/`festivalName` fields on Show, the "Tag as festival" control on the show detail page) is fully replaced by the explicit model above. Old tagged shows keep their `isFestival`/`festivalName` fields in Firestore as harmless orphaned data — the app simply no longer reads them.

### Technical
- New per-user Firestore subcollection `users/{uid}/festivals/{festivalId}` — `{ name, startDate, endDate, location, notes, createdAt, updatedAt }`. The link to a show is `festivalId` on the Show doc (not `showIds` on the Festival) since shows are already loaded in full into `AppContext`, making a client-side filter by festivalId cheap and always in sync.
- `context/AppContext.jsx` gains Festival CRUD (`createFestival`, `updateFestivalData`, `deleteFestival`) plus `attachShowsToFestival` (single batch write, enforces one-festival-per-show) and `detachShowsFromFestival`.
- New `lib/festivalGrouping.js` (pure day-grouping/stats over a festival's attached shows, reusing `formatDate`/`parseDate` so a festival spanning a year boundary groups correctly) wrapped by `hooks/useFestivalShows.js`, mirroring the existing `lib/runIndex.js` / `hooks/useRunIndex.js` pattern.
- New dynamic route `app/festivals/[festivalId]/`, following the same pattern as `app/shows/[id]/`; the old `/festivals/?festival=` query-param form now redirects to it.
- `firestore.rules` gains an owner-only rule for the new `festivals` subcollection; no new composite index was needed since all festival reads run client-side against the already-loaded `shows` array.
- Also includes the one-time changelog popup shown after login, shipped just after 5.27.0 but not previously called out here.

---

## [5.27.0] — 2026-08-31

### New: Tag a Show as a Festival
- Show detail pages get a "Tag as festival" control — name it (e.g. "Bonnaroo 2023") and it now shows up under the Festivals tab, even if you only logged one artist's set there.
- Festival grouping (`lib/festivalIndex.js`) previously only auto-detected a festival when 2+ distinct artists shared the same tour name — the common case of logging just your own artist's set at a festival was invisible to it. A manually tagged show now forms (or merges into) a festival group on its own.
- Tagged and auto-detected shows for the same event name merge into a single festival rather than splitting into two.

### Technical
- `Show` documents gain optional `isFestival` (boolean) and `festivalName` (string) fields, written via the existing generic `updateShowData`.
- Unit tests: 4 new cases in `lib/__tests__/festivalIndex.test.js`.

---

## [5.26.0] — 2026-08-31

### Changed: Bust-Out Severity
- Severity now weighs both shows and time since a song was last played, taking whichever band it clears first: minor at 50+ shows or 1+ year, major at 100+ shows or 2+ years, epic at 5+ years (no show-count band for epic).
- `netlify/functions/get-artist-song-stats.js` now also returns `showDates` (every distinct date the artist played across the fetched setlists) so "shows since" can be counted, not just days elapsed.
- The Profile setting is now a Sensitivity multiplier (`userProfiles/{uid}.bustOutSensitivity`, replacing `bustOutThresholdDays`) that scales both dimensions of every band together.

### New: Wishlist Last-Played
- The Wishlist column on `/wishlist` now shows how long it's been since each starred song was last played live, computed from the same setlist.fm catalog data already fetched for that page — no new call.

### Technical
- `lib/utils.js` gains `humanizeGapDuration` (moved out of `SongDetailView.jsx`, now shared with `WishlistView.jsx`).
- `hooks/useBustOutThreshold.js` replaced by `hooks/useBustOutSensitivity.js`.

---

## [5.25.0] — 2026-08-31

### New: Bust-Out Detection
- Setlists automatically flag bust-outs — songs returning after a significant absence — directly on the song name, no manual tagging required.
- Severity bands: 🔥 minor (90–180 days), 🔥🔥 major (180–365 days), 🔥🔥🔥 epic (1+ year). Tapping a badge expands the previous performance's date/venue with a link to it.
- User-configurable threshold (30/60/90/180/365 days) at Profile → Bust-Out Threshold, stored on `userProfiles/{uid}.bustOutThresholdDays`.
- Show detail pages get a "This show featured N bust-outs" sidebar card; song pages show the user's own personal bust-out status via their existing gap data.

### Technical
- `lib/bustOuts.js` computes bust-outs on demand from an artist's setlist.fm play history (reuses `get-artist-song-stats`, sharing its existing `song_stats_${mbid}` cache) merged with the user's own logged performances — no new Firestore collection, Cloud Function, or background job. This also means historical shows get bust-out flags immediately on first view, with no batch backfill needed.
- New: `hooks/useBustOutAnalysis.js`, `hooks/useBustOutThreshold.js`, `components/profile/BustOutSettings.jsx`.
- Unit tests: `lib/__tests__/bustOuts.test.js`.

---

## [5.24.0] — 2026-08-31

### New: Venue Bucket List
- Add a venue (not a specific show) to your Bucket List — a new "Venues" tab on `/bucket-list`, and an "Add to Bucket List" button on every venue page.
- Daily scheduled job (`netlify/functions/venue-bucket-list-notifications.js`) cross-references favorite artists' upcoming Ticketmaster listings against every user's bucket-list venues and sends a `venue_bucket_list_match` notification (push/email/both, configurable in Profile → Notifications) on a hit.
- New Firestore collection: `bucketListVenues`. Requires `npm run deploy:rules`.

---

## [5.23.0] — 2026-08-31

### New: Venue Verification
- Venue owners/managers apply to verify a venue (proof of ownership/management upload); reviewed in a new admin dashboard at `/admin/venue-verifications`.
- Verified venues show a blue checkmark, get a Venue Management Dashboard (`/venue-dashboard/[venueKey]`) to edit info, upload official photos, and post announcements.
- Users can report unverified venues claiming to be official, duplicates, or inaccurate listings.
- Introduces the app's first real Venue entity (`venues` collection + `/venues/[venueKey]` page) — previously venues only existed as denormalized text on each show.

### New: Year in Review
- Automatic annual concert recap (top artist, favorite venue, most-heard song, top-rated shows, achievements/milestones) at `/year-in-review/[userId]/[year]`, surfaced via a home-page banner mid-December through February.
- Shareable as a downloadable image (canvas-rendered), native share sheet, Twitter, email, or a public link with a per-year privacy toggle.

### Technical
- New Firestore collections: `venues`, `venueVerificationApplications`, `venueAnnouncements`, `venuePhotos`, `venueReports`, `yearInReviews`.
- New Storage paths: `venueVerificationDocs/`, `venuePhotos/`.
- Requires `npm run deploy:rules` before these features work in production.

---

## [4.0.0] — 2026-04-20

### Overview
Version 4.0 is a full design-system overhaul. Every screen has been rebuilt on a unified set of UI primitives, a consistent token-based Tailwind theme, and a new layout shell — while preserving all live data fetching, Firebase auth, and routing behaviour from v3.

---

### New: UI Primitive Library (`components/ui/`)

17 composable primitives replace one-off inline patterns throughout the codebase:

| Component | Purpose |
|-----------|---------|
| `Avatar` | User/artist avatar with fallback initials |
| `Badge` | Status and count badges |
| `Button` | Primary / secondary / ghost / danger variants |
| `Card` | Surface card with hover and active states |
| `Divider` | Horizontal rule with optional label |
| `EmptyState` | Illustrated empty-list placeholder |
| `Input` | Text input with label, error, and icon slots |
| `Modal` | Accessible dialog with backdrop dismiss |
| `PageHeader` | Page title + subtitle + action slot |
| `RatingStars` | Interactive 1–5 star rating |
| `SearchField` | Debounced search input |
| `SectionHeader` | Section heading with optional action |
| `Select` | Styled native select |
| `Skeleton` | Loading placeholder blocks |
| `Spinner` | Animated loading indicator |
| `StatTile` | KPI tile (value + label + trend) |
| `Tabs` | Horizontal tab bar |
| `Tag` | Pill label for genres/tags |
| `Textarea` | Multi-line input |
| `Tooltip` | Hover tooltip |

All primitives are exported from `components/ui/index.js` for single-import convenience.

---

### New: App Shell & Layout (`components/layout/`)

- **`AppShell`** — Root layout wrapper; wires sidebar (desktop) and mobile header/tab-bar together
- **`Sidebar`** — Collapsible desktop navigation with brand mark, nav links, and user avatar
- **`MobileHeader`** — Top bar for mobile with logo and notification slot
- **`MobileTabBar`** — Bottom tab bar for mobile (Shows / Stats / Search / Friends / Profile)
- **`AppFooter`** — Minimal footer with version and links

---

### New: Feature Components

**Shows**
- `ShowCard` — Grid card with cover art, artist, venue, date, and rating
- `ShowRow` — Compact list row variant
- `ShowHero` — Full-bleed hero for the show detail view
- `ShowCover` — Responsive cover image with gradient overlay
- `SetlistView` — Segmented setlist display with song numbers and encore marker
- `SideCard` — Sidebar related-show card

**Stats**
- `TopList` — Ranked list with bar-chart visualisation
- `YearHeatmap` — GitHub-style activity heatmap by year

**Profile**
- `ProfileHero` — User cover + avatar + display name header
- `AchievementCard` — Badge/milestone card

**Friends**
- `FriendCard` — Friend avatar, name, mutual-shows count, and action buttons

**Search**
- `SearchBox` — Full search UI with instant results
- `ResultRow` — Unified result row for artists, venues, and shows

**Upcoming**
- `UpcomingItem` — Upcoming-show list item with ticket-link CTA

---

### New: Brand Components (`components/brand/`)

- `LogoMark` — SVG pin icon, scalable
- `Wordmark` — "mysetlists.net" lockup (green + orange + gray)
- `Pick` — Standalone location-pin icon component

---

### Updated: App Pages

All pages in `app/` now import from the design system instead of ad-hoc markup:

- `app/shows/page.jsx` — Rebuilt with `ShowCard`, `PageHeader`, `AppShell`
- `app/stats/page.jsx` — Rebuilt with `StatTile`, `TopList`, `YearHeatmap`, `Tabs`
- `app/friends/page.jsx` — Rebuilt with `FriendCard`, `EmptyState`
- `app/profile/page.jsx` — Rebuilt with `ProfileHero`, `AchievementCard`, `StatTile`
- `app/search/page.jsx` — Rebuilt with `SearchBox`, `ResultRow`
- `app/upcoming/page.jsx` — Rebuilt with `UpcomingItem`, `EmptyState`

Real Firebase/API data fetching is **unchanged** — only presentation layer swapped.

---

### Updated: Tailwind Design Tokens

`tailwind.config.js` now maps CSS custom properties to semantic token names:

```
brand.DEFAULT / brand.light / brand.subtle   → green palette
amber.DEFAULT / amber.light / amber.subtle   → orange palette
base / surface / elevated / hover / sidebar  → background layers
subtle / active                              → border strengths
primary / secondary / muted                  → text hierarchy
success / danger                             → semantic states
theme-sm / theme-md / theme-lg / theme-xl   → shadow scale
```

---

### Updated: Streaming Links

- New `components/StreamingLinks.jsx` — renders Spotify, Apple Music, YouTube, and Bandcamp links from `lib/streamingPlatforms.js`
- `lib/streamingPlatforms.js` — platform metadata and deep-link helpers

---

### Other Changes

- `components/LandingPage.jsx` — Refreshed with new brand components and design tokens
- `components/SetlistEditor.jsx`, `ShowForm.jsx`, `TagFriendsModal.jsx` — Refactored to use UI primitives
- `components/WhatsNewModal.jsx` — Updated to surface v4.0 release notes in-app
- `e2e/` smoke tests updated for new component selectors

---

## [3.17.0] and earlier

See git history for previous release details.
