/**
 * App-wide constants — extracted from App.js.
 */

export const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];

export const VALID_VIEWS = [
  'shows', 'stats', 'search', 'friends', 'invite', 'feedback',
  'release-notes', 'scan-import', 'community', 'profile', 'admin',
  'roadmap',
];

// Roadmap feature categories — used in FeedbackView, RoadmapView, PublicRoadmapPage, AdminView
export const ROADMAP_CATEGORIES = {
  ui: 'UI/Design',
  social: 'Social',
  data: 'Data & Stats',
  search: 'Search',
  other: 'Other',
};

// Roadmap column definitions — order and display for the three public columns
export const ROADMAP_COLUMNS = [
  { key: 'upnext',     label: 'Up Next',      emoji: '\uD83D\uDD1C', headerColor: 'text-amber',  border: 'border-amber/30'  },
  { key: 'inprogress', label: 'In Progress',   emoji: '\uD83D\uDEE0\uFE0F', headerColor: 'text-brand',   border: 'border-brand/30'   },
  { key: 'shipped',    label: 'Shipped',        emoji: '\u2705', headerColor: 'text-success', border: 'border-success/30' },
];

// Shared import field definitions (used by ImportView and admin bulk import)
export const IMPORT_FIELDS = [
  { key: 'artist', label: 'Artist', required: true },
  { key: 'venue', label: 'Venue', required: true },
  { key: 'date', label: 'Date', required: true },
  { key: 'city', label: 'City', required: false },
  { key: 'country', label: 'Country', required: false },
  { key: 'rating', label: 'Rating', required: false },
  { key: 'comment', label: 'Comment', required: false },
  { key: 'tour', label: 'Tour', required: false },
];

// Ticket event cache TTL
/**
 * Playlist creation (Spotify and Apple Music) is switched off.
 *
 * Neither provider works end to end today:
 *   - Spotify needs NEXT_PUBLIC_SPOTIFY_CLIENT_ID at build time. It is set on
 *     Netlify but not in local or Xcode Cloud builds, so the button ships
 *     disabled in the iOS app while working on the website.
 *   - Apple Music needs APPLE_MUSIC_TEAM_ID / KEY_ID / PRIVATE_KEY on the
 *     server for the MusicKit developer token. They are not set anywhere, so
 *     it fails on web and in the app.
 *
 * A half-working feature is worse than an absent one in App Review: the
 * reviewer is an Apple employee on an Apple device, and a broken Apple Music
 * button is a Guideline 2.1 rejection. Hiding it is the safe state to submit.
 *
 * TO RE-ENABLE: set the environment variables above (all four), verify both
 * providers on device, flip this to true, and put the playlist line back in
 * the App Store description — see claude/app-store-connect-metadata.md.
 */
export const PLAYLIST_CREATION_ENABLED = false;

export const TICKET_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours in ms
