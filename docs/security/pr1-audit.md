# PR 1 (`fix/secure-functions`): Part 1 audit

Audited against `main` at `24f3b0c` (web 5.59.4, iOS `MARKETING_VERSION` 3.13.4), before implementation. The decisions at the end were approved before any code changed.

**Housekeeping first.**
- `docs/ios-native/SCOPING.md` is not on `main`. It exists only in commit `b11e8bd` on the local branch `docs/swiftui-scoping`, which has not been pushed and has no PR. That commit claims **5.59.5 / iOS 3.13.5**. There are no open PRs on GitHub, so PR 1 would also take 5.59.5 / 3.13.5. If the scoping PR opens first, PR 1 becomes 5.59.6 / 3.13.6. Which should go first?
- "88 functions" comes from counting the `netlify/functions/` listing, which includes the `fonts/` and `lib/` directories. There are **86 functions**: 84 `.js` and 2 `.mjs`.

---

## 1. Admin SDK init and shared helpers

| | |
|---|---|
| Shared helper | `netlify/functions/lib/firebaseAdmin.js`. Exports `getDb`, `getAdminAuth`, `verifyUser(event)` (Bearer → decoded token or null), `isAdminClaims`, `bearerToken`, `ADMIN_EMAILS`, and `__setTestFirebase`, which the in-memory test doubles in `tests/email/fakeFirestore.js` use |
| Env vars | `FIREBASE_PRIVATE_KEY` (with `\\n` unescaping), `FIREBASE_CLIENT_EMAIL`, **and `FIREBASE_PROJECT_ID`**. The brief named only the first two. All 39 Admin users read all three |
| Adoption | 23 functions use the shared helper. Older ones (38 files) inline their own copy of `initFirebase()` with the same three vars |
| Helper directory | The convention is `netlify/functions/lib/`. There is no `_lib/`, so new helpers go in `lib/` (proposed: `lib/requestAuth.js` and `lib/cors.js`) |
| Admin determination | **An email allowlist, not a custom claim.** `ADMIN_EMAILS = ['phillip.leonard@gmail.com']` is in `lib/constants.js:5` (client), `netlify/functions/lib/firebaseAdmin.js:37`, `firestore.rules:19–22` (`isAdmin()`), and inlined again in about 15 older admin functions |
| Gap to flag | Neither `isAdminClaims` nor rules `isAdmin()` checks `email_verified`. The address is a Google account, so its tokens carry `email_verified: true`. **Recommendation:** add `decoded.email_verified === true` to the new helper's admin check. That tightens the existing mechanism rather than adding a new one, and the admin's own token is unaffected |

---

## 2. AI endpoints (`analyze-tickets`, `analyze-screenshot`)

| | `analyze-tickets` | `analyze-screenshot` |
|---|---|---|
| Client caller | `components/TicketScanner.jsx:125` | `components/ImportView.jsx:182` |
| Request the current iOS build sends | `POST {images:[{base64, mediaType}]}`, Content-Type JSON, **no Authorization header** | `POST {image, mediaType}`, **no Authorization header** |
| What the image is | `resizeImageForUpload` (`lib/utils.js:213`) always re-encodes through a canvas: **`image/jpeg`, max 1200px, quality 0.8**, roughly 150–400 KB of base64. HEIC from the library is converted the same way | Same |
| Images per request | **No client cap.** Every selected file goes in one request | 1 |
| CORS | `Access-Control-Allow-Origin: *`, `Allow-Headers: Content-Type` | Same |
| Max payload | No server check. The only limit is Netlify's 6 MB synchronous body limit. `max_tokens` 16000, model `claude-sonnet-5-5` | Same |
| Upstream errors passed back | **Yes.** It sets `details: parsed` (the full Anthropic error body), passes Anthropic's status code straight through (so a 429 or 529 from Anthropic reaches the client), sets `raw:` to the model's text on 422, puts `error.message` in the 500 bodies, and returns "ANTHROPIC_API_KEY not configured…" when the key is missing | Same |
| Logging | `console.error` logs the full Anthropic error body on non-200 responses and the network error message. **Images and successful results are never logged** | Same |

