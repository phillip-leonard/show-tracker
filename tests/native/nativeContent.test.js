/**
 * public/native/*.json: the native app's How to Use (F-7) and What's New
 * (F-5), served by the website and bundled into the app (Stage 6, 6-11).
 * The app decodes them strictly (HelpContent.swift), so a malformed edit
 * would leave it on the bundled copy; this catches one before it ships.
 *
 *   node tests/native/nativeContent.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/native', name), 'utf8'));
const text = (v) => typeof v === 'string' && v.trim().length > 0;
let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('native content');

test('how-to-use.json: sections with unique ids and topics', () => {
  const guide = read('how-to-use.json');
  assert.ok(Array.isArray(guide.sections) && guide.sections.length >= 5);
  const ids = guide.sections.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'section ids are unique');
  for (const s of guide.sections) {
    assert.ok(text(s.id) && text(s.title), `section ${s.id}: id and title`);
    assert.ok(s.symbol === undefined || text(s.symbol), `section ${s.id}: symbol is a name`);
    assert.ok(Array.isArray(s.topics) && s.topics.length > 0, `section ${s.id}: topics`);
    const titles = s.topics.map((t) => t.title);
    assert.strictEqual(new Set(titles).size, titles.length, `section ${s.id}: topic titles are unique (they're ids)`);
    for (const t of s.topics) assert.ok(text(t.title) && text(t.body), `section ${s.id}: topic has a title and a body`);
  }
});

test('how-to-use.json is written for the native app', () => {
  const all = JSON.stringify(read('how-to-use.json')).toLowerCase();
  for (const word of ['drawer', 'sidebar', 'swipe']) assert.ok(!all.includes(word), `mentions the web's "${word}"`);
});

test('whats-new.json: releases by native version, an optional announcement', () => {
  const news = read('whats-new.json');
  assert.ok(Array.isArray(news.releases) && news.releases.length > 0);
  for (const r of news.releases) {
    assert.match(r.version, /^4\.\d+\.\d+$/, 'a native 4.x version');
    assert.ok(text(r.title) && Array.isArray(r.items) && r.items.length > 0 && r.items.every(text));
  }
  const versions = news.releases.map((r) => r.version);
  assert.strictEqual(new Set(versions).size, versions.length, 'one entry per version');
  const a = news.announcement;
  assert.ok(a === null || a === undefined || (text(a.id) && text(a.title) && text(a.body)), 'announcement shape');
});

if (failures) { console.error(`${failures} failed`); process.exit(1); }
