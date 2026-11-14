# Shared fixtures

Golden input → output files that the web app's tests and the Swift app's
contract tests both read. Each file is plain JSON so any test runner can load
it. Change one only on purpose: a changed expected value is a number users
see change.

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