**Real usage (Netlify observability, last 7 days):** every POST to either endpoint (34) came from Playwright in CI, and all of them were deliberate 400s. **No real user scanned in that window.** Usage can't support a number either way, so I propose the **20/day default** (§ Proposals).

**Tests that call production unauthenticated:** `e2e/integration/ai-ticket-scan.integration.spec.js` (OPTIONS→200, GET→405, POST-no-body→400) against `https://mysetlists.net`. Once enforcement is on, POST-no-body returns 401 instead of 400, so the spec has to accept either. The opt-in full OCR test also posts the wrong shape (`{image, mimeType}`) to `analyze-tickets`. It's skipped unless `TEST_AI_SCAN_FULL=true`.

---

## 3. `send-email`

**Server today** (`netlify/functions/send-email.js`): it requires an ID token, has a CORS allowlist (site, www, `capacitor://localhost`), and a 30/hour per-sender limit in `emailRateLimits/{uid}` (admins exempt). Opt-out is decided server-side (`canEmail`), the recipient is resolved from `to`, and it stamps a signed unsubscribe footer and List-Unsubscribe headers. It **accepts any `to` / `subject` / `html` (≤200 KB)** from any signed-in user (S-06).

**Client wrapper:** `lib/email.js:24` `sendEmailIfAllowed({to, subject, html}, {type})` sends exactly **`{to, subject, html, type}`**. **No caller sends any ID.** The current iOS payload alone can't identify the show, tag or invite.

**Templates are client-side only:** `lib/emailTemplates.js` (ESM). It already imports the shared server wrapper `netlify/functions/lib/emailLayout.js`. The only server templates are welcome, Year in Review and announcement. Every type below would need its template ported to the server (CommonJS), and **values are interpolated without HTML-escaping today** (artist, venue, names, personal message), so the port must escape them.

### Every caller

