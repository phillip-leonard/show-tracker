# Pre-native server moves: Part 0 audit

SCOPING §7.2 items 3, 4, 6 (remainder), 7 (Year in Review) and 8, plus R-06. Citations are `path:line` at `e6cd9bd` (`main`, 5.60.2 / iOS 3.13.18). `context/AppContext.jsx` has moved about 100 to 200 lines since SCOPING was written, so its old ranges (1754–2085, 2224–2264) are now 1629–1962 and 2101–2145.

## Summary

| Part | Size | Headline |
|---|---|---|
| 1. `normalize-show` | **L** (two PRs recommended) | 12 create paths. Three different duplicate rules. The offline pattern assumes a Firestore offline cache, but the app turns persistence off (`lib/firebase.js:98–110`). |
| 2. Resync, proposals, scan | **M** | Most of the server side exists in `admin-resync-setlists.js`. The ratings guard is applied in only 3 of 8 setlist-writing paths, and `admin-populate-setlist` can overwrite rated songs today. |
| 3. Festival matching | **S** | Four copies of the rule, not two. Only one client caller (`FestivalFormModal`). |
| 4. Year in Review | **M** | Two calculators with different band keys, and neither uses `lib/stats`. Public `yearInReviews` numbers are written by the client. Launch is in 18 days. |
| 5. Field-level writes (R-06) | **M** | Every rating and comment edit rewrites the whole show from a copy loaded once with `getDocs` and never refreshed. Song edits inside `setlist` can't be field-level without a shape change. |
| 6. Item 6 remainder | **S** (rules part waits on `minSupportedIosVersion`) | `removeFriend` deletes from the other user's list. Shows Together and both suggestion scans read friends' full histories, including once per friend on every show add. |

Also found, outside these items. **Both are fixed in 5.60.3**, with production checked (read-only): 49 of 1,498 show documents carried the admin's address (scrubbed by `scripts/scrub-show-admin-emails.js`). No show has ever been written by a populate (none carries `populatedAt`), so no ratings were lost. Point-in-time recovery is enabled, but only since 2026-11-13 03:11 UTC.


- **`admin-bulk-import.js:150` writes `importedByAdmin: <admin email>` onto show documents, which friends can read.** This breaks the "no email on any document other users can read" invariant. Fold the fix into Part 1, with a backfill that removes the field.
- `admin-populate-setlist.js:159` refuses an overwrite only when `isManual` is true. A setlist.fm show with rated songs has `isManual: false`, so its ratings are replaced (`:247–255`). Fold the fix into Part 2.

## The structural problem every part runs into

The shared logic is ESM written against the `@/` alias (`lib/setlistSources.js:47–49`, `lib/bandSetlist.js:27–30`, `lib/bandSetlistMerge.js:45–46`, `lib/festivalMatch.js`, `lib/showDoc.js`, `lib/showIdentity.js`, `lib/setlistParser.js`). Netlify functions are CommonJS with no alias resolution, which is why the hand-maintained twins exist: `netlify/functions/lib/bandSetlistMergeRule.js` (587 lines vs. 535), `festivalMatchRule.js`, inline `toIsoDate` copies in `band-setlist.js:174`, `admin-resync-setlists.js:224`, `get-tour-shows.js:92`, `get-artist-tours.js:112` and `search-festival-lineup.js:103`, plus `artistNameKey` and `resolveBandSource` in `admin-resync-setlists.js:193–250`.

The pattern that already works is the one from 5.59.10 and 5.59.15: **CommonJS in `lib/` with relative `require`s**, imported by both the Next.js client and the functions (`lib/showDate.js`, `lib/venueCount.js`, `lib/stats/index.js:171`). To collapse the twins, convert the pure modules to that form (`showDoc`, `showIdentity`, `setlistParser`, the pure half of `setlistSources`, `bandSetlistMerge`, `festivalMatch`), delete the `*Rule.js` twins and their parity tests, and point the inline copies at `lib/showDate.js`. `lib/bandSetlist.js` stays split: its fetch half (`apiUrl`) is client-only, and the server calls `band-setlist.js` in-process, as `admin-resync-setlists.js:328` already does.

