# setlist.fm compliance

How MySetlists brings its use of the setlist.fm API in line with setlist.fm's terms, in three phases. **Top priority throughout: no user loses stats.** This is not legal advice.

What the terms require, as read in October 2026 (last updated October 14, 2019):

- Non-commercial use only on the free key.
- No long-term copies. Caching is allowed "for short periods" only; the API is called and the data passed to users on receipt.
- An attribution link wherever setlist.fm data appears: the `url` in each response, or setlist.fm's home page, never `nofollow`.
- Data shown as-is.
- The key never shared.
- No scraping.
- The privacy policy discloses third-party access.

| Phase | What | Status |
|---|---|---|
| 1 | Short-lived cache, attribution, robots, privacy draft | **5.47.5, iOS 3.9.5** |
| 2 | Stop storing setlist.fm setlists; show them live from the cache | Planned below, not built |
| 3 | Migrate existing shows, with the safeguards below | Planned below, not built, never run without Phillip's approval |

## Part 1 findings (October 21, 2026)

- **Calls.** Every setlist.fm call runs in a Netlify function, none in the browser or iOS native code. The key is read only from `SETLISTFM_API_KEY` (`netlify/functions/lib/setlistfmKey.js`) and is absent from `out/` and `.next/`.
- **Key.** The production key had been committed to the public repo in January–March 2026 and never rotated. Phillip is rotating it.
- **Cache.** `setlistCache` held 944 responses (22.9 MB). 922 were expired, the oldest from March 4, 2026. TTLs ran up to 7 days, expired entries were served as a fallback, and nothing deleted them.
- **Stored setlists.** Song arrays sit on 992 setlist.fm show documents. Copies also live in:
  - `showTags` and `pendingEmailTags` (`showData.setlist`)
  - cross-user aggregates in `communityStats` and `publicArtistStats`
  - derived counts on `userProfiles`
  - Year in Review stats (`yearInReviews`)
  - shared collections
  - Netlify Blobs `public-artists` (`raw/` and `artists/` for 16 setlist.fm bands)
  - the guest `guest-shows` localStorage key
  - three localStorage caches that were never swept
- **Volume.**
  - 31 users, 21 with shows, 1,243 shows.
  - Shows per user: median 15, 90th percentile 156, max 253.
  - 945 distinct setlist.fm setlists (1,098 references).
- **Ratings.** Ratings and comments live on each song object in `show.setlist[]`, keyed by a random id. 429 non-null ratings across 68 shows, all setlist.fm.
- **Limits.** setlist.fm publishes no rate limits and sends no rate-limit headers. A burst of 12 concurrent requests all succeeded. The commonly cited standard key is 2/s and 1,440/day; Phillip is confirming the real numbers. Netlify Pro gives synchronous functions 10 s, scheduled 30 s and background 15 min.
- **Feasibility of on-demand stats, cold cache at 2/s:**
  - median user about 6–8 s
  - 90th-percentile user about 80–90 s
  - heaviest user about 2–2.5 min
  - warm cache under 2 s for anyone
  - All 945 setlists are about 66% of a 1,440/day quota, which is the binding constraint.
- **Attribution.** Band pages linked to setlist.fm correctly. The show page's link depended on a `url` field no show had, so **the app showed no setlist.fm attribution anywhere**.

## Phase 1: shipped in 5.47.5

- **One cache module.** `netlify/functions/lib/setlistCache.js` caps every entry at 24 hours, never returns an expired entry (no more "STALE" fallbacks), and writes `expiresAt` on every entry. It is used by `search-setlists`, `get-artist-tours`, `get-tour-shows`, `search-festival-lineup` and the new `setlistfm-links`.
- **Firestore deletes expired entries.** There is a TTL policy on `setlistCache.expiresAt`, declared in `firestore.indexes.json` and applied with `scripts/setlist-cache-ttl.js --apply`. It was applied on October 23, 2026, and the same run purged all 944 existing entries, every one either expired or written to outlive 24 hours. Rerun the script after this deploys to catch anything the old code wrote in between.
- **Device caches are swept.** `lib/setlistfmLocalCache.js` removes expired setlist.fm entries in localStorage on every app load.
- **Attribution everywhere setlist.fm data appears.**
  - The text reads "Source: {Band} setlist on setlist.fm", linking the setlist's own page.
  - The link is followable; where there is no specific URL it goes to setlist.fm's home page.
  - New imports store `setlistfmUrl` as a reference. Older shows get their URL from `netlify/functions/setlistfm-links.js` by `setlistfmId`, through the 24-hour cache, with 429 backoff and a time budget.
  - Where it appears:
    - show page
    - setlist editor
    - run nights
    - Shows Together
    - search results
    - tour browser, tour info
    - festival lineup
    - wishlist catalog
    - stats
    - song history and song pages
    - Year in Review
    - shared collection
    - public show, profile and shared pages
  - iOS uses the same web code.
