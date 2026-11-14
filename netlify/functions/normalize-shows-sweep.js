// netlify/functions/normalize-shows-sweep.js
//
// Scheduled function (netlify.toml, hourly, 5.60.5): the safety net behind
// normalize-show (lib/showSweep.js).
//   - every run: shows the app wrote with needsNormalization (offline, or
//     before normalize-show answered) are normalized from their own saved
//     input, in place, keeping the user's edits
//   - the 03:xx UTC run also checks every show for what an older build may
//     have written wrong (the date format, isManual, a missing setlist) and
//     fixes only that
// Logs counts only.

const { getDb, getAdminAuth } = require('./lib/firebaseAdmin');
const { sweepPending, sweepStored } = require('./lib/showSweep');

const FULL_PASS_UTC_HOUR = 3;

exports.handler = async function () {
  try {
    const db = getDb();
    const { FieldValue } = require('firebase-admin/firestore');
    const emailFor = async (uid) => {
      try { return (await getAdminAuth().getUser(uid)).email || null; } catch { return null; }
    };
    const pending = await sweepPending(db, { write: true, emailFor, FieldValue });
    const full = new Date().getUTCHours() === FULL_PASS_UTC_HOUR;
    const stored = full ? await sweepStored(db, { write: true }) : null;
    console.log(`[normalize-shows-sweep] pending: ${JSON.stringify(pending)}${stored ? `; stored: ${JSON.stringify(stored)}` : ''}`);
    return { statusCode: 200, body: JSON.stringify({ pending, stored }) };
  } catch (error) {
    console.error('[normalize-shows-sweep] failed:', error && error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'sweep failed' }) };
  }
};
