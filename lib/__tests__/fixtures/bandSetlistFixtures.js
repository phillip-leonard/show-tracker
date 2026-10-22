/**
 * Fixture responses for the band-source adapter tests.
 *
 * ── Provenance ───────────────────────────────────────────────────────
 *
 * THE EL GOOSE FIXTURES USE REAL KEY NAMES. Every key below was read back
 * off elgoose.net's own response via `?debug=1` on Goose at Ascend
 * Amphitheater, 2024-10-24, so these exercise the adapter against the
 * spelling the archive actually sends — including `jamchart_notes` (not
 * `jamchart_description`), `song_id` as distinct from `uniqueid`,
 * `original_artist`, `shownotes`, and the absence of any gap field.
 *
 * THE PHISH.NET FIXTURES ARE STILL CONSTRUCTED, NOT CAPTURED. phish.net is
 * parked (no API key configured), so its row shape is transcribed from
 * documentation and has never been checked against a live response. Its
 * `gap` mapping in particular is unverified — elgoose turned out to have no
 * gap field at all on the equivalent endpoint, which is reason enough not
 * to assume phish.net does.
 *
 * TO RE-CHECK EITHER against the live archive:
 *   /api/band-setlist?source=elgoose&artist=Goose&date=<date>&debug=1
 * and compare `upstream.firstRowKeys` with the adapter's FIELDS map.
 */

// Goose, Ascend Amphitheater, 2024-10-24. Abridged from the real response,
// using the real key names: two sets, a segue chain, a cover with
// `original_artist`, a jam chart with `jamchart_notes`, show-level
// `shownotes` carrying HTML, and a soundcheck row. Note there is NO gap
// key — the archive does not send one on this endpoint.
const ELGOOSE_RADIO_CITY = {
  error: false,
  error_message: '',
  data: [
    {
      showdate: '2024-10-24', permalink: 'goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html',
      venuename: 'Ascend Amphitheater', city: 'Nashville', state: 'TN', country: 'USA',
      settype: 'Soundcheck', setnumber: 1, position: 1, songname: 'Arcadia',
      transition: '', footnote: '', isjamchart: 0, jamchart_notes: null,
      soundcheck: 1, opener: 0, isoriginal: 1, original_artist: '', tourname: 'Fall Tour 2024',
      show_id: 1719248440, uniqueid: '56300', song_id: '810', artist_id: 1, slug: 'arcadia',
      shownotes: 'Night two in Nashville.<br>First <b>Green River</b> since 2022.',
    },
    {
      showdate: '2024-10-24', permalink: 'goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html',
      venuename: 'Ascend Amphitheater', city: 'Nashville', state: 'TN', country: 'USA',
      settype: 'Set', setnumber: 1, position: 1, songname: 'Echo of a Rose',
      transition: ' -> ', footnote: 'Fast version.', isjamchart: 0, jamchart_notes: null,
      soundcheck: 0, opener: 1, isoriginal: 1, original_artist: '', tourname: 'Fall Tour 2024',
      show_id: 1719248440, uniqueid: '56311', song_id: '811', artist_id: 1, slug: 'echo-of-a-rose-2',
      shownotes: 'Night two in Nashville.<br>First <b>Green River</b> since 2022.',
    },
    {
      showdate: '2024-10-24', permalink: 'goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html',
      venuename: 'Ascend Amphitheater', city: 'Nashville', state: 'TN', country: 'USA',
      settype: 'Set', setnumber: 1, position: 2, songname: 'Green River',
      transition: ' > ', footnote: 'Creedence Clearwater Revival.', isjamchart: 0,
      jamchart_notes: null, soundcheck: 0, opener: 0, isoriginal: 0,
      original_artist: 'Creedence Clearwater Revival', tourname: 'Fall Tour 2024',
      show_id: 1719248440, uniqueid: '56313', song_id: '812', artist_id: 1, slug: 'green-river',
      shownotes: 'Night two in Nashville.<br>First <b>Green River</b> since 2022.',
    },
    {
      showdate: '2024-10-24', permalink: 'goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html',
      venuename: 'Ascend Amphitheater', city: 'Nashville', state: 'TN', country: 'USA',
      settype: 'Set', setnumber: 1, position: 3, songname: 'Madhuvan',
      transition: ',', footnote: '', isjamchart: 0, jamchart_notes: null,
      soundcheck: 0, opener: 0, isoriginal: 1, original_artist: '', tourname: 'Fall Tour 2024',
      show_id: 1719248440, uniqueid: '56320', song_id: '813', artist_id: 1, slug: 'madhuvan',
      shownotes: 'Night two in Nashville.<br>First <b>Green River</b> since 2022.',
    },
    {
      showdate: '2024-10-24', permalink: 'goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html',
      venuename: 'Ascend Amphitheater', city: 'Nashville', state: 'TN', country: 'USA',
      settype: 'Set', setnumber: 2, position: 1, songname: 'Into the Myst',
      transition: ' > ', footnote: 'Unfinished.', isjamchart: 1,
      jamchart_notes: 'Exploratory, patient build into a full-band peak.',
      soundcheck: 0, opener: 0, isoriginal: 1, original_artist: '', tourname: 'Fall Tour 2024',
      show_id: 1719248440, uniqueid: '56402', song_id: '814', artist_id: 1, slug: 'into-the-myst',
      shownotes: 'Night two in Nashville.<br>First <b>Green River</b> since 2022.',
    },
    {
      showdate: '2024-10-24', permalink: 'goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html',
      venuename: 'Ascend Amphitheater', city: 'Nashville', state: 'TN', country: 'USA',
      settype: 'Encore', setnumber: 1, position: 1, songname: 'Dripfield',
      transition: '', footnote: 'Guest: Marcus King on guitar', isjamchart: 0,
      jamchart_notes: null, soundcheck: 0, opener: 0, isoriginal: 1, original_artist: '',
      tourname: 'Fall Tour 2024', show_id: 1719248440, uniqueid: '56469', song_id: '815',
      artist_id: 1, slug: 'dripfield',
      shownotes: 'Night two in Nashville.<br>First <b>Green River</b> since 2022.',
    },
  ],
};

