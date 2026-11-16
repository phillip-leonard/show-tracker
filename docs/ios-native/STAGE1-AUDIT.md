# SwiftUI Stage 1: Part 1 audit (Shows tab, show detail, adding shows)

Audit of `main` at `88a5475` (web 5.60.20, iOS 3.13.36, native 4.0.5), 2026-11-15. Report only: no app code changed. Production was read with two read-only scripts that print counts, never ids, names or text (`scripts/scan-show-decode.js`, and a one-off count of dates and states).

**Answered on 2026-11-15.** Approved as recommended, with song comments moved to Part 3b, a golden fixture for the upcoming-show shape, and the queued-show label "Waiting to sync". The calls are in [`DECISIONS.md`](DECISIONS.md) ("Stage 1").

## What needed a decision

| # | Question | Recommendation |
|---|---|---|
| S-1 | **Upcoming is a different collection.** The web keeps upcoming shows in `users/{uid}/upcomingShows`, with their own shape (`time`, `notes`, `ticketUrl`, `source`), not as future-dated shows. Production has **0** shows dated after today and 2 upcoming docs. Adding one is a direct client `setDoc` (no server function); normalize-show only takes them back out (kind `upcoming`, "I went"). | The Upcoming segment reads `upcomingShows`. Adding, editing and deleting an upcoming show writes that document directly, field by field, with the web's validation (`lib/upcomingShows.js`). It isn't a show document, so the normalize-show rule doesn't cover it, and no new function is needed. "I went" calls normalize-show `upcoming`. Ticketmaster/SeatGeek event search and tagging friends wait for later stages. (§1, §3) |
| S-2 | **The re-sync button needs to know the artist's source.** The web decides from `resolveSource` in `lib/setlistSources.js` (band source or not, label, whether it needs review), built from config files. No function answers that question. | Add a small public read-only function, `setlist-source`: `POST { artists: [{ name, mbid }] }` returns `{ id, label, isBandSource, requiresReview }` per artist, from the same `resolveSource`. The app asks once per band and caches the answer. No Swift copy of the registry. (§2, §5) |
| S-3 | **Setlist edits run on the device by design.** `lib/setlistEdits.js` is applied inside a client Firestore transaction, so Swift needs its own copy, as with `ShowDate`. Set grouping (`lib/setlistGrouping.js`) is the same. Neither has golden fixtures. | Port both, with new golden files `fixtures/setlist-edits/` and `fixtures/setlist-grouping/`, generated and checked by JS tests, the same pattern as `fixtures/dates/`. (§2, §5) |
| S-4 | **Offline adds.** The web builds the show on the device with the JS normalizer and writes it with `needsNormalization`. The native app can't, without building documents in Swift. | The native outbox holds **inputs only**, in a file, per user. The list shows a "Waiting to sync" row made from the typed fields, and normalize-show builds the show when the app is back online. Retrying is safe: the minted `showId` makes a second commit `alreadyNormalized`. Cost: the show isn't on other devices until the phone reconnects, and its songs can't be rated until then (its rating and comment travel in the input). (§4) |
| S-5 | **Web links for v1.x sections don't carry the sign-in.** `SFSafariViewController` has its own website data, so a page with the user's data shows the web's signed-out view until they sign in there once. A guest can't sign in on the web at all. | No web links inside the show page in Stage 1. Photos, comments, tags, "friends who were there", follow band and archival audio stay hidden until their stage. Whole-page v1.x links (Import, Advanced search) are offered to accounts only, with a line saying they'll sign in on the web once. Guests see a "create an account" prompt there instead. (§2, §3) |
| S-6 | **Shared rules with no server answer.** The run badge ("Night 2 of 3", `lib/runIndex.js`), the tour link (`buildTourIndex`) and "Seen 4×" play counts (`lib/songCounts.js`) all compute over the whole library. | Leave them out of Stage 1. Show the tour name as plain text. Decide server vs. fixture port with runs and tours (Stage 4) and stats (Stage 2). |
| S-7 | **Header counts.** The web shows `userStats/{uid}` when its `showCount` matches the shows on screen, and otherwise computes `lib/stats` locally. Swift mustn't copy `lib/stats`. | The show count is the list's own count. Bands, venues and average rating come from `userStats`. After a change, the app calls `recompute-my-stats` (debounced 3 s, as the web does) and the listener on `userStats/{uid}` updates the numbers. Until then they show the last value. |
| S-8 | **Clearing a value.** The web writes `rating: 0` and `comment: ''` when cleared. Every reader treats 0, null and absent alike (`validRating`, Swift `rating()`). | Native clears with `FieldValue.delete()`, matching the canonical shape ("absent when unrated/empty", `lib/showInputs.js`). Leave the web as it is. |
| S-9 | **Search scope.** The web's text filter matches artist or venue only. You asked for band, venue, city and song. | Native matches all four. Unfiltered lists match the web exactly. A search can find more than the same text finds on the web. |
| S-10 | **Song comments and "rate all unrated."** The web's show page has no song ratings at all: they're in the SetlistEditor sheet (Shows Together, Stats), which also has song comments and "rate every unrated song". | v1: rate a song, plus comment on a song (the same transaction path, cheap). "Rate all unrated" later. |
| S-11 | **PR split.** Part 3 is the riskiest and largest. | Split it into 3a (read view and field edits) and 3b (setlist editing and setlist operations), and put a server/fixtures PR before 3a. (§6) |