- **Robots on `/u/*`.** These pages now send `noindex, follow` as both a header and a meta tag. `public/_headers` turned out not to apply to function responses, so before this those pages sent no robots directive at all.
- **Privacy policy.** A draft is in `docs/privacy-policy-sources-draft.md`, not published.

Not changed in phase 1 (all phase 2): stored setlists, ratings, cross-user aggregates, band-page snapshots, Year in Review storage, and friend-tag and shared-collection copies.

## Report: setlist.fm shows by band

Production, read-only, October 23, 2026. A show counts when it has a `setlistfmId` and no band source.

- **Total:** 1,089 setlist.fm shows across 312 bands. 192 bands have a single show, and the median band has one or two shows. So moving bands to other sources helps a lot at the top and not at all in the long tail.
- **Biggest single win:** Grateful Dead, 378 shows (35%) across 4 users. The Internet Archive adapter is already live, but each setlist needs the user's review before it applies (`requiresReview`).
- **Goose:** 20 shows across 6 users are still on setlist.fm although El Goose is live. The existing admin re-sync (`admin-resync-setlists.js`) moves them.
- **Waiting on written permission:** Tedeschi Trucks Band (TTBase, 24 shows) and Eggy (The Carton, 1).
- **Phish:** 15 shows. Phish.net allows 24 hours of display, not storage, so moving Phish doesn't reduce on-demand fetching.
- **Ratings are concentrated outside these bands.** Radiohead 86, Dead & Company 74, LCD Soundsystem 47 and Grateful Shred 39 hold most of the 429 rated songs, and none of them has a permitted source. The ratings re-keying in phase 3 has to work for setlist.fm bands regardless.

The full per-band table (band, shows, users, rated songs) was given to Phillip directly. It's left out of this public repo because at this user count some rows describe one person's listening.

## Phase 2: stop storing setlist.fm content (planned, not built)

### Data model for a setlist.fm show

**Kept, as references and the user's own data:**
- `setlistfmId` and `setlistfmUrl`
- `artist`, `date`, `venue`, `city`, `country`, `tour`
- attendance, show `rating` and `comment`, `taggedFriendUids`, `festivalId`, `venueRating`

**Removed:** `setlist[]`.

**Added, the user layer.** It's stored and is the user's own data:

```
userLayer: {
  songNotes: [ { pos, set, name, rating, comment } ],   // keyed by position + the name the user rated
  addedSongs: [ { afterPos, set, name, rating, comment } ], // songs the user added ("setlist.fm missed one")
  notHeard: [ { pos, name } ],                          // a deleted song becomes "didn't hear"
}
```

- `pos` is the song's 0-based index in setlist.fm's flattened setlist, and `set` is its set label. Together with `name` they identify what was rated.
- The song name is kept only where the user acted on that song (rated, commented, marked or added it). It's the user's own record, not a copy of the setlist.

### Showing a setlist

- `netlify/functions/setlistfm-setlists.js` takes up to 12 ids per call. That's 12 × 550 ms, about 7 s, inside Netlify's 10 s. It reads `lib/setlistfmSetlist.js#getSetlists`, the same cache phase 1 fills.
- `resolveSetlist(show, liveSetlist)` is a pure function that merges the live setlist with the user layer into today's `setlist` array shape. Components don't change. The merge rules, for each `songNotes` entry:
  1. Live song at `pos` has the same normalized name: attach.
  2. Otherwise, exactly one live song anywhere has that name: attach there, and record the move.
  3. Otherwise: **flag, never guess.** The note is shown in a "ratings that need a look" list under the setlist, with its stored name, and isn't attached to any song.
  4. `addedSongs` are inserted after `afterPos` and marked as the user's. `notHeard` songs are shown dimmed as "didn't hear" and excluded from the user's counts. Both are matched by the same rules.
- `useResolvedSetlists(shows)` fetches only on pages that need songs: show page, stats, songs, Year in Review, runs, Shows Together, song history, and search by song. It never runs on general page loads. One request at a time (the key is shared), in batches of 12, remembered for the session.
- Storage-permitted sources (`elgoose`, `archive`, user-entered, and Songfish sites marked `granted`) keep `setlist[]` exactly as today. Phish.net becomes a 24-hour source like setlist.fm, storing only its show id and permalink.
- Phish.net responses are cached in `bandSetlistCache` (`netlify/functions/band-setlist.js`). That cache still serves expired entries when the source is down ("STALE") and has no Firestore TTL policy, which is the same problem phase 1 fixed for `setlistCache`. Phish.net entries get the same treatment: no stale serving, `expiresAt` within 24 hours, and a TTL policy.

### Stats while loading

- Anything built from songs shows "Still loading 37 of 156 shows" and **no number** until every needed setlist has loaded or failed. It never shows a smaller number as if it were final.
- Shows whose setlists can't be loaded are counted and named: "3 shows' setlists unavailable: view on setlist.fm". Numbers that exclude them are labelled "at least".
- Show, band, venue and year counts don't depend on setlists and render immediately.
- Mixed users get one view: stored setlists for permitted sources, live ones for setlist.fm.

### Writes

