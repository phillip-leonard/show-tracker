# Stage 3 audit: friends, notifications, push

Part 1 of "MySetlists — SwiftUI Stage 3", read against `main` at 8b05590 (native 4.0.19, web 5.60.27). Nothing here is built yet. The calls (**C-n**, §11) were approved on 2026-11-16, with the additions in §11, and DECISIONS.md "Stage 3" records them.

The Stage 3 decisions this audit was read against, not reopened here:
- the server does every cross-user write;
- guests get no friends, UGC or tagging, but do follow bands and get band push (D-2);
- no user counts until 1,000 users;
- `iosPushOfferEnabled` stays off;
- `token()` stays until §5.3 is decided;
- `/?ref=` links work;
- offline actions say so;
- internal TestFlight only.

What native already has, so the parts below only list what's left:

- **Models** (`Core/Models/Social.swift`): `FriendEdge`, `ShowTag` / `TagShowData`, `PendingEmailTag`, `ShowSuggestion`, `UpcomingShow`; `UserProfile.favoriteArtists` (`FollowedBand`); `AppConfig.iosPushOfferEnabled`.
- **API** (`Core/API/Endpoints.swift`, `FriendsRequest`): `accept`, `claimInvites`, `referral`, `referralLink`, `lookupByEmail`, `remove`, `showsTogether`, `showsTogetherCounts`, `suggestionScan`. No `block`/`unblock` yet.
- **Links** (`DeepLink.resolve`): `/?ref=` kept as `Referral` and posted to `friends.js referral` (or `account-linked`) after sign-in; `/friends` and `/notifications` open the Friends tab; `/shows/?show=`, `/bands/?band=`, `/venues/?venue=` open their screens.
- **Push:** `FirebaseMessaging` is linked. Both entitlements carry `aps-environment` (development / production). Sign-out deletes `pushTokens/{token()}`. Nothing registers yet (`AppDelegate`: "Push registration isn't wired yet").
- **Friends tab:** a placeholder ("Friends need an account" for guests).

## 1. Friends

### 1.1 What the web does today

| Action | Path today | Server? |
|---|---|---|
| Friend list | `users/{me}/friends` listener (own subcollection) | read |
| Find someone | `friends.js lookupByEmail` (email only; no handle or name search) | yes |
| **Send a request** | client `addDoc(friendRequests, {from, to, fromName, toName, status:'pending'})` after reading both directions for a duplicate | **no** |
| Accept | `friends.js accept` (block check, `makeFriends`) | yes |
| **Decline** | client `updateDoc(status:'declined')` (rule: recipient only) | **no** |
| **Cancel a sent request** | client `deleteDoc` (rule: either party) | **no** |
| Remove a friend | `friends.js remove` | yes |
| Block / unblock | `friends.js block` / `unblock` (5.60.27; `lib/moderation.js` calls them) | yes |
| **Invite by email** | client `addDoc(invites)`, then `send-email {type:'invite'}` | **no** (email is built on the server) |
| **Resend an invite** | client `updateDoc(lastSentAt)`, then `send-email` | **no**, and **broken**: the `invites` rule is `allow update: if false` (5.59.7), so the update is refused and the resend never sends |
| **Withdraw an invite** | client `deleteDoc` (rule: inviter) | **no** |
| Claim invites on sign-up | `friends.js claimInvites` / `account-linked` | yes |
| Referral link | `friends.js referralLink` → `https://mysetlists.net?ref=<signed>`; `referral` befriends | yes |

**Response shapes** (`friends.js`, all `POST {action, …}` with a Bearer token, `requireAccount`):
- `accept` → `{friendUid}`
- `lookupByEmail` → `{uid, name}` or 404
- `referralLink` → `{url}`
- `showsTogether` → `{shows}`
- `showsTogetherCounts` → `{counts}`
- `suggestionScan` → `{created}`
- `remove`, `block`, `unblock` → `{ok}`

Refusals are `{error, code?}` with 400/403/404/409.

