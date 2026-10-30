#!/usr/bin/env node
/**
 * Internet Archive terms of use — docs/setlist-sources/internet-archive.md.
 *
 *   node tests/setlist-cache/archiveAttribution.test.js
 *
 * Why this test exists: the October 2026 audit found the Archive credit on
 * the show page only. Run nights, Shows Together, the setlist editor and
 * the public show page showed Archive setlists with no link to the tape.
 * These tests pin the credit everywhere a single setlist is shown, and the
 * three request rules: server-side only, an identifying User-Agent, and
 * no audio fetched.
 */

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { archiveCreditHtml, archiveItemUrl, isArchiveShow } = require('../../netlify/functions/lib/archiveAttribution');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const ITEM = 'gd77-05-08.sbd.hicks.4982.sbeok.shnf';
const archiveShow = {
  artist: 'Grateful Dead',
  setlistSource: 'archive',
  sourceShowId: ITEM,
  sourcePermalink: `https://archive.org/details/${ITEM}`,
  setlist: [{ name: 'Minglewood Blues' }],
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(rel, out);
    } else if (/\.(jsx?|mjs)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

test('credit HTML links the archive.org item and names the recording', () => {
  const html = archiveCreditHtml(archiveShow);
  assert.ok(html.includes(`href="https://archive.org/details/${ITEM}"`), html);
  assert.ok(html.includes('the Internet Archive'), html);
  assert.ok(html.includes(`recording ${ITEM}`), html);
  assert.ok(html.includes('Setlist from a tape on'), html);
  assert.ok(html.includes('Tape setlists can be incomplete.'), html);
  assert.ok(!/nofollow/i.test(html));
});

test('a Live Music Archive band links its own tape, or its own Archive page', () => {
  const kw = { artist: 'Keller Williams', setlistSource: 'archive', sourceShowId: 'kw2003-07-04.shnf', setlist: [{ name: 'Freekshow' }] };
  assert.strictEqual(archiveItemUrl(kw), 'https://archive.org/details/kw2003-07-04.shnf');
  assert.strictEqual(archiveItemUrl({ artist: 'Keller Williams', setlistSource: 'archive' }), 'https://archive.org/details/KellerWilliams');
});

test('the app credit names a tape and says tape setlists can be incomplete', () => {
  const src = read('components/shows/BandSourceAttribution.jsx');
  assert.ok(/Setlist from a tape on/.test(src));
  assert.ok(/Tape setlists can be incomplete\./.test(src));
});

test('item url: stored permalink, then the item id, then the collection', () => {
  assert.strictEqual(archiveItemUrl(archiveShow), `https://archive.org/details/${ITEM}`);
  assert.strictEqual(archiveItemUrl({ ...archiveShow, sourcePermalink: '' }), `https://archive.org/details/${ITEM}`);
  assert.strictEqual(archiveItemUrl({ setlistSource: 'archive' }), 'https://archive.org/details/GratefulDead');
  // A permalink that isn't archive.org's is never linked as the Archive's.
  assert.strictEqual(archiveItemUrl({ ...archiveShow, sourcePermalink: 'https://example.com/x' }), `https://archive.org/details/${ITEM}`);
});

test('no credit for setlist.fm shows, other sources, or an empty setlist', () => {
  assert.strictEqual(archiveCreditHtml({ ...archiveShow, setlistSource: 'setlistfm' }), '');
  assert.strictEqual(archiveCreditHtml({ ...archiveShow, setlistSource: undefined }), '');
  assert.strictEqual(archiveCreditHtml({ ...archiveShow, setlistSource: 'elgoose' }), '');
  assert.strictEqual(archiveCreditHtml({ ...archiveShow, setlist: [] }), '');
  assert.ok(!isArchiveShow(null));
});

test('the public show page renders the Archive credit', () => {
  assert.ok(/archiveCreditHtml\(show\)/.test(read('netlify/functions/public-show.js')));
});

test('every view with a per-show setlist.fm credit also has the band-source credit', () => {
  const files = walk('components').concat(walk('app'))
    .filter((f) => !f.endsWith(path.join('shows', 'SetlistfmAttribution.jsx')));
  const perShow = files.filter((f) => /<SetlistfmAttribution\s+show=/.test(read(f)));
  assert.ok(perShow.length >= 4, `expected the per-show views, found ${perShow.join(', ')}`);
  const missing = perShow.filter((f) => !/<BandSourceAttribution\s+show=/.test(read(f)));
  assert.deepStrictEqual(missing, [], `no Internet Archive credit in: ${missing.join(', ')}`);
});

test('run nights carry the fields the credit links with', () => {
  const src = read('lib/runIndex.js');
  assert.ok(/sourcePermalink:\s*show\.sourcePermalink/.test(src));
  assert.ok(/sourceShowId:\s*show\.sourceShowId/.test(src));
});

test('archive.org is only requested from Netlify functions, never the app', () => {
  // The app may link to archive.org; it never fetches from it.
  const clientFiles = ['app', 'components', 'context', 'hooks', 'lib'].flatMap((d) => walk(d));
  const offenders = clientFiles.filter((f) => {
    const src = read(f);
    return /fetch\(\s*[`'"]https?:\/\/(?:[\w-]+\.)*archive\.org/.test(src)
      || /archive\.org\/(?:advancedsearch|metadata|download)\b/.test(src);
  });
  assert.deepStrictEqual(offenders, []);
});

test('archive.org requests send a User-Agent naming MySetlists with a contact URL', () => {
  for (const rel of ['netlify/functions/lib/archiveAdapter.js', 'netlify/functions/archival-audio-lookup.js']) {
    const ua = read(rel).match(/const USER_AGENT = '([^']+)'/);
    assert.ok(ua, `${rel}: no USER_AGENT`);
    assert.ok(/^MySetlists/.test(ua[1]) && /https:\/\/mysetlists\.net/.test(ua[1]), `${rel}: ${ua[1]}`);
  }
});

test('the adapter downloads info .txt files only, never audio', () => {
  const src = read('netlify/functions/lib/archiveAdapter.js');
  const downloads = src.match(/archiveGet\(`\/download\/[^`]*`/g) || [];
  assert.strictEqual(downloads.length, 1, 'one download call, for the info file');
  // The file name comes from txtFileName, which only returns a .txt.
  assert.ok(/txtFileName[\s\S]*?\\\.txt\$\/i/.test(src));
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${name}\n    ${e.message}`);
    }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
