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

// The stored permalink, else one built from the item id, else the collection.
function archiveItemUrl(show) {
  if (typeof show?.sourcePermalink === 'string' && /^https:\/\/archive\.org\//.test(show.sourcePermalink)) {
    return show.sourcePermalink;
  }
  if (show?.sourceShowId) return `https://archive.org/details/${encodeURIComponent(show.sourceShowId)}`;
  return CONFIG.homeUrl;
}

/** '' for any show whose setlist didn't come from the Archive. */
function archiveCreditHtml(show) {
  if (!isArchiveShow(show)) return '';
  const recording = show.sourceShowId ? `, recording ${escapeAttr(show.sourceShowId)}` : '';
  return `<p style="${CREDIT_STYLE}">Setlist via <a href="${escapeAttr(archiveItemUrl(show))}" style="${LINK_STYLE}">the ${escapeAttr(CONFIG.label)}</a>${recording}</p>`;
}

module.exports = { isArchiveShow, archiveItemUrl, archiveCreditHtml };