**A block isn't checked on request.** The client can't read the other person's `userBlocks`, so someone you've blocked can still send you a request. You'd see it in Requests, and `accept` would refuse it (`blockedBetween`). The new `request` action (C-1) checks the block and answers as if the request were sent, so a block isn't revealed.

### 1.2 Guests

No Friends features. The rules already refuse guests (`isAccount()` on `friendRequests`, `invites` and `showTags` create; `requireAccount` in `friends.js`). The tab keeps its "Friends need an account" screen, with "Create your account". A `/?ref=` link opened by a guest is kept and used when they create an account (already built).

## 2. Show social

| Feature | Path today | Native v1 |
|---|---|---|
| **Tag friends at a show** | client batch: `showTags` docs (or `pendingEmailTags` for an address with no account), then `send-email {type:'tag'}`, then `updateDoc(upcomingShows.taggedFriendUids arrayUnion)` | needs a server action (C-2) |
| Accept a tag | `normalize-show {kind:'tag', tagId}` (past show). For an upcoming tag: `addUpcomingShow`, then a client `setDoc(tag, {status:'accepted'})` | past: as is. Upcoming: through the C-2 action |
| Decline a tag | client `setDoc(tag, {status:'declined'}, merge)` | C-2 action |
| Revoke a sent tag | client update `status:'revoked'` | C-2 action |
| Shows Together | `friends.js showsTogether` / `showsTogetherCounts` (mutual friends, server reads) | as is |
| Suggestions ("were you there together?") | created by `friends.js suggestionScan`. **Answered by a client `updateDoc` of the shared doc** (`responses.<me>`, `overallStatus`), then `send-email suggestion_nudge` and a second client update (`emailSentToUid`) | needs a server action (C-3) |
| Suggestion comments | `showSuggestions/{id}/comments`, client create (participants only) | out (C-4) |
| Show comments | `showComments`: created by `moderate-content` (rules: no client create); likes are a client `likedBy` update of your own uid | C-4 |
| Show photos | `showPhotos`: created by the upload function; likes the same as comments | C-4 |

**Block filtering:**
- **Blocking clears what's between two people** (`clearBetween`: friendship both ways, requests, tags and `taggedFriendUids` either way).
- **Shows Together and suggestions are mutual-friends only**, so a block removes them.
- **Comments and photos:** the web filters a blocked author's out of the list (`withoutBlocked`, `lib/moderation.js`, on the caller's own block list).

**Engagement notifications are cross-user client writes.** `createEngagementNotification` (`lib/notifications.js`) has the browser `addDoc` a `notifications` document for another user, and the rule `allow create: if isAccount()` lets any account write any notification to anyone. It covers `comment_reply`, `comment_mention`, `comment_like`, `photo_like` and `meetup_join`. That is the 5.60.11 rule broken, and a spoofing hole: anyone can write "X replied to you" into anyone's inbox. Native won't write these in any case (C-4), but the web does (C-5).

## 3. Notifications

### 3.1 Storage and state

- **Storage:** `notifications/{autoId}` with `{uid, type, message, read, createdAt}` plus per-type fields.
- **Reading:** the recipient reads and updates their own; nothing deletes them (rules).
- **The web's lists:**
  - the badge is an unread-only listener;
  - the Notification Center lists the latest 50 (`where uid ==`, `orderBy createdAt desc`), with tabs All / Band alerts (`BAND_ALERT_TYPES`).
- **Read and unread:** `read: false` on create. Opening a row sets `read: true`, and "Mark all as read" updates each one. Those are writes to your own documents, so they stay client writes.

### 3.2 Types