This conversion is the first commit of Part 1. Parts 2 and 3 depend on it.

---

## 0.1 Item 3: every path that creates or edits a show document

All client writes to `users/{uid}/shows` are in `context/AppContext.jsx`. No component writes shows directly (`components/AdminView.jsx:278,383` only reads them).

### Create paths

| # | Path | Entry (file:line) | Computed client-side before the write | Where it diverges from `buildShowDoc` / `showIdentity` |
|---|---|---|---|---|
| 1 | setlist.fm search, single add | `components/SearchView.jsx:220` → `addShow` `AppContext.jsx:1417` | `setlistToShowData` (`lib/setlistSearch.js:23–37`): ISO date via `fromSetlistfmDate`, `extractSongsFromSetlist`, tour. Then dedup `findDuplicate`, `enrichShowDataWithBandSetlist` (`lib/bandSetlist.js:347–397`), `buildShowDoc`, `writeShowDoc` (`AppContext.jsx:83–87`) | **`artistMbid` is not stored**, although `setlist.artist.mbid` is present, and `resolveSource` uses the mbid. Dedup (`showIdentity.isSameShow`) ignores `setlistfmId` and compares venue exactly. |
| 2 | setlist.fm "Add all" | `SearchView.jsx:241–290` → `addShowsFromTour` `AppContext.jsx:1528` | Same `setlistToShowData`, then per show enrich, `buildShowDoc`, `writeShowDoc` | **A different dedup rule**: `lib/tourBrowse.js:152–196` (`setlistfmId`, then artist and exact date string with a *fuzzy* venue). This breaks the CLAUDE.md rule that "the same show" is decided only by `showIdentity`. |
| 3 | Tour bulk add | `components/tours/TourBrowseModal.jsx:420` → `addShowsFromTour` | Candidates from `get-tour-shows.js` (its own `toIsoDate`, `:92`) | Same as #2 |
| 4 | "Songs I've heard" save | `components/heard/HeardSaveModal.jsx:90` → `addShowsFromTour` | Candidates from the heard import | Same as #2 |
| 5 | Manual form (and bucket-list "Mark attended") | `components/ShowForm.jsx:30`; `app/shows/page.jsx:155` → `addShow` | `{artist, venue, city, date: defaultShowDate()}` | No divergence: `isManual` true and the band source tried. |
| 6 | AI ticket scan, setlist.fm match | `components/TicketScanner.jsx:227–249` → `addShow` | **A copy of `setlistToShowData`**, written inline | The same fields today, but it's a second definition that can drift. |
| 7 | AI ticket scan, no match | `TicketScanner.jsx:251–262` | `{artist, venue, city, date: toIsoDate(...)}` | No divergence |
| 8 | Screenshot and CSV import | `components/ImportView.jsx:188` (`analyze-screenshot`) → table → `:282` `importShows` → `addShow({silent})` | `matchShow` (`lib/importMatch.js:169–230`): its own band-source fetch, `canAutoApply`, `bandSetlistShowFields`, or setlist.fm. `showDataFor` (`lib/importSheet.js:271–294`) sets `rating`, `comment`, `state` and **`setlistProposal` at create time** | **A third dedup rule**: `importSheet.showKey` (`:118`) is artist and date, with no venue. The band source is fetched twice (match, then `addShow`'s enrich, which is cached). |
| 9 | Festival lineup import | `components/festivals/FestivalLineupModal.jsx:135–148` → `importShowsToFestival` `AppContext.jsx:2447–2528` | `setlistfmId` map, `findDuplicateShow`, `findDuplicate(fresh)`, enrich, `buildShowDoc`, then **`writeBatch` with its own `set`** (`:2499–2503`) instead of `writeShowDoc` | The `writeBatch` copy skips `writeShowDoc`'s date re-normalization. Harmless today because `buildShowDoc` already normalized, but it's a second write definition. |
| 10 | Upcoming → convert | `app/shows/page.jsx:78` → `convertUpcomingShow` `AppContext.jsx:2944–2960` | `upcomingToShowData` (`lib/upcomingShows.js:167`) with an optional `setlistToShowData` | No divergence (goes through `addShow`) |
| 11 | Accept a friend's tag, accept an email tag | `acceptShowTag` `AppContext.jsx:3109–3157`; `acceptPendingEmailTag` `:3193–3209` | `...tagData.showData` (written by the *tagger*: `sanitizeShowForTag` `:2662–2675`) | **Songs are cut down to `{id, name}`**, so the friend's copy loses `set`, `cover` and `tape`. `isManual` is sent but recomputed. The upcoming-tag branch (`:3124`) builds its own small object. |
| 12 | Guest rescue on sign-up | `rescueLocalShows` `AppContext.jsx:1168–1207` → `mergeGuestShows` (`lib/guestMerge.js:37–70`) | `buildShowDoc` + `migratedFromLocal`. Writes after confirmation | No band-source enrich (guest shows were enriched when added). |
| A | Admin bulk import | `netlify/functions/admin-bulk-import.js:130–152` | Server-side, its own shape | `isManual: true` always, **no `toIsoDate`**, no `setlistSource`, ids from `baseTimestamp + i`, **`importedByAdmin` holds an email**. |

### Edit paths that change normalized fields

- `saveShow` (`AppContext.jsx:1341–1357`): `setDoc(merge)` of the whole in-memory show, date re-normalized. See 0.6.
- `updateShowData` (`:1606–1626`): `updateDoc` of the given fields, date normalized.
- `mergeTagDataIntoShow` (`:1366–1382`): `updateDoc` of `taggedBy` and `taggedByUid` on a duplicate.
- Festival attach and detach (`:2381, 2415, 2536`): batch `update` of `festivalId`.

### Details the golden fixtures must pin down

- **Song ids are random**: `extractSongsFromSetlist` uses `Date.now().toString(36) + Math.random()` (`lib/setlistParser.js:31`). "Byte-identical" output needs an id seam. Either the server mints deterministic ids (for example `${setlistfmId}-${i}`), or the fixtures compare with ids masked. **Decision needed** (my recommendation: inject an `idFor(index)` seam, keep the current format in production, and use a fixed seed in fixtures).
- `createdAt` is a local ISO string in memory and `serverTimestamp()` in Firestore (`writeShowDoc`). Fixtures should treat it as a placeholder.
- `setlistFetchedAt` is `new Date().toISOString()` (`lib/bandSetlist.js:233`). Same treatment.
- Absent, `null` and `''` are used interchangeably for `tour` and `artistMbid` (SCOPING §3.2). The server should pick one: I propose `null` for `tour` and omitting `artistMbid` when it's unknown.

## 0.2 Item 4: resync, proposals and the missing-setlist scan

### Client (`context/AppContext.jsx`)

| Function | Lines | Reads | Writes | Ratings guard |
|---|---|---|---|---|
| `scanForMissingSetlists` | 1629–1781 | in-memory `shows`; `/api/search-setlists` (up to 9 requests a show); `band-setlist` | `updateShowData` `{setlist, setlistfmId, setlistfmUrl, isManual:false, setlistSource, tour}` (`:1749`) or band fields (`:1690`) | **None on the setlist.fm path**: it filters to empty setlists in memory, then writes without re-reading. Band path: merge rule only. **Only reachable from the admin button** (`components/AdminView.jsx:2504`), and then on the admin's own shows. |
| `proposeSetlistFromSource` | 1801–1835 | `band-setlist` | none | n/a |
| `applySetlistProposal` | 1845–1900 | in-memory show | `updateShowData(bandSetlistShowFields + extraFields)` | **Yes**: `userNoteCounts` before vs. after (`:1868–1873`), on top of the merge rule. Not in a transaction, so it judges the stale in-memory copy. |
| `acceptStoredProposal` | 1910–1938 | `show.setlistProposal` | through `applySetlistProposal`; on `would-lose-notes`, `setlistProposal.status = 'blocked'` (`:1931–1936`) | Yes, inherited |
| `declineStoredProposal` / `clearSetlistReview` | 1940–1952 | — | `setlistProposal` decided; `needsReview:false` | n/a |
| `resyncSetlistFromSource` | 1954–1962 | composes propose + apply; refuses `requiresReview` sources | — | Yes, inherited |

Callers: `app/shows/page.jsx:62–64, 315` and `components/shows/ShowDetailView.jsx:288–293`, `ArchiveProposalReview.jsx`.

### Server (already there)

- `admin-resync-setlists.js` (1,015 lines, plus a `-background` twin): walks every user, merges with `bandSetlistMergeRule`, writes band fields (`:848–852`) or, for the Archive, `setlistProposal` (`:840`, `buildProposal` `:348`), or source-only fields (`:835`). It has its own `noteCounts` and `lostNotes` (`:409–423`), **used only on the source-only branch** (`:831`). Dry run by default, cursor and budget, review accounts left out.
- `admin-find-missing-setlists.js`: a second, setlist.fm-only missing-setlist scan with `autoPopulate`. It writes `{setlist, …, isManual:false}` (`:323–331`) after a read without a transaction.
- `admin-populate-setlist.js`: populates one show. It refuses only `isManual && setlist.length` (`:159`), so a rated setlist.fm show can be overwritten (see the summary).

**So the guard exists three times** (the client's `userNoteCounts`, the server's `lostNotes`, and the merge rule itself) **and is skipped by 5 of the 8 setlist writers.** None of the writers uses a transaction.

### Proposed endpoints (one module, `netlify/functions/lib/setlistOps.js`, behind `requireUser` + `takeDailyQuota`)

| Endpoint | Request | Response |
|---|---|---|
| `propose-setlist` | `{showId}` | `{ok, reason?, source, proposal:{result, setlist, summary}}`. No write, as today. |
| `accept-proposal` | `{showId, result?, onlyIfEmpty?}` (no `result` = the stored `setlistProposal`) | `{ok, reason?: 'would-lose-notes'\|'has-setlist'\|'nothing-to-change'\|'ambiguous-date', before, after, summary, fields}` |
| `reject-proposal` | `{showId}` | `{ok, setlistProposal}` |
| `resync-show` | `{showId}` | `propose` then `accept`; refuses `requiresReview` sources (`needs-review`) |
| `scan-missing-setlists` | `{dryRun?: true, showIds?}` (own shows) / scheduled: all users, cursor | `{scanned, found, written, refused, results[]}`, logging counts only |

Every write is `runTransaction(read show → merge → guard → update)`. The guard is one function, `lostNotes`, run on every write path. `admin-resync-setlists` and `admin-populate-setlist` call the same module (admin scope is just a different uid list). `admin-find-missing-setlists` is replaced by `scan-missing-setlists`.

**Old builds:** 3.13.7+ keep their client resync and write directly. Their own client guard still runs there. Nothing they write is unreadable, and the shape doesn't change.

## 0.3 Item 8: festival matching

- Client: `findFestivalMatchesFor` (`AppContext.jsx:2101–2145`) runs a prefix query and a ±7-day `startDate` query on `festivals` (limit 20 each), drops festivals the user already joined, then calls `matchFestivals` from `lib/festivalMatch.js`. **The only caller is `FestivalFormModal.jsx:103`** (creating or editing a festival). No add or attach flow calls it today.
- Rule copies: `lib/festivalMatch.js` (ESM, 311 lines), `netlify/functions/lib/festivalMatchRule.js` (CJS, 211 lines, kept in sync by `festivalMatchParity.test.js`), **and two more inline ports** in `admin-migrate-festivals.js:61–100` and `admin-repair-festival-split.js:56–70`, marked "keep in step".
- Still client-only: the candidate query and the "already joined" filter. The client also keeps `normalizeFestivalName` (used to write `nameNormalized` in `createFestival`, which the rules validate) and `festivalNameProblem`, `festivalYear` and `isYearOnly` (form validation, `lib/festivalDates.js:12`). Those stay importable from the one CJS module.
- **Proposed:** `match-festivals` `{name, startDate?, endDate?, year?, location?}` → `{matches:[{id, name, startDate, endDate, year, location, score}]}`. In `normalize-show`, when a show's date and venue fall inside a catalog festival's window, the server returns `festivalMatches` as a *suggestion*. It never attaches the show itself, because attaching is a user choice today. Old builds keep their local copy and get the same results.

## 0.4 Item 6 remainder: cross-user writes and reads

#399/#407 closed accept, invite and referral (`friends.js`) and email lookup. What's left:

| What | Where | Problem |
|---|---|---|
| `removeFriend` deletes `users/{friendUid}/friends/{me}` | `AppContext.jsx:2648–2660` | A cross-user write, allowed by `firestore.rules:109–110` (`request.auth.uid == friendId`) |
| `getShowsTogether` reads the friend's whole `shows` collection | `:2963–2978` | A full-history read |
| `checkShowSuggestionsForNewShow` reads **every friend's whole history on every show add** | `:3027–3045` (called from `addShow` `:1484`) | A full-history read, N friends × M shows on each add |
| `runRetroactiveSuggestionScan` reads every friend's history once per device (localStorage flag) | `:3047–3077` (from `loadShows` `:841`) | A full-history read, repeated on each new device |
| `createShowSuggestion` writes a `showSuggestions` doc naming both users | `:2991–3025` | A shared doc, but the rules check participants. Fine as is. |

Rules: `firestore.rules:59–65` let any friend read a user's shows. After the server endpoints ship, that clause can go (owner and admin only). **But 3.13.7+ builds do Shows Together client-side**, so tightening the rule breaks them until `minSupportedIosVersion` passes the release that stops reading. Ship the endpoints now and tighten the rules in a later PR gated on that version.

**Proposed:** `friends.js` gains `remove`. `shows-together` `{friendUid}` → `{shows:[{myShowId, friendShowId, artist, venue, city, date}]}` (only the matches). `suggestion-scan` `{showId?}` → the server creates `showSuggestions` (`{created}`), replacing both client scans.

## 0.5 Year in Review

| | `lib/yearInReviewStats.js` (`computeYearInReview`) | `lib/yearRecap.js` (`computeYearRecap`, `computeShowBuddy`) |
|---|---|---|
| Used by | `/year-in-review` owner view (`app/year-in-review/YearInReviewClient.jsx:21`), which **writes the result to `yearInReviews/{uid_year}`** (`lib/yearInReview.js:30–38`), readable by anyone when `privacy == 'public'` | The 2026 recap page (`YearRecapView.jsx:33`), the My Shows banner (`YearInReviewCard.jsx:39`) and the Stats card (`RecapStatsCard.jsx:14`), gated by `lib/recapLaunch.js` (Dec 2 PST to Jan 15) |
| Date | `parseDate` from `lib/utils` (which is `lib/showDate`). OK | Same. OK |
| Venue | `venueCountKey`. Shared, OK | `venueCountKey`. OK |
| Band | **`trim().toLowerCase()`** (`:44`) | `artistNameKeyLoose` (= `lib/stats/keys.bandKey`). OK |
| Song | `normalizeSongTitle` + `forEachSongOncePerShow` | `songTitleKey` + `forEachSongOncePerShow` (= `stats/keys.songKey`) |
| Uses `lib/stats` (#407)? | No | No |
| Extra inputs | none | rarity: `/api/artist-shows` per band (`lib/yearRecapRarity.js:81`); show buddy: `showTags` query (`lib/yearRecapData.js:16`) |

**Size: M** to move server-side. Both calculators are pure, but rarity needs each band's history (the server can read the artist snapshot from Blobs in-process), show buddy needs `showTags`, and the shared `yearInReviews` doc has the same "numbers others see, written by the client" problem as B-05. The rules accept any `stats` from the owner (`firestore.rules:1085–1094`).

**Recommendation, given the Dec 2 launch is 18 days away:** in Part 4, take the "keep the client calculators" branch for the recap. Switch `computeYearInReview`'s band key to `bandKey`, have both calculators use `lib/stats/keys`, and add `fixtures/year-in-review/*.json`, plus a parity report (counts only) before shipping. Move only the public `yearInReviews.stats` write to the server (computed with the same module through `recompute-my-stats`), because that number is shown to other people. Leave full server storage of the recap until after the promo ends on Jan 15. The band-key change only alters numbers for users whose band names differ in more than case and spaces, which the parity report will count.

## 0.6 R-06: how show writes work today

- `loadShows` reads once with `getDocs` (`AppContext.jsx:828–837`). **No `onSnapshot` on the user's shows**, so the in-memory copy is never refreshed by another device's edits until the next load.
- `saveShow` (`:1341–1357`) does `setDoc(ref, wholeShowMinusId, {merge:true})`. A merge with every field means every field is written from the in-memory copy.
- Callers that go through `saveShow`, and so rewrite **`setlist` and every other field** from a possibly stale copy: `updateShowRating` (3334), `updateShowComment` (3355), `updateArchivalAudioPick` (3368), `addSongToShow` (3379), `updateSongRating` (3400), `updateSongComment` (3418), `batchRateUnrated` (3436), `deleteSong` (3464), `restoreSongToShow` (3487), `updateSetlistOrder` (3501), `tagFriendsAtShow` (2714).
- `updateShowData` is already a field-level `updateDoc`, but resync and scan pass the whole `setlist`.

Most at risk, in order:
1. `setlist`: song ratings and comments live inside the array. Any edit on either device, including a show-level rating, rewrites the whole array.
2. `rating` / `comment`: these clobber only because `saveShow` sends everything. The fix is simple.
3. `taggedFriendUids`: rewritten whole by `tagFriendsAtShow`. `arrayUnion` fixes it.

**The constraint that makes this M, not S:** Firestore can't update one element of an array, and "no data-shape change" keeps song notes in `setlist[]`. Song-level edits therefore need `runTransaction` (re-read the show, apply the edit by `song.id`, write). **Transactions fail offline.** Proposal:
- top-level fields use `updateDoc({rating})` and the like; `taggedFriendUids` uses `arrayUnion`
- setlist edits are expressed as operations (`rate song X`, `move X to i`, …): a transaction when online, falling back to `updateDoc({setlist})` (last-write-wins, as today) when offline
- a shows `onSnapshot` listener, so the in-memory copy stays fresh. This is a bigger change; it needs the same "fail loud, never hang" care noted in `lib/firebase.js`, so it could be its own PR

## Offline logging: the pattern's premise doesn't hold today

The brief says "the client writes the show locally (Firestore's offline cache)". **The app runs Firestore without persistence**, on purpose (`lib/firebase.js:98–110`: 5.36.4's `enableIndexedDbPersistence` hung every load). With only the in-memory cache:
- `addShow` awaits `writeShowDoc`, and an offline `setDoc` doesn't resolve until reconnect. The show isn't added to `shows` until then, and the UI waits.
- If the iOS WebView is killed before reconnect, the queued write is lost.

So the pattern isn't impossible, but step 1 needs a different store. **Proposal:** a device outbox using the same mechanism as guest shows (`lib/storage` → Capacitor Preferences or localStorage, with `lib/guestMerge.js`'s rule that a show leaves the device only after its write is confirmed):
1. Mint the id (`mintShowId`), build with the shared `buildShowDoc`, put it in the outbox and in `shows` immediately, and fire the Firestore write with `needsNormalization: true` and the raw input under `normalizationInput`, without awaiting it.
2. When online, call `normalize-show` `{mode:'commit', showId, input}`. The server writes the canonical doc to the same id (idempotent) and the outbox entry clears.
3. The sweep picks up `needsNormalization == true` (a collection-group equality query, served by a single-field index).

Old builds never set `needsNormalization`. Finding their non-canonical writes needs a full collection-group walk compared against the canonical shape. At today's scale (under 1,000 users) a nightly full walk is cheap. The sweep logs counts only and stamps `normalizedVersion` so a re-run is idempotent.

Nothing else in Parts 1–6 is blocked by offline. Parts 2, 3 and 6 are online-only features today, and Part 5's fallback is covered above.

## 0.7 Endpoints and compatibility

| Part | Endpoint(s) | Shapes | Old builds (3.13.7+) |
|---|---|---|---|
| 1 | `normalize-show` (authed, per-user daily quota; setlist.fm calls through `withProxyLimit`) | Request `{mode:'preview'\|'commit', showId?, input}` or `{…, inputs:[…≤25]}`, where `input.kind` ∈ `setlistfm {setlistfmId \| setlist}`, `band-source {artist, date, venue}`, `ticket-row {artist, venue, city, date, setlistfmId?}`, `manual {artist, venue, city, date, setlist?}`, `csv-row {…showDataFor}`, `festival-row {setlistfmId, festivalId}`, `tag {tagId \| pendingEmailTagId}`, `upcoming {upcomingId, setlistfmId?}`, `existing {showId}`, plus optional user fields `{rating, comment, taggedBy, taggedByUid}`. Response `{show, showId, written, duplicate: null \| {showId, rule:'same-show'\|'setlistfm-id', possible?:true}, festivalMatches?:[…]}` | Same field set, plus `normalizedVersion` and `needsNormalization:false`. Firestore maps tolerate unknown fields, and the show rules don't validate shape (`firestore.rules:64`), so old writes still pass. The sweep normalizes them. |
| 1 | `normalize-shows-sweep` (scheduled, hourly) and `scripts/normalize-shows.js` (dry run by default, `--apply`) | counts only | as above |
| 2 | `propose-setlist`, `accept-proposal`, `reject-proposal`, `resync-show`, `scan-missing-setlists` (plus a scheduled run) | see 0.2 | Old builds keep their client resync and guard. `setlistProposal` has the same shape as `admin-resync-setlists.js:348`. |
| 3 | `match-festivals` | see 0.3 | Old builds keep their client copy; results are the same |
| 4 | none new for the recap; `recompute-my-stats` also writes `yearInReviews/{uid_year}.stats` | `stats` has the same shape as `computeYearInReview` | The old client write stays allowed, and the server overwrites it on recompute |
| 5 | none (client) | — | n/a |
| 6 | `friends` `{op:'remove'}`, `shows-together`, `suggestion-scan` | see 0.4 | Old builds keep their direct reads; the rules stay open until `minSupportedIosVersion` moves |

## Decisions for you before Part 1

1. **Song id determinism** for golden fixtures (0.1). Recommendation: an injected id seam, with the production format unchanged.
2. **Offline store**: a device outbox instead of the Firestore offline cache (Offline section). Recommendation: outbox; leave persistence off.
3. **One duplicate rule.** `showIdentity` today ignores `setlistfmId` and is exact on venue, while `tourBrowse` is fuzzy on venue and `importSheet` ignores venue. Recommendation: extend `showIdentity` to check `setlistfmId` first, then artist, venue and day, and return the fuzzy-venue case as `possible` (tourBrowse's current behavior). Delete the other two.
4. **Year in Review route** (0.5). Recommendation: shared keys and fixtures now, with only the public `yearInReviews.stats` computed on the server, and the full server-side recap after Jan 15.
5. **Split Part 1 into two PRs**: 1a is the CJS conversion, `normalize-show`, fixtures and sweep (server only, no client change); 1b is the client cutover and outbox.
