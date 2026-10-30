/**
 * netlify/functions/lib/archiveAttribution.js
 *
 * The Internet Archive credit for server-rendered pages: a link to the
 * archive.org item (the tape) the setlist was read from, the same line
 * components/shows/BandSourceAttribution.jsx renders in the app. See
 * docs/setlist-sources/internet-archive.md.
 */

const CONFIG = require('../../../config/internet-archive.json');

const escapeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CREDIT_STYLE = 'font-size:12px;color:#b7b6c9;margin:16px 0 0;';
const LINK_STYLE = 'color:inherit;text-decoration:underline dotted;';

function isArchiveShow(show) {
  return show?.setlistSource === 'archive' && Array.isArray(show.setlist) && show.setlist.length > 0;
}

// The band's page on the Archive, for a show with neither permalink nor id.
function bandHomeUrl(show) {
  const name = String(show?.artist || '').trim().toLowerCase();
  const artist = (CONFIG.artists || []).find((a) => [a.name, ...(a.aliases || [])].some((n) => n.toLowerCase() === name));
  return (artist && artist.homeUrl) || CONFIG.homeUrl;
}

// The stored permalink, else one built from the item id, else the band's
// page (Grateful Dead's collection when the band can't be told).
function archiveItemUrl(show) {
  if (typeof show?.sourcePermalink === 'string' && /^https:\/\/archive\.org\//.test(show.sourcePermalink)) {
    return show.sourcePermalink;
  }
  if (show?.sourceShowId) return `https://archive.org/details/${encodeURIComponent(show.sourceShowId)}`;
  return bandHomeUrl(show);
}

/** '' for any show whose setlist didn't come from the Archive. */
function archiveCreditHtml(show) {
  if (!isArchiveShow(show)) return '';
  const recording = show.sourceShowId ? `, recording ${escapeAttr(show.sourceShowId)}` : '';
  return `<p style="${CREDIT_STYLE}">Setlist from a tape on <a href="${escapeAttr(archiveItemUrl(show))}" style="${LINK_STYLE}">the ${escapeAttr(CONFIG.label)}</a>${recording}. Tape setlists can be incomplete.</p>`;
}

module.exports = { isArchiveShow, archiveItemUrl, archiveCreditHtml };
