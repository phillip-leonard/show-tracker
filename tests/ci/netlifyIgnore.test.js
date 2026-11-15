/**
 * scripts/netlify-ignore.sh — Netlify's `ignore` command (5.60.14). Exit 0
 * skips the build; exit 1 builds. A build is skipped only when every file
 * changed since the last deploy is under ios-native/.
 *
 *   node tests/ci/netlifyIgnore.test.js
 *
 * Each case makes real commits in a throwaway git repo (in the OS temp
 * folder) and runs the script there the way Netlify does, with
 * CACHED_COMMIT_REF and COMMIT_REF set.
 */

const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'netlify-ignore.sh');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netlify-ignore-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  const write = (file, text = `${file} ${Math.random()}\n`) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const commit = (files, message = 'change') => {
    files.forEach((f) => write(f));
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const run = (env) => {
    const r = spawnSync('sh', [SCRIPT], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
    return { code: r.status, out: (r.stdout + r.stderr).trim() };
  };
  const base = commit(['app/page.jsx', 'ios-native/App/MySetlistsApp.swift', 'docs/a.md', 'CHANGELOG.md', 'package.json'], 'base');
  return { dir, git, commit, run, base, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const SKIP = 0;
const BUILD = 1;
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('an ios-native/-only commit is skipped', () => {
  const r = repo();
  const head = r.commit(['ios-native/App/MySetlistsApp.swift', 'ios-native/Packages/Core/Sources/Core/New.swift']);
  const res = r.run({ CACHED_COMMIT_REF: r.base, COMMIT_REF: head });
  assert.strictEqual(res.code, SKIP, res.out);
  assert.match(res.out, /skip \(every changed file is under ios-native\/ \(2 files\)\)/);
  r.cleanup();
});

test('a mixed commit (ios-native/ plus anything else) builds', () => {
  const r = repo();
  const head = r.commit(['ios-native/App/MySetlistsApp.swift', 'CHANGELOG.md', 'package.json']);
  const res = r.run({ CACHED_COMMIT_REF: r.base, COMMIT_REF: head });
  assert.strictEqual(res.code, BUILD, res.out);
  assert.match(res.out, /changed outside ios-native\//);
  r.cleanup();
});

for (const file of ['docs/ios-native/DECISIONS.md', 'CHANGELOG.md', 'package.json', 'firestore.rules', 'netlify/functions/friends.js', 'app/page.jsx', 'netlify.toml']) {
  test(`a commit touching only ${file} builds`, () => {
    const r = repo();
    const head = r.commit([file]);
    assert.strictEqual(r.run({ CACHED_COMMIT_REF: r.base, COMMIT_REF: head }).code, BUILD);
    r.cleanup();
  });
}

test('several commits since the last deploy: one outside ios-native/ is enough to build', () => {
  const r = repo();
  r.commit(['ios-native/a.swift']);
  r.commit(['lib/stats/index.js']);
  const head = r.commit(['ios-native/b.swift']);
  assert.strictEqual(r.run({ CACHED_COMMIT_REF: r.base, COMMIT_REF: head }).code, BUILD);
  r.cleanup();
});

test('a file moved from outside into ios-native/ builds (the delete counts)', () => {
  const r = repo();
  r.git('mv', 'docs/a.md', 'ios-native/a.md');
  r.git('commit', '-q', '-m', 'move');
  const head = r.git('rev-parse', 'HEAD');
  assert.strictEqual(r.run({ CACHED_COMMIT_REF: r.base, COMMIT_REF: head }).code, BUILD);
  r.cleanup();
});

test('a directory that only starts with "ios-native" is not ios-native/', () => {
  const r = repo();
  const head = r.commit(['ios-native-tools/x.sh']);
  assert.strictEqual(r.run({ CACHED_COMMIT_REF: r.base, COMMIT_REF: head }).code, BUILD);
  r.cleanup();
});

test('builds when it cannot be sure: no base, same commit, unknown base, nothing changed', () => {
  const r = repo();
  const head = r.commit(['ios-native/a.swift']);
  assert.strictEqual(r.run({ COMMIT_REF: head }).code, BUILD, 'no CACHED_COMMIT_REF');
  assert.strictEqual(r.run({ CACHED_COMMIT_REF: head, COMMIT_REF: head }).code, BUILD, 'a retried deploy');
  assert.strictEqual(r.run({ CACHED_COMMIT_REF: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', COMMIT_REF: head }).code, BUILD, 'base not in the clone');
  assert.strictEqual(r.run({ CACHED_COMMIT_REF: r.base }).code, BUILD, 'no COMMIT_REF');
  r.git('commit', '-q', '--allow-empty', '-m', 'empty');
  const empty = r.git('rev-parse', 'HEAD');
  assert.strictEqual(r.run({ CACHED_COMMIT_REF: head, COMMIT_REF: empty }).code, BUILD, 'nothing changed');
  r.cleanup();
});

test('netlify.toml runs the script as the build ignore command', () => {
  const toml = fs.readFileSync(path.join(__dirname, '..', '..', 'netlify.toml'), 'utf8');
  const build = toml.slice(toml.indexOf('[build]'), toml.indexOf('[build.environment]'));
  assert.match(build, /^\s*ignore = "sh scripts\/netlify-ignore\.sh"\s*$/m);
});

let passed = 0;
let failed = 0;
for (const c of cases) {
  try { c.fn(); passed++; console.log(`  ✓ ${c.name}`); } catch (e) { failed++; console.error(`  ✗ ${c.name}\n    ${e.message}`); }
}
console.log(`netlifyIgnore: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
