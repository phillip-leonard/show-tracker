# Stage 5 audit: festivals

Part 1 of Stage 5, read against `main` at 28e1064 (web 5.60.35, Capacitor 3.13.51, native 4.0.40). [`PARITY-AUDIT.md`](PARITY-AUDIT.md) §2.14 is the inventory. This audit maps the festival data, confirms what moves to the server, and splits Parts 2–4. The calls (§8) were approved on 2026-11-19, and DECISIONS.md "Stage 5" records them. Ships in native 4.0.42; web and Capacitor unchanged.

## 1. Data model

Two documents per user per festival (since 5.30.0), joined when they're read.

| Document | Fields | Who writes it today | Rules today |
|---|---|---|---|
| `festivals/{festivalId}`: the shared, **canonical** festival, one per real edition | `name`, `nameNormalized`, `startDate` + `endDate` (ISO) **or** only `year`, `location`, `edition`, `createdBy`, `createdAt`, `updatedAt` | **The browser**: `createFestival` (create), `updateFestivalData` (the creator edits name, dates, location) | read: any signed-in user. create: `isAccount()`, `createdBy` is the caller, field allowlist, name 1–120, `festivalWhenIsValid`. update: the creator or the admin address, `createdBy` fixed, lineup fields unchanged. delete: never. |
| …lineup fields on it | `lineup` (names), `lineupSource` (`ticketmaster` or `seed`), `lineupUrl`, `lineupFetchedAt` | The server: `festival-lineup` (Ticketmaster, at most daily) and `admin-seed-festival-lineups` | No client may change them. |
| …catalog fields on it | `source: 'seed'`, `createdBy: 'system:seed'`, `seedKey`, `seedConfidence`, `genre`, `status` (`cut_short`), `notes` | The server: `admin-seed-festivals` | Not in the client allowlist. |
| `users/{uid}/festivals/{attendanceId}`: the private **attendance** record | `festivalId` (the canonical id), `notes`, `rating` (unused by any screen), `myLineup` (typed lineup, ≤300 names, private), `createdAt`, `updatedAt`. Records from before 5.30.0 have no `festivalId` and carry their own name and dates. | **The browser**: join, create, leave (delete), notes, `myLineup` | read and write: the owner, writes `isAccount()` only. |
| `users/{uid}/shows/{id}.festivalId` | The **attendance** id, not the canonical id. A show is in at most one festival. | **The browser**: attach, remove, leave (sets `null`); `normalize-show` (`festival-row` inputs from the lineup search) | Owner-only, as every show field. |
| `bandAffinity/{bandKey}`, `bandPopularity/all` | Count-only co-fan data | The nightly `band-affinity` job | read: signed-in; write: never. |
| `users/{uid}/discover/prefs` | `dismissed` bands (Discover "not interested") | The browser | Owner-only. |

Indexes: `festivals.festivalId` has a collection-group index (`festival-lineup` checks attendance with it).

**Shared vs private.** Only the canonical document is read by other people. Notes, the typed lineup, attached shows and ratings are private to each attendee. Account deletion (`userDataPurge`) deletes the attendance records and sets `createdBy: null` on canonical festivals the user made; the canonical festival stays for everyone else.

## 2. Cross-user writes and the server actions

