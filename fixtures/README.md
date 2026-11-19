# Shared fixtures

Golden input → output files that the web app's tests and the Swift app's
contract tests both read (ios-native/Packages/Core/Tests/CoreTests bundles
this folder through its `Fixtures` symlink). Each file is plain JSON so any
test runner can load it. Change one only on purpose: a changed expected
value is a number users see change.

## `dates/`

`show-dates.json`: stored show dates and how `lib/showDate.js` reads them
(`toIsoDate`, the legacy-shape buckets, year, month-day, ordering, days
between, setlist.fm's `DD-MM-YYYY`, past and upcoming, and the device's
"today" in five time zones). One row per case; `''` means unreadable. The
web side runs it in `lib/__tests__/showDateGolden.test.js`, the Swift side
in `ShowDateGoldenTests` (ios-native Core). Add a row to both by adding it
here.

## `shows/`

The show document every app writes, from each way of adding a show
(`lib/normalizeShow.js`, served by `netlify/functions/normalize-show.js`).
Each file is one case:

| Field | What it is |
|---|---|
| `name`, `description` | What the case pins down |
| `now` | The clock (`createdAt`, `setlistFetchedAt`) |
| `input` | What the app sends normalize-show: `kind` and its fields, with a client-minted `showId` |
| `context.setlistfm` | setlist.fm's setlist JSON by id, as the server would fetch it |
| `context.bandSetlist` | `/api/band-setlist`'s JSON for the night. Absent means the band source has no show that night (`{ ok: false, songs: [], shows: [] }`); it's only asked about bands that have a source |
| `context.showTags`, `pendingEmailTags`, `upcomingShows` | The documents a `tag`, `email-tag` or `upcoming` input reads |
| `context.existingShows` | The user's shows, for the duplicate verdict |
| `expected.show` | The document, with `id` (the document id, not a stored field) |
| `expected.duplicate` | `null`, or `{ showId, rule }`, rule one of `setlistfm-id`, `same-show`, `possible` (only ever a question for the user) |
| `expected.band` | `{ reason }`: `ok`, `no-show`, `not-a-band-source`, … |
| `expected.error` | For an input that is refused: its code (`bad-input`, `bad-kind`, `tag-not-found`, …) |