// Phish, Hampton Coliseum, 1997-11-22. Abridged; two encores, which is the
// case the e/e2 set-code parsing exists for.
const PHISHNET_HAMPTON = {
  error: false,
  error_message: null,
  data: [
    {
      showid: 1252344800, showdate: '1997-11-22',
      permalink: 'https://phish.net/setlists/phish-november-22-1997-hampton-coliseum-hampton-va-usa.html',
      venue: 'Hampton Coliseum', city: 'Hampton', state: 'VA', country: 'USA',
      tourname: '1997 Fall Tour',
      setlistnotes: 'This show was officially released as Hampton Comes Alive.',
      set: '1', position: 1, song: 'Mikes Song', songid: 848, transmark: ' > ',
      footnote: '', gap: 4, isjamchart: 0, jamchart_description: null,
      soundcheck: '', artistid: 1,
    },
    {
      showid: 1252344800, showdate: '1997-11-22',
      permalink: 'https://phish.net/setlists/phish-november-22-1997-hampton-coliseum-hampton-va-usa.html',
      venue: 'Hampton Coliseum', city: 'Hampton', state: 'VA', country: 'USA',
      tourname: '1997 Fall Tour',
      setlistnotes: 'This show was officially released as Hampton Comes Alive.',
      set: '1', position: 2, song: 'Simple', songid: 1130, transmark: ' -> ',
      footnote: 'Unfinished.', gap: 7, isjamchart: 1,
      jamchart_description: 'Uncommonly patient Simple.', soundcheck: '', artistid: 1,
    },
    {
      showid: 1252344800, showdate: '1997-11-22',
      permalink: 'https://phish.net/setlists/phish-november-22-1997-hampton-coliseum-hampton-va-usa.html',
      venue: 'Hampton Coliseum', city: 'Hampton', state: 'VA', country: 'USA',
      tourname: '1997 Fall Tour',
      setlistnotes: 'This show was officially released as Hampton Comes Alive.',
      set: '2', position: 1, song: 'Halleys Comet', songid: 508, transmark: ', ',
      footnote: '', gap: 15, isjamchart: 0, jamchart_description: null,
      soundcheck: '', artistid: 1,
    },
    {
      showid: 1252344800, showdate: '1997-11-22',
      permalink: 'https://phish.net/setlists/phish-november-22-1997-hampton-coliseum-hampton-va-usa.html',
      venue: 'Hampton Coliseum', city: 'Hampton', state: 'VA', country: 'USA',
      tourname: '1997 Fall Tour',
      setlistnotes: 'This show was officially released as Hampton Comes Alive.',
      set: 'e', position: 1, song: 'Sleeping Monkey', songid: 1149, transmark: ' > ',
      footnote: '', gap: 33, isjamchart: 0, jamchart_description: null,
      soundcheck: '', artistid: 1,
    },
    {
      showid: 1252344800, showdate: '1997-11-22',
      permalink: 'https://phish.net/setlists/phish-november-22-1997-hampton-coliseum-hampton-va-usa.html',
      venue: 'Hampton Coliseum', city: 'Hampton', state: 'VA', country: 'USA',
      tourname: '1997 Fall Tour',
      setlistnotes: 'This show was officially released as Hampton Comes Alive.',
      set: 'e2', position: 1, song: 'Rocky Top', songid: 1061, transmark: '',
      footnote: '', gap: 19, isjamchart: 0, jamchart_description: null,
      soundcheck: '', artistid: 1,
    },
  ],
};