| Type | Written by | Extra fields | Opens | Email | Push |
|---|---|---|---|---|---|
| `followed_band_tour` | `followedBandAlerts.js` (daily job) | band, dates[] | Notifications (dates and ticket links inline) | pref `followedBands.email` | pref `.push`; link: `/bands/?band=<slug>` if the band has a screen, else `/notifications/` |
| `venue_bucket_list_match` | same job | venueKey, event | `venueHref(venueKey)` | `venueBucketList.email` | `.push`, link `/notifications/` |
| `onsale_alert` | `onsaleAlerts.js` (scan and reminder) | artist, venue, date, portalUrl, signupUrl, url, code | Notifications (portal, sign-up, event links inline) | `onsaleAlerts.email` (one digest per run) | `.push`, link `/notifications/`, thread `onsale` |
| `anniversary` | `anniversaryAlerts.js` (daily) | showId, concertKey | the show | `anniversaries.email` | `.push`, link `/shows/?show=<id>` |
| `comment_reply`, `comment_mention`, `comment_like` | **client** (§2) | concertKey, fromUid, fromName | the recipient's own show with that `concertKey` | `emailFrequency: 'immediate'` (opt-in) via `send-email engagement` | none |
| `photo_like` | **client** | same | same | same | none |
| `meetup_join` | **client** (`lib/meetups.js`) | concertKey | `/meetups/?id=` | same | none |
| `roadmap_published` | admin (AdminView) | itemId, itemTitle | roadmap | none | none |

**Friend requests, tags and suggestions are not notifications.** The web shows them as their own lists (Friends → Requests; the pending-tags and suggestions banners) and emails tags and nudges. The native inbox (Part 4) can show them in the same place, read from their own collections, so nothing new is stored.

**Prefs:** `userProfiles.notificationPrefs.<key>` = `{enabled, push, email}` (legacy `method`), read the same way by `lib/alertChannels.js` and `pushDelivery.prefFor`. Keys: `anniversaries`, `followedBands`, `venueBucketList`, `onsaleAlerts`, plus `engagementNotifications` and `emailFrequency`. Updating your own profile field is a client write, the web's path.

### 3.3 Decoding

The per-type fields vary (an on-sale alert carries links and a code; a tour carries a dates array). The native model needs `type`, `message`, `read` and `createdAt` required, every other field optional, and an unknown `type` shown as its message with no destination, rather than failing to decode.

## 4. Moderation UI

| Piece | Web | Native |
|---|---|---|
| Report | `ReportButton` → `ReportModal` → `report-content {contentType, contentId, reason, details?}`. Reasons: `spam`, `harassment`, `sexual`, `violence`, `impersonation`, `other` (details required for `other`). Types: `showComment`, `meetupComment`, `showMedia`, `profile`. Guests get 403 `account_required` | profile reports in Part 2. Comment and media reports only if C-4 brings those screens |
| Block | `UserProfileSheet` (opened from `UserLink` on comments, photos and meetups) and the friend card's Block (Guideline 1.2: reachable without something to report) → `friends.js block` | the friend row and the person sheet (Part 2) |
| Blocked list | `BlockedAccountsSection` on Profile: `userBlocks/{me}` (own doc) → `friends.js unblock` | Me → Blocked accounts (Part 2) |

**Confirmed:** since 5.60.27 the web's block and unblock go only through `friends.js` (`lib/moderation.js` → `callFriends`), with the notice recorded server-side (`lib/blockNotice.js`, shared with `notify-block`). The rule that still allows direct `userBlocks` writes waits for `minSupportedIosVersion` ≥ 3.13.43 (GATED-CLEANUPS, "Blocking only through the server").

## 5. Push

### 5.1 Capacitor today (`lib/pushAlerts.js`, 5.49.0)

- **Permission:**
  - asked only in context: the first follow (`PushOfferModal`), or "Turn on push alerts" in Notifications settings;
  - both are behind `pushOfferEnabled()` (`config/app.iosPushOfferEnabled`, 10-minute cache, false on error), which is off;
  - with the flag off, the settings card hides itself while permission is still `prompt` (`PushAlertsCard`: `state === 'prompt' && !offerEnabled → null`), and a follow toasts "We'll email you…";
  - the plugin registers with APNs at launch, which shows nothing.