| Action | Writes | Others read it? | Today | Proposal |
|---|---|---|---|---|
| Create | canonical + attendance | **Yes** (the canonical goes into everyone's matches) | browser, two `setDoc`s (private record first, so a failure strands nothing shared) | **Server** |
| Edit details (creator) | canonical | **Yes** (every attendee sees the change) | browser `updateDoc` | **Server** (not in the brief's list, but the same kind of write; see call A) |
| Join | attendance only | No | browser `setDoc`; "already joined" checked against the local list | **Server** (decided in the brief): checks the canonical exists and the caller hasn't joined, in one place |
| Leave | attendance (delete) + own shows (`festivalId: null`) | No | browser batch over the shows **this device has loaded**, then a delete | **Server** (decided): one batch over every show with that `festivalId`, found on the server |
| Notes, typed lineup | attendance, one field | No | browser `updateDoc` | Stays a direct field write (works offline, private) |
| Attach, remove shows | own shows, `festivalId` only | No | browser batch | Stays a direct field write (R-06: that field alone) |
| Lineup from Ticketmaster | canonical lineup fields | Yes | already the server (`festival-lineup`) | unchanged |

One function, `netlify/functions/festivals.js`, in the `friends.js` pattern: `POST`, `Authorization: Bearer`, `requireAccount` (guests get 403 `account_required`), reached through `authedFetch`. The festival rules are shared CommonJS in `lib/` (§4). Every answer's festival is the same **joined view** the web builds in `loadFestivals`:

```
festival = { id /* attendance id */, festivalId, name, startDate?, endDate?, year?, location, edition,
             isCreator, isSeeded, catalogStatus, catalogNote,
             notes, myLineup, lineup, lineupSource, lineupUrl }
```

| Action | Request | Response | Notes |
|---|---|---|---|
| `create` | `{ action: 'create', attendanceId, name, startDate?, endDate?, year?, location?, edition?, notes? }` | `{ ok, festival }` | Validated with `festivalNameProblem` and `festivalWhenFields`; `nameNormalized` built on the server. Both documents in **one batch** (the Admin SDK can, so the ordering workaround goes). `attendanceId` is minted by the app (as `mintShowId`), so a retry after a lost answer returns the festival it made instead of a second one. A daily limit per user (`takeDailyQuota`, say 20). 400 `{ error: 'bad-input', field, message }` names the field. |
| `join` | `{ action: 'join', festivalId, attendanceId }` | `{ ok, festival, already }` | 404 when the canonical doesn't exist. Already joined: the existing record with `already: true`, nothing written. |
| `leave` | `{ action: 'leave', attendanceId }` | `{ ok, detached }` | Clears `festivalId` on every show of the caller's that has it, then deletes the record, in one batch (up to 500 writes; more is chunked). The canonical is never touched, the creator's included. |
| `update` | `{ action: 'update', attendanceId, name?, startDate?, endDate?, year?, location?, edition? }` | `{ ok, festival }` | Creator or `isAdmin(decoded)` (the rules' admin address check becomes the one admin check). Catalog festivals: 403 with the web's "can't be edited here" message. Dates rewritten whole (both dates and year, or year only with both dates deleted), as `whenPatch` does. |

The web's `createFestival`, `joinFestival`, `leaveFestival` and the canonical half of `updateFestivalData` switch to these. Notes and `myLineup` stay as they are.

## 3. Screens and actions

| Web | Server path | Guests | Native notes |
|---|---|---|---|
| **List** (`FestivalListView`): newest first by `festivalSortKey`; name, when, location, show count; the shared show filter (search on artist or venue, year, date) narrows to festivals with a matching show; empty state "No festivals yet" with New festival; "No festivals match those filters" with Clear | Firestore: own attendance records + each canonical `getDoc` | The web says "Sign in to see your festivals"; native says **"Create an account to use Festivals"** (the Library row is already hidden) | Reads straight from Firestore, so the offline cache shows at once. A record whose canonical can't be read stays as "Unavailable festival", as on the web. The web's split view on wide windows follows the native list/detail pattern. |
| **Festival page** (`FestivalDetailView`): header (name, when, location; "Cut short" catalog note; "Added by another user" or "From the catalog"); tiles Shows Attended, Artists, Days, Avg Rating; notes (inline edit); artist chips → `/shows/?artist=`; shows grouped by day, each with remove | Firestore; stats from the shows on the phone (`buildFestivalStats`) | — | Stats are the owner's own: computed on the phone from cached shows (call C fixes the keys first). Artist chips open the band page (4-5) rather than a filtered list, or the filtered show list if that's preferred. |
| **Attach** (`AttachShowsModal`): search by artist, venue or date; within the festival's dates (or its year) unless "Show shows outside…"; multi-select; a show in another festival is a conflict, with "Move … here anyway" | own show field writes | — | Needs `showFitsFestival` (§4). |
| **Remove** a show | own show field write | — | — |
| **Lineup (read)** and **Your picks** (`FestivalPicks`): upcoming festivals ask `festival-lineup` (Ticketmaster, stored on the canonical; "The announced lineup" for seeded ones); else the typed `myLineup`; groups "Recommended for you", "Bands you love", "Everyone else"; shown for an upcoming festival or any festival with a lineup | `festival-lineup` (account, attendee only); picks scored **in the browser** with `lib/recommendations.js` from `bandAffinity` docs, the user's shows, followed bands and dismissed list | 403 | See call B. |
| **Enter or edit the lineup**: one name per line, deduplicated, ≤300, "Only you can see this" | own attendance field write | — | — |
| **Notes** | own attendance field write | — | — |
| **Create** (`FestivalFormModal`): name; start and end dates, or "I don't know the exact dates" and a year; location; notes; as you type, `match-festivals` (400 ms debounce) offers "Someone already added this festival" with Join; "Create it anyway" | today the browser; **`festivals.js` `create`** | 403 | — |
| **Edit** (creator: details; others: notes only, with an explanation) | today the browser; **`festivals.js` `update`** for details | — | Goes in Part 4 with the form (call A). |
| **Join** via the match list | today the browser; **`festivals.js` `join`** | 403 | Needs a second account to check. |
| **Leave** (`LeaveFestivalModal`): "Every show you had attached is kept"; creator note | today the browser; **`festivals.js` `leave`** | — | — |
| **Lineup search** (`FestivalLineupModal`): "Whole lineup" (Find who played) and "By artist"; warnings for no location and year-only; results with "Already logged"; Select all; import adds new sets and attaches existing ones, with the conflict prompt; setlist.fm credit | `search-festival-lineup` (public GET, `withProxyLimit`), then `normalize-show` `festival-row` inputs (`confirmPossible: true`) | — | `normalize-show` `preview` of the picked rows gives each one's `duplicate` (the server's `classifyDuplicate`), so native checks conflicts **before** writing, as the web does, without a Swift copy of the rule. Native already encodes `festival-row` (`ShowInput.swift`). "Already logged" is the web's simple key (setlist.fm id, or artist + venue + day). |
| **Festival badge on a show**: show page "<name> — view festival"; show list pill | — | — | Native already shows the name on the show page (`ShowsStore.festivalName`), not tappable. Part 3 makes it open the festival, and adds the list pill. |

**Links.** `/festivals` and `/festivals/?festival=<attendanceId>` (and the old `/festivals/<id>` 301) are in `fixtures/deep-links`. The id is the **attendance** id, so a festival link only works for its owner; someone else's link gets "Festival not found", on the web and in native.

**Nothing that can't work natively,** once picks have a server path (call B).

## 4. Shared logic

| Module | Module type | Native needs | Plan |
|---|---|---|---|
| `lib/festivalMatch.js` | CommonJS | No: `match-festivals` and the server's create validation use it | unchanged; `festivals.js` requires it |
| `lib/festivalDates.js` | ES module, `@/` imports | `festivalSortKey`, `festivalLastDay` (upcoming), `showFitsFestival` (attach picker), year-only rules | **CommonJS**, without `festivalWhenLabel` (it formats with `lib/utils`, which stays web-side; native formats its own). Fixture `fixtures/festivals/dates.json`, including the name and year limits. |
| `lib/festivalGrouping.js` | ES module (`parseDate` from `lib/utils`) | `buildFestivalStats` | **CommonJS** (`lib/showDate.js` for dates), with call C's keys. Fixture `fixtures/festivals/stats.json`. |
| `lib/festivalCatalog.js` | ES module | `isSeededFestival`, `catalogFields`, `isCutShort` | **CommonJS** (three one-liners); `festivals.js` builds the joined view with it. Covered by the joined-view cases in the stats fixture. |
| `lib/recommendations.js` | CommonJS | `festivalPicks` | Call B: run on the server, no Swift copy. |
| `lib/showIdentity.js` | CommonJS | duplicate check for the lineup import | Through `normalize-show` `preview` (§3), no Swift copy. |

**The festival stats as the web computes them don't use the shared keys** (call C): artists are counted by the name as typed ("Goose" and "goose" are two), the average counts any number (0 and out-of-range ratings included), and days are grouped by the date string as stored.

## 5. Old Capacitor builds

iOS 3.13.51 and earlier create, edit, join and leave from the phone. Once Part 2 ships (Capacitor 3.13.52), a `GATED-CLEANUPS.md` row, safe from **iOS 3.13.52**:

- `festivals/{id}`: `allow create, update: if false` (reads unchanged).
- `users/{uid}/festivals/{id}`: `allow create, delete: if false`; `allow update` only for the owner (`isAccount()`) and only `notes`, `rating`, `myLineup` and `updatedAt`, with `festivalId` unchanged.
- Emulator tests in `tests/rules/security.rules.test.js` and `discovery.rules.test.js`: each client write refused, the owner's notes and lineup update allowed, reads unchanged; `anonymous.rules.test.js` and the creator-edit cases in `discovery.rules.test.js` change with them.

**Before writing that row, Part 2 counts pre-5.30.0 attendance records** (no `festivalId`) in production. Their owners edit name and dates on their own record, which the tightened rule would refuse. If any are left, `admin-migrate-festivals` (dry run first) moves them, or the rule keeps those keys for records without `festivalId`.

## 6. Carry-over: "Different song titles" on the web

**There is no web tile to rename.** The web's Stats page shows Shows, "Songs heard" (`songCount`, performances) and Artists; Me shows Songs Heard and Songs Rated. `uniqueSongCount` reaches the web only as `summaryStats.totalSongs` in `AppContext`, which no screen reads. Native's "Different song titles" tile has no web counterpart (call D).

## 7. PR split

| PR | Contents | Kind |
|---|---|---|
| 5-1 | This audit and the DECISIONS entry. | docs (native) |
| 5-2 | **Server:** `festivals.js` (`create`, `join`, `leave`, `update`) with tests; the web switches to it; picks in `festival-lineup`'s answer (call B); `festivalDates`, `festivalGrouping` and `festivalCatalog` made CommonJS with call C's keys; `fixtures/festivals/`; the gated rules row; the pre-5.30.0 record count; call D. | server (web + Capacitor) |
| 5-3 | **List and page:** Library and `/festivals` links native; list, filters, empty states; page with stats, artists, shows; attach and remove; lineup (read); notes; leave; the show page badge and list pill open the festival. | native |
| 5-4 | **Create, join, edit, lineup search, picks:** the form with `match-festivals` and Join; the creator's edit; enter and edit the lineup; "Find who played" and "By artist" with import; Your picks. | native |

**Offline, everywhere:** the list and page read the Firestore cache and show at once; notes, the typed lineup, attach and remove are field writes that queue offline. Create, join, leave, edit details, matches, lineup search and picks need the server and say "You're offline" instead of spinning.

**TestFlight checks needing a second account:** join (5-4), and that a creator's edit shows for the joiner (5-4). Leave as creator (5-3) is checked by the second account still seeing the festival.

## 8. Calls (approved 2026-11-19, all as recommended)

| Call | Question | Recommendation |
|---|---|---|
| **A** | The creator's "edit details" also writes the shared document. Move it to the server with create, join and leave? | **Yes**, as `festivals.js` `update`, and native gets the edit form in 5-4. Otherwise the rules can't close client writes to `festivals`. |
| **B** | Picks are scored in the browser from `bandAffinity` docs. Port `festivalPicks` (and `recommend`) to Swift with a fixture, or score on the server? | **Server:** `festival-lineup` returns `picks` (the three groups, with each recommendation's reason text) alongside the lineup, from the caller's shows, followed bands and dismissed list, with the same `lib/recommendations.js`. The tuning (`SEEN_THRESHOLD` and the weights) stays in one place and changes without an app release. Cost: one read of the caller's shows per festival opened. The web keeps scoring in the browser with the same module. |
| **C** | The festival tiles use names as typed and any rating. Change to the shared keys? | **Yes, in both apps:** artists by `bandKey` (shown with the first spelling), the average over 1–10 ratings only (`validRating`, as Stats), days by ISO date. Pinned by `fixtures/festivals/stats.json`. |
| **D** | No web tile shows `uniqueSongCount`, so there's nothing to rename. | **Drop the carry-over** and remove the unused `summaryStats.totalSongs`. If you'd rather have parity, the alternative is a fourth web Stats tile, "Different song titles". |

**Versions:** 5-1 ships in native 4.0.42; 5-2 in web 5.60.36 and Capacitor 3.13.52.
