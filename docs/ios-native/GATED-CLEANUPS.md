# Cleanups gated on `minSupportedIosVersion`

Each item below is safe to do only once every iOS build still in use contains the change that made it unnecessary. `minSupportedIosVersion` in `config/app` (Admin → App versions, `lib/appVersion.js`) is how old builds are retired: below it, the app shows a screen that can't be dismissed, with an App Store link. It only reaches builds that read `config/app`, which means **3.13.10 and later**. Builds older than that never see it and keep running until people update on their own.

To do one: raise `minSupportedIosVersion` to at least the version in the "Safe from" column, wait until the admin version report shows nobody below it, then make the change in its own PR. Rule changes deploy from `main`.

| Cleanup | Why it waits | Safe from | Added in |
|---|---|---|---|
| Set `REQUIRE_AUTH_AI=true` in Netlify (AI scans refuse tokenless requests) | Older builds scan without an ID token | iOS 3.13.6 | 5.59.6 (#398) |
| Remove the legacy `send-email` path (client `{to, html, type}` payloads) | Older builds send tag, invite and friend-joined emails the old way | iOS 3.13.6 | 5.59.6 (#398) |
| Stop writing and reading `odubleserId` on profiles and leaderboard entries | Older builds read the old field name | iOS 3.13.10 | 5.59.10 |
| Refuse client writes of `showCount`, `songCount`, `ratedSongCount` and `venueCount` on `userProfiles` (rules) | iOS 3.13.14 and earlier still write them; nothing reads them | iOS 3.13.15 | 5.59.15 |
| Refuse client writes of `stats` on `yearInReviews` (rules; only the server writes the numbers) | iOS 3.13.19 and earlier write `stats` on every visit | iOS 3.13.20 | 5.60.4 |
| **Friends no longer read each other's shows directly** (rules): drop the friends clause from `users/{uid}/shows` read (owner and admin only); let only the owner delete from a friends list (drop `request.auth.uid == friendId` on `users/{uid}/friends/{friendId}` delete); refuse client creates of `showSuggestions` | iOS 3.13.26 and earlier read a friend's whole show history themselves (Shows Together, suggestion scans), delete themselves from a friend's list, and create suggestions in the browser. Since 5.60.11 the app does all three through `netlify/functions/friends.js`. Each change needs emulator tests (`tests/rules/security.rules.test.js`), including that the server still does all three. | iOS 3.13.27 | 5.60.11 |