- **Registration:** `pushTokens/{fcmToken} = {userId, platform:'ios', updatedAt}` (rule: `hasOnly` those keys, writer must be `userId`, and may take over a token another account left).
  - It's rewritten on each launch while signed in with permission, and on `tokenReceived` (rotation).
  - The previous token, kept in `localStorage`, has its doc deleted when the token changes.
- **Deletion:** before sign-out, the `pushTokens` doc (3 s cap) and then the FCM token itself (`deleteToken`), so the next account gets a fresh one. On account deletion: `userDataPurge.js`. The job deletes any token FCM reports unregistered.
- **Sending:** `pushDelivery.js` through the Admin SDK (`firebase-admin` 12.7) by FCM registration token. The jobs read every `pushTokens` doc, plus the legacy web `userProfiles.fcmToken`.

### 5.2 When native replaces Capacitor (same bundle ID `com.mysetlists.app`)

- **Both apps use the same Firebase iOS SDK**, which keeps its installation ID and FCM token in the app's keychain (Messaging 13.0.0's changelog: tokens are archived in the keychain). A keychain survives an App Store update.
- **Expected:** the native app's `token()` returns the same token, or a fresh one if the SDK refreshes on the version change. Either way it writes `pushTokens/{token}` for the signed-in user, which the rule allows.
- **If the token changed,** the Capacitor app's old doc stays until a send to it comes back `registration-token-not-registered`, and the job then deletes it. In between, one alert can be sent to both tokens. Whether the old one still delivers isn't certain, so the handover check (§9) looks for a duplicate push.
- **Nothing to do on the server.** Native can't read the Capacitor app's `localStorage` copy of the old token, and doesn't need to.
- **One device, one account:** native registers only after sign-in and deletes its doc on sign-out (already built), so a device moving between accounts doesn't keep pushing to the old one.

### 5.3 The `token()` deprecation

- **What the SDK says** (firebase-ios-sdk 13.2.0, the version the native app resolves):
  - Messaging 12.18.0 deprecated `token()`, `deleteToken()`, `fcmToken` and `messaging(_:didReceiveRegistrationToken:)` in favour of `register()` / `unregister()` and `messaging(_:didReceiveRegistration:)`, which hands back the Firebase Installation ID (FID).
  - Those only work with `FirebaseMessagingInstallationIdEnabled = YES` in Info.plist. With it on, no FCM token is made, every token API fails, and the server must send by FID.
- **Installation IDs aren't needed.**
  - Deprecated is not removed, and with the flag off (the default) the token APIs work exactly as they do in the Capacitor app.
  - Moving to FIDs would mean sending by FID on the server. `firebase-admin` 12.7's `send()` takes `token`, `topic` or `condition`, with nothing for an FID, so that is a server change the brief says not to make unless required. It isn't required.
  - It would also strand the Capacitor app's token docs, and it can't be done halfway: the flag is per app, and turning it on breaks `token()`.