// One date, two shows — a festival day or a two-a-day. Distinguished by
// show_id, which is what the adapters group on.
const ELGOOSE_TWO_SHOWS_ONE_DATE = {
  error: 0,
  error_message: null,
  data: [
    {
      showdate: '2024-06-22', permalink: 'https://elgoose.net/setlists/?d=2024-06-22a',
      venuename: 'The Gorge Amphitheatre', city: 'George', state: 'WA', country: 'USA',
      settype: 'Set', setnumber: 1, position: 1, songname: 'Dripfield',
      transition: '', footnote: '', isjamchart: 0, jamchart_notes: null,
      soundcheck: 0, opener: 1, isoriginal: 1, original_artist: '', tourname: 'Summer 2024',
      show_id: 1700, uniqueid: 'eg-dripfield-1', song_id: '815', artist_id: 1, slug: 'dripfield',
    },
    {
      showdate: '2024-06-22', permalink: 'https://elgoose.net/setlists/?d=2024-06-22b',
      venuename: 'Bonnaroo', city: 'Manchester', state: 'TN', country: 'USA',
      settype: 'Set', setnumber: 1, position: 1, songname: 'Red Bird',
      transition: '', footnote: '', isjamchart: 0, jamchart_notes: null,
      soundcheck: 0, opener: 1, isoriginal: 1, original_artist: '', tourname: 'Summer 2024',
      show_id: 1701, uniqueid: 'eg-red-bird-1', song_id: '816', artist_id: 1, slug: 'red-bird',
    },
  ],
};

// Two ACTS in the same archive on one date. elgoose.net's Songfish
// instance carries Goose-adjacent projects alongside Goose itself, and
// /setlists/showdate/ is addressed by date rather than by artist — so
// without a filter this date is a coin flip between two different bands'
// setlists, decided by whichever row the archive happened to return first.
//
// artist_id and artist carry the distinction, so the filter has something
// real to work with. (These values are shaped from the archive's own key
// list; the filter fails open if it matches nothing, precisely because the
// exact values are not verified against a live response.)
const ELGOOSE_TWO_ARTISTS_ONE_DATE = {
  error: 0,
  error_message: null,
  data: [
    {
      showdate: '2025-02-14', permalink: 'goose-february-14-2025.html',
      venuename: 'Fox Theatre', city: 'Atlanta', state: 'GA', country: 'USA',
      settype: 'Set', setnumber: 1, position: 1, songname: 'Arcadia',
      transition: ' > ', footnote: '', isjamchart: 0, jamchart_notes: null,
      soundcheck: 0, opener: 1, isoriginal: 1, original_artist: '', tourname: 'Winter 2025',
      show_id: 1800, uniqueid: 'eg-arcadia-1', song_id: '900',
      artist_id: 1, artist: 'Goose', slug: 'arcadia',
    },
    {
      showdate: '2025-02-14', permalink: 'goose-february-14-2025.html',
      venuename: 'Fox Theatre', city: 'Atlanta', state: 'GA', country: 'USA',
      settype: 'Set', setnumber: 1, position: 2, songname: 'Hungersite',
      transition: '', footnote: '', isjamchart: 0, jamchart_notes: null,
      soundcheck: 0, opener: 0, isoriginal: 1, original_artist: '', tourname: 'Winter 2025',
      show_id: 1800, uniqueid: 'eg-hungersite-1', song_id: '901',
      artist_id: 1, artist: 'Goose', slug: 'hungersite',
    },
    {
      showdate: '2025-02-14', permalink: 'orebolo-february-14-2025.html',
      venuename: 'Some Small Room', city: 'Atlanta', state: 'GA', country: 'USA',
      settype: 'Set', setnumber: 1, position: 1, songname: 'Time to Flee',
      transition: '', footnote: '', isjamchart: 0, jamchart_notes: null,
      soundcheck: 0, opener: 1, isoriginal: 1, original_artist: '', tourname: 'Orebolo 2025',
      show_id: 1801, uniqueid: 'or-time-to-flee-1', song_id: '902',
      artist_id: 7, artist: 'Orebolo', slug: 'time-to-flee',
    },
  ],
};