These paths write references and the user layer, never `setlist[]`, for setlist.fm:
- add show, add-all
- tour browser, festival lineup, ticket scanner, import
- the "did you go" conversion
- `scanForMissingSetlists`
- admin populate, find-missing, bulk import and resync

Copies:
- Friend tags (`showTags`, `pendingEmailTags`) copy `setlistfmId` and `setlistfmUrl` only. The recipient's show resolves live.
- Guest mode stores references only in `guest-shows`.

### Cross-user and derived data

- `communityStats` top songs and `publicArtistStats` top songs come from storage-permitted sources only. MySetlists' own data (attendance counts, ratings) stays.
- Public band and song pages for the 16 setlist.fm bands keep MySetlists' own data and a setlist.fm link. Their `raw/` and `artists/` snapshots are deleted. **This removes visible content; needs Phillip's go-ahead per band page.**
- Year in Review is computed on demand. `yearInReviews` keeps the privacy flag and only counts that don't come from setlists (shows, bands, venues). A visitor to a public Year in Review sees those counts and, for the song sections, either a live computation from the owner's show references (needs a rules change to read them) or nothing. **Needs Phillip's decision.**
- `userProfiles.songCount` and `ratedSongCount` stop counting setlist.fm songs, or are dropped. They feed the community totals. **Needs Phillip's decision.**
- Shared collections store show references and render song counts live. Today they copy song names.

### Quota

- Phase 2 makes the daily quota the limit on how many users can open stats on the same day.
- Before building it: confirm the real limits, and ask setlist.fm for a higher non-commercial limit if they are 2/s and 1,440/day.
- `/search/setlists?artistMbid&year` returns 20 setlists per call and is the fallback for users with many shows by one band.

### Suggested PRs (each bumps the web and iOS versions)

1. The batch endpoint, `resolveSetlist`, `useResolvedSetlists` and tests, unused.
2. Display paths read live behind a flag. Stats loading states.
3. Write paths stop storing.
4. Cross-user features, after Phillip decides on band pages and Year in Review.

## Phase 3: migrate existing shows (planned, not built, not run)

`scripts/migrate-setlistfm-shows.js`. Dry run by default. A live run needs `--live --run=<id>` and Phillip's written approval for that run.

1. **Snapshot first.** For every user, compute stats from stored data with the app's own functions (`lib/songCounts.js`, `lib/songIndex.js`, `lib/yearInReviewStats.js`):
   - song counts, songs heard, ratings
   - per-year Year in Review numbers
   - song pages, runs

   Save them per user in `setlistfmMigration/<runId>/snapshots/<uid>`.
2. **Back up** every show document the run will touch into `setlistfmMigration/<runId>/backup/...`, with `expiresAt` = run + 7 days. A Firestore TTL policy deletes it after **7 days**. The backup is itself a copy of setlist.fm data; 7 days is the limit Phillip set.
3. **Per show, remove the stored setlist only if both hold:**
   - its `setlistfmId` resolves live, and
   - the live setlist matches the stored one: the same song names, in order, after normalization, ignoring `manuallyAdded` songs.

   When both hold, convert ratings and comments to `songNotes` (position + name) and `manuallyAdded` songs to `addedSongs`, set `setlistfmUrl`, and remove `setlist[]`.
4. **Don't touch, and flag for review:**
   - shows that don't resolve (404, deleted or merged on setlist.fm)
   - shows whose stored setlist differs from the live one. A user deletion and a setlist.fm edit look the same, so a difference is never auto-resolved into `notHeard`.
5. **Verify per user.** Recompute stats on demand from the migrated shows, through the same code path the app will use, and diff against the step 1 snapshot. **Any difference rolls back that user's shows from the backup and flags the user.**
6. **Copies.** Strip setlist arrays from `showTags`, `pendingEmailTags` and `sharedCollections`, and remove setlist.fm-derived aggregates, in the same run and with the same backup. Guest `guest-shows` is migrated on the device at next load.
7. **Report.** The dry run prints, per show, one of: will migrate (with its ratings re-keyed), no `setlistfmId`, no longer on setlist.fm, or setlist differs. Per user, it prints the stats diff it expects (none).

Quota: the dry run fetches all 945 distinct setlists once, about 8 minutes at 2/s and about 66% of a 1,440/day quota. Run it on a quiet day, or after a limit increase. The live run reuses the cache if it starts within 24 hours.

## Open decisions for Phillip

1. The real rate limits after the key rotation, and whether to ask setlist.fm for more.
2. Public band and song pages for the 16 setlist.fm bands: OK to drop setlist-derived content from them?
3. Year in Review for visitors: counts only, or a rules change so their browser can compute song sections live?
4. `userProfiles.songCount` / `ratedSongCount`: count permitted sources only, or drop?
5. Shared collections (`/shared/`) are `index, follow`. Keep, or match `/u/*`?
6. The app's own pages (`/shows/`, `/stats/` and so on) send `noindex, nofollow` from `public/_headers`. They are behind sign-in and setlist.fm links there aren't crawled, but `noindex, follow` would remove any doubt.