---

## 1. Show list (web `/shows`, `app/shows/page.jsx`, `context/AppContext.jsx`)

### Queries

| Data | Query | Where |
|---|---|---|
| Shows | `onSnapshot(collection(users/{uid}/shows))`, **the whole collection, no `where` or `orderBy`**. First snapshot deadline 10 s, then one `getDocs` with 15 s; loading always ends (`lib/liveShows.js`). | `AppContext.loadShows` (863) |
| Upcoming | `onSnapshot(collection(users/{uid}/upcomingShows))`, whole collection, sorted on the device (`sortUpcoming`: date ascending, then artist) | AppContext 772 |
| Header numbers | `userStats/{uid}` (server), used when `statsVersion` and `showCount` match; else `lib/stats` locally | AppContext 3590–3604 |

**Indexes:** none needed. Both reads are whole subcollections, and the only show index is `needsNormalization` (for the sweep). The largest library in production is 253 shows, so sorting and filtering in memory is fine. Native uses the same two listeners; no new indexes.

### Past vs. upcoming

- The web has no date split of `shows`: everything in `shows` is "My Shows", and upcoming is the other collection (S-1). Production: 1,503 shows, **0 dated after today**, 0 dated today; 2 upcoming, none past their date.
- An upcoming show stays upcoming through its own day (`isUpcomingPast`: `date < today`). "Today" is `lib/showDate.js today()`, the device's local day, which `ShowDate.swift` already ports with the five-time-zone golden rows.
- Native: **Past** = `shows` (all of them, so the count matches the web). **Upcoming** = `upcomingShows`. A show in `shows` dated after today is shown in Past with an "upcoming" badge. Production has none; this is a guard.

### Sort, filter, search, counts

