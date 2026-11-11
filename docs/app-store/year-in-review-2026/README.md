# In-App Event: Your 2026 in Live Music

App Store Connect → the app → Features → In-App Events. The event is a
separate submission from the iOS 3.13 version, which contains the recap.
Submit the version first, then the event, so both are approved well
before 2026-12-02.

## Media

Regenerate with `node scripts/render-recap-event-art.js`.

| File | Use |
|---|---|
| `event-card-1920x1080.jpg` | Event card (16:9) |
| `event-details-1080x1920.jpg` | Event details page (9:16) |

Both show the same flat illustration: a recap card (a year bar, four stat
tiles, top songs) among setlist rows, in the recap card's palette. They
follow Apple's In-App Event media guidance:

- **No text or logos.** The event name and descriptions come from the
  metadata below.
- **No borders or gradients.** The App Store adds its own crop and
  gradient.
- **Main shapes centered,** so the automatic crop doesn't cut them.

Both are JPEG, so they have no alpha channel. Use App Store Connect's
preview to check both placements before you submit.

## Metadata

| Field | Value | Length |
|---|---|---|
| Reference name | Year in Review 2026 | internal |
| Event name | Your 2026 in Live Music | 23 / 30 |
| Short description | Your top bands, songs and rarest catch of 2026 | 46 / 50 |
| Long description | See your year in live music: top bands and songs, your rarest catch, your show buddy and a card to share. | 105 / 120 |
| Badge | Special Event | |
| Deep link | `https://mysetlists.net/year-in-review/?year=2026` | |
| Event start | 2026-12-02 00:00 (Pacific) | |
| Event end | 2027-01-01 23:59 (Pacific) | 31 days max |
| Publish start | 2026-12-02 00:00 (Pacific) | see below |

**Publish start.** Apple can show an event up to 14 days before it
starts. Before Dec 2, the deep link opens the old 2026 Year in Review
(the recap is gated by `lib/recapLaunch.js`). To show only the new recap,
publish on Dec 2. Publishing earlier gets more "Notify Me" taps.

## Emails

The two recap emails go out from Admin → Announcements → Year in Review
2026 emails. One Send reaches every account with a 2026 show that hasn't
opted out. Before Dec 2, set `YEAR_RECAP_EMAILS_ENABLED=true` in Netlify,
then trigger a deploy: functions only see a changed variable after the
next deploy. Each email can be sent once. A second Send is refused, and a
send that stopped part-way is finished with Resume.
