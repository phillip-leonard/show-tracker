/**
 * fixtures/anniversaries/cases.json against the web's own rules:
 * "Relive this night" (lib/reliveThisNight.js pickReliveShow) and the
 * upcoming anniversaries list (lib/anniversaries.js
 * buildUpcomingAnniversaries). The native app reads the same file
 * (AnniversaryTests), so a change to either rule shows up in both.
 *
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/anniversaryFixtures.test.js
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pickReliveShow } from '@/lib/reliveThisNight';
import { buildUpcomingAnniversaries } from '@/lib/anniversaries';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, '../../fixtures/anniversaries/cases.json'), 'utf8'));

let passed = 0;
let failed = 0;
for (const c of fixture.cases) {
  try {
    const shows = c.showIds.map((id) => fixture.shows.find((s) => s.id === id));
    // Local noon on the case's day: pickReliveShow reads the device's local date.
    const relive = pickReliveShow(shows, new Date(`${c.today}T12:00:00`));
    assert.strictEqual(relive ? relive.id : null, c.expected.relive, 'relive');
    const upcoming = buildUpcomingAnniversaries(shows, c.today).map((e) => ({ id: e.show.id, occurrence: e.occurrence, yearsAgo: e.yearsAgo }));
    assert.deepStrictEqual(upcoming, c.expected.upcoming, 'upcoming');
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${c.name}\n  ${err.message}`);
  }
}
console.log(`\nanniversaryFixtures: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