- **Smallest change that keeps server sends working: none on the server.** Native keeps the flag off and uses `token()` behind one small `PushToken` type, the only file that calls the deprecated API: `current()`, `delete()` and a rotation stream from the delegate. Its deprecation warnings stay in that one file, with a pointer to this section.
- **When to revisit:** if the SDK removes `token()`, or the Admin SDK gains FID sends. GATED-CLEANUPS gets a row (the move also waits for the Capacitor app's retirement).
- **What Part 5 wires:**
  - **APNs:** `registerForRemoteNotifications()` at launch; method swizzling is on (no `FirebaseAppDelegateProxyEnabled` key), so Messaging gets the APNs token itself.
  - **Notification handling:** a `UNUserNotificationCenterDelegate` that shows banners in the foreground and routes taps; `Messaging.delegate` for rotation.
  - **Asking for permission:** only when `iosPushOfferEnabled` is true; with it off, a follow says "We'll email you…" (or, for a guest, only that it's followed, §6).
  - **Token registration:** writes the token doc on sign-in and each launch when permission is already granted (a TestFlight tester who allowed push in the Capacitor app keeps it).

### 5.4 Tap routing

Every push carries `data.link`, a universal link. Native resolves it with the same `DeepLink.resolve` it uses for links, so no new routing table is needed:

| Push | Link | Native today |
|---|---|---|
| Tour announced | `/bands/?band=<slug>` or `/notifications/` | band screen; Friends tab |
| Bucket-list venue | `/notifications/` | Friends tab |
| On sale near you | `/notifications/` | Friends tab |
| Anniversary | `/shows/?show=<id>` | the show |

`/notifications` should open the inbox itself, not the Friends tab root, once Part 4 builds it (one line in `DeepLink.action`, plus `AppRoute.notifications`).

## 6. Band alerts

- **What exists:**
  - following is `userProfiles.favoriteArtists` (own profile, client `updateDoc` on the web);
  - the alert settings are `notificationPrefs` (own profile) and `alertSettings/{uid}` (home location, radius 25/50/100/250, timezone; owner-only, key-checked);
  - the three jobs: followed-band tours and venue matches daily, on-sale scan and reminders, anniversaries daily;
  - each email's "Unfollow" link goes to `unfollow-band`, a signed GET confirm and POST.
- **Guests (D-2):**
  - the jobs read every profile with no account check, so a guest who follows a band gets the in-app notification and push now;
  - email is skipped because a guest has no address (`sendEmail` finds none);
  - the rules allow a guest's own profile, `alertSettings` and own `notifications` reads;
  - nothing on the server needs to change.
- **What native needs (Part 6):**
  - Follow and Unfollow on the band screen: one `updateDoc` of `favoriteArtists`, as the web does. It's a whole-array write, and the web does the same; a server action would only be needed if two devices racing over the array becomes a real problem, which it isn't for a list people change by hand;
  - "Bands you follow" in Me;
  - alert settings: the four prefs with push and email switches (email hidden for guests), and home location and radius for on-sale alerts;
  - the post-follow message by permission state and the flag, as the web's toast does.

## 7. Referral and share links

- **`/?ref=`:**
  - **Built (D-6):** `DeepLink.resolve` strips `ref` and keeps it (`Referral`), `SessionStore` posts `friends.js referral` after an account sign-in, and `account-linked` takes it on sign-up.
  - **Left:**
    - "Invite friends" in the Friends tab gets the link from `friends.js referralLink` and shares it with `ShareLink`. It's signed (`signReferral`), so it auto-friends.
    - Guests can't get one (`requireAccount`).
- **Share links:**
  - a public profile `mysetlists.net/u/<handle>/` (built in Me, Stage 2);
  - a show: `mysetlists.net/u/<handle>/shows/<id>/` (`public-profile.js` / `public-show.js`), only when the profile is public.
  - With a private profile there is no public show page, so Share isn't offered on a show; the share sheet's text says to make the profile public first.

## 8. Gaps

**Missing server actions**, all in `friends.js` (one place, `requireAccount`, block-checked):

| Action | Does | Replaces (web) |
|---|---|---|
| `request {toUid}` | duplicate and friendship check, block check (silent), creates the request | client `addDoc(friendRequests)` |
| `decline {requestId}` | recipient only | client `updateDoc` |
| `cancel {requestId}` | sender only | client `deleteDoc` |
| `invite {email, message?}` | creates the invite and sends the email (`send-email`'s template, server-side), per-user rate limit | client `addDoc(invites)` + `send-email` |
| `resendInvite {inviteId}` | stamps `lastSentAt` and resends; **fixes the web's refused update** | client `updateDoc` (refused today) |
| `cancelInvite {inviteId}` | inviter only | client `deleteDoc` |
| `tag {showId \| upcomingId, friendUids[], emails[]}` | builds `showData` from the caller's own stored show (not the request body), writes `showTags` / `pendingEmailTags`, emails, updates `taggedFriendUids`; friends only, block-checked | client batch |
| `respondTag {tagId, response}` | decline, and accepting an upcoming tag (adds the upcoming show, marks the tag accepted) | client `setDoc` |
| `revokeTag {tagId}` | sender only, pending only | client update |
| `respondSuggestion {suggestionId, response}` | writes my response and `overallStatus`, sends the nudge once | client `updateDoc` ×2 |
| `lookupByHandle {handle}` | exact handle → `{uid, name}`; only if C-6 | (none; the web is email-only) |

**Rules that would refuse native:** none for the paths above, since the actions use the Admin SDK. The client-create rules on `friendRequests`, `invites`, `showTags`, `pendingEmailTags` and `notifications` stay until old iOS builds age out (GATED-CLEANUPS rows, as with blocking).

**Models that don't decode yet** (new in native):
- `FriendRequest` (`from`, `to`, `fromName`, `toName`, `status`, `createdAt`);
- `Invite` (`inviteeEmail`, `status`, `createdAt`, `lastSentAt?`);
- `AppNotification` (§3.3);
- `UserBlocks` (`blockedUids`);
- `AlertSettings` and `notificationPrefs`.

The existing `ShowTag`, `PendingEmailTag` and `ShowSuggestion` decode today's documents. A test reads one of each from the emulator, as Stage 2 did for stats.

**Web follow-ups found here** (not native work): the invite resend bug (fixed by `resendInvite`), and engagement notifications written by the browser (C-5).

## 9. Testing plan

**Simulator, against the emulators** (Auth, Firestore, and the repo's functions running locally, with a throwaway local key deleted afterwards):
- **Setup:** two emulator accounts on two simulators, never the iPhone 18 Pro simulator that holds Phillip's account.
- **Friends:** request, accept, decline, cancel; invite, resend, withdraw; referral; remove, block, unblock, report; each checked from the other account and in the emulator's documents.
- **Show social:** tag, accept, decline, revoke; Shows Together; suggestions.
- **Inbox:** notifications written by the jobs run locally against the emulator.
- **Guests:** the guest view of every screen.
- **Offline:** each action with the network off says so and sends nothing half-done.
- **Tap routing:** `xcrun simctl push` with a payload carrying each type's `data.link` tests routing without FCM.

**What the emulators can't do:** deliver a real push (FCM and APNs need the production project), or test the token handover from the Capacitor app.

**What push checks need from Phillip** (TestFlight, his iPhone):
1. **Handover:** with the Capacitor app installed, signed in and push allowed, install the native TestFlight build over it. The native app should register without asking (permission carries over), and a test push reaches it once.
2. **A way to send a test push.** Pick one (C-7):
   - an admin-only "Send me a test push" in the native debug rows (behind five taps), through a small `send-test-push` function that sends to the caller's own `pushTokens` with a chosen link;
   - or the Firebase console's test message, given the token from a debug row.
3. **A second real account** (a throwaway) on a second device or the simulator against production, only for the friends checks that need two people. **Optional:** everything friends-related is covered on the emulators, so this can wait for Stage 3's TestFlight round.
4. **Turning `iosPushOfferEnabled` on stays Phillip's call** and isn't part of any check. With it off, the push checks use a device that already granted permission in the Capacitor app.

## 10. PR split (approved)

| Part | PR | Touches | Versions |
|---|---|---|---|
| 2a | **Friends server actions**: `request`, `decline`, `cancel`, `invite`, `resendInvite`, `cancelInvite` (+ `lookupByHandle` if C-6); web switched to them (fixes resend); GATED-CLEANUPS rows; tests in `tests/security` | `netlify/`, `lib/`, `context/`, `firestore.rules` (none loosened), docs | web, Capacitor, native |
| 2b | **Native Friends, block, report**: list, requests in and out, find by email (and handle), invite and referral share, remove, block from the row and the person sheet, report a profile, Me → Blocked accounts, guest screen. **Built in native 4.0.21.** | `ios-native/` | native only |
| 3a | **Show social server actions**: `tag`, `respondTag`, `revokeTag`, `respondSuggestion`; web switched; plus C-5 if approved (engagement notifications written by the server) | server, web | all three |
| 3b | **Native show social**: tag friends from a show, accept, decline and revoke, Shows Together on a friend, suggestions. **Built in native 4.0.22.** | `ios-native/` | native only |
| 4 | **Native notifications inbox**: the list, read and unread, mark all read, per-type rows and destinations, tags and requests and suggestions in the same place, `/notifications` routing, badge | `ios-native/` | native only |
| 5 | **Native push**: APNs registration, `PushToken` (the one `token()` file), token doc on sign-in and launch, foreground banners, tap routing, the `iosPushOfferEnabled` gate; + C-7's test tool (a function, so all three versions if chosen) | `ios-native/` (+ `netlify/` for C-7) | native, or all three |
| 6 | **Native band alerts and links**: follow and unfollow, Bands you follow, alert settings (prefs, channels, home location and radius), the post-follow message, show share links | `ios-native/` | native only |

The order is 2a → 2b → 3a → 3b → 4 → 5 → 6. Parts 2b, 4 and 6 depend only on their server PR or on nothing, so 4 and 6 could run in parallel with 3 if you want speed. The brief's "one PR per part" becomes two for Parts 2 and 3, because the server actions are web changes with their own versions and tests.

## 11. Calls (approved 2026-11-16)

All eight were approved as recommended, with these additions:

- **C-4:** native comments, photos and meetups go on the v1.x list.
- **C-5:** treated as a security fix. Refusing client creates on `notifications` goes in GATED-CLEANUPS with its minimum iOS version, since old Capacitor builds still write them.
- **C-6:** an exact match only, and only accounts with a claimed handle.
- **C-7:** gated on the `admin` claim.
- **C-8:** the Stage 2 `TODO(Stage 3)` in `SessionStore.signOut` is removed, and the reason is in DECISIONS.
- **The invite resend bug** is fixed in 2a.
- **Order:** 2a → 2b → 3a → 3b → 4 → 5 → 6.

The calls as proposed:


- **C-1 Friend requests go through the server.** Add `request`, `decline` and `cancel` to `friends.js`, with a silent block check on `request`, and switch the web to them in the same PR. *Recommended.* (The brief's rule; it also closes the request-while-blocked gap.)
- **C-2 Tags go through the server.** Add `tag`, `respondTag` and `revokeTag`, with `showData` built from the tagger's own stored show; switch the web. Accepting a past tag stays `normalize-show kind:'tag'`. *Recommended.*
- **C-3 Suggestion answers go through the server.** Add `respondSuggestion`, which sends the nudge once. *Recommended.* (It's a shared doc both people can write today, but the nudge email and `emailSentToUid` are cross-user.)
- **C-4 Comments, photos and meetups stay on the web in Stage 3.** A show's "Comments and photos" row opens the web page; native doesn't post, like or report them. They're the largest UGC surface (filtering, uploads, moderation, three report types) and not in the brief's Parts. *Recommended.* (The alternative is reading them natively with reporting, in a Stage 4 part.)
- **C-5 Engagement notifications move to the server** (web): `moderate-content` writes the reply and mention notifications when it creates a comment, and a `notify-engagement` action covers likes and meetup joins, checking that the like or join happened. The client-create rule on `notifications` goes to GATED-CLEANUPS. *Recommended in 3a.* (It closes the spoofing hole; native doesn't depend on it.)
- **C-6 Find friends by handle.** Add `lookupByHandle`, an exact match only, alongside email. *Recommended: yes.* Handles are already public on public profiles, and email-only search is hard on a phone. (The alternative is email only, as the web does.)
- **C-7 How to send a test push.** An admin-only `send-test-push` function (to the caller's own devices, with a chosen link) and a debug row, or the Firebase console with the token copied from a debug row. *Recommended: the function.* It tests each type's routing on a real device, and it's admin-checked with `isAdmin`.
- **C-8 `token()` stays.** No installation IDs, no server change, one `PushToken` file, and a GATED-CLEANUPS row for the later move. *Recommended* (§5.3).

## Follow-ups

- The web's invite resend has been refused since 5.59.7 (§1.1); fixed in 2a, worth a CHANGELOG line.