// The failure this guards against: ONLY the song-title key is
// mis-transcribed, so every row still carries a valid settype, setnumber,
// position and gap. The setlist comes out structurally perfect and entirely
// nameless — and, before the untitled-row drop, sailed past the merge
// rule's empty-incoming guard and overwrote a real setlist with blank rows,
// taking the user's ratings with it. Note `song_name` rather than
// `songname`.
const ELGOOSE_MISTRANSCRIBED_TITLE_KEY = {
  error: 0,
  error_message: null,
  data: [
    {
      showdate: '2023-12-30', permalink: 'https://elgoose.net/setlists/?d=2023-12-30',
      venuename: 'Radio City Music Hall', city: 'New York', state: 'NY', country: 'USA',
      settype: 'Set', setnumber: 1, position: 1, song_name: 'Hot Tea',
      transition: ' > ', footnote: '', isjamchart: 0, jamchart_notes: null,
      soundcheck: 0, opener: 1, isoriginal: 1, tourname: 'Fall Tour 2023',
      show_id: 1601, uniqueid: 'eg-hot-tea', artist_id: 1, slug: 'hot-tea',
    },
    {
      showdate: '2023-12-30', permalink: 'https://elgoose.net/setlists/?d=2023-12-30',
      venuename: 'Radio City Music Hall', city: 'New York', state: 'NY', country: 'USA',
      settype: 'Set', setnumber: 1, position: 2, song_name: 'Arrow',
      transition: '', footnote: '', isjamchart: 0, jamchart_notes: null,
      soundcheck: 0, opener: 0, isoriginal: 1, tourname: 'Fall Tour 2023',
      show_id: 1601, uniqueid: 'eg-arrow', artist_id: 1, slug: 'arrow',
    },
  ],
};

const ELGOOSE_ERROR = {
  error: 1,
  error_message: 'No results found',
  data: [],
};

const PHISHNET_ERROR = {
  error: true,
  error_message: 'Invalid API key',
  data: [],
};

// The trap the explicit envelope checks exist for. If either adapter tested
// its error node truthily, a *string* "true"/"1" would read as falsy and a
// hard failure would be reported as a successful empty result.
const PHISHNET_ERROR_STRING = {
  error: 'true',
  error_message: 'Invalid API key',
  data: [],
};

