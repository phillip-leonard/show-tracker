# Internet Archive (Grateful Dead)

How MySetlists uses the Internet Archive's Grateful Dead collection (`collection:GratefulDead`) as a setlist source, and what keeps that use within the Archive's permission. This is not legal advice.

## Permission

Internet Archive Patron Services, October 26, 2026, request 1669802:

> "If the materials are available on the site feel free to use them."

That covers the metadata MySetlists reads: item descriptions, info `.txt` files and track titles. MySetlists holds itself to these conditions on top of it:

1. **Attribution.** Every Grateful Dead setlist from the Archive links back to the archive.org item (the tape) it was read from.
2. **Polite requests.** Every archive.org request is made from a server, is rate-limited and cached, and sends a User-Agent that names MySetlists with a contact URL.
3. **No audio.** Recordings are link-out only. MySetlists never downloads, proxies, stores or rehosts audio.

## Where it lives

- `config/internet-archive.json`: the switch (`enabled`), the collection, the artists it covers, protected titles and excluded dates.
- `netlify/functions/lib/archiveAdapter.js`: every request to archive.org for setlists, and how a setlist is chosen from a night's tapes.
- `netlify/functions/band-setlist.js`: the only route the app uses to reach the adapter (`/api/band-setlist?source=archive`), with the cache.
- `netlify/functions/admin-resync-setlists.js`: the backfill, which calls band-setlist's handler in-process with the adapter's request gap set.
- `netlify/functions/archival-audio-lookup.js` and `components/shows/ArchivalAudioSection.jsx`: "Listen to This Night", through Relisten.
- `components/shows/BandSourceAttribution.jsx` and `netlify/functions/lib/archiveAttribution.js`: the credit line.
- `tests/setlist-cache/archiveAttribution.test.js`: pins the three conditions above.

## Audit, October 28, 2026

### 1. Attribution

A show saved from the Archive stores `setlistSource: 'archive'`, `sourceShowId` (the item identifier) and `sourcePermalink` (`https://archive.org/details/<identifier>`). The credit reads "Setlist via the Internet Archive, recording `<identifier>`", linking the item. It's followable, and falls back to a link built from `sourceShowId`, then to the collection page.

**Found:** the credit appeared on the show page, the review screen (`ArchiveSetlistReview`) and the proposal diff (`SetlistProposalDiff`) only. Four places showed an Archive setlist with no link:

- run nights (`RunDetailView`): `lib/runIndex.js` didn't pass the source fields through
- Shows Together (`ShowsTogetherView`)
- the setlist editor (`SetlistEditor`)
- the public show page `/u/<handle>/shows/<id>` (`public-show.js`)

**Fixed in 5.48.1:** these four now show the credit. The show page's inline credit moved into `BandSourceAttribution`, which all four app views use. As a side effect, El Goose and Phish.net setlists get their credit in those views too.

Not changed, because they show counts and not a setlist: stats, songs, song history, Year in Review, shared collections (song counts only). The public Grateful Dead band page (`/artist/grateful-dead`) is built from setlist.fm (`config/public-artists.json`), not the Archive, and credits setlist.fm.

### 2. Requests

- **Server-side only.** archive.org is requested only from `archiveAdapter.js` (setlists) and, through Relisten, from `archival-audio-lookup.js`. The app and iOS build call `/api/band-setlist` and never archive.org directly. iOS runs the same web code and has no native networking for this. The app's other archive.org URLs are links (item pages, "Browse on Archive.org").
- **Rate-limited.**
  - One lookup makes its 2 to 5 requests one at a time, never in parallel, inside a 6.5-second deadline.
  - The backfill sets a 1-second gap between requests (`ARCHIVE_REQUEST_GAP_MS`), cache misses included.
  - A 429 or 5xx is thrown, never cached as "not found", and the caller serves the stale cache entry or an error.
  - Single lookups have no gap and no limit across function instances. They are started by a person adding or checking one Grateful Dead show, so the volume is small.
- **Cached.**
  - `bandSetlistCache` in Firestore keeps a found setlist for up to 30 days and a "nothing found" for 7 days.
  - A lookup cut short by its deadline isn't cached.
  - Relisten results are cached in `archivalAudioShowCache` (180 days found, 7 days not found).
- **User-Agent.** `MySetlistsApp/1.0 (https://mysetlists.net; contact@mysetlists.net)`, the same in both functions, on every request including the one followed redirect. It names MySetlists and gives a contact URL, so it was left unchanged.
- **Redirects.** Only one redirect is followed, and only to an `archive.org` host.

### 3. Audio

**Found compliant.** The adapter downloads one kind of file: an item's info `.txt`, chosen by `txtFileName`, which accepts only `.txt` names. Track titles come from the item's metadata (its file list), not from the audio files. "Listen to This Night" lists recordings from Relisten and opens the chosen one on Relisten or archive.org, in a new tab on the web and in the in-app browser on iOS. No `<audio>` element, player, proxy or stored audio exists anywhere in the app.

## Keeping it this way

- A new view that shows one show's setlist renders `<SetlistfmAttribution show={show} />` and `<BandSourceAttribution show={show} />` together. The test fails if a view has the first without the second.
- A new archive.org request goes through `archiveGet` in `archiveAdapter.js`, so it gets the User-Agent, the redirect rule and the request gap.
- Any change that would play, fetch or store audio needs a new permission request first. The approval above covers what's on the site, not rehosting it.