Song ids in the fixtures are `song-1`, `song-2`, … (the test's `idFor`);
in production they are the app's random ids. Compare documents as JSON
values, not as text: key order isn't part of the contract.

The canonical shape (which fields are always present, which are absent
when empty) is documented at the top of `lib/showInputs.js`. The web side
checks these in `lib/__tests__/normalizeShow.test.js`, which also checks
that the web app's current add path builds the same document. To
regenerate after a deliberate change:

```
UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/normalizeShow.test.js
```

## `setlist-edits/` and `setlist-grouping/`

A user's edit to a setlist (`lib/setlistEdits.js applySetlistEdit`), and
how a setlist is split into sets and encores and rearranged in the editor
(`lib/setlistGrouping.js`). The edits run on the device, inside a
Firestore transaction against the stored setlist, so both apps have their
own copy of these rules; these files keep them the same (5.60.22). The
web side runs them in `lib/__tests__/setlistFixtures.test.js`. The Swift
side decodes all of them (`SetlistAndUpcomingFixtureTests`), runs
`groups.json` with its port `SetGroups` (`SetGroupsTests`, 5.60.25), and
every edit case plus `move.json`, `reorder.json` and `options.json` with
its port `SetlistEdits` (`SetlistEditsTests`, native 4.0.11), survive-checks
included.

`setlist-edits/<type>.json`, one file per edit type (`rate`, `comment`,
`rate-unrated`, `add`, `delete`, `restore`, `reorder`), each with `cases`:

| Field | What it is |
|---|---|
| `setlist` | The setlist as stored |
| `edit` | `{ type, … }`, as `lib/setlistEdits.js` documents |
| `expected` | `{ setlist, changed }`, plus `removed` and `index` for a delete |
| `survives` | Songs that must still carry this `rating` and `comment` afterwards. Checked on their own, so regenerating `expected` can't accept an edit that drops a rating. |

`setlist-grouping/`: `groups.json` (`groupSongsBySet`, expected
`[{ label, songIds }]` in display order), `options.json` (`getSetOptions`,
the "which set?" picker), `move.json` (`moveSongToSet`) and `reorder.json`
(`reorderSongWithinSet`). The last two return the setlist the app then
sends as a `reorder` edit; they carry `survives` too.

Songs carry the fields production has, including ones the app doesn't
show (`transitionMark`, `footnote`, `jamchart`, `songSlug`, the legacy
`setBreak`). Every edit must keep them.

## `upcoming-shows/`

The upcoming-show document, `users/{uid}/upcomingShows/{id}`, which both
apps write directly (no server function; 5.60.22, DECISIONS "Stage 1").
From `lib/upcomingShows.js`: `create.json` (`newUpcomingRecord`, the new
document), `update.json` (`upcomingUpdate`, an edit's `updateDoc`
payload), `validate.json` (`validateUpcomingInput`, the form's messages,
with a fixed `today`) and `duplicate.json` (`findDuplicateUpcoming`).
`createdAt` and `updatedAt` are `serverTimestamp()` in production and the
file's `now` (an ISO string) here. The web side runs them in
`lib/__tests__/upcomingFixtures.test.js`.

## `show-edits/`

`fields.json`: the one-field write the native show page sends when the
show rating, the venue rating or the note (`comment`) changes
(`lib/showFieldEdits.js showFieldEdit`, 5.60.25), and the stored show
after it. `expected.edit` is `{ ok, set: { field: value } }`, `{ ok,
remove: [field] }` (Firestore's `deleteField()`: a cleared value is
absent, never `0` or `''`) or `{ ok: false, error }`; `expected.show` is
`show` with only that field changed. Every other field must come through
untouched, which the test checks on its own (R-06). The web side runs it
in `lib/__tests__/showEditFixtures.test.js`, the Swift side in
`ShowFieldEditTests`.

To regenerate any of these after a deliberate change:

```
UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/setlistFixtures.test.js
UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/upcomingFixtures.test.js
UPDATE_FIXTURES=1 node lib/__tests__/showEditFixtures.test.js
```

## `user-stats/`, `stats-keys/` and `recap-launch/` (5.60.27, Stage 2)

`user-stats/*.json`: `{ name, description, shows, expected }`, where
`expected` is `computeUserStats(shows)` (`lib/stats/index.js`), the numbers
the server writes to `userStats/{uid}` (plus `ranked`, `rank`, `rankedOf`
and `computedAt`, which depend on other users). The top lists are the top
10, all time: `topBands` and `topVenues` as `{ name, count }`, `topSongs` as
`{ name, artist, count }` counted by shows (a reprise is one show), per band.
The Swift side decodes each `expected` in `UserStatsFixtureTests`.
Since 5.60.32 (Stage 4) `expected.years` holds each dated year's numbers by
the same definitions, plus `showsByMonth` (twelve counts, January first);
`years.json` covers a legacy date and a show with no readable date.

`stats-keys/keys.json`: `[input, key]` rows for `bandKey` and `songKey`
(`lib/stats/keys.js`) and `venueCountKey` (`lib/venueCount.js`), the
identities those numbers count by. The native app uses them to list your
shows for a band, song or venue.

`recap-launch/window.json`: when Stats promotes the year's recap
(`lib/recapLaunch.js` `recapPromoActive`, an ES module the native app can't
run): `promoStartsAt` (inclusive) and `promoEndsAt` (exclusive), UTC, the
link's `path`, and `[moment, promoted]` cases.

The web side checks all three in `lib/__tests__/statsFixtures.test.js` and
`lib/__tests__/recapLaunchFixture.test.js`. To regenerate after a deliberate
change:

```
UPDATE_FIXTURES=1 node lib/__tests__/statsFixtures.test.js
UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/recapLaunchFixture.test.js
```

## `song-index/`, `runs/` and `user-count/` (5.60.32, Stage 4)

`song-index/gaps.json`: `{ today, shows, expected }`, where `expected` is
`buildSongIndex(shows, { today })` (`lib/songIndex.js`): per song key, times
seen (distinct shows), first and last seen, the current gap (shows of that
band since, days to `today`), the longest gap, and every performance with
its set label, position, opener, closer, encore and segues. Gaps count only
this person's own shows of the band.

`song-index/keys.json`: rows for `artistSlugFromName`, `songSlugFromTitle`,
`songKeyFor` and `songKeyFromParams`, the song page's identity. It is not
Stats' `bandKey` (Stage 4 call C): "goose (US)" is its own song page.

`runs/*.json`: `{ today, shows, venuePairs, expected }`, where
`expected.runs` is `buildRunIndex`, `expected.tours` `buildTourIndex` and
`expected.newSongsOnTour` each tour's `newSongsOnTour` against the song
index (`lib/runIndex.js`); `venuePairs` are `[a, b, venuesFuzzyMatch(a, b)]`
(`lib/showIdentity.js`), the venue rule a run uses.

`user-count/threshold.json`: `[totalUsers, show]` rows for
`shouldShowUserCount` (`lib/userCount.js`): never below 1,000 users.

All three run in `lib/__tests__/libraryFixtures.test.js`
(`UPDATE_FIXTURES=1` to regenerate); the native app's Stage 4 PRs add the
Swift side.

## `festivals/` (5.60.36, Stage 5)

`festivals/dates.json`: `limits` (name length, year range, from
`lib/festivalMatch.js`); per festival shape, `festivalYear`, `isYearOnly`,
`festivalSortKey`, `festivalLastDay` and `showFitsFestival` against a set
of show dates; and `whenFields`, the dates `festivalWhenFields` writes from
a form's input (`null` is refused). The label isn't here: each app formats
dates its own way.

`festivals/stats.json`: `{ name, shows, expected }`, where `expected` is
`buildFestivalStats(shows)` (`lib/festivalGrouping.js`) on the shared keys
(Stage 5 call C): artists by `bandKey` with the first spelling, the average
over ratings from 1 to 10, days by ISO date (an unreadable date last, under
`''`, and not a day), and each day's show ids in order.

`festivals/joined.json`: an attendance record and its canonical festival in
(`canonical` is `null` when it can't be read, `"absent"` for a record from
before 5.30.0), `joinedFestival` out (`lib/festivalCatalog.js`): the object
`netlify/functions/festivals.js` answers with and every festival screen
reads, plus `cutShort`.

All three run in `lib/__tests__/festivalFixtures.test.js`
(`UPDATE_FIXTURES=1` to regenerate); the native Stage 5 PRs add the Swift
side.

## `year-in-review/`

Each file is one case:

| Field | What it is |
|---|---|
| `name`, `description` | What the case pins down |
| `year` | The calendar year being summarized |
| `shows` | The user's whole show history, as stored in `users/{uid}/shows` (with `id`) |
| `expected.yearInReview` | `computeYearInReview(shows, year)` (`lib/yearInReviewStats.js`): the `/year-in-review` page and the public copy in `yearInReviews/{uid}_{year}.stats`, which the server writes |
| `expected.recap` | `computeYearRecap(shows, year)` (`lib/yearRecap.js`): the 2026 recap, the My Shows banner and the Stats card, without the band-history sections (rarest catch, bust-outs) and the show buddy, which need data outside the shows |

`null` means the year has no shows. Fields that are absent in `shows`
(a show with no city) are absent in the output too, as Firestore stores them.

The definitions behind every number (one band = `bandKey`, one song =
`songKey` heard once per show, one venue = name + city, dates in any stored
format read as calendar days) are in `lib/stats/index.js` and the header of
`lib/yearInReviewStats.js`.

The web side checks these in `lib/__tests__/yearInReviewFixtures.test.js`,
in three time zones. To regenerate after a deliberate change:

```
UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/yearInReviewFixtures.test.js
```

then read the diff.
