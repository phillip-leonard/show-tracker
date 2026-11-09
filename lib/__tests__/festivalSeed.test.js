/**
 * Tests for the festival catalog seeder: the planner and document shape in
 * netlify/functions/lib/festivalSeed.js, the write loop in
 * netlify/functions/admin-seed-festivals.js, and — through the app's own
 * ESM match rule — that seeded festivals are suggested by the create form
 * exactly the way user-created ones are.
 *
 * The cases this file exists to protect:
 *
 *   1. A seeded festival has the create flow's field names. If the create
 *      flow or the rules gain or rename a field, this fails instead of the
 *      seeded catalog quietly drifting from the user-created one.
 *   2. Running twice creates nothing the second time.
 *   3. A user-created festival is never overwritten or duplicated: a match
 *      is reported, and so is a conflict.
 *   4. Editions stay apart: Bonnaroo 2025 is not Bonnaroo 2026, and each
 *      Coachella weekend is its own festival.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/festivalSeed.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as esm from '@/lib/festivalMatch';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

const seedLib = require('../../netlify/functions/lib/festivalSeed.js');
const { writeCreates } = require('../../netlify/functions/admin-seed-festivals.js');
const SEED = require('../../data/festival-seed.json').festivals;

const {
  planSeed, canonicalFromSeed, seedDocId, formatPlanReport,
  CREATE_FLOW_FIELDS, SEED_FIELDS, SEED_CREATOR,
} = seedLib;

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  pending.push(async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${e.message}`);
    }
  });
}

const bySeedKey = (key) => {
  const r = SEED.find(s => s.seedKey === key);
  if (!r) throw new Error(`no seed record ${key}`);
  return r;
};

// The catalog after a clean seed: every record as its canonical document.
const seededCatalog = () => SEED.map(r => ({ id: seedDocId(r.seedKey), ...canonicalFromSeed(r) }));

const userFestival = (id, name, startDate, endDate, location = '') => ({
  id, name, nameNormalized: esm.normalizeFestivalName(name), startDate, endDate,
  location, edition: '', createdBy: 'uid-alice', createdAt: null, updatedAt: null,
});

// What the create form would offer, given what a user typed. Same function
// context/AppContext.jsx runs over its candidate set.
const suggest = (name, startDate, endDate = startDate, catalog = seededCatalog()) =>
  esm.findFestivalMatches({ name, startDate, endDate, location: '' }, catalog).map(m => m.festival.seedKey);

// ── The seed file ───────────────────────────────────────────────────────

test('seed file has 293 records and every one plans cleanly into an empty catalog', () => {
  assert.strictEqual(SEED.length, 293);
  const plan = planSeed(SEED, []);
  assert.deepStrictEqual(plan.counts, { create: 293, matched_existing: 0, conflict: 0, skip: 0, excluded: 0, failed: 0 });
});

// ── Confidence filter ───────────────────────────────────────────────────

test('a verified + high run creates only those and excludes the medium records', () => {
  const plan = planSeed(SEED, [], { confidence: ['verified', 'high'] });
  const medium = SEED.filter(r => r.seedConfidence === 'medium').length;
  assert.strictEqual(plan.counts.excluded, medium);
  assert.strictEqual(plan.counts.create, SEED.length - medium);
  assert.ok(plan.create.every(e => e.seedConfidence !== 'medium'));
  assert.ok(plan.excluded.every(e => e.seedConfidence === 'medium'));
  assert.deepStrictEqual(plan.confidence, ['verified', 'high']);
});

test('a later full run creates exactly what the filtered run excluded', () => {
  const first = planSeed(SEED, [], { confidence: 'verified,high' });
  const after = first.create.map(e => ({ id: e.docId, ...e.doc }));
  const second = planSeed(SEED, after);
  assert.deepStrictEqual(
    second.create.map(e => e.seedKey).sort(),
    first.excluded.map(e => e.seedKey).sort()
  );
  assert.strictEqual(second.counts.skip, first.counts.create);
});

test('the filter gates creation only: a medium record that matches is still reported as a match', () => {
  const r = SEED.find(s => s.seedConfidence === 'medium');
  const user = userFestival('u9', r.name, r.startDate, r.endDate, canonicalFromSeed(r).location);
  const plan = planSeed([r], [user], { confidence: ['verified'] });
  assert.strictEqual(plan.counts.matched_existing, 1);
  assert.strictEqual(plan.counts.excluded, 0);
});

test('an unknown or empty confidence filter is refused, never ignored', () => {
  assert.throws(() => planSeed(SEED, [], { confidence: ['verfied'] }), /Unknown confidence/);
  assert.throws(() => planSeed(SEED, [], { confidence: [] }), /empty/);
  assert.throws(() => seedLib.normalizeConfidence(''), /empty/);
  assert.deepStrictEqual(seedLib.normalizeConfidence(undefined), ['verified', 'high', 'medium']);
  assert.deepStrictEqual(seedLib.normalizeConfidence(['HIGH', ' verified ']), ['verified', 'high']);
});

test('no two seed records match each other under the app rule', () => {
  const docs = seededCatalog();
  const pairs = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      if (esm.festivalsMatch(docs[i], docs[j])) pairs.push(`${docs[i].seedKey} ~ ${docs[j].seedKey}`);
    }
  }
  assert.deepStrictEqual(pairs, []);
});

// ── Document shape ──────────────────────────────────────────────────────

test('CREATE_FLOW_FIELDS is exactly the festivals create rule\'s hasOnly list', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const block = rules.slice(rules.indexOf('match /festivals/{festivalId}'));
  const create = block.slice(block.indexOf('allow create'), block.indexOf('allow update'));
  const hasOnly = create.match(/hasOnly\(\[([^\]]*)\]/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  assert.deepStrictEqual([...hasOnly].sort(), [...CREATE_FLOW_FIELDS].sort());
});

test('CREATE_FLOW_FIELDS is exactly what AppContext createFestival writes', () => {
  const src = fs.readFileSync(path.join(root, 'context/AppContext.jsx'), 'utf8');
  const fn = src.slice(src.indexOf('const createFestival = async'));
  const literal = fn.slice(fn.indexOf('const canonical = {'), fn.indexOf('};', fn.indexOf('const canonical = {')));
  // `key: value` and shorthand `key,` both count.
  const keys = [...literal.matchAll(/^\s+(\w+)\s*[:,]/gm)].map(m => m[1]);
  assert.deepStrictEqual([...keys].sort(), [...CREATE_FLOW_FIELDS].sort());
});

test('a seeded document has the create-flow fields plus the seed fields, and no festivalId', () => {
  const doc = canonicalFromSeed(bySeedKey('bonnaroo-2025'));
  assert.deepStrictEqual(Object.keys(doc).sort(), [...CREATE_FLOW_FIELDS, ...SEED_FIELDS].sort());
  assert.ok(!('festivalId' in doc));
  assert.strictEqual(doc.createdBy, SEED_CREATOR);
  assert.strictEqual(doc.source, 'seed');
  assert.strictEqual(doc.seedKey, 'bonnaroo-2025');
  assert.strictEqual(doc.seedConfidence, 'verified');
  assert.strictEqual(doc.status, 'cut_short');
  assert.strictEqual(doc.location, 'Manchester, TN');
  assert.strictEqual(doc.edition, '2025');
  assert.ok(doc.notes);
});

test('every seeded document passes the create rule\'s field checks', () => {
  for (const r of SEED) {
    const d = canonicalFromSeed(r);
    assert.ok(typeof d.name === 'string' && d.name.length > 0 && d.name.length <= 120, r.seedKey);
    assert.ok(d.nameNormalized.length <= 120, r.seedKey);
    assert.match(d.startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(d.endDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d.endDate >= d.startDate, r.seedKey);
    assert.ok(typeof d.location === 'string' && d.location.includes(', '), r.seedKey);
  }
});

test('nameNormalized comes from the app normalizer, not the seed file', () => {
  const r = SEED.find(s => /&/.test(s.name));
  assert.ok(r, 'expected a seed name with "&"');
  const doc = canonicalFromSeed(r);
  assert.strictEqual(doc.nameNormalized, esm.normalizeFestivalName(r.name));
  assert.notStrictEqual(doc.nameNormalized, r.normalizedName);
});

// ── Idempotency ─────────────────────────────────────────────────────────

test('running twice creates nothing the second time', () => {
  const first = planSeed(SEED, []);
  const after = first.create.map(e => ({ id: e.docId, ...e.doc }));
  const second = planSeed(SEED, after);
  assert.strictEqual(second.counts.create, 0);
  assert.strictEqual(second.counts.skip, 293);
  assert.strictEqual(second.counts.matched_existing + second.counts.conflict, 0);
});

test('a doc carrying the seedKey under another id is also a skip', () => {
  const r = bySeedKey('bonnaroo-2025');
  const plan = planSeed([r], [{ id: 'hand-made', ...canonicalFromSeed(r) }]);
  assert.strictEqual(plan.counts.skip, 1);
  assert.strictEqual(plan.skip[0].existingId, 'hand-made');
});

test('doc ids are seed_<seedKey>', () => {
  assert.strictEqual(seedDocId('bonnaroo-2025'), 'seed_bonnaroo-2025');
  const plan = planSeed([bySeedKey('bonnaroo-2025')], []);
  assert.strictEqual(plan.create[0].docId, 'seed_bonnaroo-2025');
});

// ── Matches against user-created festivals ──────────────────────────────

test('a matching user festival is reported, not duplicated or modified', () => {
  const user = userFestival('u1', 'BottleRock', '2025-05-23', '2025-05-25', 'Napa, CA');
  const catalog = [user];
  const snapshot = JSON.stringify(catalog);
  const plan = planSeed([bySeedKey('bottlerock-napa-valley-2025')], catalog);
  assert.strictEqual(plan.counts.create, 0);
  assert.strictEqual(plan.counts.matched_existing, 1);
  assert.strictEqual(plan.matched_existing[0].existing.id, 'u1');
  assert.strictEqual(JSON.stringify(catalog), snapshot, 'planner must not touch the catalog');
});

test('a "Daytona" vs "Daytona Beach" location is a match, not a conflict', () => {
  const user = userFestival('u2', 'Rockville 2026', '2026-05-07', '2026-05-10', 'Daytona, FL');
  const plan = planSeed([bySeedKey('welcome-to-rockville-2026')], [user]);
  assert.strictEqual(plan.counts.matched_existing, 1);
});

test('different dates are a conflict, and nothing is created', () => {
  const user = userFestival('u3', 'Bonnaroo', '2025-06-13', '2025-06-16', 'Manchester, TN');
  const plan = planSeed([bySeedKey('bonnaroo-2025')], [user]);
  assert.strictEqual(plan.counts.conflict, 1);
  assert.strictEqual(plan.counts.create, 0);
  assert.deepStrictEqual(plan.conflict[0].differences, ['dates']);
});

test('a different city is a conflict', () => {
  const user = userFestival('u4', 'Bonnaroo', '2025-06-12', '2025-06-15', 'Nashville, TN');
  const plan = planSeed([bySeedKey('bonnaroo-2025')], [user]);
  assert.deepStrictEqual(plan.conflict[0].differences, ['location']);
});

test('a user\'s Bonnaroo 2026 never absorbs the Bonnaroo 2025 seed', () => {
  const user = userFestival('u5', 'Bonnaroo', '2026-06-11', '2026-06-14', 'Manchester, TN');
  const plan = planSeed([bySeedKey('bonnaroo-2025'), bySeedKey('bonnaroo-2026')], [user]);
  assert.deepStrictEqual(plan.create.map(e => e.seedKey), ['bonnaroo-2025']);
  assert.deepStrictEqual(plan.matched_existing.map(e => e.seedKey), ['bonnaroo-2026']);
});

test('a bad record fails alone and the rest still plan', () => {
  const bad = { ...bySeedKey('bonnaroo-2025'), seedKey: 'bad/key' };
  const plan = planSeed([bad, bySeedKey('bonnaroo-2026')], []);
  assert.strictEqual(plan.counts.failed, 1);
  assert.strictEqual(plan.counts.create, 1);
});

test('every action table is sorted by start date', () => {
  const plan = planSeed(SEED, []);
  const starts = plan.create.map(e => e.startDate);
  assert.deepStrictEqual(starts, [...starts].sort());
});

test('the report has a table per action and shows confidence', () => {
  const report = formatPlanReport(planSeed(SEED.slice(0, 5), []));
  for (const heading of ['CONFLICT', 'MATCHED_EXISTING', 'CREATE', 'SKIP']) assert.ok(report.includes(heading), heading);
  assert.ok(/\bconf\b/.test(report));
});

// ── Create-form suggestions over the seeded catalog ─────────────────────

test('Coachella weekends stay separate; a Weekend 2 date suggests Weekend 2', () => {
  assert.deepStrictEqual(suggest('Coachella', '2025-04-19'), ['coachella-2025-weekend-2']);
  assert.deepStrictEqual(suggest('Coachella', '2025-04-12'), ['coachella-2025-weekend-1']);
  const w1 = canonicalFromSeed(bySeedKey('coachella-2025-weekend-1'));
  const w2 = canonicalFromSeed(bySeedKey('coachella-2025-weekend-2'));
  assert.strictEqual(esm.festivalsMatch(w1, w2), false);
});

test('ACL weekends stay separate', () => {
  assert.deepStrictEqual(suggest('Austin City Limits', '2025-10-11'), ['austin-city-limits-2025-weekend-2']);
  assert.deepStrictEqual(suggest('Austin City Limits', '2025-10-04'), ['austin-city-limits-2025-weekend-1']);
});

test('Bonnaroo 2025 and 2026 never match', () => {
  assert.deepStrictEqual(suggest('Bonnaroo', '2025-06-13'), ['bonnaroo-2025']);
  assert.deepStrictEqual(suggest('Bonnaroo', '2026-06-12'), ['bonnaroo-2026']);
  assert.strictEqual(esm.festivalsMatch(
    canonicalFromSeed(bySeedKey('bonnaroo-2025')), canonicalFromSeed(bySeedKey('bonnaroo-2026'))
  ), false);
});

test('multi-weekend records match a show on any date inside the span', () => {
  assert.deepStrictEqual(suggest('Summerfest', '2025-06-20'), ['summerfest-2025']);
  assert.deepStrictEqual(suggest('Summerfest', '2025-07-03'), ['summerfest-2025']);
  assert.deepStrictEqual(suggest('Newport Folk', '2021-07-27'), ['newport-folk-festival-2021']);
  assert.deepStrictEqual(suggest('When We Were Young', '2022-10-29'), ['when-we-were-young-2022']);
  const jazz = SEED.find(r => r.brand && /jazz/i.test(r.brand) && /new orleans/i.test(r.name) && r.edition === 2025);
  assert.ok(jazz, 'expected a 2025 New Orleans Jazz Fest record');
  const inside = new Date(Date.parse(`${jazz.endDate}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  assert.deepStrictEqual(suggest(jazz.name, inside), [jazz.seedKey]);
});

test('LOCKN\' 2021 weekends and Warped Tour cities are separate festivals', () => {
  assert.deepStrictEqual(suggest('LOCKN', '2021-08-21'), ['lockn-2021-weekend-2']);
  assert.deepStrictEqual(suggest('Warped Tour', '2025-07-26'), ['vans-warped-tour-2025-long-beach']);
  assert.deepStrictEqual(suggest('Warped Tour', '2025-06-14'), ['vans-warped-tour-2025-washington-dc']);
});

test('single-day festivals (start == end) match', () => {
  assert.deepStrictEqual(suggest('Kilby Block Party', '2021-10-02'), ['kilby-block-party-2021']);
  assert.deepStrictEqual(suggest('Darker Waves', '2026-11-14'), ['darker-waves-2026']);
});

test('a festival across a month boundary (Hulaween, Oct 30 – Nov 2) matches either side', () => {
  assert.deepStrictEqual(suggest('Hulaween', '2025-10-30'), ['suwannee-hulaween-2025']);
  assert.deepStrictEqual(suggest('Hulaween', '2025-11-02'), ['suwannee-hulaween-2025']);
  assert.deepStrictEqual(suggest('Hulaween', '2025-10-30', '2025-11-02'), ['suwannee-hulaween-2025']);
});

// ── Writes ──────────────────────────────────────────────────────────────

function fakeDb({ failBatch = false, existing = new Set(), broken = new Set() } = {}) {
  const store = new Map();
  const create = (id, data) => {
    if (existing.has(id) || store.has(id)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
    if (broken.has(id)) throw new Error('boom');
    store.set(id, data);
  };
  return {
    store,
    collection: () => ({ doc: (id) => ({ id, create: async (data) => create(id, data) }) }),
    batch: () => {
      const ops = [];
      return {
        create: (ref, data) => ops.push([ref.id, data]),
        commit: async () => {
          if (failBatch) throw new Error('batch rejected');
          ops.forEach(([id]) => { if (existing.has(id) || broken.has(id)) throw new Error('batch rejected'); });
          ops.forEach(([id, data]) => create(id, data));
        },
      };
    },
  };
}

test('writeCreates writes every planned create with timestamps', async () => {
  const plan = planSeed(SEED, []);
  const db = fakeDb();
  const result = await writeCreates(db, plan.create, () => 'TS');
  assert.deepStrictEqual(result, { created: 293, skipped: 0, failed: [] });
  const doc = db.store.get('seed_bonnaroo-2025');
  assert.strictEqual(doc.createdAt, 'TS');
  assert.strictEqual(doc.createdBy, SEED_CREATOR);
});

test('a failed batch falls back to one-by-one: one bad record costs only itself', async () => {
  const plan = planSeed(SEED.slice(0, 10), []);
  const db = fakeDb({
    existing: new Set([plan.create[0].docId]),
    broken: new Set([plan.create[1].docId]),
  });
  const result = await writeCreates(db, plan.create, () => 'TS');
  assert.strictEqual(result.created, 8);
  assert.strictEqual(result.skipped, 1);
  assert.strictEqual(result.failed.length, 1);
  assert.strictEqual(result.failed[0].docId, plan.create[1].docId);
});

(async () => {
  for (const run of pending) await run();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