| Web | Rule | Native Stage 1 |
|---|---|---|
| Default order | `parseDate(b) - parseDate(a)` (date descending), stable sort over snapshot order (document id) | Date descending, then document id ascending. Grouped by year (the web doesn't group). |
| Sort buttons | Only **Artist** and **Rating**; there's no button back to Date once one is picked (web bug, noted, not fixed) | Later |
| Text filter | `artist` or `venue` contains the text, case-insensitive (`lib/showFilters.js`) | Band, venue, city, song (S-9) |
| Year filter | `parseDate(date).getFullYear()`; options = distinct years, newest first | v1 (year picker) |
| Single-date filter | `show.date === filterDate` | Later |
| Band / venue arriving from Top Artists / Top Venues (`?artist=`, `?venue=`) | Seeds the text filter | v1 as band and venue filter chips (tap a band or venue in the detail) |
| Saved searches, Advanced search | `localStorage`; `/advanced-search/` | v1.x web link, accounts only (S-5) |
| Timeline / **By artist** tabs | `artistGroups` table with expand and rate | Later (Stage 4, bands) |
| Header | "N shows · X artists · Y venues" and four tiles (shows, artists, venues, avg rating) | v1 (S-7) |
| Row (`ShowCard`) | artist (tour link), date, venue, city, song count, comment, rating badge, friends, run badge, festival | Band, date, venue/city, rating, setlist status: **has setlist** / **missing** (218 shows in production have none) / **proposal waiting** (`setlistProposal.status == 'pending'`, 0 today) / **waiting to sync** (outbox) |

### Other things on the web list

| Item | Stage 1 |
|---|---|
| Empty state with Search / Bulk import | v1: signed-in, guest and no-results, each with + |
| Relive this night card | Later (Stage 2) |
| Year in Review card | Later (Stage 2) |
| Archive proposal review, Archive backfill card | Later. The row badge and the detail's Accept / Keep current cover a waiting proposal. |
| Friend-request / tag banner, pending email tags review | Later (Stage 3) |
| Venue view (`?venueKey=`) | Later (Stage 4) |
| iPad split view (list beside the show) | v1: `NavigationSplitView` when the measured width allows (DECISIONS, "Navigation"). |

### Deep links

`Core/DeepLink` already maps `/shows/?show=<id>` and the legacy `/shows/<id>` (DECISIONS Part 6) to `AppRoute.show(id:)`. Part 2 routes it to the detail placeholder; an unknown id gets "Show not found" with a way back, as the web does.

---

## 2. Show detail (web `components/shows/ShowDetailView.jsx`)

"Field" means one `updateDoc` of only that field. "Txn" means `editSetlist`: `lib/setlistEdits.js` applied in a `runTransaction` to the setlist as stored. Offline, or when the transaction can't run, it falls back to writing this device's setlist (last write wins). The web does the same.

| Section / action | Web write path | Server function | Stage 1 |
|---|---|---|---|
| Header: band, date, venue, city | — | — | v1 |
| Tour name | — | — | v1, as text (S-6) |
| Run badge, tour link | `lib/runIndex.js` over the library | none | Later (S-6) |
| Festival badge | reads `users/{uid}/festivals/{festivalId}` → `festivals/{id}` | — | v1 read-only name, no link (festivals are Stage 5) |
| **Show rating** 1–10 | Field `rating` (`updateShowFields`) | — | v1 (clear = delete, S-8) |
| Venue rating 1–10 (on the show) | Field `venueRating` (`updateShowData`) | — | v1 |
| **Show note** (the web's "note" is `comment`) | Field `comment` | — | v1 (guests too; see below) |
| Setlist by set and encore, `setBreak` legacy marker | — (`lib/setlistGrouping.js`) | — | v1 (port, S-3) |
| Band-source extras: segue mark, footnote, jam chart, debut | — | — | v1 (display) |
| `setlistNotes` (phish.net prose) | — | — | v1 |
| setlist.fm attribution (required by its terms), band-source credit, "now sourced from the Archive" line | — | — | v1 |
| **Rate a song** | Txn `rate` | — | v1 (not on the web's show page; it's in SetlistEditor, S-10) |
| Comment on a song | Txn `comment` | — | v1 (S-10) |
| Rate all unrated | Txn `rate-unrated` | — | Later |
| **Add a song** (name + set picker) | Txn `add`, `manuallyAdded: true`, `rating: null` | — | v1 |
| **Delete a song** (two taps) **+ Undo** (12 s) | Txn `delete`, then `restore {song, index}` | — | v1 |
| **Reorder within a set** (up/down), move to another set | Txn `reorder` (full new order; the stored copy's ratings win) | — | v1 |
| "Check this setlist" (`needsReview`) → "It looks right" | Fields `needsReview: false`, `needsReviewReason: null` | — | v1 |
| **Re-sync** from a band source (El Goose, Phish.net, songfish sites) | — | `resync-show { showId }` → `{ ok, fields, summary }` or `{ ok: false, reason }` | v1, needs S-2 |
| **Propose** (Internet Archive, `requiresReview`), review sheet, Accept | — | `propose-setlist { showId }` → `{ ok, result, setlist, summary }`; `accept-proposal { showId, result }` | v1 |
| **Stored proposal**: Accept / Keep current | — | `accept-proposal { showId }`, `reject-proposal { showId }` → `{ ok, fields }` | v1 |
| **Delete show** (confirmation) | `deleteDoc(users/{uid}/shows/{id})`, then `recompute-my-stats`. The web also rewrites the legacy profile counters; the native app must not. | none needed (owner's own document) | v1 |
| Share (copy link) | — | — | v1: `ShareLink` to `https://mysetlists.net/shows/?show=<id>` (owner and friends can open it, as on the web) |
| Play counts ("Seen 4×") | `lib/songCounts.js` over the library | none | Later (S-6) |
| Artist / venue info panels (Wikipedia, `get-entity-info`), "Shows seen" | — | `get-entity-info`, `enrich-artist` | Later (Stage 4) |
| Follow band | profile `favoriteArtists` | `resolve-artist` | Later (Stage 3, push) |
| Tag friends, "Friends who were there" | `showTags`, `send-email` | — | Later (Stage 3) |
| Photos and videos, comments (UGC) | `showPhotos`, `showComments`, `moderate-content` | — | Later (Stage 2 moderation, Stage 3). Hidden, not a web link (S-5). |
| Streaming links, archival audio (Relisten) | `archivalAudioPick` field | `archival-audio-lookup` | Later |
| Create playlist | — | — (`PLAYLIST_CREATION_ENABLED = false`) | No |

**Ratings and comments survive every setlist operation on the server.** `setlistOps.apply` refuses a setlist that would lose a note (`would-lose-notes`, `lostNotes`) inside a transaction against the stored show. The app only sends ids and shows the answer: it writes nothing to `setlist` after an operation, and the listener brings the stored result. `reorder` in `setlistEdits.js` takes each song's rating and comment from the stored copy, so a reorder never undoes a rating made elsewhere.

**Guests:** the web hides every setlist action for guests, because its guests are local-only. Native guests are anonymous accounts, and DECISIONS allows "their own shows … re-sync and the setlist operations", so every v1 action above is available to guests. Firestore rules allow it (owner write), and `lib/setlistOpsHandler.js` takes anonymous tokens.

### Swift specifics that matter

- **Edit raw maps, not the model.** `Song` is `Decodable` only and drops keys it doesn't know (production has `setBreak`, and songs carry source fields the model may not list). The transaction must read `setlist` as `[[String: Any]]`, apply the edit to those maps, and write them back, so no unknown key is lost. The decoded model is for display.
- **Keep this device's setlist while an edit is in flight.** A transaction isn't in the listener's view until it commits, so a snapshot would briefly undo the edit. Port `mergeShowsSnapshot`'s rule: an in-flight setlist and a still-saving show keep the device's copy.
- **Transactions offline.** `runTransaction` doesn't work offline. Use the network state (`NWPathMonitor`) plus a short deadline, then fall back to `updateData(["setlist": deviceCopy])`, as the web does. With persistence on, that write is queued and survives a force-quit.

---

## 3. Add flows

Every path ends in `normalize-show` (`POST { mode: 'preview'|'commit', input | inputs[≤25] }`, bearer token, 3,000 inputs per user per day, per-IP setlist.fm limit). An answer is `{ show, duplicate, band, festivalMatches }`, plus on commit `{ written, created | updated | mergedInto | needsConfirmation | alreadyNormalized, showId }`. The native `ShowInput` / `NormalizeShow` types (Part 4 of the kickoff) already encode the inputs, and `ShowInputTests` checks them against `fixtures/shows/`.

| Way to add | Endpoints (in order) | normalize-show input | Fixture | Stage 1 |
|---|---|---|---|---|
| **Search setlist.fm** (artist, then pick among same-named artists; or venue/city alone) | `search-artists?artistName=` → `search-setlists?artistMbid|artistName&year&venueName&cityName&p=` (20 per page) | `{ kind: 'setlistfm', setlist }` (setlist.fm's JSON as returned) | `setlistfm-search.json`, `setlistfm-row.json` | **Part 4** |
| Band-specific source | No separate search: normalize-show asks the band source for the night and merges it (`band.reason`) for `setlistfm` and `manual` inputs alike | — | `setlistfm-band-source.json`, `manual-band-source.json` | **Part 4**, through the same calls. A Goose show missing from setlist.fm is a manual add; the server fills its setlist. |
| **Manual** | — | `{ kind: 'manual', artist, venue, city, date (YYYY-MM-DD), setlist?, rating?, comment? }`. The web form has no city or setlist; the server takes both. | `manual-typed.json`, `error-no-artist.json` | **Part 4**. Date picker → `ShowDate` ISO day, local calendar. |
| **AI ticket scan** | `analyze-tickets { images: [{ base64, mediaType }] }` (1–10, ≤4 MB each) → `{ shows: [{ artist, venue, date, city }] }`; then per row `search-artists` + `search-setlists?…&year=` (400 ms apart) | `setlistfm` for a picked match, otherwise `manual` with the row's fields | — | **Part 5**, accounts only. Errors: 401 → sign in, 403 `account_required` → sign-in prompt, 429 → daily limit, 413/400 → image, 422 → nothing readable, 502 → try later. All are already typed in `Core/API/APIError`. |
| Upcoming → "I went" | `search-setlists` (artist + year, ≤3 pages) to find the night | `{ kind: 'upcoming', upcomingId, setlistfmId? }`, then delete the upcoming doc | `upcoming-converted.json` | Part 4 |
| Add an upcoming show (manual) | direct `setDoc` to `upcomingShows` (S-1); duplicate = same artist and date | — | — | Part 4 |
| Search "by artist" mode, **Add all**, tour bulk add | `search-artist-shows`, every page of `search-setlists`, `get-tour-shows` | `setlistfm` (or `row`) in batches with `confirmPossible` | `setlistfm-row.json` | Later (Stage 4) |
| Screenshot import | `analyze-screenshot` | `manual` rows | — | v1.x web link, accounts only (S-5) |
| CSV / XLSX import | — (`lib/importSheet.js`) | `csv-row` | `csv-row.json` | v1.x web link, accounts only |
| Festival import / attach | `search-festival-lineup`, `match-festivals` | `festival-row` | `festival-row.json` | Stage 5 |
| Accept a friend's tag / email tag | — | `tag`, `email-tag` (refused for guests) | `tag.json`, `tag-upcoming-past.json` | Stage 3 |
| Bucket list "mark attended", heard tool | — | `manual` | — | Stage 4 / web only |

**Duplicates** (`lib/showIdentity.js classifyDuplicate`, on the server):

1. `setlistfm-id` (same setlist.fm setlist) or `same-show` (same band, calendar day and venue): nothing is created and the answer is `mergedInto: <existing id>`. The app says "already in your shows" and opens that show.
2. `possible` (same band and day, venue spelled differently or missing): `needsConfirmation: true`, nothing written. The app asks, with the web's wording ("You already have X on D at V. Add W as a separate show?"), and on yes sends the same input with `confirmPossible: true` and the same `showId`.
3. Fixtures: `duplicate-setlistfm-id.json`, `duplicate-same-show.json`, `duplicate-possible.json`.

After a commit the app opens the new show's detail (`showId`, or `mergedInto`), and calls `recompute-my-stats` (debounced). The listener delivers the document.

---

## 4. Offline (proposed native outbox)

Firestore persistence is on, so field edits made offline are already queued by the SDK and survive a force-quit. Adds are the hard part, because the show must come from normalize-show (S-4).

**The outbox**
- A JSON file per uid in Application Support (`outbox-<uid>.json`), written atomically. Each entry: `{ showId (minted, ShowID.mint), input, enqueuedAt, state: queued | needsAnswer | failed }`.
- **Adding:** mint the id, append the entry, then try `commit`. Online, it usually commits at once. Offline (`APIError.offline`) or on a 5xx, it stays queued.
- **Flush:** at launch once signed in, on `NWPathMonitor` reconnect, on return to the foreground, and on pull to refresh. Up to 25 per request, in order. An entry is removed only when the server answers for it: `created`, `alreadyNormalized`, `updated` or `mergedInto`. A 4xx input error (`bad-input`, …) marks it `failed`, and the row offers Edit or Delete.
- **No duplicates on retry:** the server's transaction on `users/{uid}/shows/{showId}` returns `alreadyNormalized` if the first attempt landed but its answer was lost (force-quit mid-request, a dropped connection). A second device can't send the same entry.
- **A possible duplicate found later:** the entry becomes `needsAnswer`, and the row asks the question. A yes resends with `confirmPossible`.

**What the user sees before the server answers**
- A row in Past made from the typed or chosen fields (band, date, venue, city), marked **Waiting to sync**, merged into the list by `showId` until the listener has that document. Then the server's document replaces it.
- Its detail is read-only apart from rating and comment, which update the queued input (normalize-show takes them). Songs appear once the server has built the show.
- Toast: "Saved on this iPhone. It finishes saving when you're back online."

**Force-quit while queued:** the file outlives the process, so the next launch flushes it. Firestore's own queued field writes also replay at launch.

**Sign-out:** the 4.0.4 "changes that haven't synced" warning checks only Firestore's pending writes. It must also count outbox entries, or a queued add is lost without asking (Part 4).

**Never a spinner forever:** the list shows the cache at once (`Source.cache` on the first read, then the listener). The first-snapshot deadline (10 s) and read-once fallback (15 s) from `lib/liveShows.js` are carried over, and an empty cache offline shows "You're offline" with the empty state's +, not a spinner.

---

## 5. Gaps

### Server functions

| Gap | Needed for | Proposal |
|---|---|---|
| `setlist-source` (S-2) | Whether to offer re-sync, its label, and whether a review sheet is needed | New public read-only function wrapping `resolveSource`, no quota (config only), with a golden fixture of resolved cases |
| Upcoming-show writes (S-1) | Add / edit / delete upcoming | None needed (direct owner write, same as the web), if you agree |
| Run index, tour index, play counts (S-6) | Run badge, tour link, "Seen N×" | Decide in Stages 2 and 4 |

Nothing else is missing: create (`normalize-show`), every setlist operation (`resync-show`, `propose-setlist`, `accept-proposal`, `reject-proposal`), stats (`recompute-my-stats`, `userStats`) and the AI scan (`analyze-tickets`) exist and accept the native app's callers. `SetlistOperation` in `Core/API/Endpoints.swift` already encodes four of the five bodies; `accept-proposal` with a proposed `result` (the Archive review) still needs adding.

### Fixtures to add (contract tests for every write payload)

- `fixtures/setlist-edits/`: setlist before, edit, setlist after (every edit type, including reorder keeping a stored rating, restore at a shrunk index, an unknown song key surviving), from `lib/setlistEdits.js`.
- `fixtures/setlist-grouping/`: setlist → sets and labels, including legacy `setBreak` and soundcheck (`set` absent).
- `fixtures/show-edits/`: the field-update payloads (`rating`, `venueRating`, `comment`, clears, `needsReview`) and the setlist-op request bodies.

### Models (production vs. kickoff Part 4)

`scripts/scan-show-decode.js` against production today: **every document decodes** (1,503 shows, 2 upcoming, 46 profiles and stats, 128 tags, 8 email tags, 10 suggestions). One field the model doesn't read: `populatedFrom` (1 show, admin populate). Add it to `Show.ignoredFields`.

Fields the web's detail reads that the model doesn't have, none present in production today: `setlistSourceChange` (the Archive credit line), `tourName`, and per-song `duration`, `tags`, `song`/`title` (older alternate names). Add `setlistSourceChange` in Part 3; the others stay unread.

Counts that shape the UI: 218 shows without a setlist, 0 with `needsNormalization`, 0 pending proposals.

---

## 6. Proposed PR split

Each from the latest `main`, each bumping the web version, the Capacitor `MARKETING_VERSION` and the native one (CLAUDE.md).

| PR | Contents | Notes |
|---|---|---|
| **0. Q-01 and "Welcome back"** (small) | Q-01 results and the 2026-11-15 decision in `Q01-SIGNIN-CARRYOVER.md` and DECISIONS. Sign-in screen: when installed over the Capacitor app (the first-launch report's WebKit check, remembered until the first sign-in) and nobody is signed in, "Welcome back. Sign in to see your shows. Everything you logged is still there.", with Forgot password next to email sign-in. | Separate, so it can reach TestFlight before the Shows work |
| **1. Server and fixtures** (web) | `setlist-source` function; `fixtures/setlist-edits/`, `fixtures/setlist-grouping/`, `fixtures/show-edits/` with their JS tests | No `ios/` or web UI change. Before 3a. |
| **2. Shows tab (read)** | `ShowsStore` (listener, cache first, deadlines), Past and Upcoming segments, grouped by year, rows with setlist status, search, year/band/venue filters, header counts from `userStats`, the three empty states with +, pull to refresh, `NavigationSplitView` when wide, deep link → detail placeholder | |
| **3a. Show detail: read and field edits** | Header, setlist by set (grouping port), notes, attribution, show and venue rating, comment, song rating and comment (raw-map transactions), "It looks right", delete show, share. Two-writer emulator test; contract tests against `fixtures/setlist-edits/` and `show-edits/` | The riskiest PR; kept small on purpose (S-11). **Built in 5.60.25** with the setlist read-only: song ratings and comments and "It looks right" moved to 3b with the setlist work; a queued show opens read-only (no rating or note until it syncs). |
| **3b. Setlist editing and operations** | Add song, delete with undo, reorder and move between sets; re-sync, Archive propose/review/accept, stored proposal accept/keep. Tests: after re-sync and accept the app writes nothing to `setlist`; stubbed answers from each op; ratings kept across a reorder made while another device rates | |
| **4. Add: search and manual** | + menu, setlist.fm search with artist picker and paging, manual form (band, date, venue, city, optional setlist), the duplicate prompt, the outbox (file, flush, Waiting to sync rows), sign-out warning counting the outbox, open the new show; upcoming add/edit/delete and "I went"; v1.x web links for imports (accounts only) | Airplane-mode, force-quit and reconnect run in the PR's TestFlight checks |
| **5. Ticket scan** | Camera and library (PhotosPicker), resize to ≤4 MB, `analyze-tickets` with typed errors, review screen with editable fields and setlist.fm matches, guests get the sign-in prompt, permission strings | |

### Not verified here

- Whether `SFSafariViewController` keeps a web sign-in between openings in this app (S-5). It should, since iOS 11 keeps website data per app, but check on a device before relying on it.
- Phillip's own list order against the web: checked in Part 2's TestFlight steps, since the audit scripts don't print anything about a single account.
