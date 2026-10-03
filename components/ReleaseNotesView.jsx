'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { PLAYLIST_CREATION_ENABLED } from '@/lib/constants';

// Playlist creation is switched off (see lib/constants.js), so the historical
// entries that name Spotify or Apple Music advertise a feature no one can
// reach. Filter them at render rather than editing the history: flipping
// PLAYLIST_CREATION_ENABLED back on restores every entry untouched.
const STREAMING_MENTION = /spotify|apple\s*music/i;

function ReleaseNotesView() {
  const releases = [
    {
      version: '5.42.0',
      date: 'October 3, 2026',
      title: 'Add A Whole Venue\u2019s Year At Once',
      changes: [
        'New: the artist is now optional when you search for a show. Enter a venue or a city, and a year, to see every show there',
        'New: Add all. Add every show from a search in one go. You see the venues first and can untick any you didn\u2019t mean, and shows already in your history are skipped',
      ]
    },
    {
      version: '5.41.0',
      date: 'October 1, 2026',
      title: 'One Filter Everywhere',
      changes: [
        'The search, year and date filter from My Shows is now on Stats, Tours and Festivals too. On Stats, every number, chart and top-songs list follows the filter',
        'A song played twice in one show (a sandwich or a reprise) now counts as one show seen everywhere song counts appear. Both performances still show in the setlist',
        'Fixed: the archive.org link on a show could search the wrong date format and come up empty. It now always uses the show\u2019s date as YYYY-MM-DD',
        'Fixed: links to public profiles and shows in your Activity feed now open in the iPhone app, and Profile has Open and Copy link buttons for your own public page',
        'The password reset screen no longer says whether an address has an account',
        'The "Select shows" button is gone from My Shows. You can still tag friends at each show from the show itself',
        'The MySetlists logo at the top of the app is a little bigger',
      ]
    },
    {
      version: '5.40.0',
      date: 'September 27, 2026',
      title: 'A Roomier My Shows On Your Phone',
      changes: [
        'My Shows on a phone now shows your latest show straight away, without scrolling',
        'Your stats sit in one compact row, and search, filters and sort fold away behind a Filters button \u2014 with a count so you can see when a filter is on',
        'Festivals now sits right under Tours in the menu',
        'The Upcoming page has been retired. An artist\u2019s upcoming dates are still there when you open them in the By artist view on My Shows',
      ]
    },
    {
      version: '5.38.0',
      date: 'September 25, 2026',
      title: 'Email Settings You Control',
      changes: [
        'New: two email settings in your Profile — one for product news and announcements, one for all emails. Turn off announcements and you’ll still hear about tags, replies and other activity',
        'Every email from MySetlists now has an unsubscribe link, including invites and tags sent to friends who haven’t joined yet',
        'Unsubscribe straight from Gmail or Apple Mail with their built-in Unsubscribe button',
        'Unsubscribe links now ask you to confirm first, so a link-scanning mail filter can’t unsubscribe you by accident',
        'Unsubscribe links in older emails no longer work. Manage your email settings from your Profile instead',
        'Fixed: unsubscribing from an invite or a tag a friend sent you could turn off your friend’s emails instead of yours',
      ]
    },
    {
      version: '5.36.2',
      date: 'September 17, 2026',
      title: 'Community Guidelines, Flagging And Blocking',
      changes: [
        'New: community guidelines you agree to when you sign in \u2014 zero tolerance for objectionable content and for anyone abusive',
        'New: flag any comment, photo or profile, and we\u2019ll review it within 24 hours. It disappears for you straight away',
        'New: block anyone, from their profile or from anything they posted. Their content disappears right away, you stop appearing to each other, and we\u2019re notified',
        'Blocked someone by mistake? Profile \u2192 Blocked accounts lists everyone you\u2019ve blocked, with an undo',
        'Clearer camera and photo permissions, and a fix for the ticket scanner asking for camera access and never showing the prompt',
      ]
    },
    {
      version: '5.36.0',
      date: 'September 13, 2026',
      title: 'Built For Your Phone',
      changes: [
        'New: every screen has a clear way back. Quite a few had none at all before \u2014 in the app there is no browser back button to fall back on, so the only way off them was the menu',
        'Better fit on modern iPhones: nothing hidden behind the notch, the home indicator, or the keyboard',
        'Bigger, easier tap targets throughout, and everything you tap now responds to the press',
        'Fixed: tapping into any text box zoomed the whole page in and shifted the layout. It no longer does, and the right keyboard shows up for the field \u2014 a search key when you are searching, an email keypad for an email',
        'Fixed: the button for deleting a show from your stats table was invisible on a phone, because it only appeared on mouse hover',
      ]
    },
    {
      version: '5.35.0',
      date: 'September 13, 2026',
      title: 'Delete A Song From A Setlist',
      changes: [
        'New: tap Edit on a setlist and you can now remove a song, not just move it. Handy when an archive lists something that wasn\u2019t played, or you added one by hand and changed your mind',
        'It asks twice before removing anything, and then offers to put it back \u2014 with its rating, your note and its place in the setlist exactly as they were',
      ]
    },
    {
      version: '5.34.4',
      date: 'September 12, 2026',
      title: 'Shows Added By Scanning A Ticket',
      changes: [
        'Fixed: shows you added by scanning a ticket stored their date in a different format from the rest, which the setlist archives could not be asked about \u2014 so \u201cGet setlist from El Goose\u201d did nothing on exactly those shows, with no explanation. They work now',
        'New tickets you scan save the date the same way every other screen does',
      ]
    },
    {
      version: '5.34.3',
      date: 'September 12, 2026',
      title: 'The Shows El Goose Still Missed',
      changes: [
        'Fixed: a show could keep showing the old setlist for up to a day after we corrected how we read the archive \u2014 cached answers are now retired the moment the reading changes',
        'Fixed: on a date when Goose and one of the band\u2019s side projects both played, the wrong setlist could come back. The archive is asked by date, so it now filters by band as well',
        'Fixed: \u201cAscend Amphitheater\u201d and \u201cAscend Amphitheatre\u201d are the same venue. Spelling differences like that used to pick the wrong show on a two-show day',
      ]
    },
    {
      version: '5.34.2',
      date: 'September 12, 2026',
      title: 'Goose Shows With A Qualifier In The Name',
      changes: [
        'Fixed: a show saved under a name like \u201cGoose (US)\u201d or \u201cThe Goose\u201d was never matched to El Goose, so none of the El Goose features reached it and nothing said why. Those names now match, and the re-fetch button appears on those shows',
        'Still precise about it \u2014 Goose Island, Mother Goose and Phish Food are different artists and keep their setlist.fm setlists',
      ]
    },
    {
      version: '5.34.1',
      date: 'September 12, 2026',
      title: 'Re-Fetch A Setlist From El Goose',
      changes: [
        'New: a Goose show you logged before El Goose support shipped kept its old setlist.fm setlist, and nothing in the app would swap it. Open the show and there is now a button under the setlist to get it from El Goose \u2014 with the segues, footnotes, cover credits and jam-chart flags that come with it',
        'Your ratings, your notes and any songs you added by hand are kept, exactly as when a setlist is refreshed anywhere else in the app',
        'Worth pressing again on a show that already came from El Goose: the archive corrects setlists after review, and this picks up those corrections',
        'If nothing changes, it now tells you why \u2014 the archive has no show on that date, it has the show but sent no songs, or your setlist already matches. \u201cNothing happened\u201d with no explanation is gone',
      ]
    },
    {
      version: '5.34.0',
      date: 'September 12, 2026',
      title: 'Goose Setlists From El Goose',
      changes: [
        'New: Goose setlists now come from elgoose.net \u2014 the archive the Goose community maintains \u2014 so segues show the real \u201c>\u201d or \u201c->\u201d, songs carry the archive\u2019s footnotes about teases and guests, covers are credited to the original artist, jam-chart picks are flagged, and the show\u2019s own notes appear under the setlist',
        'Every band-sourced setlist credits the archive with a link back to that show\u2019s page there',
        'Your ratings, your notes and any songs you added by hand are kept when a setlist is refreshed \u2014 and if the archive is unreachable or has nothing for a date, your existing setlist is left exactly as it was',
      ]
    },
    {
      version: '5.33.0',
      date: 'September 12, 2026',
      title: 'Better Setlists for Goose and Phish',
      changes: [
        'New: Goose setlists now come from elgoose.net and Phish setlists from phish.net — the archives the communities around those bands actually maintain — instead of from setlist.fm. Every other artist is unchanged',
        'New: segues show the real mark the archive recorded, so a “>” and a “->” no longer look the same',
        'New: tap the † next to a song to read its footnote — teases, guests, “first since 2019”, all the detail setlist.fm throws away',
        'New: songs the archive has flagged in its jam charts carry a “jam chart” badge, and tapping it tells you why it was flagged',
        'New: Phish shows display the archive’s own notes about the show underneath the setlist, and every band-sourced setlist credits the archive it came from with a link back to it',
        'Your ratings, your comments and any songs you added by hand are kept when a setlist is refreshed — and if an archive is unreachable or has nothing for a date, your existing setlist is left exactly as it was',
        'Scanning for missing setlists is much faster for Goose and Phish shows: one lookup per show instead of up to nine',
      ]
    },
    {
      version: '5.32.0',
      date: 'September 5, 2026',
      title: 'Report, Block, and Safer Comments',
      changes: [
        'New: every comment, photo, video, setlist photo and meetup message now has a flag icon to report it. Reports are anonymous to the person you report, and we review every one within 24 hours \u2014 anything reported by three or more people is hidden straight away while it waits',
        'New: you can block anyone. Their comments, photos, meetup messages and activity disappear for you, and you\u2019re removed from each other\u2019s friends list. Block from the report box, from a friend\u2019s card, or from the friends page \u2014 and undo it any time under Profile \u2192 Blocked accounts',
        'New: comments, captions, meetup messages, display names and handles are now checked before they\u2019re posted, and anything with slurs, threats or spam is refused with a message under the box rather than posted and taken down later',
        'The check is deliberately built not to trip over live music \u2014 \u201cCum On Feel the Noize\u201d, \u201cHo Hey\u201d, Dick Dale and David Lynch all post fine, and a show date is never mistaken for a phone number',
        'Fixed: the Terms of Service, Privacy Policy and Cookie Policy pages showed \u201cApplication error\u201d instead of loading, and couldn\u2019t be opened at all unless you were signed in. All three now work, signed in or not',
        'New: a Community Guidelines section in the Terms setting out what isn\u2019t allowed, how to report it, and what happens next \u2014 plus a support email address on every page, so you can reach us without an account',
      ]
    },
    {
      version: '5.31.0',
      date: 'September 4, 2026',
      title: 'Duplicate Festivals Can Now Be Merged',
      changes: [
        'New: when two people add the same festival under slightly different names — "Outside Lands" and "Outside Lands Music & Arts Festival" — those copies can now be folded into one, so everyone who was there ends up on the same festival instead of separate copies of it',
        'Your notes, your rating and every show you attached stay exactly as they are; nothing about your own record changes except which shared festival it points at',
        'Two different years of the same festival can never be merged into each other, no matter how identical the names are',
      ]
    },
    {
      version: '5.30.4',
      date: 'September 4, 2026',
      title: 'Fix: Two Years of the Same Festival Could Be Merged',
      changes: [
        'Fixed: a festival whose start date had a mistyped year (2011 entered as 0011) could be treated as spanning two thousand years, which let it be merged with a different year of the same festival. Dates that can\u2019t be real are now ignored for matching rather than matching everything',
      ]
    },
    {
      version: '5.30.3',
      date: 'September 4, 2026',
      title: 'See Every Show a Song Was Played At, Without Leaving Stats',
      changes: [
        'New: on Stats \u2192 Songs, tap a song to expand it right there and see every show you\u2019ve heard it at \u2014 newest first, with the date, venue, which set it landed in and where in that set, any segue, and the rating you gave that particular version',
        'Tap any of those to jump straight to that show; tap the song again to collapse it. You can keep several songs open at once',
        'Songs you added by hand look exactly like ones imported from setlist.fm, and a show with no set information simply shows without a set label rather than a blank one',
        'Fixed: on a phone, the song titles on this page were squeezed down to about one letter wide by the Times Seen and Gap columns \u2014 they now have room to be read',
      ]
    },
    {
      version: '5.30.2',
      date: 'September 4, 2026',
      title: 'Fix: Opening a Tour Crashed the Page',
      changes: [
        'Fixed: picking a tour under \u201cAdd shows from a tour\u201d blanked the page with an application error for any tour with a dozen or more shows \u2014 which is most of them',
        'Fixed: when setlist.fm couldn\u2019t be reached, the tour lookups showed a raw technical parser error instead of a readable message',
      ]
    },
    {
      version: '5.30.1',
      date: 'September 2, 2026',
      title: 'Fix: Creating a Festival Failed',
      changes: [
        'Fixed: creating a festival failed with a permission error — 5.30.0 introduced a shared festival catalog whose security rule had not been published to Firebase yet',
        'A permission error no longer tells you to “try again”, which could never have worked — it now says what was actually refused',
        'Festival names are checked against the real length limit as you submit, instead of being rejected later with no explanation',
        'A half-finished create can no longer leave an unremovable festival in the shared catalog that nobody attends',
        'Security rules now publish themselves whenever they change, so a feature can no longer ship with the permission it needs still missing — the cause of both this bug and the favorite-tours one',
      ]
    },
    {
      version: '5.30.0',
      date: 'September 2, 2026',
      title: 'Add a Whole Tour at Once, and Shared Festivals',
      changes: [
        'New: add every show you caught on a tour in one go \u2014 pick the artist, pick the tour, tick the nights. Or type \u201cGoose Summer Tour 2025\u201d and go straight to that tour\u2019s shows',
        'Shows you already have are marked and can\u2019t be added twice, so this can\u2019t duplicate your history \u2014 even for shows you\u2019d added by hand with the venue spelled differently',
        'Adding shows its progress as it goes; if some fail, the ones that worked are kept and you can retry just the ones that didn\u2019t',
        'A tour you already have shows from gets \u201cAdd more shows\u201d on its own page, with the nights you already have ticked off',
        'Changed: festivals are now shared. If someone\u2019s already added the festival you went to, you can join theirs instead of creating a duplicate \u2014 it shows up while you\u2019re still typing the name',
        'Joining keeps your shows, notes and rating entirely your own \u2014 nobody else at the same festival can see them',
        'Bonnaroo 2025 and Bonnaroo 2026 are never treated as the same festival, however identically they\u2019re spelled',
        'The person who created a festival can fix its name, dates or location for everyone; everyone else edits their own notes, and the form says so',
        'Changed: \u201cdelete festival\u201d is now \u201cleave festival\u201d \u2014 it removes it from your list, keeps every show you\u2019d attached, and never affects anyone else\u2019s copy',
        'Fixed: a security hole in the starred-tours rules that let one signed-in user overwrite another user\u2019s starred tours',
      ]
    },
    {
      version: '5.29.1',
      date: 'September 2, 2026',
      title: 'Smarter Festival Lineup Search',
      changes: [
        'The festival lineup search no longer asks you to type anything — it uses the festival’s own city and dates, so you just press one button to see who played',
        'It now searches by city and date rather than by venue, which is what actually finds a festival: BottleRock is logged under “Napa Valley Expo”, Bonnaroo under “Great Stage Park” — neither is searchable by the festival’s name',
        'New “By artist” mode for festivals setlist.fm covers thinly — type just the band you saw, the dates and city are already set',
        'Festivals without a location get a nudge to add their city, since that’s what makes the search accurate',
      ]
    },
    {
      version: '5.29.0',
      date: 'September 2, 2026',
      title: 'Festival Lineup Search, Tour Filters & Wishlist Reorder',
      changes: [
        'Fixed: festivals you\u2019d already created wouldn\u2019t open \u2014 clicking one dropped you on My Shows instead, so they looked like they\u2019d vanished. Festival pages now live at a URL this app can actually serve, and old links redirect to it',
        'Fixed: an error while saving a festival showed a blank screen instead of an error message',
        'New: \u201cSearch lineup\u201d on a festival looks it up on setlist.fm and lists every band that played inside its dates \u2014 tick everyone you saw and add them all at once',
        'Bulk-added sets are logged as your shows (with full setlists) and attached to the festival in one step; anything you\u2019d already logged is attached rather than duplicated',
        'If setlist.fm doesn\u2019t have the lineup, you can still add shows the old way \u2014 nothing about creating a festival depends on the search',
        'New: filter Tours by year, artist, or favorites, and star the tours you loved. Tours now sort by how many stops you caught by default',
        'New: every tour page shows the songs you heard for the first time on that tour, with where and when you first caught each one',
        'Tour pages are fully clickable now \u2014 stops, artist, venues and songs all link where they should \u2014 and a show\u2019s tour name links to that tour',
        'Changed: the Wishlist page now reads \u201cSongs I want to see\u201d, then a new combined \u201cAll songs\u201d list, then \u201cThe songs I\u2019ve seen\u201d \u2014 stacked so it reads the same on a phone',
      ]
    },
    {
      version: '5.28.0',
      date: 'September 1, 2026',
      title: 'Create & Manage Festivals',
      changes: [
        'New: festivals are now something you create — give one a name, dates, an optional location and notes, then attach any of your existing shows to it from a searchable picker',
        'Festival detail pages group your shows by day, list every artist you caught (linking to their shows), and show stats: shows attended, distinct artists, days, and your average rating',
        'A show can only be in one festival at a time — attaching a show already in a different one asks first instead of silently double-attaching',
        'Deleting a festival keeps the shows in it — only the grouping goes away',
        'Tours gets its own sidebar page at /tours, with a full landing list, not just single-tour pages',
        'Notifications and Activity moved from the sidebar onto the Profile page, same as Friends — same URLs as before',
        'This replaces the previous "Tag a Show as a Festival" auto-detection from 5.27.0, which is now fully retired',
      ]
    },
    {
      version: '5.27.0',
      date: 'August 31, 2026',
      title: 'Tag a Show as a Festival',
      changes: [
        'New: tag any show as a festival appearance right from the show detail page — give it a name (e.g. "Bonnaroo 2023") and it shows up under the Festivals tab',
        'Previously festivals only appeared automatically when 2+ different artists you logged shared the same tour name — now tagging works even if you only logged your one artist\'s set',
        'A manually tagged show and an auto-detected festival with the same name merge into one, rather than splitting',
      ]
    },
    {
      version: '5.26.0',
      date: 'August 31, 2026',
      title: 'Bust-Out Tuning & Wishlist Last-Played',
      changes: [
        'Bust-out severity now considers both shows and time since a song was last played, whichever gets there first: 🔥 minor at 50+ shows or 1+ year, 🔥🔥 major at 100+ shows or 2+ years, 🔥🔥🔥 epic at 5+ years',
        'Renamed the bust-out setting from a single day threshold to a Sensitivity scale (Profile → Bust-Out Sensitivity) that adjusts both the shows and time bands together',
        'New: your Wishlist now shows how long it\'s been since each starred song was last played live, using the same setlist.fm data already pulled for the catalog',
      ]
    },
    {
      version: '5.25.0',
      date: 'August 31, 2026',
      title: 'Bust-Out Detection',
      changes: [
        'New: setlists now automatically flag bust-outs — songs returning after a significant absence — right on the song name, no manual tagging needed',
        'Severity scales with the gap: 🔥 minor (90–180 days), 🔥🔥 major (180–365 days), 🔥🔥🔥 epic (1+ year)',
        'Tap a bust-out badge to see exactly how long it had been and where it was last played, with a link to that earlier performance',
        'Customize your own bust-out threshold (30/60/90/180/365 days) under Profile → Bust-Out Threshold',
        'Show detail pages get a "This show featured N bust-outs" summary card',
        'Song pages show your own personal bust-out status based on when you last saw that song',
        'Uses each artist\'s setlist.fm play history (already fetched for Tour Info) plus your own logged shows — no new data import needed, so past shows get bust-out flags immediately, not just new ones',
      ]
    },
    {
      version: '5.24.0',
      date: 'August 31, 2026',
      title: 'Venue Bucket List',
      changes: [
        'New: add a venue (not a specific show) to your Bucket List — a venue you\'ve always wanted to see a show at',
        'New "Venues" tab on the Bucket List page, alongside the existing show-based Bucket List',
        '"Add to Bucket List" button now also appears on every venue page',
        'New: automatic daily check that notifies you when one of your favorite artists announces or has an upcoming show at a venue on your bucket list — configurable under Profile → Notifications → Venue bucket list matches (push, email, or both; on by default)',
        'Runs on the same daily scheduled job infrastructure as anniversary reminders — a new `venue-bucket-list-notifications` Netlify function checks favorite artists\' upcoming Ticketmaster listings against everyone\'s bucket-list venues',
        'Requires a Firestore rules deploy (`npm run deploy:rules`) before venue bucket-list entries can be saved in production — new `bucketListVenues` collection needs its security rule live',
      ]
    },
    {
      version: '5.23.0',
      date: 'August 31, 2026',
      title: 'Venue Verification & Year in Review',
      changes: [
        'New: Venue Verification — venue owners/managers can apply for a blue checkmark by submitting proof of ownership; MySetlists reviews and approves in a new admin dashboard at /admin/venue-verifications',
        'Verified venues get a checkmark on their venue page, can edit venue info (capacity, year opened, website, address), upload official photos, and post announcements from a Venue Management Dashboard',
        '"Report this venue" lets anyone flag an unverified venue falsely claiming to be official, a duplicate, or inaccurate info',
        'New: Year in Review — an automatic annual recap (top artist, favorite venue, top-rated shows, milestones like your 100th show, longest streak) available mid-December through February',
        'Shareable as a downloadable image, native share sheet, Twitter post, email, or a public link with a privacy toggle (private by default)',
        'New Venue entity (`venues` collection) is the first real venue page in the app — previously venues only existed as text on each show',
        'Requires a Firestore + Storage rules deploy (`npm run deploy:rules`) before verification/photo uploads work in production — new `venues`, `venueVerificationApplications`, `venueAnnouncements`, `venuePhotos`, `venueReports`, and `yearInReviews` collections need their security rules live',
      ]
    },
    {
      version: '5.22.0',
      date: 'August 31, 2026',
      title: 'Group Meetups (MVP)',
      changes: [
        'New: "Find or create meetup" on any Bucket List show — see who else is going, join, and coordinate in a discussion thread',
        'Meetup page shows the attendee list, an organizer-pinned note for where/when to meet, and a message thread',
        'Bucket list cards now show a live "N people meeting up" count',
        'The organizer gets notified when someone else joins their meetup',
        'MVP scope: same-show meetups only, no location-based/general meetups yet',
        'Requires a Firestore rules deploy (`npm run deploy:rules`) before meetups can actually be created in production — new `meetups` and `meetupComments` collections need their security rules live',
      ]
    },
    {
      version: '5.21.0',
      date: 'August 31, 2026',
      title: 'Anniversary Notifications',
      changes: [
        'New: "X years ago today you saw [Artist] at [Venue]" reminders, sent automatically on the anniversary date of any show more than a year old',
        'Delivered as an in-app notification, an email, or both — your choice under Profile → Notifications → Anniversary reminders (on by default)',
        'New: an "Upcoming anniversaries" list on the Notifications page showing what\'s coming up, soonest first',
        'This runs on a new daily scheduled job — the first one in this app (previous "digest email" work had flagged the lack of any scheduled job as a blocker; this is that infrastructure, reused for anniversaries first)',
        'Known limitation: only the exact-date reminder is built — a "week before" or "month before" option, and weekly/monthly digest emails, aren\'t built yet',
      ]
    },
    {
      version: '5.20.0',
      date: 'August 31, 2026',
      title: 'Advanced Search',
      changes: [
        'New: an Advanced Search page ("Advanced search" link on the Shows page) for filtering your own show history by artist, venue, city, country, date range, tour, festival, minimum rating, your notes, tagged friend, or a specific setlist song — any combination at once',
        'Autocomplete on artist, venue, and city fields, drawn from your own logged shows',
        'Quick filters for "This month," "This year," and "Last year"',
        'Save a search by name for one-click reuse, and see your last few searches under Recent — both stored on this device, not synced across devices yet',
        'Results that matched on notes, a setlist song, or a tagged friend show a small "matched on…" hint, since those aren\'t otherwise visible on the show card',
        'The existing basic artist/venue search and year/date filter on the Shows page are unchanged — this is a separate, more powerful search alongside it',
      ]
    },
    {
      version: '5.19.0',
      date: 'August 31, 2026',
      title: 'Festival Tracking',
      changes: [
        'New: a dedicated Festivals section (sidebar → Festivals) that automatically groups shows into festivals — detected when two or more different artists in your history share the same setlist.fm tour/event name, like several artists all tagged "Bonnaroo 2023"',
        'Festival list shows Festivals Attended, total Festival Shows, and your Favorite Festival (by average rating)',
        'Each festival\'s page lists every artist you saw there, every show, and stats for venues, countries, and unique songs',
        'Known limitation: if you only logged one artist from a festival, it can\'t be told apart from that artist\'s own tour and won\'t show up here — same limitation tour grouping already has',
      ]
    },
    {
      version: '5.18.0',
      date: 'August 31, 2026',
      title: 'Tours Tab & Richer Tour Stats',
      changes: [
        'New: a "Tours" tab on the Shows page listing every tour we\'ve detected from your setlist.fm imports, with expandable cards showing every stop you caught',
        'Tour pages (and the new Tours tab) now show Venues and Countries counts alongside stop count, first stop, unique songs, and average rating',
        'Tour detection itself already existed (grouped by artist + setlist.fm tour name) — this makes it browsable on its own instead of only reachable by clicking a tour badge on an individual show',
      ]
    },
    {
      version: '5.17.0',
      date: 'August 31, 2026',
      title: 'Bulk Import Audit & Improvements',
      changes: [
        'Audited the bulk import flow end-to-end (CSV/Excel upload, column mapping, preview, setlist.fm auto-linking) and found the core flow already solid — preview-before-import and column mapping already existed',
        'New: "Download CSV template" button on the upload screen with example data and all supported columns, so formatting your own file is less guesswork',
        'Fixed: duplicate detection now also compares city, so seeing the same artist at the same venue on the same date in two different cities no longer falsely flags as a duplicate',
        'Changed: possible duplicates are now unchecked by default in the import preview (with a per-row checkbox to include them anyway) instead of silently importing them alongside everything else',
        'New: a "Retry Failed" button after import for any rows that failed to save, instead of having to redo the whole file',
        'Fixed: uploading a file with no extension in its name (e.g. from some cloud exports) no longer crashes the import screen',
      ]
    },
    {
      version: '5.16.2',
      date: 'August 30, 2026',
      title: 'Fixed: New Sidebar Items Never Actually Showing',
      changes: [
        'Fixed: today\'s new sidebar items (Activity, Notifications, Bucket List, Setlist Photos) were being added to a copy of the sidebar component that the app no longer actually uses — a leftover from before a sidebar redesign, never deleted, never imported anywhere. Every one of today\'s nav additions was going into dead code',
        'Added the same four items to the sidebar component that\'s actually live, and deleted the unused duplicate so this can\'t happen again',
        'No other changes — this only affects sidebar navigation, everything else shipped today already worked correctly',
      ]
    },
    {
      version: '5.16.1',
      date: 'August 30, 2026',
      title: 'Fixed: Stuck on an Old Version',
      changes: [
        'Fixed: some users were stuck seeing a version of the app from mid-August, missing everything shipped since — including several of today\'s releases. The offline service worker\'s cache identifier was never updated across a release, all the way back to when it was first added, so browsers had no way to tell a new version had shipped and kept serving the same cached copy indefinitely',
        'Every release now stamps a fresh cache identifier automatically, so this can\'t silently happen again',
        'If you\'re still seeing an old version after this update, force it once by clearing this site\'s data (Safari: Settings → Advanced → Website Data → mysetlists.net → Remove) or fully closing and reopening the app',
      ]
    },
    {
      version: '5.16.0',
      date: 'August 30, 2026',
      title: 'Immediate Email Notifications',
      changes: [
        'New: an "Also email me" option under Replies & Likes on your Profile page — set to Immediately to get an email the moment someone replies to your comment, likes your comment/photo, or mentions you',
        'Off by default — nobody gets emailed unless they turn it on',
        'Daily and weekly digest options from the original ask need a scheduled email job that doesn\'t exist in this app yet — flagged as a follow-up rather than half-built here; this release covers immediate only',
      ]
    },
    {
      version: '5.15.0',
      date: 'August 30, 2026',
      title: 'Per-Photo Captions & Most-Liked Sort',
      changes: [
        'New: uploading several photos or videos at once now gives each one its own caption field, instead of one caption applying to the whole batch',
        'New: a "Most Liked" sort option on the Photos & Videos, Posters, and Setlist Photos galleries — the practical version of "community voting" flagged when those features shipped',
        'Both were flagged as follow-ups in the Photos/Video (v5.10.0) and Posters/Setlist Photos (v5.12.0) releases',
      ]
    },
    {
      version: '5.14.0',
      date: 'August 30, 2026',
      title: 'Comment @Mentions & Unread Highlighting',
      changes: [
        'New: type "@" in a comment or reply to autocomplete a friend\'s name — mentioning them sends a notification',
        'New: comments and replies posted since your last visit to a show are highlighted "New", so you can tell what you haven\'t seen yet',
        'Both were flagged as follow-ups when Comments shipped (v5.9.0) — now built',
      ]
    },
    {
      version: '5.13.0',
      date: 'August 30, 2026',
      title: 'Comments & Photos in the Activity Feed',
      changes: [
        'The Activity Feed (added in v5.8.0, flagged then as not-yet-covering comments/photos) now logs those too: "commented on", and "shared a photo/poster/setlist photo from" a show',
        'Two new filter tabs — Comments, Photos — alongside the existing All/Shows/Ratings',
        'Same privacy rule as everything else in the feed: only shows up for friends who have activity sharing turned on, and links to the actual show only when the poster\'s public profile is on',
      ]
    },
    {
      version: '5.12.0',
      date: 'August 30, 2026',
      title: 'Posters & Setlist Photos',
      changes: [
        'New: dedicated Posters and Setlist Photos galleries on every show page, alongside the existing Photos & Videos gallery — same upload flow, lightbox, and likes, images only (no video, since a poster or setlist isn\'t one)',
        'New: a searchable Setlist Photos directory (find it in the sidebar) — browse setlist photos from every show in the app, not just ones you\'ve logged yourself, filterable by artist, venue, or date',
        'The lightbox for posters and setlist photos supports zooming in, so a handwritten setlist is actually legible',
        'The 10MB-per-file / 50MB-per-show upload limit is shared across photos, posters, and setlist photos combined, not tracked separately per gallery',
        '"Community voting" from the original ask is the same like button used everywhere else in the app — sort-by-most-liked already exists on comments; a dedicated best-of ranking is a bigger, separate feature and is flagged as a follow-up rather than half-built here',
      ]
    },
    {
      version: '5.11.0',
      date: 'August 30, 2026',
      title: 'Notifications',
      changes: [
        'New: a Notification Center — get notified when someone replies to your comment, or likes your comment or photo/video, with a real-time badge in the sidebar',
        'Click a notification to jump straight to the show it\'s about',
        '"Mark all as read" clears the badge in one tap',
        'A new "Replies & likes" toggle on your Profile page lets you turn these off any time — on by default',
        'Not yet built: notifying every attendee when a friend adds a show you also attended, and email digest options (immediate/daily/weekly) — both are real infrastructure projects on their own (the first needs a cross-user show lookup that doesn\'t exist yet; the second needs a scheduled email job), flagged as follow-ups rather than half-built here',
      ]
    },
    {
      version: '5.10.0',
      date: 'August 30, 2026',
      title: 'Concert Photos & Videos',
      changes: [
        'New: a Photos & Videos gallery on every show page — upload images, MP4 clips, or paste a YouTube link, and see what everyone else who logged that concert has shared',
        'Thumbnail grid with a full-size lightbox: arrow keys or on-screen arrows to browse, caption, uploader, timestamp, and a like button on each',
        '10MB per file, 50MB total per show — this is the first feature to use Firebase Storage, which wasn\'t wired into the app until now',
        'Delete your own upload any time; moderators can remove any',
        'Not yet built: per-photo captions when uploading several at once (one caption currently applies to the whole batch), and community voting beyond a simple like — both flagged as follow-ups rather than half-built here',
      ]
    },
    {
      version: '5.9.0',
      date: 'August 30, 2026',
      title: 'Concert Comments',
      changes: [
        'New: a Comments section on every show page — discuss the setlist, the crowd, the venue, whatever\'s on your mind, with anyone else who\'s logged that same concert',
        'Different from the old "Shared Memories" feature removed in v4.1.1 (which was private between you and one tagged friend): this is a real discussion thread, open to everyone who logged the show, not just a friend pair',
        'One level of replies, sort by newest/oldest/most-liked, real-time — no refresh needed to see a new comment or reply land',
        'Delete your own comment any time; spam or abuse can be removed by moderators',
        'Not yet built: @mention autocomplete and "new since your last visit" highlighting — both flagged as follow-ups rather than half-built here',
      ]
    },
    {
      version: '5.8.0',
      date: 'August 30, 2026',
      title: 'Friend Activity Feed',
      changes: [
        'New: an Activity page showing what your friends have been up to — added a show, rated a show — chronologically and in real time, no refresh needed',
        'Filter by All, Shows, or Ratings',
        'On by default for every account (unlike the off-by-default Public Profile) — a new toggle on your Profile page lets you stop sharing your own activity at any time; turning it off only stops new entries, past ones already shown to friends aren\'t retroactively removed',
        'A feed item links to the actual show only when the friend who did it has Public Profile turned on — there\'s no separate "friend\'s private show" viewer, so without that, the row is plain text, not a broken link',
        'Not yet built: comments and photos in the feed — both need their own feature first (coming in later releases), at which point they slot into this same feed with no schema changes',
      ]
    },
    {
      version: '5.7.0',
      date: 'August 30, 2026',
      title: 'Bucket List',
      changes: [
        'New: a Bucket List for shows you want to attend — separate from the song-level Wishlist. Add a show manually, or straight from an Upcoming Shows listing with one tap',
        'Sort by soonest or artist, filter by artist/venue, add a one-click Google Calendar reminder, or share your list with friends',
        '"Mark Attended" moves a bucket-list entry into the regular Add Show flow, pre-filled, then removes it from the list once saved',
        'Sign-in only, like Wishlist and Friends — a guest\'s bucket list would have nowhere durable to live',
        'Not yet built: distance-from-you sorting — the upcoming-shows data (Ticketmaster/SeatGeek) doesn\'t carry venue coordinates today, so this is flagged as a follow-up rather than faked',
      ]
    },
    {
      version: '5.6.0',
      date: 'August 30, 2026',
      title: 'Public Profiles',
      changes: [
        'New: an optional public profile at mysetlists.net/u/your-handle — off by default for every account, always. Turning it on shares only the shows, dates, venues, artists, setlists, and your own ratings you\'ve logged',
        'A preview shows exactly what a stranger would see before you turn it on, and turning it off takes the pages down again',
        'Never made public, no matter what: notes, photos, venue notes, your home location, email, wishlist, and friend list',
        'A friend tagged on one of your shows is only named on your public page if that friend has independently made their own profile public too — their attendance is their own data to share, not yours',
        'Handles are permanent once claimed — pick carefully',
        'Resurrected /shared collection links as real, indexable pages (they quietly stopped working after a past rebuild) instead of a client-side fetch that search engines never actually saw',
        'A generated sitemap.xml now lists every public profile automatically, replacing the old fixed 6-page version',
        'Not yet built: rate limiting on the public routes and public artist/venue/song directory pages spanning multiple users — both flagged as follow-ups rather than half-built here',
      ]
    },
    {
      version: '5.5.0',
      date: 'August 30, 2026',
      title: 'Archival Audio — Listen to the Actual Night',
      changes: [
        'New: Show pages for taper-friendly artists now check Relisten (which aggregates the Internet Archive\'s Live Music Archive and phish.in) for a real recording of that exact night, and link straight to it when one exists',
        'Multiple recordings of the same night are all listed with their source, taper, and transfer credit — jam fans care which board it came from',
        'Nothing shows up on the roughly 9 in 10 shows with no known recording — no empty panel, no "not found" message, just nothing',
        'Opens the recording on Relisten or the Internet Archive, never re-hosted or played from mysetlists.net — attribution to the taper and transferrer is always shown',
        'Not yet built: a "shows I can listen to" filter and an audio badge on the show card — both need a batch/cached lookup across a whole shows list rather than one show at a time, flagging as a follow-up rather than half-building it',
      ]
    },
    {
      version: '5.4.0',
      date: 'August 30, 2026',
      title: 'Runs & Tours',
      changes: [
        'New: Two or more consecutive nights at the same venue by the same artist now show up as a "run" — a dedicated page with a night-by-night breakdown, a combined setlist showing which nights each song landed on, and a call-out when a run had zero repeats across every night',
        'New: A show that\'s part of a run now says so on its own page ("Night 2 of 3 — view the full run") and on its card in My Shows',
        'New: Tours — shows sharing a setlist.fm tour name now link to a tour page listing every stop you caught, in order, with venues and ratings',
        'New: /stats/runs lists every run you\'ve logged, newest first',
        'Runs require a real gap of no more than one day between nights at a fuzzy-matched venue name, so a sponsor-name change mid-run (or a run spanning New Year\'s Eve) doesn\'t split it into two — but a single show never counts as a run',
        'If a run has a night with no setlist logged yet, the no-repeat call-out is left undetermined rather than guessing',
        'Not yet built: multi-venue tour legs and festival grouping (both need different rules than a single-venue run), and a shareable run recap card — flagging both as known gaps rather than half-building them',
      ]
    },
    {
      version: '5.3.1',
      date: 'August 30, 2026',
      title: 'Song Identity Cleanup',
      changes: [
        'Fixed: Two spellings of the same song now merge everywhere song titles are counted, not just on song pages and the Wishlist — this includes the "Songs" tab on the main Stats page, the shared-collection summary text, the community leaderboard, and the song-history popup used in friend comparisons and the setlist editor',
        'Added test coverage for personal gap tracking, verifying the math at each edge case: seeing a song at your most recent show, seeing it only once ever, and seeing it at the very first show you logged for that artist',
      ]
    },
    {
      version: '5.3.0',
      date: 'August 30, 2026',
      title: 'Song Pages & Personal Gap Tracking',
      changes: [
        'New: Every song you\'ve logged now has its own page — times seen, first/last seen, and your current personal gap ("You haven\'t seen this in 14 shows — 2 years, 3 months since Dick\'s, 9/2/2023")',
        'New: A song page lists every time you\'ve seen it in reverse-chronological order with venue, set, and segue context, plus a by-year breakdown, where it tends to land in the set (opener, set closer, encore), and your best-rated versions',
        'New: Song titles in a setlist are now links to that song\'s page — click straight through from any show\'s setlist',
        '"Songs I\'ve Seen" on the Wishlist page now links to each song\'s page too',
        'New: /stats/songs lists every song you\'ve seen for a chosen artist, sortable by times seen or current gap',
        'Personal gap is scoped to your own logged shows for now — a global "the band hasn\'t played this in 213 shows" gap is a planned follow-up',
        'Fixed: Two spellings of the same song (e.g. "Ashes//Dust" vs. "Ashes // Dust") now merge into one entry everywhere song titles are matched, including the Wishlist',
      ]
    },
    {
      version: '5.2.1',
      date: 'August 30, 2026',
      title: 'Year-Scoped Top Venues & Top Artists Drill-Down',
      changes: [
        'Fixed: Clicking a venue or artist on Top Venues / Top Artists now filters My Shows to that year by default, instead of showing all-time shows',
        'New: The year filter on the resulting My Shows view can be changed or set to "All Years" without losing the venue/artist filter',
        'The "Your shows at [Venue]" / "Your shows seeing [Artist]" header now includes the year (e.g. "Your 2026 shows at Red Rocks Amphitheatre") and updates live as you change the year',
      ]
    },
    {
      version: '5.2.0',
      date: 'August 29, 2026',
      title: 'Simpler Navigation, Refreshed Logo & a Wishlist Home Base',
      changes: [
        'Changed: Sidebar reorganized around the 7 places you actually go — My Shows, Wishlist, Upcoming, Artists, Venues, Stats, and Profile',
        'Friends moved off the sidebar and onto your Profile page — look for the Friends button up top; every existing link into Friends still works',
        '"Scan / Import" is no longer a separate sidebar entry, but it\'s still right there on the My Shows page',
        'New: The Wishlist page now shows a card for every artist you\'ve already started a wishlist for, so you can jump straight back in instead of searching for them again — the artist search is still there for starting a new one',
        'Refreshed the MySetlists logo (header, favicon, and app icons) so it matches the gold-on-navy Concert Venue theme instead of an old green palette',
        'Fixed: The artist info panel for Goose now links to the band\'s actual Wikipedia page — it was previously landing on the article about the bird',
      ]
    },
    {
      version: '5.1.0',
      date: 'August 26, 2026',
      title: 'Encore Songs & Full Setlist Editing',
      changes: [
        'New: "Add a song setlist.fm missed" now offers Encore as a set option — including a specific encore (Encore, Encore II, etc.) when a show has more than one, and you can start a new Encore section on a show that setlist.fm recorded as a single set',
        'New: "Edit setlist" on any show you logged lets you move a song between Set 1, Set 2, and Encore, and reorder songs within a set — works for setlist.fm songs and songs you added yourself',
        'Moving or reordering a song is a personal edit layered on top of the imported setlist — it never gets sent back to setlist.fm and is never overwritten if that show\'s setlist is auto-populated again',
        'Song count, play counts, and stats are unaffected by which set a song sits in or its order within a set',
        'Edit setlist is only available to you on your own shows, and works with touch on mobile',
      ]
    },
    {
      version: '5.0.0',
      date: 'August 26, 2026',
      title: 'Concert Venue Theme — Gold & Purple Redesign',
      changes: [
        'New: Site-wide "concert venue" color palette — dark navy backgrounds with stage-gold and amber accents, plus a bright purple highlight for a third layer of contrast',
        'Every screen uses the same token-based theme, so the new palette applies consistently across Shows, Stats, Profile, Admin, and the logged-out landing page',
        'Buttons, badges, tags, and the year-in-review heatmap were re-checked for text contrast against the new brighter accent colors',
        'Fixed: "Add a song setlist.fm missed" is now available on shows opened from the Stats page (Years and Top Shows) — it was previously wired up only on the Shows page',
      ]
    },
    {
      version: '4.1.1',
      date: 'August 26, 2026',
      title: 'Setlist Sections, Tagged Friends on Cards & Comments Removed',
      changes: [
        'New: Setlists now group songs into their actual Set 1 / Set 2 / Encore sections on the show detail page, matching how setlist.fm presents them, instead of one flat list',
        'New: Songs you add yourself (via "Add a song setlist.fm missed") can now be assigned to a specific set or encore instead of always landing at the end',
        'New: Show cards on Shows and Stats now display any friends tagged as attending with you — "with [Friend]" or "with N friends" — using the same tagging data as the Friends "Together" count',
        'Fixed: A show/venue name mismatch meant tagged friends never actually showed up in the "Friends Who Were There" panel on the show detail page — now fixed',
        'Removed: The friend-to-friend "Shared Memories" comment feature on shared shows, including comment display on Profile, in the setlist editor, and in Shows Together — existing comments are kept in the database but are no longer created, shown, or editable',
        'Your own personal show and song notes are unaffected — those still work exactly as before',
      ]
    },
    {
      version: '4.1.0',
      date: 'August 26, 2026',
      title: 'Site-Wide Design Consistency Pass',
      changes: [
        'Every page now matches the Shows page\'s look, feel, and interaction patterns — same fonts, spacing, cards, buttons, tabs, and empty/loading states throughout',
        'Stats, Top Artists, and Top Venues now share one underline-style tab component (matching Shows\' Timeline/By Artist tabs) instead of a separate pill-style nav',
        'Search, Scan/Import, Community, Feedback, Roadmap, Invite, and How to Use pages now use the shared page header, card, button, and input components instead of one-off styling',
        'Fixed several buttons that rendered dark text on a colored background (Search, Scan/Import, Feedback, Invite, and the sign-in/sign-up forms) — all primary actions now render consistently',
        'Removed duplicate page titles that were appearing twice on Search and Upcoming Shows',
        'Sign-in and sign-up forms now use the same input, button, and password-visibility styling as the rest of the app',
        'How to Use page rebuilt in the app\'s light theme — it previously used an unrelated dark theme left over from an old design',
        'Friends, Wishlist, and Profile pages now use the shared empty-state, modal, and stat-figure components',
        'The Tabs component gained support for route-backed sub-navigation and notification badges, so pages needing either no longer roll their own',
      ]
    },
    {
      version: '4.0.3',
      date: 'August 26, 2026',
      title: 'Manual Setlist Additions & Fewer Interruptions',
      changes: [
        'New: Add a song setlist.fm missed directly from a show\'s detail page — it\'s saved to your show and counts toward play counts, song history, and stats just like any other song',
        'Manually-added songs are marked "added by you" in the setlist so it\'s clear they aren\'t part of setlist.fm\'s own record',
        'Removed: The "What\'s New" modal and the one-time announcement popup no longer appear after signing in',
        'Changed: Stat boxes on the Shows page (Shows, Artists, Venues, Avg Rating) are now sized to match the Profile page for a more consistent look',
      ]
    },
    {
      version: '4.0.2',
      date: 'August 26, 2026',
      title: 'Show Detail Polish — Play Counts & Inline Ratings',
      changes: [
        'Changed: "Show play counts" on the show detail page now defaults to on for anyone who hasn\'t set a preference — turn it off from the toggle if you\'d rather not see it',
        'Changed: Show rating and venue rating now display on the same line on the show detail page instead of stacked, wrapping gracefully on narrow screens',
      ]
    },
    {
      version: '4.0.1',
      date: 'August 26, 2026',
      title: 'Shows Page Cleanup — Consistent Show Cards',
      changes: [
        'Removed: "Auto-fetch setlists from Setlist.fm" banner and scan progress bar from the Shows page — setlist scanning is still available to admins from the Admin panel',
        'Changed: Show cards on the Shows page now match the Stats page — tour name, song count, and average song rating are shown for every show, not just artist/venue/date/rating',
        'Shows page and Stats page now share one show card component, so a show looks identical everywhere it appears',
      ]
    },
    {
      version: '4.0.0',
      date: 'August 26, 2026',
      title: 'Stats Page Redesign — Detailed Breakdown Front and Center',
      changes: [
        'Changed: The detailed breakdown (Years, Songs, Artists, Venues, Top Shows) is now the default view on Stats — no more scrolling to the bottom to find it',
        'New: Top Artists and Top Venues moved to their own pages, linked from a new sub-nav at the top of Stats',
        'Same data, same year filters — just relocated so the page loads with your full breakdown front and center',
      ]
    },
    {
      version: '3.20.0',
      date: 'August 15, 2026',
      title: 'Wishlist — Songs You Want to See Live',
      changes: [
        'New: Wishlist page — pick an artist and see every song they\'ve played live that you haven\'t caught yet, sourced from setlist.fm',
        'New: "Songs I\'ve Seen" panel shows every song by that artist from your own logged shows, with play counts',
        'New: Check off songs from their live catalog to build a per-artist wishlist that saves automatically',
        'Wishlist persists per artist across sessions — pre-checked boxes pick up right where you left off',
        'Song titles are normalized when matching your setlists against setlist.fm\'s catalog, so "(Live)" tags and punctuation differences don\'t cause duplicates',
        'Songs you\'ve logged that setlist.fm has no record of (private edits, typos) are flagged rather than hidden',
        'Sign-in required — Wishlist is not available in guest mode',
      ]
    },
    {
      version: '3.19.0',
      date: 'March 26, 2026',
      title: 'Find Missing Setlists — Now Available to All Users',
      changes: [
        'New: "Find Missing Setlists" banner on the Shows page — users can now auto-fetch setlists from Setlist.fm for any shows missing them',
        'New: Admin per-user scanning — click into any user in Admin and scan their shows individually for missing setlists',
        'New: Per-user results with populate buttons, bulk populate, and song count preview',
        'Scan results clear automatically when navigating between users',
      ]
    },
    {
      version: '3.18.0',
      date: 'March 26, 2026',
      title: 'Find Missing Setlists — All-Users Admin Tool',
      changes: [
        'Fixed: Admin > Tools > Find Missing Setlists now scans ALL users, not just the admin\'s own shows',
        'New: Setlist.fm search with fuzzy artist name matching (handles &/and, The prefix variants)',
        'New: Populate individual setlists or bulk-populate all matched results with one click',
        'New: Filter results by match status (All / Matched / No Match) to quickly find actionable items',
        'New: Stats dashboard showing users scanned, missing setlists, and setlist.fm matches',
        'New: admin-find-missing-setlists Netlify function with rate-limited setlist.fm integration',
        'New: admin-populate-setlist Netlify function for populating individual shows with safety checks (won\'t overwrite user-created setlists)',
        'Preserves "Scan My Shows Only" button for quick personal scanning alongside the new all-users tool',
      ]
    },
    {
      version: '3.17.0',
      date: 'March 26, 2026',
      title: 'One-Time Popup System',
      changes: [
        'New: One-time popup announcement system — important updates shown once and dismissed for 12 months',
        'New: Popup manager utility tracks dismissals in localStorage with automatic 12-month expiration',
        'New: PopupOverlay component with fade/slide animations, keyboard navigation, and focus trapping',
        'New: Popup registry for centralized popup definitions with audience targeting (all, new users, returning users, admin)',
        'New: usePopup hook for standalone popup control in any component',
        'New: PopupQueue automatically shows eligible popups one at a time on app load',
        'New: Admin > Popups tab to preview, reset, and manage all popup dismissals',
        'Handles edge cases: localStorage quota, clock skew, corrupted data, SSR safety',
        'Full accessibility: ARIA labels, keyboard trap, Escape to close, screen reader support',
        'Mobile responsive: full-width on small screens, centered modal on desktop',
      ]
    },
    {
      version: '3.16.0',
      date: 'March 26, 2026',
      title: 'Song Play Counts & History',
      changes: [
        'New: Toggle play counts on setlist songs — see how many times you\'ve seen each song by this artist',
        'New: First-time songs highlighted with an orange badge so you can spot songs you\'ve never seen before',
        'New: Click any song name to open the Song History modal with every show where you\'ve heard that song',
        'Song History shows date, venue, your song rating, and any notes for each performance',
        'Stats summary at bottom: average rating, first/last heard, venues seen at, and best performance',
        '"View Show" button in Song History lets you jump directly to that show\'s setlist',
        'Play count toggle state persists across sessions via localStorage',
        'Available from Shows, Stats, and Friends views',
      ]
    },
    {
      version: '3.15.0',
      date: 'March 26, 2026',
      title: 'Smart Scroll to Comment & Return Navigation',
      changes: [
        'New: Clicking "View Show" from Profile > Comments now scrolls directly to the relevant song or show note in the setlist modal',
        'New: Song and show comments are briefly highlighted with a green glow so you can spot them instantly',
        'New: When closing the show modal, the Profile page restores your exact scroll position in the Comments section',
        'Improved navigation flow between Profile comments and Show modal — no more losing your place',
      ]
    },
    {
      version: '3.14.0',
      date: 'March 26, 2026',
      title: 'Shows & Profile UI Improvements',
      changes: [
        'New: Hover effects on Shows page stat buttons (Shows, Songs, Artists, Venues, Avg Rating) with green tint and scale animation',
        'Updated: "Select" button renamed to "Select Multiple Shows" for clarity',
        'Removed: "Date" sort option from Shows page sort filter — shows still sort by date by default',
        'Fixed: Friends badge now accurately shows pending invites + incoming friend requests',
        'Removed: Hover effects on non-actionable Profile page stats and cards to reduce confusion',
      ]
    },
    {
      version: '3.13.0',
      date: 'March 25, 2026',
      title: 'Favorite Artists & Tour Information',
      changes: [
        'New: Favorite artists — heart any artist from Stats, Shows, or show detail modal',
        'New: Favorite Artists section on Profile page showing your favorited artists with show counts and last seen date',
        'New: Tour Information modal — view current tours, recent tours, and all-time stats for favorited artists via setlist.fm',
        'New: Netlify functions for fetching artist info and tour data from setlist.fm API',
        'Tour data is cached for 24 hours in localStorage to avoid excessive API calls',
        'Heart button appears in Stats artist rows and in the show detail modal header',
        'MusicBrainz IDs are automatically fetched and stored when you favorite an artist',
        'Tour Info modal shows setlist.fm tour groupings with venue listings, date ranges, and avg songs per show',
      ]
    },
    {
      version: '3.12.0',
      date: 'March 25, 2026',
      title: 'Profile Comments & UI Polish',
      changes: [
        'New: Comments section on Profile page with "My Comments" and "Friends\' Comments" tabs',
        'View all your show notes and song notes in one place, sorted by date',
        'See comments friends left on your shared shows, with filter by friend',
        'Click "View Show" from any comment to jump directly to that show\'s setlist',
        'Fixed: Tag Friend and Rate Venue options now appear in Stats page show modal (previously missing)',
        'Added hover effects to all Profile stat cards for better interactivity',
        'Increased logo size across the app for better visibility',
        'Pagination for comments (20 at a time) for smooth scrolling with many notes',
      ]
    },
    {
      version: '3.11.0',
      date: 'March 25, 2026',
      title: 'Duplicate Prevention, What\'s New Refresh & UI Polish',
      changes: [
        'New: Duplicate show detection — accepting a friend tag for a show you already have merges tag data instead of creating a duplicate',
        'New: Admin duplicate cleanup tool — scan all users for duplicate shows and merge them (dry run + live modes)',
        'Updated: "What\'s New" modal now only shows when new features are added (proper version tracking)',
        'Updated: "What\'s New" content refreshed with 5 latest features: AI Ticket Scanning, Bulk Tagging, Guest Access, Consolidated Emails, Roadmap Voting',
        'Fixed: Tooltip "Got It" button now clearly visible with green background and white text',
        'Fixed: "Search for a Show" and "Scan / Import" buttons updated to solid green (#34D399) for brand consistency',
        'Improved: Duplicate detection matches on artist + venue + date (case-insensitive)',
        'Improved: When a duplicate is detected, users see a helpful message instead of a confusing second entry',
      ]
    },
    {
      version: '3.10.1',
      date: 'March 24, 2026',
      title: 'Bulk Tagging, Email Improvements & Post-Accept Navigation',
      changes: [
        'New: Bulk friend tagging — select multiple shows and tag friends in all of them at once',
        'New: Consolidated email notifications — bulk tagging sends one email per friend listing all shows, not one email per show',
        'New: Deep linking from email notifications — clicking "View Shows" in tag emails takes you directly to Friends > Requests',
        'New: After accepting tagged shows, you are automatically navigated to the Shows page with a confirmation toast',
        'New: Pending email tags now visible in Friends > Invites — see which non-members you\'ve tagged and what shows they\'re waiting to accept',
        'Redesigned email templates — light background, updated branding with green/amber accents, and improved readability',
        'Updated tag email wording — "tagged you in a show you attended together" replaces uncertain "thinks you were at this show"',
        'Fixed: Tag notification emails now work correctly (resolved Firestore permission and base64url encoding errors)',
        'Fixed: Tooltips in show detail modal no longer cut off by container overflow',
        'Fixed: Application crash caused by missing Sparkles and Upload icon imports',
        'Fixed: Post-signup crash for invited users resolved',
        'Fixed: Profile page now accessible from the sidebar navigation',
      ]
    },
    {
      version: '3.9.0',
      date: 'March 24, 2026',
      title: 'Account Management, Email Control & iOS Sign-In Fix',
      changes: [
        'New: Delete your account from Settings — permanently removes all shows, friends, tags, and data',
        'New: Unsubscribe from all emails via profile Settings or one-click unsubscribe link in every email',
        'New: All email notifications now include an unsubscribe link in the footer',
        'New: Email opt-out is respected across all notification types (invites, tags, suggestions, shared memories)',
        'Fixed: Google and Apple sign-in now working correctly on iOS app',
        'Fixed: iOS OAuth redirects properly configured with reversed client ID URL scheme',
        'Improved: Capacitor Firebase Authentication plugin configured with native provider support',
        'Improved: Better error handling for native sign-in cancellation on iOS',
        'Improved: Account deletion writes an audit trail for compliance before removing data',
        'Improved: Roadmap completion notifications respect email opt-out preferences',
        'Fixed: Application error when invited users sign up and log in',
      ]
    },
    {
      version: '3.8.0',
      date: 'March 24, 2026',
      title: 'Branded Email Notifications',
      changes: [
        'All email notifications now feature a branded design with the MySetlists logo, dark theme, and green/amber accent colors',
        'Invite emails include a feature overview with signup link and auto-friendship note',
        'Show tag emails display artist, venue, and date in a styled card with personal messages',
        'Tag confirmation emails notify the tagger when their friend confirms a shared show',
        'Show suggestion nudge emails prompt friends to confirm attendance with a direct link',
        'Shared memory comment emails notify friends of new comments on confirmed shows',
        'Friend joined notifications let inviters know when their friend signs up',
        'Email templates extracted to a shared module (lib/emailTemplates.js) for easier maintenance',
        'All emails are mobile-responsive and render consistently across Gmail, Outlook, and Apple Mail',
      ]
    },
    {
      version: '3.7.0',
      date: 'March 22, 2026',
      title: 'Artist Search, Admin Tools & Date Fix',
      changes: [
        'New: Artist-based search — search for a performer name to discover all their shows across different bands and projects from setlist.fm',
        'Artist search results are grouped by band/project with expandable setlists and one-click import',
        'Admin: Date range filtering for Guest Trials — filter sessions by start date range',
        'Admin: Bulk delete for guest trials within a selected date range — permanently removes records instead of re-dating them',
        'Fix: Corrected date display issue where shows could appear one day off (e.g., 3/21 showing as 3/20) due to UTC timezone handling',
      ]
    },
    {
      version: '3.6.0',
      date: 'March 21, 2026',
      title: 'Dashboard Layout Reorganization',
      changes: [
        'New horizontal action button row under stats: "Search for a Show" and "Scan / Import" displayed side-by-side with gradient styling',
        '"Add Manually" button now appears contextually in search results when no shows match your query',
        '"Find Missing Setlists" moved to Admin Tools tab for cleaner dashboard',
        'Streamlined "My Shows" header — action buttons no longer stacked in the right column',
        'Responsive button row stacks on mobile for a clean layout on all screen sizes',
      ]
    },
    {
      version: '3.5.0',
      date: 'March 20, 2026',
      title: 'Admin Roadmap Enhancements',
      changes: [
        'Admin: vote counts now displayed prominently on every roadmap item with sorting by most votes',
        'Admin: submitter email address shown on each roadmap item and draft for easy identification',
        'All feedback types (feature requests, bug reports, general) now automatically appear in Admin Roadmap Drafts',
        'Drafts show feedback content, submitter email, and submission date with approve/reject actions',
        'New: completion notification emails — when a feature is marked Shipped, all voters and the original submitter receive an email via Resend',
        'Notification tracking prevents duplicate emails if an item is toggled back and forth',
        'Professional branded email template with feature details and direct link to the app',
      ]
    },
    {
      version: '3.4.0',
      date: 'March 20, 2026',
      title: 'UI Polish & Copy Fixes',
      changes: [
        'Fix: Onboarding tooltip redesigned with dark navy background and green "Got it" button for clear visibility on the light theme',
        'Fix: Tooltip z-index raised to appear above all page content',
        'Fix: Upcoming Shows now displays the number of upcoming events on sale instead of historical attendance count',
        'Removed wristband scanning references from landing page, ticket scanner, and feature announcements',
      ]
    },
    {
      version: '3.2.0',
      date: 'March 19, 2026',
      title: 'Polish & Consistency',
      changes: [
        'Refreshed UI with new color scheme based on MySetlists brand colors (green + amber from the logo)',
        'New sidebar design with dark navy background',
        'Updated browser tab title to "MySetlists | Your Show History"',
        'Fixed favicon to show correct green logo',
        'Scan / Import and Find Missing Setlists buttons updated to match Search for a Show styling',
        'Consistent button and input styling throughout the app',
      ]
    },
    {
      version: '3.1.0',
      date: 'March 19, 2026',
      title: 'Brand Refresh — Light Theme with Logo Colors',
      changes: [
        'New: Light, airy theme built from the MySetlists logo color palette — green primary (#4bc86a) and amber accent (#f5a623)',
        'New: Soft blue-gray page background (#f4f6f9) with white card surfaces for a clean, modern feel',
        'New: Dark navy sidebar (#1e2538) matching the logo background — high contrast against the light content area',
        'New: Plus Jakarta Sans typography throughout for a friendly, contemporary UI',
        'New: Search-as-input in the sidebar — always visible, styled as a search field',
        'Redesigned: Primary buttons in brand green, secondary in amber, ghost buttons with green hover borders',
        'Redesigned: Star ratings in amber, tab indicators in amber, stat highlights in green/amber',
        'Redesigned: Modals with soft blur backdrop and white elevated surfaces',
        'Redesigned: Landing page keeps dark navy background with gradient amber-to-green CTA button',
        'Technical: CSS variable system updated for light backgrounds, new shadow scale, and semantic color tokens',
        'Technical: Tailwind config extended with brand/amber color scales and themed box-shadow utilities',
      ]
    },
    {
      version: '3.0.0',
      date: 'March 19, 2026',
      title: 'Concert Venue Theme — Complete Visual Redesign',
      changes: [
        'New: Dark, moody concert venue aesthetic — near-black backgrounds with warm amber and electric teal accents',
        'New: Custom color system with CSS variables for consistent theming across every screen',
        'New: Stage-lighting background effect — subtle radial gradients suggesting amber and teal stage lights',
        'New: DM Serif Display headings paired with DM Sans body text for a vinyl-sleeve, gig-poster feel',
        'New: Themed scrollbars, amber-glow hover states, and teal secondary accents throughout',
        'Redesigned: Sidebar navigation with left accent bars, amber active states, and muted bottom items',
        'Redesigned: Cards and show entries with subtle borders, amber hover glow, and serif titles',
        'Redesigned: Buttons — amber primary CTAs with dark text, ghost secondary with teal hover',
        'Redesigned: Modals with blurred backdrop, elevated surface backgrounds, and subtle borders',
        'Redesigned: Form inputs with void background, amber focus rings, and muted placeholders',
        'Redesigned: Star ratings with amber fill and glow effect',
        'Redesigned: Stats badges, pill tags, and count indicators in the new color system',
        'Technical: All hardcoded Tailwind color classes replaced with CSS variable-backed theme tokens',
        'Technical: Tailwind config extended with semantic color names (void, surface, elevated, etc.)',
      ]
    },
    {
      version: '2.4.0',
      date: 'March 18, 2026',
      title: 'Bug Fixes: Login, Upcoming Shows & Admin Panel',
      changes: [
        'Fix: Login modal now auto-closes after successful Google or Apple sign-in',
        'Fix: Upcoming Shows page is now reachable from the sidebar navigation (was linking to a 404)',
        'Fix: Upcoming Shows green indicator dots now display correctly for artists with cached events',
        'Fix: Admin panel tabs are now horizontally scrollable on mobile — all tabs accessible on iPhone',
      ]
    },
    {
      version: '3.0.0',
      date: 'March 15, 2026',
      title: 'Native iOS App with Capacitor',
      changes: [
        'New: MySetlists is now available as a native iOS app via Capacitor — same great web app, native App Store experience',
        'New: Sign in with Apple — required by the App Store and now available on both web and iOS',
        'New: Native Google Sign-In on iOS — uses the system sign-in sheet instead of a web popup',
        'New: Native camera support for ticket scanning — choose camera or photo library on iOS',
        'New: Spotify OAuth uses in-app browser on iOS with custom URL scheme (mysetlists://) callback',
        'Improved: Tailwind CSS migrated from CDN to build-time — ~20KB purged CSS vs 300KB+ CDN, works offline',
        'Improved: All API calls route through centralized apiUrl() helper for native/web compatibility',
        'Improved: iOS safe area support — content respects the notch, Dynamic Island, and home indicator',
        'Improved: StatusBar, Keyboard tracking, and SplashScreen configured for native iOS polish',
        'Technical: Next.js static export (output: \'export\') generates pre-rendered HTML for all 21 routes',
        'Technical: PWA install prompt automatically hidden when running as a native app',
      ]
    },
    {
      version: '2.3.1',
      date: 'March 15, 2026',
      title: 'Landing Page Restored',
      changes: [
        'Fix: Logged-out users now see a full landing page with hero section, feature showcase, and community stats instead of a bare login screen',
        'Landing page highlights all major features: show tracking, ticket scanning, CSV import, playlist creation, stats, and social features',
        '"How it works" section walks new visitors through the 3-step onboarding flow',
        'Community leaderboards visible to logged-out visitors to showcase the active user base',
        '"Try it First" guest mode button lets visitors explore the app without signing up',
      ]
    },
    {
      version: '2.3.0',
      date: 'March 15, 2026',
      title: 'What\'s New Announcements & Feature Tooltips',
      changes: [
        'New: "What\'s New" modal highlights recent features for returning users — playlist creation, ticket scanning, CSV import, and more',
        'New: Playlist creation tooltip appears on the setlist view to introduce the Spotify/Apple Music playlist button',
        'Each announcement links directly to the relevant feature (e.g., "Try Scan / Import →")',
        'Announcements show once per release and are tracked in localStorage — won\'t pester you',
        'Tooltips dismiss on tap and won\'t reappear after dismissal',
      ]
    },
    {
      version: '2.2.1',
      date: 'March 14, 2026',
      title: 'Playlist Creation Bug Fix',
      changes: [
        'Fixed: Spotify playlist creation no longer fails with "Missing playlistId or trackUris" error',
        'Improved: Spotify API proxy now properly handles and surfaces non-success responses',
        'Added: Defensive validation for playlist ID before attempting to add tracks',
      ]
    },
    {
      version: '2.2.0',
      date: 'March 14, 2026',
      title: 'Create Playlists on Spotify & Apple Music',
      changes: [
        'New: "Create Playlist" button in show detail view — turn any setlist into a streaming playlist',
        'New: Spotify integration with secure OAuth login — creates a playlist with your setlist songs in one tap',
        'New: Apple Music integration via MusicKit — add setlist playlists directly to your library',
        'Smart song matching handles covers, jam annotations, and song name variations',
        'Results screen shows matched/unmatched songs with a direct link to your new playlist',
        'Playlist auto-named "[Artist] - [Venue] [Date]" with show details in the description',
      ]
    },
    {
      version: '2.1.0',
      date: 'March 14, 2026',
      title: 'Artist & Venue Info from Wikipedia',
      changes: [
        'New: "About [Artist]" collapsible panel in show detail view — see Wikipedia summary, image, and link',
        'New: "About [Venue]" collapsible panel with city disambiguation for accurate results',
        'New: Netlify function proxies Wikipedia API with 7-day Firestore cache',
        'Info panels load lazily — only fetches when you expand, and caches for instant re-access',
        'Graceful handling when no Wikipedia article exists',
      ]
    },
    {
      version: '2.0.0',
      date: 'March 14, 2026',
      title: 'Next.js 14 Migration',
      changes: [
        'Migrated from Create React App to Next.js 14 App Router with file-based routing',
        'Real URL routes replace query-parameter navigation (e.g., /stats, /friends, /search)',
        'Native SEO metadata on every page via Next.js metadata API',
        'New: Shareable collection links at /shared/[id] with server-rendered previews and JSON-LD structured data',
        'New: Dynamic artist page metadata for better search engine previews',
        'Updated sitemap.xml and robots.txt for improved crawlability',
        'PWA support preserved — install prompt, manifest, and service worker continue to work',
      ]
    },
    {
      version: '1.0.34',
      date: 'March 14, 2026',
      title: 'SEO & Discoverability Improvements',
      changes: [
        'New: Reusable SEOHead component for consistent meta tags across all pages',
        'New: Dynamic page titles and Open Graph tags on show detail views',
        'New: JSON-LD MusicEvent structured data on show detail views (schema.org)',
        'New: Netlify _headers file to allow indexing on public pages and block on private routes',
        'New: Google Search Console verification placeholder in index.html',
        'Updated: Default homepage title and description for better search visibility',
        'Updated: sitemap.xml now includes /roadmap route',
        'Updated: robots.txt with explicit allow/disallow rules and /.netlify/ exclusion',
        'Updated: Twitter Card and Open Graph fallback tags in index.html',
      ]
    },
    {
      version: '1.0.33',
      date: 'March 12, 2026',
      title: 'Admin Bulk Import for User Profiles',
      changes: [
        'New: Admins can now bulk-import shows into any user\'s profile via CSV or Excel upload',
        'New: "Bulk Import" tab in Admin panel with full multi-step wizard',
        'Step-by-step flow: select user \u2192 upload file \u2192 map columns \u2192 preview \u2192 import',
        'Auto-detects column headers (Artist, Venue, Date, City, Rating, Comment, Tour)',
        'Preview table shows validation errors and flags duplicate shows before import',
        'Server-side duplicate detection prevents duplicates even on concurrent imports',
        'Imported shows are marked with importedByAdmin field for traceability',
        'Admin audit log records every bulk import with who, for whom, and how many shows',
        'Maximum 500 shows per import to stay within serverless function limits',
      ]
    },
    {
      version: '1.0.32',
      date: 'March 12, 2026',
      title: 'Friend Notes Visible on Shared Shows',
      changes: [
        'Fix: Friends can now see each other\'s notes and ratings when viewing tagged/shared shows',
        'When you open a show you were tagged in, the tagger\'s comments and song ratings appear in violet alongside yours',
        'When you open a show you tagged friends in, their notes appear once they\'ve added them',
        'Works for show-level comments, song-level comments, and ratings \u2014 all displayed with clear attribution',
        'Tagged friend UIDs are now saved on the tagger\'s show for fast bidirectional lookups',
        'Friend annotations also appear for shows both users independently added (matched by artist + venue + date)',
      ]
    },
    {
      version: '1.0.31',
      date: 'March 11, 2026',
      title: 'Invitation & Referral Tracking in Admin',
      changes: [
        'New: Referrals tab in Admin portal \u2014 see all users who joined via invitation with inviter details',
        'New: Inviter Leaderboard \u2014 ranked list of top inviters with sent/accepted counts, conversion rate, and invitee activity',
        'New: "Invited" badge on user rows in the Users tab with blue envelope icon',
        'New: "Invited Only" filter toggle to quickly find users who joined via referral',
        'New: Invitation & Referral details panel on user profile \u2014 who invited them, who they\'ve invited, and invitee metrics',
        'New: Export referral data to CSV with one click',
        'Sortable invited users list by join date, name, or inviter',
        'Invite acceptance now saves inviter data directly on user profile for fast admin lookups',
        'Referral stats cards: total invites sent, accepted, acceptance rate, active inviters',
      ]
    },
    {
      version: '1.0.30',
      date: 'March 11, 2026',
      title: 'Guest Conversion Tracking in Admin',
      changes: [
        'New: Conversions tab in Admin portal \u2014 see all users who converted from guest accounts',
        'Conversion details include name, email, conversion date, guest shows added, and total shows',
        'New: "Converted" badge on user rows in the Users tab with amber sparkle icon',
        'New: "Converted Only" filter toggle to quickly find converted users',
        'New: Conversion details panel on user profile \u2014 guest start date, conversion date, shows before/after, session ID',
        'New: Export converted users to CSV with one click',
        'Sortable converted users list by conversion date, name, or email',
        'Guest-to-user conversion now saves tracking data directly on user profile for fast lookups',
      ]
    },
    {
      version: '1.0.29',
      date: 'March 11, 2026',
      title: 'Interactive Shows Together & Friend Annotations',
      changes: [
        'New: Shows in "Shows Together" are now fully interactive \u2014 click to expand inline with full setlist, ratings, and comments',
        'New: See your friend\'s show ratings and comments right alongside your own on shared shows',
        'New: Friend song-level ratings and notes displayed inline on every song in the setlist',
        'New: Open the full show editor directly from Shows Together \u2014 rate songs, add notes, tag friends, and more',
        'New: Friend annotations appear in the full show editor with violet badges to distinguish from your own notes',
        'Visual: Friend comments marked with purple avatar/badges, your own in green \u2014 easy to tell apart at a glance',
        'Your and friend\'s overall show ratings shown side-by-side on each show card',
      ]
    },
    {
      version: '1.0.28',
      date: 'March 10, 2026',
      title: 'Bulk Accept, Unified Scan/Import, Sidebar Refresh',
      changes: [
        'New: Bulk accept pending show tags and suggestions \u2014 accept all at once or per friend',
        'New: Scan Tickets and Import File merged into a single "Scan / Import" tabbed view',
        'Sidebar: Search pinned at top, Invite & Feedback pinned at bottom, everything else scrolls',
        'Sidebar reordered for better flow \u2014 Friends and Community moved up, Upcoming Shows follows Stats',
        'Simplified onboarding: single tooltip for the unified Scan / Import button',
      ]
    },
    {
      version: '1.0.27',
      date: 'March 9, 2026',
      title: 'Mobile-Friendly Tooltips',
      changes: [
        'Fixed: Onboarding tooltips no longer get cut off on iPhone and small screens',
        'Mobile: onboarding tooltips now appear below buttons instead of to the left, staying fully visible',
        'All button tooltips (Rate Venue, Tag Friends, Share, etc.) now work on touch devices via tap',
        'Desktop: hover tooltips continue to work as before',
        'Tooltips auto-adjust to stay within screen boundaries with proper edge padding',
      ]
    },
    {
      version: '1.0.26',
      date: 'March 9, 2026',
      title: 'Onboarding Tooltips & Ticket Scanner',
      changes: [
        'New: Onboarding tooltips guide first-time users through Import File and Scan Tickets features',
        'Tooltips appear sequentially with a gentle animation and dismiss with "Got it"',
        'New: Scan Tickets \u2014 upload photos of physical ticket stubs, wristbands, or digital tickets',
        'AI reads artist, venue, date, and city from ticket images, even old or worn stubs',
        'Automatically searches setlist.fm for matching setlists after scanning',
        'Batch scanning: upload multiple tickets at once and process them all together',
        'Emerald green favicon now matches the site logo',
      ]
    },
    {
      version: '1.0.24',
      date: 'March 4, 2026',
      title: 'Public Roadmap & Voting',
      changes: [
        "New: Public roadmap at mysetlists.net/roadmap \u2014 see what\u2019s Up Next, In Progress, and Shipped",
        'Vote on features you want most \u2014 top 3 most-voted items get a \u201cMost Requested\u201d badge',
        'Votes update in real time \u2014 no refresh needed',
        'Feature requests now save to a feedback queue and automatically create draft roadmap items',
        'Admin: new Roadmap tab for reviewing drafts, publishing items, creating items manually, and moving items between columns',
        'Get an in-app notification when your feature request makes it to the roadmap',
      ]
    },
    {
      version: '1.0.23',
      date: 'March 4, 2026',
      title: 'Pending Invites Dashboard',
      changes: [
        'New: See all pending email invites in Friends \u2192 Invites tab',
        'Resend any pending invite with one tap (limited to once per 24 hours to prevent spam)',
        'Cancel invites you no longer want to send',
        'Invites older than 30 days are marked Expired \u2014 resending resets the expiry clock',
        'Invite summary shows how many people you\u2019ve invited and how many have joined',
        'Duplicate invite guard: warns you if you try to invite someone who already has a pending invite',
        'Pending invite count now appears in the Friends badge in the sidebar',
      ]
    },
    {
      version: '1.0.22',
      date: 'March 4, 2026',
      title: 'Friend Show Suggestions, Shared Memories & SEO',
      changes: [
        'New: MySetlists now suggests when you and a friend may have been at the same show \u2014 confirm or decline from the Friends tab',
        'New: Share memories on any confirmed shared show \u2014 add, edit, and delete comments visible only to you and that friend',
        'New: Public artist pages at mysetlists.net/artist/[name] with community stats (shows tracked, fans, top songs, recent venues)',
        'New: Dynamic page titles and meta tags for better search engine visibility and sharing',
        'Improved: Notification badge now includes pending show-together suggestions',
      ]
    },
    {
      version: '1.0.21',
      date: 'March 4, 2026',
      title: 'Bug Fixes',
      changes: [
        'Fixed: Rate Venue button now opens the rating modal correctly from any page',
        'Fixed: Rate Venue modal now works when accessed from the Stats page as well as setlist view',
      ]
    },
    {
      version: '1.0.20',
      date: 'March 4, 2026',
      title: 'Venue Ratings, Social Tagging & Navigation',
      changes: [
        'Rate venues with 1\u20135 stars and optional sub-ratings (Sound, Sightlines, Atmosphere, Accessibility, Food & Drinks)',
        'See aggregate venue ratings and top-rated venues in your Stats page',
        'Tag multiple friends at a show in one tap with instant batch confirmation',
        'Tag friends when adding new shows, not just from existing setlists',
        'See all the shows you\'ve attended with a specific friend from their profile',
        'Browser back/forward buttons now work correctly throughout the app',
      ]
    },
    {
      version: '1.0.19',
      date: 'March 4, 2026',
      title: 'Email Invites, Show Tagging & Admin Tools',
      changes: [
        'Invite emails are now sent directly from mysetlists.net \u2014 no more opening your mail app',
        'Friends who join via your invite are automatically connected with a welcome message',
        'Tag friends at shows even if they haven\'t joined yet \u2014 they\'ll get an invite email with the show details',
        'New users who were tagged in shows see a "Shows your friends tagged you in" screen on first login',
        'Confirmed tags notify the friend who tagged you so they know you\'re officially show buddies',
        'Admin: full user deletion removes their account, shows, friend connections, and tags permanently',
      ]
    },
    {
      version: '1.0.18',
      date: 'February 20, 2026',
      title: 'Interactive Summary Stats',
      changes: [
        'Stat boxes are now ~50% smaller for a cleaner, less cluttered home screen',
        'Tap any stat box to jump directly to its detailed stats view (Songs, Artists, Venues, or Top Shows)',
        'User rank box now links to the Community page',
      ]
    },
    {
      version: '1.0.17',
      date: 'February 10, 2026',
      title: 'Notifications & Alerts',
      changes: [
        'Notification banner on the Shows page alerts you to pending friend requests and show tags',
        'Clicking the notification banner takes you directly to the Friends Requests tab',
        'Red badge on the Requests tab shows the number of pending friend requests and show tags',
      ]
    },
    {
      version: '1.0.16',
      date: 'February 9, 2026',
      title: 'Setlist Scanning & Onboarding',
      changes: [
        'Find Missing Setlists button scans your shows without setlists and fetches them from setlist.fm',
        'Improved setlist matching with artist name variations (e.g., "Dead & Company" vs "Dead and Company")',
        'Shows are refreshed when navigating back from Import to ensure imported shows appear immediately',
        'Setlist scanning preserves your existing ratings and comments',
        'New first-time user experience with import options: screenshot, CSV/Excel, and setlist.fm search',
      ]
    },
    {
      version: '1.0.15',
      date: 'February 9, 2026',
      title: 'Screenshot Import',
      changes: [
        'Upload a screenshot from Ticketmaster, AXS, or any ticket platform to import shows',
        'AI-powered image analysis identifies artists, venues, dates, and cities',
        'Detected shows are previewed for review before importing',
        'Setlists are automatically fetched from setlist.fm for screenshot-imported shows',
        'Supports PNG, JPG, and WebP image formats',
      ]
    },
    {
      version: '1.0.14',
      date: 'February 9, 2026',
      title: 'Sidebar Redesign',
      changes: [
        'Reorganized sidebar navigation for a cleaner layout',
        'Restored Invite option to the sidebar',
        'Moved Feedback and Release Notes below Community and Invite',
        'Hidden profile section from sidebar for a streamlined look',
      ]
    },
    {
      version: '1.0.13',
      date: 'February 9, 2026',
      title: 'Invite Auto-Friendship',
      changes: [
        'Users who join via an invite link are now automatically friends with the person who invited them',
        'Invite links now include a referral code so the app knows who sent the invitation',
        'No friend request needed \u2014 the friendship is created instantly when the invited user signs up',
      ]
    },
    {
      version: '1.0.12',
      date: 'February 9, 2026',
      title: 'Bug Fixes & Improvements',
      changes: [
        'Fixed community stats not updating \u2014 leaderboards now show all users correctly',
        'Fixed community song and venue aggregation failing due to Firestore permissions',
        'Removed duplicate years list on the Stats page',
      ]
    },
    {
      version: '1.0.11',
      date: 'February 9, 2026',
      title: 'Auto-Fetch Setlists on Import',
      changes: [
        'Imported shows now automatically search setlist.fm for matching setlists',
        'Setlists are matched by artist name and exact date',
        'Found setlists include full song lists with set breaks and encore markers',
        'Tour information is also pulled when available from setlist.fm',
        'Progress indicator shows setlist fetch status during import',
        'Import completion screen shows how many setlists were found',
      ]
    },
    {
      version: '1.0.10',
      date: 'February 8, 2026',
      title: 'Friends & Show Tagging',
      changes: [
        'Add friends by email or directly from the Community leaderboard',
        'Friend requests require acceptance \u2014 mutual friendship only',
        'Tag friends at shows you attended together',
        'Tagged shows require friend approval before importing to their collection',
        'Approved tags copy the full setlist (without your ratings or comments)',
        'Real-time notification badge for pending requests and show tags',
        'New Friends page with My Friends, Requests, and Find Friends tabs',
      ]
    },
    {
      version: '1.0.9',
      date: 'February 8, 2026',
      title: 'Admin User Support',
      changes: [
        'Admins can click any user to view their shows in the Admin Portal',
        'User show detail view with search, sort, and setlist inspection',
        'On-demand show loading for efficient data access',
      ]
    },
    {
      version: '1.0.8',
      date: 'February 7, 2026',
      title: 'File Import',
      changes: [
        'Import shows from CSV, Excel, or Google Sheets files',
        'Smart column detection \u2014 automatically maps your headers',
        'Preview and validate data before importing',
        'Duplicate detection warns about shows already in your collection',
        'Drag-and-drop or browse to upload files',
      ]
    },
    {
      version: '1.0.7',
      date: 'February 7, 2026',
      title: 'Artist Stats Upgrade',
      changes: [
        'Expandable artist rows in the Stats Artists tab \u2014 click to see all shows for that artist',
        'Double-click any show under an artist to open full show details',
      ]
    },
    {
      version: '1.0.6',
      date: 'February 7, 2026',
      title: 'Legal Pages & Stats Improvements',
      changes: [
        'Added Privacy Policy, Terms of Service, and Cookie Policy pages',
        'New site-wide footer with links to all legal pages',
        'Cookie consent banner on first visit with Accept/Decline options',
        'Terms & Privacy consent language on the signup screen',
        'Redesigned Years tab with expandable accordion view',
        'Double-click any show in the Years view to open full show details',
        'Fixed duplicate Years tab in Stats navigation',
      ]
    },
    {
      version: '1.0.5',
      date: 'February 6, 2026',
      title: 'Guest Mode & Stats Improvements',
      changes: [
        'Try the app without creating an account - shows saved locally',
        'Click shows in Stats view to edit them (same as Shows page)',
        'New Years tab in Stats to browse shows by year',
        'Prompt to create account after adding first show in guest mode',
        'Guest shows automatically migrate when you create an account',
      ]
    },
    {
      version: '1.0.4',
      date: 'February 5, 2026',
      title: 'PWA & Authentication Updates',
      changes: [
        'Install as an app on your phone or desktop (PWA support)',
        'Email/password authentication option added',
        'Profile page with your concert statistics',
        'Community leaderboards showing top show-goers',
        'Invite friends via email',
        'New sidebar navigation for easier access',
      ]
    },
    {
      version: '1.0.3',
      date: 'February 4, 2026',
      title: 'Enhanced Stats & Filtering',
      changes: [
        'Filter songs by artist, venue, or year in Stats',
        'Expandable venue details showing shows by year',
        'Top rated shows leaderboard',
        'Average song ratings displayed per show',
        'Improved mobile responsiveness',
      ]
    },
    {
      version: '1.0.2',
      date: 'February 3, 2026',
      title: 'Setlist Editing & Notes',
      changes: [
        'Add missing songs to any setlist',
        'Rate individual songs (1-10 scale)',
        'Add personal notes to songs',
        'Add notes to entire shows',
        'Batch rate all unrated songs at once',
        'Delete songs from setlists',
      ]
    },
    {
      version: '1.0.1',
      date: 'February 2, 2026',
      title: 'Search & Import',
      changes: [
        'Search setlist.fm for shows by artist',
        'Filter by year, venue, or city',
        'One-click import of setlists',
        'Manual show entry option',
        'Show rating system (1-10)',
      ]
    },
    {
      version: '1.0',
      date: 'February 1, 2026',
      title: 'Initial Release',
      changes: [
        'Track your concert history',
        'Google sign-in authentication',
        'Cloud sync across devices',
        'Basic statistics (shows, songs, artists)',
        'Share your collection stats',
      ]
    },
  ];

  const visibleReleases = PLAYLIST_CREATION_ENABLED
    ? releases
    : releases
        .filter((release) => !STREAMING_MENTION.test(release.title))
        .map((release) => ({
          ...release,
          changes: release.changes.filter((change) => !STREAMING_MENTION.test(change)),
        }))
        .filter((release) => release.changes.length > 0);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl md:text-2xl font-bold text-primary mb-2">Release Notes</h1>
      <p className="text-secondary mb-8">What's new in Setlist Tracker</p>

      <div className="space-y-6">
        {visibleReleases.map((release, index) => (
          <div
            key={release.version}
            className={`bg-hover backdrop-blur-xl rounded-2xl border border-subtle p-6 ${
              index === 0 ? 'ring-2 ring-brand/30' : ''
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-lg font-bold text-primary">v{release.version}</span>
                  {index === 0 && (
                    <span className="px-2 py-0.5 bg-brand-subtle text-brand rounded-full text-xs font-semibold">
                      Latest
                    </span>
                  )}
                </div>
                <h3 className="text-brand font-medium">{release.title}</h3>
              </div>
              <span className="text-muted text-sm">{release.date}</span>
            </div>
            <ul className="space-y-2">
              {release.changes.map((change, i) => (
                <li key={i} className="flex items-start gap-3 text-secondary">
                  <Check className="w-4 h-4 text-brand mt-0.5 flex-shrink-0" />
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ReleaseNotesView;
