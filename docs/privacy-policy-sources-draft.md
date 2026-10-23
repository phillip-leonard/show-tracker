# Privacy policy: data sources draft (not published)

**Status: draft for Phillip's review. Nothing here is live.** `components/PrivacyPolicy.jsx` is unchanged in 5.47.5. When approved, this text replaces the policy's "Third-Party Services" section and adds one item to "Data Sharing". The policy is already linked from both footers (`components/Footer.jsx`, `components/layout/AppFooter.jsx`) at `/privacy`.

Written for the 5.47.5 setlist.fm compliance work. This is not legal advice.

---

## Third-Party Services (replaces the current section)

### Where setlists come from

MySetlists does not write setlists itself. When you add a show, we look up its setlist from one of these sources:

- **setlist.fm**: the default for most artists. We request setlists from the setlist.fm API when you search, add a show or open one. We keep setlist.fm's responses for no more than 24 hours, and every setlist from setlist.fm links back to its page there. See [setlist.fm's privacy policy](https://www.setlist.fm/help/privacy).
- **El Goose (elgoose.net)**: setlists for Goose.
- **Phish.net**: setlists for Phish. We don't keep Phish.net data longer than its terms allow.
- **The Internet Archive (archive.org)**: Grateful Dead setlists, read from the recordings in its Grateful Dead collection. You review each one before it's saved.
- **You**: setlists you type in or edit yourself.

What we send these services is the search itself: an artist, a date, a venue or a city. We don't send your name, email address or account details to any of them.

### Other services we use

- **Firebase (Google)**: sign-in, data storage and hosting. See [Google's privacy policy](https://policies.google.com/privacy).
- **Netlify**: hosts the site and runs its server functions.
- **Resend**: sends our emails (invitations, notifications and announcements you haven't unsubscribed from).
- **Anthropic**: when you scan a ticket or import a screenshot, the image is sent to Anthropic's API to read the artist, venue and date. We don't keep the image.
- **Ticketmaster and SeatGeek**: upcoming shows for the bands you follow. We send only the artist name.
- **MusicBrainz, Wikipedia and Discogs**: artist and venue background, and artist images.
- **Relisten and the Internet Archive**: links to recordings of shows you've logged.
- **Spotify and Apple Music**: only if you connect an account, to open songs or build playlists.

We do not sell your personal information.

## Data Sharing (add this item)

- **Public profiles and shared pages.** If you turn on a public profile, or share a collection or a show, anyone with the link can see the shows on it. That includes setlists, which come from the sources above and are credited to them on the page. Your own notes and song comments are never shown. Public profile pages ask search engines not to list them.

---

## Notes for Phillip (not policy text)

1. **Check the list of services.** I took it from the hosts the Netlify functions call (`api.anthropic.com`, `api.resend.com`, `app.ticketmaster.com`, `api.seatgeek.com`, `musicbrainz.org`, `en.wikipedia.org`, `api.discogs.com`, `api.relisten.net`, `archive.org`, `elgoose.net`, `api.phish.net`, `api.spotify.com`, Apple Music). Today the policy names only Firebase and setlist.fm. Anthropic receiving ticket images is the one most worth disclosing.
2. **"No more than 24 hours" for setlist.fm** is true from 5.47.5 for the shared cache (`setlistCache`, with a Firestore TTL policy), for the device caches (`lib/setlistfmLocalCache.js`) and for function responses. It is **not yet true for setlists stored on show documents**: that's phase 2 (`docs/setlistfm-compliance.md`). Don't publish that sentence until phase 2 ships, or soften it to "we're moving to keeping setlist.fm data only briefly".
3. **"Ask search engines not to list them"** matches the 5.47.5 change: `/u/` pages send `noindex, follow`. Shared collection pages (`/shared/`) are still `index, follow`. Say so if that's intended.
4. **Phish.net: "longer than its terms allow".** The public band pages respect the 24-hour rule (`REFRESH_HOURS` in `publicArtistSnapshot.js`). Phish.net setlists saved on show documents don't yet; that's phase 2.
