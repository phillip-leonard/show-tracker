/**
 * festivalSeed — the pure half of the festival catalog seeder: what a seed
 * record becomes in the shared catalog, and what a run would do with each
 * record given the catalog as it stands. No Firestore access here, so the
 * planner is exercised by lib/__tests__/festivalSeed.test.js and by
 * scripts/festival-seed-dryrun.js exactly as the function runs it.
 *
 * The function that writes is netlify/functions/admin-seed-festivals.js.
 *
 * WHAT A SEEDED FESTIVAL IS. An ordinary canonical festival — the same
 * documents in the same `festivals` collection, with the same field names
 * the create flow writes (context/AppContext.jsx createFestival), so the
 * create form's match lookup, joining, the merge tool and every reader
 * treat it like any other. On top of those fields it carries where it came
 * from: source, seedKey, seedConfidence, genre, status and notes.
 *
 *   createdBy: "system:seed". No uid can equal that, so the creator-only
 *   update rule in firestore.rules leaves a seeded festival editable by the
 *   admin account alone, with no rules change.
 *
 *   location: "City, ST" — a string, because that is what the create flow
 *   writes and what the match rule's tiebreaker reads (the city is the text
 *   before the first comma). The seed's venue is deliberately left out:
 *   putting it first would make the venue the "city".
 *
 *   nameNormalized: recomputed with the app's own normalizer. The seed
 *   file's `normalizedName` is a guess and is ignored.
 *
 *   notes: the seed's research note about the edition ("cut short by
 *   weather"). NOT the user's notes — those live on each user's private
 *   attendance record under the same field name. loadFestivals reads it as
 *   `catalogNote` so the two can never be confused on screen.
 *
 *   No `festivalId` field, ever. The canonical and per-user collections are
 *   both called `festivals`, and the collection-group readers in the admin
 *   tools tell attendance records apart by that field.
 *
 * WHAT A RUN DOES WITH EACH RECORD, given the current catalog:
 *
 *   skip              its document (seed_<seedKey>) or its seedKey is
 *                     already in the catalog. A second run lands here for
 *                     every record it created the first time.
 *   matched_existing  the app's match rule pairs it with a festival already
 *                     in the catalog, and their dates and city agree.
 *                     Nothing is created and the existing doc is untouched.
 *   conflict          matched, but the dates differ or the cities disagree.
 *                     Nothing is created either; it is listed for a human.
 *   create            no match: a new canonical festival.
 *   excluded          no match, but the run was limited to other
 *                     seedConfidence levels (e.g. verified + high only).
 *                     Created by a later run that includes its level.
 *   failed            the record itself is malformed. Reported, skipped,
 *                     and the rest of the run carries on.
 *
 * Seed records are not matched against each other. The seed is curated:
 * Coachella weekends and Warped Tour cities are separate on purpose, and no
 * two records in it match under the rule anyway (checked by the test).
 */

const {
  festivalsMatch,
  normalizeFestivalName,
  locationsAgree,
  nameSimilarity,
  FESTIVAL_NAME_MAX,
} = require('./festivalMatchRule');

const SEED_CREATOR = 'system:seed';
const SEED_SOURCE = 'seed';
const SEED_ID_PREFIX = 'seed_';

// The fields context/AppContext.jsx createFestival writes, which are also
// the `festivals` create rule's hasOnly list in firestore.rules. The test
// reads both and fails if this drifts from either.
const CREATE_FLOW_FIELDS = [
  'name', 'nameNormalized', 'startDate', 'endDate', 'year',
  'location', 'edition', 'createdBy', 'createdAt', 'updatedAt',
];

// What a seeded festival carries beyond the create-flow fields.
const SEED_FIELDS = ['source', 'seedKey', 'seedConfidence', 'genre', 'status', 'notes'];

const ACTIONS = ['create', 'matched_existing', 'conflict', 'skip', 'excluded', 'failed'];

// Every seedConfidence the seed file uses, strongest first. A run can be
// limited to some of them (e.g. verified + high); see normalizeConfidence.
const CONFIDENCE_LEVELS = ['verified', 'high', 'medium'];

