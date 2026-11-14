#!/usr/bin/env node
/**
 * set-admin-claim — give the admin account the `admin: true` custom claim
 * (5.59.12).
 *
 *   node scripts/set-admin-claim.js            # dry run: shows what it would do
 *   node scripts/set-admin-claim.js --apply    # sets the claim
 *
 * isAdmin() in netlify/functions/lib/firebaseAdmin.js and in
 * firestore.rules / storage.rules accepts either this claim or the
 * allowlisted address with a verified email. Setting the claim is the first
 * step of moving admin onto the claim alone; a later change can then drop
 * the email half. Existing claims on the account are kept.
 *
 * The claim reaches the app the next time its ID token refreshes (within
 * an hour, or on the next sign-in).
 *
 * Credentials come from .env, same as scripts/purge-user.js.
 */

(function loadDotEnv() {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

const { ADMIN_EMAILS, getAdminAuth } = require('../netlify/functions/lib/firebaseAdmin');

/** The claims to set: the existing ones plus admin, or null when already set. */
function nextClaims(existing) {
  const claims = existing || {};
  return claims.admin === true ? null : { ...claims, admin: true };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const auth = getAdminAuth();
  console.log(apply ? 'APPLY: setting the claim' : 'DRY RUN: nothing is changed (pass --apply to set the claim)');
  for (const email of ADMIN_EMAILS) {
    let user;
    try {
      user = await auth.getUserByEmail(email);
    } catch {
      console.log(`${email}: no account`);
      continue;
    }
    const next = nextClaims(user.customClaims);
    if (!next) { console.log(`${email}: already has admin: true`); continue; }
    console.log(`${email}: ${user.emailVerified ? 'verified' : 'NOT verified'}; would set ${JSON.stringify(next)}`);
    if (apply) {
      await auth.setCustomUserClaims(user.uid, next);
      console.log(`${email}: set`);
    }
  }
}

module.exports = { nextClaims };

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
