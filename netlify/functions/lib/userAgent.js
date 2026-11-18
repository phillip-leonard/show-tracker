// lib/userAgent.js — the one User-Agent every function sends to an outside
// data source (Wikipedia, MusicBrainz, Discogs, archive.org, Relisten,
// setlist.fm, the Songfish archives, phish.net, Ticketmaster).
//
// "Application/version ( contact )", the form MusicBrainz's rate-limit rules
// ask for (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting) and the
// volunteer-run archives appreciate: they can see who is asking and reach
// us. The version is the site's own, so it never goes stale.
//
// Not for calls to our own site, or to vendor APIs that identify us by key
// (Anthropic, Resend, Spotify). tests/metadata/userAgent.test.js fails if a
// function sends any other User-Agent to an outside source.

const { version } = require('../../../package.json');

const USER_AGENT = `MySetlists/${version} ( https://mysetlists.net; support@mysetlists.net )`;

module.exports = { USER_AGENT };