/**
 * The confidence filter for a run, from whatever the caller passed:
 * undefined/null means every level; otherwise an array (or comma-separated
 * string) of levels from CONFIDENCE_LEVELS. Throws on an unknown level or an
 * empty list, so a typo can never silently turn into "create nothing" or
 * "create everything".
 */
function normalizeConfidence(input) {
  if (input == null) return [...CONFIDENCE_LEVELS];
  const list = (Array.isArray(input) ? input : String(input).split(','))
    .map(s => String(s).trim().toLowerCase())
    .filter(Boolean);
  const unknown = list.filter(l => !CONFIDENCE_LEVELS.includes(l));
  if (unknown.length) {
    throw new Error(`Unknown confidence level ${unknown.join(', ')} (use ${CONFIDENCE_LEVELS.join(', ')})`);
  }
  if (list.length === 0) throw new Error('Confidence filter is empty');
  return CONFIDENCE_LEVELS.filter(l => list.includes(l));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Firestore document ids may not contain "/", and seedKeys become ids.
const SEED_KEY_RE = /^[a-z0-9][a-z0-9-]*$/;

function seedDocId(seedKey) {
  return `${SEED_ID_PREFIX}${seedKey}`;
}

function seedLocation(location) {
  if (!location || typeof location !== 'object') return '';
  return [location.city, location.state].map(s => String(s || '').trim()).filter(Boolean).join(', ');
}

/** '' for a usable record, otherwise what is wrong with it. */
function seedRecordProblem(record) {
  if (!record || typeof record !== 'object') return 'not an object';
  if (!SEED_KEY_RE.test(record.seedKey || '')) return `bad seedKey ${JSON.stringify(record.seedKey)}`;
  const name = String(record.name || '').trim();
  if (!name) return 'missing name';
  if (name.length > FESTIVAL_NAME_MAX) return `name longer than ${FESTIVAL_NAME_MAX}`;
  if (!DATE_RE.test(record.startDate || '')) return `bad startDate ${JSON.stringify(record.startDate)}`;
  if (!DATE_RE.test(record.endDate || '')) return `bad endDate ${JSON.stringify(record.endDate)}`;
  if (record.endDate < record.startDate) return 'endDate before startDate';
  return '';
}

/**
 * The canonical document for one seed record. `now` is whatever the caller
 * stamps createdAt/updatedAt with (a server timestamp in the function, a
 * placeholder in tests and dry runs).
 */
function canonicalFromSeed(record, now = null) {
  const name = String(record.name).trim();
  return {
    name,
    nameNormalized: normalizeFestivalName(name),
    startDate: record.startDate,
    endDate: record.endDate,
    // Seed records always have dates; `year` (5.58.0) is their start
    // date's year, as the create flow writes it. Festivals seeded before
    // 5.58.0 don't have it, which the rules and lib/festivalDates.js allow.
    year: Number(String(record.startDate).slice(0, 4)),
    location: seedLocation(record.location),
    edition: record.edition == null ? '' : String(record.edition),
    createdBy: SEED_CREATOR,
    createdAt: now,
    updatedAt: now,
    source: SEED_SOURCE,
    seedKey: record.seedKey,
    seedConfidence: record.seedConfidence || null,
    genre: record.genre || null,
    status: record.status || 'held',
    notes: record.notes || null,
  };
}

function summarizeExisting(festival) {
  return {
    id: festival.id,
    name: festival.name || '',
    startDate: festival.startDate || '',
    endDate: festival.endDate || festival.startDate || '',
    location: festival.location || '',
    createdBy: festival.createdBy || '',
    source: festival.source || 'user',
  };
}

function differencesBetween(seedDoc, existing) {
  const diffs = [];
  if (seedDoc.startDate !== existing.startDate || seedDoc.endDate !== existing.endDate) {
    diffs.push('dates');
  }
  if (!locationsAgree(seedDoc.location, existing.location)) diffs.push('location');
  return diffs;
}

/**
 * What a run would do with every record, given `catalog` (every document
 * currently in the `festivals` collection, each with its `id`). Pure.
 *
 * `options.confidence` limits which records may be CREATED (default: every
 * level). It only gates creation: a record outside the filter is still
 * reported as skip, matched_existing or conflict when that applies, since a
 * match is worth knowing about whatever its confidence, and lands in
 * `excluded` only where it would otherwise have been created. A later run
 * with a wider filter creates exactly those.
 *
 * Returns { create, matched_existing, conflict, skip, excluded, failed } —
 * each an array of entries sorted by start date — plus `counts` and the
 * `confidence` levels the plan used.
 */
function planSeed(records, catalog = [], options = {}) {
  const confidence = normalizeConfidence(options.confidence);
  const plan = Object.fromEntries(ACTIONS.map(a => [a, []]));
  const byId = new Map(catalog.map(c => [c.id, c]));
  const bySeedKey = new Map(catalog.filter(c => c.seedKey).map(c => [c.seedKey, c]));
  const seen = new Set();

  (records || []).forEach((record, index) => {
    const problem = seedRecordProblem(record);
    if (problem) {
      plan.failed.push({
        seedKey: (record && record.seedKey) || `#${index}`,
        name: (record && record.name) || '',
        startDate: (record && record.startDate) || '',
        seedConfidence: (record && record.seedConfidence) || '',
        reason: problem,
      });
      return;
    }
    if (seen.has(record.seedKey)) {
      plan.failed.push({
        seedKey: record.seedKey, name: record.name, startDate: record.startDate,
        seedConfidence: record.seedConfidence || '', reason: 'duplicate seedKey in the seed file',
      });
      return;
    }
    seen.add(record.seedKey);

    const docId = seedDocId(record.seedKey);
    const doc = canonicalFromSeed(record);
    const entry = {
      seedKey: record.seedKey,
      docId,
      name: doc.name,
      startDate: doc.startDate,
      endDate: doc.endDate,
      location: doc.location,
      seedConfidence: doc.seedConfidence,
      status: doc.status,
    };

    const already = byId.get(docId) || bySeedKey.get(record.seedKey);
    if (already) {
      plan.skip.push({ ...entry, existingId: already.id, reason: 'already seeded' });
      return;
    }

    const matches = catalog
      .filter(c => festivalsMatch(doc, c))
      .map(c => {
        const existing = summarizeExisting(c);
        return {
          existing,
          differences: differencesBetween(doc, existing),
          similarity: nameSimilarity(doc.name, existing.name),
        };
      })
      // Best first: the one that agrees on everything, then by name.
      .sort((a, b) => a.differences.length - b.differences.length || b.similarity - a.similarity);

    if (matches.length === 0) {
      if (confidence.includes(doc.seedConfidence)) {
        plan.create.push({ ...entry, doc });
      } else {
        plan.excluded.push({ ...entry, reason: `seedConfidence ${doc.seedConfidence || 'missing'} not selected` });
      }
      return;
    }

    const best = matches[0];
    const action = best.differences.length === 0 ? 'matched_existing' : 'conflict';
    plan[action].push({
      ...entry,
      existing: best.existing,
      differences: best.differences,
      otherMatches: matches.slice(1).map(m => m.existing),
    });
  });

  ACTIONS.forEach(a => {
    plan[a].sort((x, y) =>
      String(x.startDate).localeCompare(String(y.startDate)) ||
      String(x.seedKey).localeCompare(String(y.seedKey))
    );
  });

  return {
    ...plan,
    confidence,
    counts: Object.fromEntries(ACTIONS.map(a => [a, plan[a].length])),
  };
}

// ── Plain-text report ──────────────────────────────────────────────────

function table(rows, columns) {
  if (rows.length === 0) return '  (none)\n';
  const cells = rows.map(r => columns.map(([, get]) => String(get(r) ?? '')));
  const widths = columns.map(([label], i) => Math.max(label.length, ...cells.map(c => c[i].length)));
  const line = (vals) => '  ' + vals.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  return [
    line(columns.map(([label]) => label)),
    line(widths.map(w => '-'.repeat(w))),
    ...cells.map(line),
  ].join('\n') + '\n';
}

const dates = (r) => (r.endDate && r.endDate !== r.startDate ? `${r.startDate}..${r.endDate}` : r.startDate);
const existingDates = (r) => dates(r.existing);

/**
 * The dry-run report: one table per action, each sorted by start date,
 * with seedConfidence in every table so `medium` rows stand out.
 */
function formatPlanReport(plan, { catalogCount = null } = {}) {
  const c = plan.counts;
  const out = [];
  out.push(
    `Festival seed plan — create ${c.create}, matched_existing ${c.matched_existing}, ` +
    `conflict ${c.conflict}, skip ${c.skip}, excluded ${c.excluded}, failed ${c.failed}` +
    (catalogCount == null ? '' : ` (catalog has ${catalogCount} festivals now)`)
  );
  if (plan.confidence) out.push(`Creating seedConfidence: ${plan.confidence.join(', ')}`);
  const mediumCreates = plan.create.filter(r => r.seedConfidence === 'medium').length;
  if (mediumCreates) out.push(`${mediumCreates} of the creates are seedConfidence=medium.`);
  out.push('');

  out.push(`CONFLICT (${c.conflict}) — matched an existing festival, but dates or city differ. Nothing is written.`);
  out.push(table(plan.conflict, [
    ['conf', r => r.seedConfidence],
    ['seed dates', dates],
    ['seed name', r => r.name],
    ['seed location', r => r.location],
    ['existing dates', existingDates],
    ['existing name', r => r.existing.name],
    ['existing location', r => r.existing.location],
    ['differs', r => r.differences.join('+')],
    ['existing id', r => r.existing.id],
  ]));

  out.push(`MATCHED_EXISTING (${c.matched_existing}) — already in the catalog. Nothing is written.`);
  out.push(table(plan.matched_existing, [
    ['conf', r => r.seedConfidence],
    ['seed dates', dates],
    ['seed name', r => r.name],
    ['seed location', r => r.location],
    ['existing dates', existingDates],
    ['existing name', r => r.existing.name],
    ['existing location', r => r.existing.location],
    ['existing id', r => r.existing.id],
    ['by', r => (r.existing.source === 'seed' ? 'seed' : String(r.existing.createdBy).slice(0, 6))],
  ]));

  out.push(`CREATE (${c.create})`);
  out.push(table(plan.create, [
    ['conf', r => r.seedConfidence],
    ['dates', dates],
    ['name', r => r.name],
    ['location', r => r.location],
    ['status', r => (r.status === 'held' ? '' : r.status)],
    ['doc id', r => r.docId],
  ]));

  out.push(`SKIP (${c.skip}) — already seeded.`);
  out.push(table(plan.skip, [
    ['conf', r => r.seedConfidence],
    ['dates', dates],
    ['name', r => r.name],
    ['doc id', r => r.existingId],
  ]));

  if (c.excluded) {
    out.push(`EXCLUDED (${c.excluded}) — no match, but its confidence level wasn't selected. A later run that includes it creates these.`);
    out.push(table(plan.excluded, [
      ['conf', r => r.seedConfidence],
      ['dates', dates],
      ['name', r => r.name],
      ['location', r => r.location],
      ['doc id', r => r.docId],
    ]));
  }

  if (c.failed) {
    out.push(`FAILED (${c.failed})`);
    out.push(table(plan.failed, [
      ['seedKey', r => r.seedKey],
      ['name', r => r.name],
      ['reason', r => r.reason],
    ]));
  }
  return out.join('\n');
}

module.exports = {
  SEED_CREATOR,
  SEED_SOURCE,
  SEED_ID_PREFIX,
  CREATE_FLOW_FIELDS,
  SEED_FIELDS,
  ACTIONS,
  CONFIDENCE_LEVELS,
  normalizeConfidence,
  seedDocId,
  seedLocation,
  seedRecordProblem,
  canonicalFromSeed,
  planSeed,
  formatPlanReport,
};
