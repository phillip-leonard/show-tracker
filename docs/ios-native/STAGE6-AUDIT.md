# Stage 6 audit: parity

Part 1 of Stage 6, read against `main` at 00cfdc0 (web 5.60.37, Capacitor 3.13.53, native 4.0.45). [`PARITY-AUDIT.md`](PARITY-AUDIT.md) §2 is the inventory and §4 the plan. This audit re-checks the Stage 6 rows, maps user content, meetups, the activity feed, imports, Year in Review and posters, lists what the server and the rules need first, and proposes the PR split. No code changes. The calls (§11) were approved on 2026-11-19, and DECISIONS.md "Stage 6" records them. Ships in native 4.0.46; web and Capacitor unchanged.

## 1. The Stage 6 rows, re-checked

Stages 4 and 5 changed one row and the read turned up three corrections. Every other Stage 6 row is still as PARITY-AUDIT left it.

| Row (PARITY-AUDIT §) | Then | Today | Part |
|---|---|---|---|
| Guest rescue banner (2.1) | Native, partly | Unchanged: the prompt is in Me and the Shows empty state; no banner | 6-11 |
| Admin announcement popups (2.1) | Missing; "confirm the rules let native read them" | Still missing. **Nothing to read:** the popups are a list in code (`lib/popups.js`), dismissed in `localStorage`. Three are on: the v3.16 song-history intro, the web's welcome ("the How to Use guide in the sidebar") and an admin-only one. The `announcements` collection is the email tool, closed to clients. See call H | 6-11 |
| What's New (2.1) | Missing | Unchanged (F-5, JSON) | 6-11 |
| Relive this night (2.2) | Missing | Unchanged | 6-8 |
| Archive backfill card (2.2) | Missing | Unchanged. The web calls `propose-setlist` per show and `accept-proposal` with `onlyIfEmpty`, both already in native (#435). No server work | 6-8 |
| Play counts toggle (2.4) | Missing | Unchanged | 6-8 |
| Photos, videos, posters, setlist photos (2.4, 2.20) | Missing | Unchanged; server fixes first (§2.5) | 6-4 |
| Comments (2.4) | Missing | Unchanged; likes move to the server first (call A) | 6-3 |
| **Meetups on a show** (2.4) | Missing, `MeetupCard` on the show page | **Correction:** `MeetupCard` is only on Bucket List "Coming up" items (`BucketListView`), never on a show page. Native's bucket list (4-10) has no card. A meetup-join notification opens the web | 6-5 |
| Screenshot import (2.5) | Web link | Unchanged | 6-7 |
| CSV / Excel import (2.5) | Web link | Unchanged; server function first (call C) | 6-2b, 6-7 |
| "How many Goose songs" card on Stats (2.7) | Missing | Unchanged. F-11: a link to the web tool | 6-9 |
| Make my poster on the band page (2.9) | Missing | Unchanged (4-5 left it out) | 6-9 |
| Activity feed (2.17) | Missing; "confirm in the Stage 6 audit" | Confirmed: the browser reads it straight from Firestore, and the rule lets any account read anyone's (§4) | 6-2a, 6-6 |
| "Show my activity to friends" (2.17) | Missing | Unchanged. The rules let the owner write `shareActivity`, and native already decodes it | 6-6 |
| Anniversary calendar (2.18) | Missing | Unchanged | 6-8 |
| Achievements (2.19) | Missing | Unchanged. The web counts `shows.length` from the device; native should use `userStats` (CLAUDE.md, "the numbers people see") | 6-11 |
| **Average show rating** (2.19) | Missing, Stage 4 | **Native 4-8:** "Average show rating" on Stats | done |
| Public profile preview (2.19) | Missing | Unchanged (open `/u/<handle>`) | 6-11 |
| "My Comments" (your show notes) (2.19) | Missing | Unchanged | 6-11 |
| Help: Community Guidelines, How to Use, Send feedback (2.19, 2.21) | Partly | How to Use is still a web link; Community Guidelines appears only on the terms gate and the suspended screen, not in Me; no feedback | 6-11 |
| Roadmap, voting (2.21) | Web link | Unchanged | 6-11 |
| Release notes (2.21) | Missing | F-5 keeps it a web link; Me has no link to it yet | 6-11 |
| Setlist photo directory (2.20) | Missing | Library row opens the web (Stage 4 call B) | 6-4 |
| My poster, poster share (2.22) | Missing | Unchanged; the record moves to the server first (call G) | 6-2c, 6-9 |
| **Save to "Songs I've heard"** (2.22) | Missing, `HeardSaveModal`, `heard-import` | **Correction:** it's the other direction. `HeardSaveModal` is the app half of the tool's "Save these shows to MySetlists": `/shows/?signup=1&heard=<slug>.<code>` → `/api/artist-shows?slug=&code=` → the shows are added. `heard-import` is the tool's own setlist.fm import (F-11, web) | 6-9 |
| Year in Review page (2.22) | Web link (C-9) | Unchanged | 6-2c, 6-10 |
| **Year in Review share image** (2.22) | Missing; "drawn in the browser", native draws its own | **Correction:** the 2026 recap card is drawn on the server (`my-poster` with `recap`). `ShareYearInReview` (browser-drawn) belongs to the older layout every other year uses (§7) | 6-10 |
| Haptics (F-8) | Decided | `.sensoryFeedback` nowhere yet | 6-11 |

## 2. User content: comments, photos, posters, setlist photos

### 2.1 The one key: `concertKey`

Comments, photos and meetups hang off the concert, not anyone's show document: `showMatchKey` in `lib/showIdentity.js` (the setlist.fm id, else `artist|venue|ISO day`, trimmed and lowercased). Native already has the port (`ShowMatchKey` in `NotificationRules.swift`) with unit tests but **no shared fixture**. Three derived keys also need to match exactly or a native user lands in a different thread:

| Key | Web | Used for |
|---|---|---|
| `showMatchKey(show)` | `lib/showIdentity.js` | `showComments.concertKey`, `showPhotos.concertKey`, `meetups.concertKey` |
| `meetupIdFor(concertKey)` | `lib/meetups.js` (lowercase, runs of other characters → `_`, trimmed) | `meetups/{id}`; native has a port for notifications |
| storage segment | `lib/photos.js` `storagePathSegment` (lowercase, runs → `-`) | `showPhotos/{segment}/{uid}/{file}` in Storage |
| comment-view id | `lib/commentViews.js` (`{uid}_{same as storage segment}`) | "new since your last visit" |

**Proposal:** `fixtures/concert-keys/` with all four, run by `lib/__tests__` and `CoreTests`, in 6-2a.

### 2.2 Comments

| | Today |
|---|---|
| Data | `showComments/{autoId}`: `concertKey`, `parentId` (replies one level deep), `authorUid`, `authorName`, `text`, `artist`, `venue`, `date`, `likedBy[]`, `createdAt`. `commentViews/{uid}_{key}` for "new" |
| Read | Live listener, `where concertKey ==` ordered by `createdAt`. Rule: `isAccount()` (any account, any concert) |
| Post, reply | `moderate-content` `{ target: 'showComment', concertKey, parentId?, text, authorName, show }`: banned and guest refused, `checkContent`, 2,000 characters; writes the reply and mention notifications (`notifyCommentPeople`). Client create is refused by the rules |
| Like | **The browser writes `likedBy` on the author's document** (rule: only that field, only your own uid), then `engagement-notify` `{ type: 'comment_like', id }`, which checks the like is stored and notifies (deduped, block-aware) |
| Delete own | Client delete; the rule allows the author or `isAdmin()` |
| Report | `report-content` `{ contentType: 'showComment', contentId, reason }`; three reporters hide it (moved to `moderationHidden`) |
| Guests | Nothing: no listener, no box (rules `isAccount()`; D-1). Native shows "Create an account to see comments" |
| Blocks | `withoutBlocked(comments, blockedUserIds, 'authorUid')`, the people *you* blocked; just-reported items hidden for the session |
| Activity | The browser logs `commented` (§4) |

### 2.3 Photos, videos, posters and setlist photos

| | Today |
|---|---|
| Data | `showPhotos/{autoId}`: `concertKey`, `category` (`photo`, `poster`, `setlist`; missing = `photo`), `artist`, `venue`, `date`, `uploadedBy`, `uploaderName`, `type` (`image`, `video`, `youtube`), `url`, `storagePath`, `fileSize`, `caption`, `likedBy[]`, `createdAt` |
| Upload | The file goes **straight to Storage** at `showPhotos/{segment}/{uid}/{ms}-{filename}`; then `moderate-content` `{ target: 'showMedia', concertKey, category, type, url, storagePath, fileSize, caption, show }` writes the document (caption filtered, 500 characters). YouTube links are a document only, `photo` category only |
| Storage rules | read `isAccount()`; write `isAccount()`, own uid segment, `< 10 MB`, `image/*` or `video/mp4`; delete the uploader or the admin |
| Limits | 10 MB a file (rules), 50 MB per concert across all three categories (**browser only**). Web types: JPEG, PNG, GIF, WebP, MP4 |
| Gallery | One listener per show split by category; lightbox with next and previous; zoom on posters and setlist photos |
| Like | Same as comments: the browser writes `likedBy`, then `engagement-notify` `photo_like` |
| Delete own | Client deletes the document, then the Storage object (best effort) |
| Report | `report-content` `showMedia` |
| Guests, blocks | As comments (`uploadedBy`) |
| Setlist photo directory | `/setlist-photos`: one read of `category == 'setlist'`, newest 300, filtered on the device by band and date; lightbox, like, report; blocked uploaders hidden |

Native has `FirebaseStorage` linked (Core) and reads venue photos already (4-7). The upload paths the rules allow are enough: **no Storage rule change**. Native must set `contentType` on the upload (the rule checks it), and must convert before uploading, because the web can't show what an iPhone records: HEIC → JPEG (downscaled), and `.mov`/HEVC → MP4 under 10 MB (`AVAssetExportSession`), or refuse with the web's message.

### 2.4 Posters and setlist photos on a show

They're the same collection and the same paths (`category`), so 6-4 builds one gallery component for all three, as `ShowMediaSection` does.

### 2.5 What the server should fix first (6-2a)

1. **Likes are written by the browser into someone else's document.** The rule keeps it to your own uid in `likedBy`, but it's still a cross-user write, and this stage's checklist says nothing writes another person's documents. **Call A:** `engagement-notify` gains `like` and `unlike` (`{ type: 'comment_like' | 'photo_like', id, liked: bool }`): the server writes `likedBy` and, on a like, notifies as it does now. The web switches; the client rule waits for old builds (§9).
2. **`showMedia` trusts the caller's `url`, `storagePath` and `fileSize`.** Anyone with a token can publish an image document pointing anywhere (a tracking pixel, an image Storage never saw), and `fileSize` decides the 50 MB cap. The server should require, for `image` and `video`, a `storagePath` under `showPhotos/{segment of concertKey}/{caller's uid}/`, read the object's size and type from Storage (Admin SDK), build the download URL itself, and enforce the 50 MB per concert; for `youtube`, parse the id and store the canonical URL. Call I.
3. **A reply's `parentId` isn't checked**: it should name an existing top-level comment on the same `concertKey`.
4. **No per-user limit on posting.** `takeDailyQuota` on comments, messages and uploads (say 200, 200 and 50 a day) costs nothing for real use.
5. **An admin "delete" leaves the photo's Storage file up** (`moderate-report`), and a download URL works whatever the rules say. Delete the object after the document, best effort, as `deletePhoto` does.

## 3. Meetups

| | Today |
|---|---|
| Where | Bucket List "Coming up" items (`MeetupCard`), and `/meetups/?id=` (`MeetupDetailView`); meetup-join notifications link there |
| Data | `meetups/{meetupIdFor(concertKey)}`: `concertKey`, `artist`, `venue`, `date`, `city`, `createdBy`, `createdByName`, `attendeeUids[]`, `attendeeNames{uid: name}`, `description`, `createdAt`, `updatedAt`. `meetupComments/{autoId}`: `meetupId`, `authorUid`, `authorName`, `text`, `createdAt` |
| Create | **Browser `setDoc` of the shared document**, show fields from the bucket list item |
| Join | **Browser `updateDoc`**: `attendeeUids` arrayUnion, `attendeeNames.<uid>`; then `engagement-notify` `meetup_join` |
| Leave | Browser arrayRemove of your uid (your name stays in `attendeeNames`) |
| Edit details | `moderate-content` `meetupDescription` (organizer checked on the server) |
| Discussion | Read: listener; post: `moderate-content` `meetupComment`; delete own: client delete (author or admin) |
| Delete a meetup | Nobody (rule `false`) |
| Report | Messages (`meetupComment`). **The pinned description can't be reported** (`report-content` has no meetup type) |
| Guests | Nothing (`isAccount()`) |
| Blocks | Messages filtered. **The attendee list and the organizer's description are not** |

Problems found:

1. **An email address can land on a document every account reads.** `MeetupCard` passes `user.displayName || user.email`, so an account without a display name writes its email into `createdByName` and `attendeeNames`. That breaks the first security invariant in CLAUDE.md.
2. **Any joiner can rewrite everyone's name.** The update rule checks `attendeeUids` but lets `attendeeNames` change freely, so one write can rename every attendee. This can be fixed **now, without waiting for old builds**: allow `attendeeNames` to change only at the caller's own key (old builds' join changes only that key, and leave doesn't touch it).
3. **The shared document's free text isn't filtered**: `artist`, `venue`, `city` and the names come from the browser.
4. `meetupComment` doesn't check the meetup exists.

**Call A (continued):** create, join and leave move to a new `netlify/functions/meetups.js` (the `festivals.js` pattern, `requireAccount`): `join` `{ bucketListItemId }` creates the meetup if it's missing, from the caller's own bucket list item (key built with `showMatchKey`, names from the profile, never the request; the web's `moderate-content` code resolves names the same way), or joins it, then notifies the organizer; `leave` `{ meetupId }` removes the uid and the name. Plus, in 6-2a: the `attendeeNames` rule fix, a count and cleanup of email-shaped names already stored (replace with the display name, else "Someone"), a `meetup` report type (description, sent to the queue, not auto-hidden), and the existence check on messages. Natively, blocked people are hidden from the attendee list (counted, not named) and a blocked organizer's description is hidden. Call J.

## 4. Activity feed

**How the web builds it.** `ActivityFeedView` listens to `userActivity where userId in [friend uids]` (chunks of 10, newest 50 each), merges, drops blocked accounts, and filters by All, Shows, Ratings, Comments, Photos. A row links to the public show page only when the actor's public profile was on at the time. The writes are the browser's own `addDoc` after reading its own `shareActivity`:

| Action | Written by |
|---|---|
| `added_show` | `AppContext.afterShowsAdded`, single adds only (tour, festival and offline adds skip it; a CSV import logs every row) |
| `rated_show` | `updateShowRating` |
| `commented` | `CommentsSection` |
| `shared_media` | `MediaGalleryView` |

**The problems.**
- The rule is `allow read: if isAccount()`. "Friends only" is only the query the web chooses to run, so any account can read anyone's bands, venues, ratings and times by querying their uid. It's the same exposure 5.60.11 closed for show history.
- Native writes nothing, so a native user's shows never reach their friends' feeds (the same kind of gap as the welcome email in Stage 4).

**Proposal (call B, 6-2a):**
- **Read:** `friends.js` `activity` `{ before? }` → `{ items, next }`: mutual friends only (both sides of the friendship), blocks either way removed, newest 100 a page, each item as stored plus `handle`. The web switches.
- **Writes on the server**, each checking the actor's `shareActivity` and with an id that makes a retry harmless (`{action}_{uid}_{showId}`): `normalize-show` (`added_show`, an account's single add, as the web logs it; imports log nothing), `moderate-content` (`commented`, `shared_media`), and `friends.js` `rated { showId }` (reads the rating from the stored show). The web stops writing.
- Until old builds are gone, the server's read dedupes on `(userId, action, showId)`, since an old build's `addDoc` has a random id.
- The rule tightening (owner-only read, no client creates) waits for old builds (§9).

## 5. Imports

### 5.1 Screenshot

`analyze-screenshot`: `POST { image (base64), mediaType }`, one JPEG, PNG, WebP or GIF, ≤ 4 MB → `200 { shows: [{ artist, venue, date, city }] }`; 401, 403 `account_required` (guests), 413, 422 nothing readable, 429 daily limit (20 per user, `lib/aiScan.js`), 502. The web resizes the image first, then puts the shows into a table with the columns Artist, Venue, Date, City and runs **the same review as a file**. Native does the same: `PhotosPicker`, downscale to JPEG, then the sheet review below with those rows. No server change.

### 5.2 CSV and Excel today (all in the browser)

1. Read: `parseCSV` (`lib/utils.js`, `,` or `;`) or SheetJS `xlsx` 0.18.5, first sheet, raw cells (Excel day numbers).
2. Columns: `detectColumns` (`lib/importSheet.js`), remembered per header row; date order `inferDateOrder`, confirmed when ambiguous.
3. Rows: `buildRows`, then `planShows` (split multi-artist rows; duplicates by `classifyDuplicate` against My Shows, earlier runs and earlier rows).
4. Match: `lib/importMatch.js` `matchShow` per show, one request at a time 600 ms apart: the band's own source, then the Internet Archive, then setlist.fm (`search-setlists`); an archive setlist it may not apply becomes a `setlistProposal`.
5. Save: `showDataFor` → `addShow({ kind: 'csv-row', ... }, { silent, onPossible: 'skip' })` → `commitShowInputs` and the outbox. `normalize-show` already takes `csv-row` (`fixtures/shows/csv-row.json`), and native's `ShowInput` already has `.csvRow`.

### 5.3 The server function (F-10, call C, 6-2b)

`netlify/functions/import-sheet.js`, `POST`, `requireAccount`, through `authedFetch`. Stateless: the app keeps the table and sends it back.

| Action | Request | Response |
|---|---|---|
| `parse` | `{ action, fileName, file }` (base64) | `{ headers, rows: string[][], mapping, dateOrder, dateOrderAmbiguous, signature, truncated }` |
| `plan` | `{ action, headers, rows, mapping, dateOrder, split: [rowIndex] }` | `{ shows: [{ rowIndex, part, key, artist, date, venue, city, state, country, rating, comment, tour, problem, duplicate }], counts }`; duplicates against the caller's stored shows, read on the server |
| `match` | `{ action, show }` (one planned show) | `{ status, setlist: { songs, source } \| null, proposal: bool, input }`: `input` is the `csv-row` input without `showId` |

- **Limits:** a file ≤ 2 MB (about 2.7 MB as base64, under Netlify's 6 MB), `.csv`, `.txt`, `.xlsx`, `.xls`; the first sheet; ≤ 2,000 data rows, ≤ 30 columns, 500 characters a cell (the rest cut, `truncated: true`). 413 and 400 carry the web's wording.
- **`match` is one show a call** so no call nears the 10-second limit; the app paces at 600 ms, as the web does. It goes through `withProxyLimit` and a daily per-user count, and passes a 429 back with `Retry-After`.
- **Committing** is the app's: mint each `showId`, commit the `csv-row` inputs through `ShowsStore` 25 at a time (as `importLineup` does), skip a `possible` (the web's `onPossible: 'skip'`). `normalize-show` checks duplicates again. Offline: parse, plan and match need the server and say so; a matched input that can't commit waits in the outbox like any add.
- **Code:** `lib/importSheet.js`, `lib/importMatch.js`, `parseCSV` and `lib/bandSetlist.js` become CommonJS (no `@/`), `importMatch`'s fetch injected (`createMatchContext` already takes `fetchImpl`) and on the server calling the sources with `internalProxyHeader()`. The web keeps parsing and matching in the browser with the same modules.
- **SheetJS on the server.** npm's `xlsx` stops at 0.18.5, which has published advisories (prototype pollution, a ReDoS) fixed only in SheetJS's own 0.20.x builds, distributed from their CDN rather than npm. Parsing strangers' files on our server raises the stakes over the browser. Recommend 0.20.x pinned by URL in `package.json` for both, the caps above, and a parse timeout.
- **Guests** stay out, as Stage 1 decided ("Import links are for signed-in accounts only"), though the web lets its local guests import a CSV.

## 6. Rules and Storage

| Need | Today | Change |
|---|---|---|
| Photo, video, poster, setlist photo upload | `storage.rules` `showPhotos/{seg}/{uid}/{file}` | None |
| Comment and photo likes | Client `likedBy` | Server (call A); client rule gated (§9) |
| Meetup create, join, leave | Client | Server (call A); `attendeeNames` own-key rule **now**; client create and update gated |
| Activity read and write | `isAccount()` read, own create | Server (call B); tightening gated |
| "New since your last visit" | `commentViews` own documents | None |
| "Show my activity to friends" | Owner may update `userProfiles.shareActivity` | None |
| Feedback | `feedback` create as yourself (guests too); `roadmapItems` draft needs `isAccount()` | None. Native leaves `submitterEmail` off (the server finds the address from the uid); a guest's idea goes to feedback only |
| Roadmap votes | Transaction: `voteCount` ±1 with your `voters/{uid}` document | None (the rule pins the counter) |
| Announcement popups | None to read (§1) | None |
| Year in Review for a year with no document | Owner may create `yearInReviews/{uid}_{year}` without `recap` | None; `recompute-my-stats` then fills `recap` |

## 7. Year in Review

**What `yearInReviews/{uid}_{year}.recap` holds** (`lib/yearRecap.js` `computeYearRecap`, written by the server on every existing review document since 5.60.16): `year`, `totalShows`, `totalBands`, `totalVenues`, `totalCities`, `songsHeard`, `newBands`, `newBandNames`, `newVenues`, `topBands` (5: `name`, `shows`), `topSongs` (10: `name`, `artist`, `count`), `noSetlist` (show refs), `showsWithSetlist`, `highlights` (`firstShow`, `latestShow`, `busiestMonth` `{ month, name, shows }`, `longestRun`), `updatedThrough`. `null` for a year with no shows.

**What it doesn't hold, and the web computes in the browser:**
- **Rarest catch and bust-outs** (`lib/yearRecapRarity.js`): `/api/artist-shows` for the archive bands seen that year (Goose, Phish, Umphrey's McGee, King Gizzard) and `heardRecord`'s arithmetic.
- **Show buddy** (`computeShowBuddy`): your own accepted sent `showTags`, `taggedByUid`, and your friends list.

These can't go into `recap`: a review made public (`privacy: 'public'`) is readable by anyone, and the buddy names a friend. **Call D:** an on-demand read, `year-recap` `{ year }` (accounts) → `{ recap, rarity: { rarest, bustOuts }, buddy }`, computed on the server with the same modules (`yearRecapRarity`'s pure part made CommonJS). The web switches to it too, so both apps show the same answer.

**The recap card is already drawn on the server.** `my-poster` `{ action: 'image', kind: 'feed' | 'story', recap, buddyUid?, buddyShows? }` → PNG; `{ action: 'share', ... }` → `{ ok, code, url }` (`/p/<code>/`); the buddy's first name is added only for a friend with a public profile. **Call E:** native uses these, so the card is the same picture everywhere, instead of drawing its own with `ImageRenderer` as PARITY-AUDIT assumed. The share sheet gets the PNG and the link.

**Layouts.** The web shows the recap layout only for your own 2026 review once live (`usesRecapLayout`); every other year, and anyone else's shared review, uses the original page (`stats`, the browser-drawn `ShareYearInReview`). **Call F:** native has one layout, from `recap`, for every year you have a review document; someone else's public review opens the web.

**The window.** `RecapWindow` is already ported (`fixtures/recap-launch/`). Through Jan 15, 2027 the Stats card keeps opening the web for 2026 (C-9); the native screen takes over 2026 from Jan 16 (`RECAP_PROMO_ENDS_AT`), and other years are native at once. "Missing a show? Add it" opens the add flow.

## 8. Posters

| Function | Request → response | Native use |
|---|---|---|
| `my-poster` | `{ action: 'image', kind: 'feed' \| 'story', record }` → PNG; `{ action: 'share', record }` → `{ ok, code, url }`; also the recap card (§7). Signed in; guests draw but don't share; 100 images and 20 shares a day; body ≤ 512 KB; the record is cleaned by `heardRecord.cleanPersonalRecord` (`name`, `shows`, `showsWithSetlist`, `years`, `venues`, `totalSongs`, `firstShow`, `lastShow`, `songs[{ name, count, firstHeard, lastHeard }]`) | The poster screen's images and share link |
| `public-poster` | `GET /p/{code}/`, `/og.png`, `/poster-feed.png`, `/poster-story.png` | Web pages: native shares the link |
| `heard-share` | `POST { slug, code }` → `{ ok, id }`; `GET ?slug=&id=` → `{ ok, code }`. Anonymous, 50 a day per network | Only to read a stored selection from a `heard=` link |
| `heard-import` | `GET ?slug=&user=&page=` → `{ ok, page, pages, total, itemsPerPage, count, nights }` | None: the tool's setlist.fm import (F-11) |

**The record is built in the browser** by `lib/myPoster.js` (ES module, `@/` imports): your shows of the band, songs once per show, the loose band key; "Make my poster" shows from 2 shows with a setlist. **Call G:** `lib/myPoster.js` becomes CommonJS and `my-poster` builds the record from the caller's stored shows: a new `{ action: 'record', artist }` → `{ record, eligible }`, and `image` and `share` accept `artist` in place of `record`. No Swift copy. Sorting and "add a setlist" (shows without one open their show page) are the screen's.

**Save these shows to MySetlists** (the corrected row): a `/shows/?heard=<slug>.<code>` link (also after sign-up) asks `/api/artist-shows?slug=&code=` and adds the nights through `normalize-show`, skipping ones already logged, with progress and retry, like `TourBrowseSheet`. No server change.

## 9. Old Capacitor builds

Every rule tightening below waits for `minSupportedIosVersion`. Each becomes a `GATED-CLEANUPS.md` row in the server PR that makes it possible, safe from the Capacitor version that PR ships in (6-2a would be iOS 3.13.54 if nothing else takes it first):

| Cleanup | Why it waits |
|---|---|
| Refuse client `likedBy` updates on `showComments` and `showPhotos` | Older builds like from the phone (call A) |
| Refuse client creates and updates of `meetups` | Older builds create, join and leave from the phone (call A) |
| `userActivity`: owner-only reads, no client creates | Older builds read friends' activity and write their own (call B) |

**Not gated:** the `attendeeNames` own-key rule (§3), which old builds' join already satisfies. Nothing is loosened.

## 10. Proposed PR split

PARITY-AUDIT had one server PR (6-2). The server work is three independent pieces, each needed only before its own screens, so it splits in three. Each server PR bumps web, Capacitor and native; each native PR only native.

| PR | Contents | Second account on TestFlight? |
|---|---|---|
| **6-2a** | **Social server:** likes (`engagement-notify` `like`/`unlike`); `meetups.js`; activity read and writes; `showMedia` and reply checks, daily post limits, moderation deletes Storage bytes; `meetup` report type; `attendeeNames` rule; meetup email-name count and cleanup; `fixtures/concert-keys/`; three GATED-CLEANUPS rows. The web switches | — |
| 6-3 | **Comments:** post, reply (mentions of friends), like, delete own, report, "new since your last visit", blocked hidden, guests prompted; reply, mention and like notifications open the show natively | Yes: notifications, blocks |
| 6-4 | **Photos, videos, posters, setlist photos:** upload with captions (HEIC → JPEG, MOV → MP4), YouTube links, gallery with zoom, like, report, delete own; the setlist photo directory and its search (Library row turns native) | Yes: likes, report |
| 6-5 | **Meetups:** the card on Bucket List items, the meetup screen (details, attendees, discussion), create, join, leave, edit details, delete own message; `/meetups/?id=` and meetup notifications open it | Yes: join notification |
| 6-6 | **Activity feed** on Friends with its filters, and "Show my activity to friends" in Me | Yes: a friend's activity |
| **6-2b** | **Import server:** `import-sheet` (`parse`, `plan`, `match`), the CommonJS moves, SheetJS 0.20.x | — |
| 6-7 | **Imports:** file picker (`.csv`, `.xlsx`, `.xls`), column matching, date order, split rows, preview, matching with progress, commit through the outbox; screenshot import into the same review | No |
| 6-8 | **Show extras:** play counts on the setlist (counted with `SongIndex`'s key, so a count matches the song page it opens), the archive backfill card, "Relive this night", the anniversary calendar (small date rules ported with a shared fixture) | No |
| **6-2c** | **Recap and poster server:** `year-recap` (rarity, buddy), `my-poster` `record` and `artist`, `lib/myPoster.js` and `yearRecapRarity` to CommonJS. The web switches | — |
| 6-9 | **Posters:** my poster (sort, add setlist), share image and link, "Make my poster" on the band page, the Stats link to the Songs I've heard tool (F-11), Save these shows to MySetlists (`heard=` links) | No |
| 6-10 | **Year in Review:** every section, year picker, recap card from `my-poster`, "Missing a show? Add it"; 2026 native from Jan 16 (`RecapWindow`) | Yes: show buddy |
| 6-11 | **Profile and help:** achievements (server counts), "My Comments" (notes), public profile preview, Send feedback (email-free; ideas onto the roadmap for accounts), roadmap and voting (roadmap notices open it), How to Use and What's New from JSON, Release Notes and Community Guidelines links, the guest rescue banner, haptics | No |
| 6-12 | **Parity check:** PARITY-AUDIT re-run against the build | — |

6-2b and 6-2c can be built while 6-3 to 6-6 are in review; their native parts wait for them.

## 11. Calls for Phillip

- **A. Likes and meetups move to the server.** `engagement-notify` writes likes (`like`, `unlike`); a new `meetups.js` does create-or-join and leave from the caller's own bucket list item, with names from the profile. The web switches; the client rules wait for old builds.
- **B. The activity feed goes through the server.** `friends.js` `activity` reads it (mutual friends, blocks removed); `normalize-show`, `moderate-content` and `friends.js` `rated` write it. Bulk adds and imports log nothing. The read dedupes until old builds are gone.
- **C. Import parsing on the server.** `import-sheet` with `parse`, `plan` and `match` (one show a call), accounts only, 2 MB and 2,000 rows; SheetJS 0.20.x for the server and the web.
- **D. Year in Review's rarity and show buddy come from an on-demand read** (`year-recap`), not from `recap`, because a public review would show the buddy.
- **E. The recap card is `my-poster`'s image** (drawn on the server, as the web's is), not a native `ImageRenderer` copy.
- **F. One native Year in Review layout from `recap`, for every year**; 2026 native from Jan 16; someone else's public review opens the web.
- **G. The poster record is built on the server** (`my-poster` `record`, and `artist` in place of `record`).
- **H. No native copy of the web's popups.** The three that are on don't fit native (a v3.16 feature intro, a welcome pointing at the web's sidebar, an admin one). What's New's JSON can carry an optional announcement if one is ever needed.
- **I. Fix `showMedia` before native uploads to it:** the server checks the Storage path and builds the URL, takes the size from Storage, enforces 50 MB per concert, checks replies' parents, limits posts per day, and deletes Storage bytes when an admin deletes a photo.
- **J. Meetup fixes now:** the `attendeeNames` rule, a cleanup of email-shaped names, a report type for the pinned details; natively, blocked people's names and details hidden.
- **K. 6-2 splits into 6-2a, 6-2b and 6-2c**, each before its own screens (§10).
