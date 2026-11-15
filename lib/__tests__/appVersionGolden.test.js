/**
 * The shared version-gating table (fixtures/app-version/version-status.json)
 * against lib/appVersion.js. The Swift app's Core runs the same table
 * (AppVersionTests), so both apps gate on the same rule.
 *
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/appVersionGolden.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { compareVersions, versionStatus } from '@/lib/appVersion';

const table = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'app-version', 'version-status.json'), 'utf8'));
let passed = 0;
let failed = 0;
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); } };

for (const [a, b, expected] of table.compare) check(`compare(${a}, ${b})`, () => assert.strictEqual(compareVersions(a, b), expected));
for (const r of table.status) check(`status(${r.current}, ${r.min}, ${r.latest})`, () => assert.strictEqual(versionStatus({ current: r.current, min: r.min, latest: r.latest }), r.expected));

console.log(`appVersionGolden: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
