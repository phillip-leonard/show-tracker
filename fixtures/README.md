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
web side runs them in `lib/__tests__/setlistFixtures.test.js`; the Swift
side decodes them now (`SetlistAndUpcomingFixtureTests`) and runs them
with its port (Part 3b).

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

To regenerate any of these after a deliberate change:

```
UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/setlistFixtures.test.js
UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/upcomingFixtures.test.js
```

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
