# Internet Archive (Grateful Dead and Live Music Archive bands)

How MySetlists uses the Internet Archive as a setlist source — the Grateful Dead collection (`collection:GratefulDead`) and, since 5.50.0, a few Live Music Archive bands (`collection:etree`, by exact `creator`) — and what keeps that use within the Archive's permission. This is not legal advice.

## Permission

Internet Archive Patron Services, October 26, 2026, request 1669802:

> "If the materials are available on the site feel free to use them."

That covers the metadata MySetlists reads: item descriptions, info `.txt` files and track titles. MySetlists holds itself to these conditions on top of it:

1. **Attribution.** Every setlist from the Archive, for every band, links back to the archive.org item (the tape) it was read from.
2. **Polite requests.** Every archive.org request is made from a server, is rate-limited and cached, and sends a User-Agent that names MySetlists with a contact URL.
3. **No audio.** Recordings are link-out only. MySetlists never downloads, proxies, stores or rehosts audio.

## Where it lives

- `config/internet-archive.json`: the switch (`enabled`) and one entry per band: its collection, exact creator names, protected titles, excluded dates and title aliases. A band is added by adding an entry; nothing is inferred.
- `netlify/functions/lib/archiveAdapter.js`: every request to archive.org for setlists, and how a setlist is chosen from a night's tapes.
- `netlify/functions/band-setlist.js`: the only route the app uses to reach the adapter (`/api/band-setlist?source=archive`), with the cache.
- `lib/importMatch.js`: the spreadsheet import (5.50.0). It asks `/api/band-setlist` like every other add path, one show at a time with a gap between requests, so imports get the same cache, User-Agent and request rules; a setlist it may not write unasked is stored as a `setlistProposal` for the user to review.
- `netlify/functions/admin-resync-setlists.js`: the backfill, which calls band-setlist's handler in-process with the adapter's request gap set.
- `netlify/functions/archival-audio-lookup.js` and `components/shows/ArchivalAudioSection.jsx`: "Listen to This Night", through Relisten.
- `components/shows/BandSourceAttribution.jsx` and `netlify/functions/lib/archiveAttribution.js`: the credit line.
- `tests/setlist-cache/archiveAttribution.test.js`: pins the three conditions above.

## Bands, October 29, 2026

Chosen from production data (read-only): every artist with logged shows, counting shows with no setlist or a thin one (fewer than 6 songs, from setlist.fm). Each candidate was checked on the Live Music Archive by exact `creator`, then the adapter was run on five real dates per band (the users' own dates where a tape exists) and each result compared with the tape's track list and description. The fixtures for those dates are in `lib/__tests__/fixtures/internet-archive/` and pinned by `lib/__tests__/archiveBands.test.js`.

### Added

| Artist | Logged shows missing / thin | LMA tapes (exact creator) | Sample dates | Result |
|---|---|---|---|---|
| Keller Williams | 5 of 5 missing | ~990 | 2002-09-08, 2003-07-03*, 2003-07-04*, 2005-01-29*, 2009-07-09 | 5/5 match the tape |
| Karl Denson's Tiny Universe | 1 missing, 2 thin (of 4) | 628 | 2001-04-11, 2003-10-25, 2009-03-26, 2010-04-17, 2018-10-31 | 5/5; two flagged incomplete (unnamed tracks on the tape) |
| Tea Leaf Green | 2 missing (of 4) | 1,000+ | 2003-07-03*, 2005-02-21, 2006-03-05, 2006-12-09, 2008-06-27 | 5/5 |
| Galactic | 2 missing (of 4) | ~490 | 1999-06-25, 2001-04-03, 2005-11-18, 2007-06-08, 2010-02-23 | 5/5; two flagged incomplete |
| moe. | 1 thin (of 2) | 1,000+ | 1996-08-24, 1997-06-22, 1998-07-10, 1999-08-05, 1999-08-21* | 5/5 |

\* a date a user logged with no setlist. The other users' dates for these bands (Keller Williams 2000-03-31 and 2001-04-07, KDTU 2003-12-27 and 2005-07-02, Tea Leaf Green 2003-07-06, Galactic 2014-03-22) have no tape on the Archive.

### Not added

| Artist | Logged shows missing / thin | LMA tapes | Why not |
|---|---|---|---|
| Widespread Panic | 1 missing (of 18) | ~4,500 | Samples read well, but setlist.fm already has 17 of 18 logged shows and the missing date has no tape. Routing the band to tapes would replace reviewed setlists, not fill gaps. |
| Dark Star Orchestra | 1 missing (of 4) | ~1,070 | Same: setlist.fm has 3 of 4; the missing date's two tapes have no track titles or setlist. |
| Ozomatli | 2 missing | 32 | Only 2 of 5 sample dates gave a setlist; one tape's track titles were the venue name repeated. Neither user date is taped. |
| Soulive | 1 missing | 593 | 3 of 5 sample dates; one tape filed under Soulive (2013-05-03) is another band (Dr. Klaw). User date not taped. |
| Melvin Seals and JGB | 2 missing | 4 | Not enough tapes to check five dates. |
| Phil Lesh & Friends | 1 thin (of 21) | 1 | Not on the Live Music Archive. |
| Rodrigo y Gabriela | 3 missing | 1 | One tape. |
| Jerry Garcia Band | 0 (of 16) | 0 | No tapes under that exact creator; the 43 phrase matches are the tribute act Rosebud. |
| Motion Turns It On, Bang Camaro, The Main Drag, Tycho, G. Love & Special Sauce, Taj Mahal, Michael Franti & Spearhead, Thievery Corporation, Toots & The Maytals, Michael Hedges, Merl Saunders | 1 to 9 each | 0 | No tapes on the Live Music Archive. |

### What the adapter does for these bands

The same adapter as Grateful Dead, not a fork (`archiveAdapter.js`): the band's entry picks the search (`collection:etree AND (creator:"…")`), results are kept only when a creator matches exactly, and the band's own title aliases and protected titles apply. Live Music Archive tapes lean on track titles more than Grateful Dead ones, so the shared parser learned, for every band:

- tracks titled "set break" or "encore break" mark the break; with none, the songs stay in one set rather than a guessed split
- "tmp", fades, "untitled", "?", bracketed talk, thanks and band-member lists are not songs; a track nobody named makes the setlist incomplete (`partial`)
- "I:"/"II:" headers, and a "Disc 1" block before a "Set II" header, are read as sets
- when it comes to track titles, the tape is chosen soundboard first, then the fullest track list, then downloads, among the top three complete tapes

Setlists are reviewed exactly as Grateful Dead's are: a track-list or incomplete tape is only ever offered for review, and the credit reads "Setlist from a tape on the Internet Archive, recording `<identifier>`. Tape setlists can be incomplete."

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