// A trimmed copy of elgoose.net's real response for Goose at Ascend
// Amphitheater, 2024-10-24 (recorded 2026-10-21): five of its rows, every
// key as sent. The encore is settype 'Set' with setnumber 'e', which is how
// Songfish marks one; the guessed fixture above spells it 'Encore'.
const ELGOOSE_REAL_ENCORE = {
  "error": false,
  "error_message": "",
  "data": [
    {
      "showdate": "2024-10-24",
      "show_id": 1719248440,
      "artist": "Goose",
      "artist_id": 1,
      "venuename": "Ascend Amphitheater",
      "city": "Nashville",
      "state": "TN",
      "country": "USA",
      "permalink": "goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html",
      "tourname": "Fall Tour 2024",
      "settype": "Set",
      "setnumber": "1",
      "position": 1,
      "songname": "Echo of a Rose",
      "transition": " ->",
      "footnote": "Fast version.",
      "footnotes": "[\"Fast version.\"]",
      "isjamchart": 0,
      "jamchart_notes": null,
      "soundcheck": "",
      "opener": "",
      "isoriginal": 1,
      "original_artist": "Vasudo",
      "song_id": 463,
      "uniqueid": "56311",
      "slug": "echo-of-a-rose-2",
      "shownotes": ""
    },
    {
      "showdate": "2024-10-24",
      "show_id": 1719248440,
      "artist": "Goose",
      "artist_id": 1,
      "venuename": "Ascend Amphitheater",
      "city": "Nashville",
      "state": "TN",
      "country": "USA",
      "permalink": "goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html",
      "tourname": "Fall Tour 2024",
      "settype": "Set",
      "setnumber": "1",
      "position": 10,
      "songname": "Same Old Shenanigans",
      "transition": "",
      "footnote": "",
      "footnotes": null,
      "isjamchart": 0,
      "jamchart_notes": null,
      "soundcheck": "",
      "opener": "",
      "isoriginal": 1,
      "original_artist": "",
      "song_id": 541,
      "uniqueid": "56369",
      "slug": "same-old-shenanigans",
      "shownotes": ""
    },
    {
      "showdate": "2024-10-24",
      "show_id": 1719248440,
      "artist": "Goose",
      "artist_id": 1,
      "venuename": "Ascend Amphitheater",
      "city": "Nashville",
      "state": "TN",
      "country": "USA",
      "permalink": "goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html",
      "tourname": "Fall Tour 2024",
      "settype": "Set",
      "setnumber": "2",
      "position": 11,
      "songname": "So Ready",
      "transition": ", ",
      "footnote": "",
      "footnotes": null,
      "isjamchart": 0,
      "jamchart_notes": null,
      "soundcheck": "",
      "opener": "",
      "isoriginal": 1,
      "original_artist": "",
      "song_id": 421,
      "uniqueid": "56390",
      "slug": "so-ready",
      "shownotes": ""
    },
    {
      "showdate": "2024-10-24",
      "show_id": 1719248440,
      "artist": "Goose",
      "artist_id": 1,
      "venuename": "Ascend Amphitheater",
      "city": "Nashville",
      "state": "TN",
      "country": "USA",
      "permalink": "goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html",
      "tourname": "Fall Tour 2024",
      "settype": "Set",
      "setnumber": "2",
      "position": 15,
      "songname": "Dripfield",
      "transition": "",
      "footnote": "",
      "footnotes": null,
      "isjamchart": 0,
      "jamchart_notes": null,
      "soundcheck": "",
      "opener": "",
      "isoriginal": 1,
      "original_artist": "",
      "song_id": 738,
      "uniqueid": "56469",
      "slug": "dripfield",
      "shownotes": ""
    },
    {
      "showdate": "2024-10-24",
      "show_id": 1719248440,
      "artist": "Goose",
      "artist_id": 1,
      "venuename": "Ascend Amphitheater",
      "city": "Nashville",
      "state": "TN",
      "country": "USA",
      "permalink": "goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html",
      "tourname": "Fall Tour 2024",
      "settype": "Set",
      "setnumber": "e",
      "position": 16,
      "songname": "Mr. Action",
      "transition": "",
      "footnote": "",
      "footnotes": null,
      "isjamchart": 0,
      "jamchart_notes": null,
      "soundcheck": "",
      "opener": "",
      "isoriginal": 1,
      "original_artist": "",
      "song_id": 817,
      "uniqueid": "56485",
      "slug": "mr-action",
      "shownotes": ""
    }
  ]
};

module.exports = {
  ELGOOSE_REAL_ENCORE,
  ELGOOSE_ERROR,
  ELGOOSE_MISTRANSCRIBED_TITLE_KEY,
  ELGOOSE_RADIO_CITY,
  ELGOOSE_TWO_ARTISTS_ONE_DATE,
  ELGOOSE_TWO_SHOWS_ONE_DATE,
  PHISHNET_ERROR,
  PHISHNET_ERROR_STRING,
  PHISHNET_HAMPTON,
};