| `type` | Caller (file:line) | Recipient comes from | Record written **before** the send (what the server can verify) |
|---|---|---|---|
| `tag` (friend with an account, past show) | `context/AppContext.jsx:2849` | `friends[].friendEmail` (the friend's Auth email) | `showTags` doc `{fromUid: me, toUid, showData, status:'pending'}`, batch committed at 2819 |
| `tag` (upcoming show) | `context/AppContext.jsx:3016` | same | `showTags` doc with `upcomingShowId`, `showData.upcoming` |
| `tag` (tag-by-email, non-member) | `context/AppContext.jsx:3424` | Typed by the user | `pendingEmailTags` doc `{fromUid: me, toEmail, showData, personalMessage}` (3403) |
| `tag_accepted` | `context/AppContext.jsx:3374` | `pendingEmailTags.fromEmail` | That doc set to `status:'accepted'` (3366); caller's email = `toEmail` |
| `friend_joined` | `context/AppContext.jsx:1239` | `invites.inviterEmail` | `invites` doc `status:'accepted'` (1221), and `userProfiles/{me}.invitedByUid` (1224) |
| `invite` (send) | `context/AppContext.jsx:3479` | Typed by the user | `invites` doc `{inviterUid: me, inviteeEmail}` (3470) |
| `invite` (resend) | `context/AppContext.jsx:3499` | `invite.inviteeEmail` | The existing `invites` doc. The 24h resend limit is **client-side only** (3488) |
| `suggestion_nudge` | `context/AppContext.jsx:3268` | `friends[].friendEmail` | `showSuggestions` doc with `responses[me]='confirmed'` (3254) |
| `comment_mention`, `comment_reply`, `comment_like`, `photo_like`, `meetup_join` | `lib/notifications.js:74`, from `components/comments/CommentsSection.jsx:314,344,365`, `components/photos/MediaGalleryView.jsx:228`, `components/photos/SetlistPhotoDirectory.jsx:166`, `lib/meetups.js:91` | `userProfiles/{recipient}.email`, read by the sender's client (S-01) | `notifications` doc `{uid: recipient, fromUid: me, type, message, artist, venue, date}` (58), and only if the recipient's `notificationPrefs.emailFrequency === 'immediate'` |
| `venue_verification` (submitted) | `lib/venues.js:163` | Typed by the applicant | `venueVerificationApplications` doc `{applicantUid: me, applicantEmail, status:'pending'}` |
| `venue_verification` (approved / rejected) | `lib/venues.js:196, 211` | `application.applicantEmail` | Application `status` updated by the admin |
| `admin_message` | `components/AdminView.jsx:333` | `selectedUser.email` | None. Free text from the admin's form |

**Not via `send-email`** (already server-side and authorized): admin broadcast is `admin-send-announcement` (verifyUser + admin, `previewOnly`/`send`). Feedback/roadmap completion is `notify-roadmap-completion` (admin). The welcome email is `send-welcome-email` (user, sends to self). Report/block notices go from `report-content` and `notify-block` to the admin. Scheduled mail comes from the anniversary, followed-band, onsale, moderation-SLA and Year in Review jobs.

**Unsubscribe and preferences:** `lib/emailPolicy.js` `canEmail` reads `userProfiles.emailOptOut`, `announcementsOptOut` and `emailSuppressions/{sha256}`. `resolveRecipient` looks up `userProfiles where email ==` then Auth `getUserByEmail`. The new path keeps calling both. (PR 2 note: `findProfileByEmail` depends on the `userProfiles.email` field that PR 2 moves, so it has to switch to Auth or the private location.)

---

## 4. All 86 functions

Auth: **none**, **user** (ID token), **admin** (ID token + allowlist), **sched** (Netlify schedule; not HTTP-invocable in production), **job** (background function guarded by a one-shot trigger/nonce), **token** (signed link), **webhook**, **secret**.
Spend: **A** Anthropic, **R** Resend, **S** setlist.fm quota, **T** Ticketmaster, **G** SeatGeek, **D** Discogs. "Writes": Firestore unless it says Blobs. CORS: `*` / allowlist / none (no header; same-origin or HTML/PNG page).

| Function | What it does | Auth | Spends | Writes | CORS | Risk |
|---|---|---|---|---|---|---|
| **analyze-tickets** | Claude reads ticket photos → shows | **none** | **A** | no | `*` | **high** (in scope) |
| **analyze-screenshot** | Claude reads a ticket-site screenshot → shows | **none** | **A** | no | `*` | **high** (in scope) |
| **send-email** | Browser-initiated notification email | user | R | rate-limit doc | allowlist | **high** (S-06, in scope) |
| heard-share | Store/read a "Songs I've heard" code (≤16 KB) | none | – | Blobs, unbounded | none | **high** (anyone can fill Blobs) |
| enrich-artist | MusicBrainz/Discogs enrichment, cached | none | D | `artistEnrichCache` (key from input) | `*` | **high** (unbounded doc creation + Discogs quota) |
| get-entity-info | Wikipedia info for artist/venue | none | – | `wikiCache` (key from input) | `*` | medium |
| get-artist-stats | Community stats for an artist slug | none | – | `publicArtistStats` cache | `*` | medium |
| archival-audio-lookup | Relisten/archive recordings lookup | none | – | 2 cache collections | `*` | medium |
| search-setlists | setlist.fm search, cached | none | S | `setlistCache` | `*` | medium (quota exhaustion = outage for everyone) |
| search-artists | setlist.fm artist search | none | S | no | `*` | medium |
| search-artist-shows | Recent shows for top 5 matching artists (fan-out) | none | S | no | `*` | medium |
| get-artist-info | setlist.fm artist → mbid | none | S | no | `*` | medium |
| get-artist-song-stats | Song play counts from setlist.fm (multi-page) | none | S | no | `*` | medium |
| get-artist-tours | Every tour for an artist (multi-page) | none | S | cache | `*` | medium |
| get-tour-shows | Every show on one tour | none | S | no | `*` | medium |
| search-festival-lineup | Bands logged at a festival (multi-page) | none | S | cache | `*` | medium |
| setlistfm-links | Attribution URL per setlist id | none | S | cache | `*` | medium |
| band-setlist | One setlist from the owning band source | none | S/band APIs | cache | `*` | medium |
| heard-import | Import a setlist.fm user's attended list (paged) | none | S | no | none | medium |
| ticketmaster-events | Upcoming events for an artist | none | T | no | `*` | medium |
| seatgeek-events | Upcoming events for an artist | none | G | no | `*` | medium |
| my-poster | Personal poster PNG; share/recap need a user | `image`: none; share: user | CPU (resvg) | Blobs (share) | `*` | medium |
| spotify-token | Spotify PKCE token exchange | none | – | no | `*` | medium (dormant) |
| spotify-api | Spotify playlist proxy | none | – | no | `*` | medium (dormant) |
| create-shared-collection | Snapshot shows for `/shared/{id}` | user | – | `sharedCollections`, no rate limit | `*` | medium |
| apple-music-token | MusicKit developer JWT | none | – | token cache | `*` | low (dormant, env unset) |
| artist-image | Artist photo via MusicBrainz + Wikipedia | none | – | no | `*` | low |
| get-shared-collection | Read a shared collection by id | none | – | no | `*` | low (by design) |
| artist-api | `/api/artist*` from the Blobs snapshot | none | – | no | none | low |
| public-artist / -songs / -song / public-artists-index | Server-rendered band pages from snapshot | none | – | no | none | low |
| public-heard / public-heard-image | "Songs I've heard" pages and PNGs | none | CPU | no | none / `*` | low |
| public-poster | Poster PNG for a share code | none | CPU | no | `*` | low |
| public-profile / public-show / public-shared | Server-rendered profile, show and shared pages (privacy-gated) | none | – | no | none | low |
| sitemap | Sitemap index and children | none | – | no | none | low |
| send-welcome-email | Welcome email after first show (to self) | user | R | via lib | allowlist | low |
| delete-account | Self-service deletion | user | – | deletes own data | `*` | low |
| update-email-preferences | Profile email switches | user | – | own prefs | `*` | low |
| moderate-content | Write path for all published free text | user | – | yes, rate-limited | `*` | low |
| report-content | File a report; emails admin | user | R | reports, rate-limited | `*` | low |
| notify-block | Tell the developer about a block | user | R | yes, rate-limited | `*` | low |
| resolve-artist | Cache a band's Ticketmaster id on follow | user | T | `artists` | `*` | low |
| festival-lineup | Festival lineup for an attendee | user (attending) or admin | T/G | festivals | `*` | low |
| unsubscribe | Unsubscribe link / one-click | token | – | prefs, log | none | low |
| unfollow-band | Unfollow link in followed-band email | token | – | follows | none | low |
| inbound-email | Resend webhook for presale inbox | webhook | R | yes | none | low |
| run-tests | Pre-deploy API health checks | secret (`TEST_ADMIN_SECRET`) | R/S | no | `*` | low |
| admin-bulk-import | Bulk-import shows into a user | admin | – | yes | `*` | low |
| admin-cleanup-duplicates | Find/merge duplicate shows | admin | S | yes | `*` | low |
| admin-delete-guest-trials | Delete guest sessions | admin | – | yes | `*` | low |
| admin-find-missing-setlists | Find/populate missing setlists | admin | S | yes | `*` | low |
| admin-list-auth-users | Auth creation times for Users tab | admin | – | no | `*` | low |
| admin-list-unsubscribes | Unsubscribes view | admin | – | no | `*` | low |
| admin-merge-festivals | Merge duplicate festivals | admin | – | yes | `*` | low |
| admin-migrate-festivals | Per-user → shared festival migration | admin | – | yes | `*` | low |
| admin-onsale | Onsale admin tools (incl. Claude parse) | admin | A/S/T | yes, Blobs | `*` | low |
| admin-populate-setlist | Populate one show's setlist | admin | S | yes | `*` | low |
| admin-repair-festival-split | Repair a mis-merged attendance | admin | – | yes | `*` | low |
| admin-resync-setlists | Resync band-source setlists | admin | S | yes | `*` | low |
| admin-resync-setlists-background | Worker for the above | admin | S | yes | none | low |
| admin-seed-festival-lineups | Seed festival lineups | admin | T/G | yes | `*` | low |
| admin-seed-festivals | Seed festival catalog | admin | – | yes | `*` | low |
| admin-send-announcement | Admin broadcast email | admin | R | yes | `*` | low |
| cache-stats | setlistCache stats | admin | – | no | `*` | low |
| clear-cache | Clear setlistCache | admin | – | yes | `*` | low |
| delete-user | Admin deletes a user | admin | – | yes | `*` | low |
| moderate-report | Dismiss/delete/ban on a report | admin | – | yes | `*` | low |
| notify-roadmap-completion | Email voters when a roadmap item ships | admin | R | yes | `*` | low |
| anniversary-notifications | Daily anniversary notifications | sched | R | yes | none | low |
| band-affinity | Band affinity job | sched | – | yes | none | low |
| community-stats | Community stats/leaderboard job | sched | – | yes | none | low |
| inbound-email-cleanup | Delete presale mail after 90 days | sched | – | yes | none | low |
| moderation-sla-reminder | Re-send overdue report notices | sched | R | yes | none | low |
| onsale-reminder | Onsale reminders | sched | R/S/T | yes | none | low |
| onsale-scan | Starts onsale scan | sched | – | trigger | none | low |
| followed-band-notifications | Starts followed-band run | sched | T | trigger | none | low |
| public-artist-snapshot | Starts band-page snapshot | sched | – | Blobs token | none | low |
| onsale-scan-background | Onsale scan worker | job | A/R/S/T | yes | none | low |
| parse-presale-email-background | Claude parses presale emails | job | A/T | yes | none | low |
| followed-band-notifications-background | Followed-band worker | job | R/S/T | yes | none | low |
| public-artist-snapshot-background | Band-page snapshot worker | job | S | Blobs | none | low |

**Proposed follow-ups (not in PR 1):**
1. **heard-share** and **enrich-artist / get-entity-info / get-artist-stats / archival-audio-lookup / search-setlists and the other cache writers.** Unauthenticated requests create Firestore docs or Blobs keyed by caller input. Add input validation and key normalization plus a per-IP limit.
2. **setlist.fm / Ticketmaster / SeatGeek proxies.** Anyone can drain the shared quota, which is an outage for every user. A per-IP limit, or a Netlify rate-limit rule on `/.netlify/functions/search-*`, `get-*`, `*-events`.
3. **my-poster `image` action** (unauthenticated server-side PNG rendering): require a user or add a per-IP limit.
4. **create-shared-collection**: add a per-user limit.
5. **spotify-token / spotify-api** (dormant): require a user before the flag is turned on.
6. **CORS `*` on the other 55 functions.** See Q2 below.
7. Move the ~15 inlined `ADMIN_EMAILS` copies and 38 inlined `initFirebase()` copies onto `lib/firebaseAdmin.js` (no behaviour change).

---

## 5. Where guests can start a scan or screenshot import

Guest mode is local state, not Firebase auth, so guests never have a token.

| Entry point | File:line |
|---|---|
| `/scan-import/` page, opens on the **Scan Tickets** tab by default | `app/scan-import/page.jsx:17`, `components/ScanImportView.jsx:10, 32` |
| Screenshot import: the Import File dropzone accepts `image/*` and routes images to `analyze-screenshot` | `components/ImportView.jsx:160, 350` |
| Dropzone copy "…or a screenshot of your past events" | `components/ImportView.jsx:344` |
| My Shows header button "Scan / Import" | `app/shows/page.jsx:543` |
| Empty My Shows "Bulk Import" button, plus the "Quick ways" card promoting screenshot import | `app/shows/page.jsx:755, 770` |
| Discover "Import shows" | `components/discover/DiscoverView.jsx:86` |

There's an existing prompt pattern to reuse: `EmptyState` with `openAuthModal('signup')` (for example `app/meetups/page.jsx:36–44`). CSV/Excel import and manual entry stay available to guests.

---

## Proposals

### Auth and CORS helpers (`lib/requestAuth.js`, `lib/cors.js`)
- `requireUser(event)` → `{ uid, email, isAdmin }` or a ready 401 response. Built on `verifyUser` / `isAdminClaims` from `lib/firebaseAdmin.js`, so it uses the same env vars and the same test doubles.
- `corsHeaders(event)` echoes the Origin only if it's in the allowlist: `https://mysetlists.net`, `https://www.mysetlists.net`, `capacitor://localhost`, `http://localhost:3000`, `http://localhost:8888`. It **never rejects on Origin server-side**: CORS is browser-enforced, and the server leaving out the header is enough.
- **Deploy previews:** the web client calls relative URLs, so a preview calls its own functions **same-origin**, and CORS doesn't apply. It works without allowlisting anything, and the existing `send-email` logs show previews already working this way. The only cross-origin case would be a page on one preview calling another deploy, which the app never does. **Proposal: no `*.netlify.app` entry.** Optional: also echo `process.env.DEPLOY_PRIME_URL` when it's set, which only ever matches the preview's own URL.
- Generic error bodies everywhere touched. No `details`, `raw`, `error.message` or config names. Upstream status codes map to 502/503, so an Anthropic 429 never looks like the user's own limit.

### AI endpoints
- **Ship immediately, no flag:** JSON body only; `images` length 1–**10** for tickets, exactly 1 for screenshot; `mediaType` in {jpeg, png, webp, gif}, with the base64 magic bytes required to match; ≤**4 MB** decoded per image (Anthropic's per-image limit is 5 MB); CORS allowlist; generic errors. **Current iOS impact: none** for normal use, since it always sends 1200px JPEGs. One exception: picking more than 10 photos at once now returns 400 "Scan up to 10 tickets at a time", which the old client shows verbatim.
- **Behind `REQUIRE_AUTH_AI=true`:** ID token required, 401 otherwise.
- **With a token (on or off):** per-user **20 scans/day** (one request = one scan; screenshot and ticket scans share the counter) in `rateLimits/{uid}_{YYYY-MM-DD}` via a transaction. 429 "You've scanned 20 times today. Try again tomorrow." Server-only collection: `rateLimits` has no rule today, so it's already default-deny, and I'll add an explicit `if false` block in PR 2.
- **Interim safeguard for tokenless requests while enforcement is off:** a global **100 tokenless scans/day** across all callers, plus **10/day per IP** (stored as `rateLimits/anon_{date}` and `rateLimits/ip_{sha256(ip+secret)}_{date}`, never the raw IP). Tokenless means old iOS guests **and old iOS signed-in users**. **Impact:** with zero real scans observed in the last 7 days, no legitimate user should hit either cap. Worst case, a busy day after a marketing push returns 429 "Ticket scanning is busy right now. Try again tomorrow." to old-build users only. New clients always send a token when signed in and so bypass the global pool.
- **Messages the old client will show verbatim** (it renders `data.error`): 401 "Create a free account (or sign in and update the app) to scan tickets." 429 as above.

### `send-email`
**The current iOS payload doesn't carry IDs, but every legacy email has a verifiable record written before the call.** So I propose **no flag**. From deploy day the server **ignores client `html` and `subject` for every type** and rebuilds from server-side templates, which are `lib/emailTemplates.js` ported to `netlify/functions/lib/notificationTemplates.js` with escaping. The client switches to `sendNotification({ type, ...ids })`.

| Type | New payload | Legacy `{to, html, type}` accepted only if… | Rebuilt from |
|---|---|---|---|
| `tag` | `{type:'tag', tagId}` | `showTags` with `fromUid == caller`, `toUid ==` the uid behind `to`, created ≤15 min ago | `tag.showData` (and `upcoming`) |
| `tag_email` (legacy `tag` to a non-member) | `{type:'tag_email', pendingTagId}` | `pendingEmailTags` with `fromUid == caller`, `toEmail == to`, ≤15 min | doc, including the escaped `personalMessage` |
| `tag_accepted` | `{type:'tag_accepted', pendingTagId}` | `pendingEmailTags` `status=='accepted'`, `toEmail == caller.email`, `fromEmail == to` | doc |
| `friend_joined` | `{type:'friend_joined', inviteId}` | `invites` `status=='accepted'`, `inviterEmail == to`, and `userProfiles/{caller}.invitedByUid ==` the inviter | caller's Auth display name |
| `invite` | `{type:'invite', inviteId}` | `invites` `inviterUid == caller`, `inviteeEmail == to`; **server-side 24h same-address resend limit** | caller uid / name |
| `suggestion_nudge` | `{type:'suggestion_nudge', suggestionId}` | `showSuggestions` with both participants, `responses[caller]=='confirmed'`, no `emailSentToUid` | doc |
| engagement (5 types) | `{type:'engagement', notificationId}` | `notifications` with `uid ==` the recipient behind `to`, `fromUid == caller`, same `type`, ≤15 min; recipient has `emailFrequency=='immediate'` (the check moves server-side) | doc (message escaped, length-capped) |
| `venue_verification` | `{type:'venue_verification', applicationId}` | pending app with `applicantUid == caller` → "submitted"; approved/rejected → **admin only** | app status and reason |
| `admin_message` | `{type:'admin_message', toUid, subject, body}` (plain text) | **admin only** | escaped text, newlines → `<br>` |

- Recipient: for member types it's looked up server-side (Auth `getUser(uid).email`). For `invite` and `tag_email` it comes from the stored record, because the recipient has no account. **The remaining exposure:** a user can still email an address of their choosing by first writing an invite doc. It's bounded by the per-type limits, the 24h same-address limit and the suppression list. PR 2's rules can also restrict who writes `invites`.
- Per-user daily limits by type (proposed): invite **10**, tag_email **10**, tag **50**, tag_accepted **50**, friend_joined **5**, suggestion_nudge **30**, engagement **100**, venue_verification **5**, admin unlimited. The existing 30/hour overall limit stays.
- A legacy request that fails verification returns `200 {skipped:true}`, so old clients don't surface an error, and logs only `type` and the reason.
- **Current iOS impact:** every email it sends today still arrives, because its records verify. The content becomes the server's template, which is identical to today's apart from escaping. A forged call with custom HTML sends nothing. One residual risk: if a lookup mismatches (for example `to` differs in case from the stored record), a legitimate email is silently dropped. Emails are normalized on both sides, and the unit tests cover each type.

---

## Sequencing (PR 1)

| Step | What | Current iOS 3.13.x affected? |
|---|---|---|
| 1. Merge PR 1, Netlify deploys | Size/MIME/CORS caps; generic errors; the tokenless global/IP safeguard; `send-email` stops trusting client HTML and verifies legacy payloads; new client sends tokens, hides scanning for guests, handles 401/429 | **No**, apart from the >10-photos edge case and the tokenless caps (zero observed real use) |
| 2. Submit iOS build (3.13.5 or 3.13.6) | Bundles the token-sending client and the guest gate | — |
| 3. Wait for adoption | Watch tokenless scan counts (logged by the safeguard) fall to about zero | — |
| 4. Set `REQUIRE_AUTH_AI=true` in Netlify | Tokenless scans → 401 | **Yes, by design:** old builds can't scan at all (guests or signed-in) and see "…sign in and update the app…" |
| 5. Later (PR 1 follow-up or PR 2) | Remove the legacy `send-email` path once old builds are gone | Old builds would lose tag/invite emails, so only after step 3 |

## Decisions (approved 2026-11-12)

1. **Version:** 5.59.6 / iOS 3.13.6 (the scoping PR, #397, took 5.59.5 / 3.13.5).
2. **CORS:** every function moves to the allowlist in PR 1 (`withCors` for the 53 that answered `*`, plus `artist-api`).
3. **Numbers:** approved as proposed.
4. **Admin check:** `email_verified === true` added to `isAdminClaims`.
5. **`admin_message`:** plain text, escaped by the server.
