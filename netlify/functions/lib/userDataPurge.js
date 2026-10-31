'use strict';

/**
 * userDataPurge — the single definition of "everything that belongs to a user",
 * and the engine that removes it.
 *
 * Two functions delete users: delete-account.js (self-service, Guideline
 * 5.1.1(v)) and delete-user.js (admin). They used to carry their own hand-
 * written lists, which drifted apart and fell behind the schema: by v5.32.0
 * they were missing comments, photos, videos, every Storage object, meetup
 * posts, activity items, the user's handle, ratings, wishlists and the
 * users/{uid}/festivals subcollection.
 *
 * The fix is that the list lives here, once. When you add a collection that
 * stores a uid, add it to the map below in the same commit — and
 * tests/deletion/completeness.test.js will fail if you forget, because it
 * seeds every collection in the map and asserts the uid is gone afterwards.
 *
 * Ownership is not uniform in this schema, so the map has five shapes:
 *
 *   OWNED_DOCUMENTS    delete the whole document
 *   ARRAY_MEMBERSHIPS  the user is one entry in an array on a shared document
 *   TOMBSTONES         the document outlives the user; scrub the uid out of it
 *   USER_SUBTREE       everything under users/{uid}
 *   STORAGE_SOURCES    where Storage object paths are recorded
 *
 * Nothing here assumes Firestore cascades. It does not: deleting users/{uid}
 * leaves its subcollections addressable forever, which is how
 * users/{uid}/festivals was orphaned.
 */

const TOMBSTONE_UID = 'deleted-user';
const BATCH_LIMIT = 500;

/**
 * Whole documents that belong to exactly one user. `fields` lists every field
 * that can carry that user's uid — several collections have two (a sender and
 * a recipient), and a document matching either is theirs.
 */
const OWNED_DOCUMENTS = [
  // ── User-generated content (the v5.32.0 gap) ──
  { collection: 'showComments', fields: ['authorUid'] },
  { collection: 'meetupComments', fields: ['authorUid'] },
  { collection: 'showPhotos', fields: ['uploadedBy'], storagePathField: 'storagePath' },
  { collection: 'venuePhotos', fields: ['uploadedBy'], storagePathField: 'storagePath' },
  { collection: 'userActivity', fields: ['userId'] },

  // Moderation-hidden content is a full copy of the original document, taken
  // when three reports auto-hid it (report-content.js). The original row is
  // gone, so this is the only place that copy — and its storagePath — survives.
  { collection: 'moderationHidden', fields: ['authorUid'], nestedStoragePath: ['data', 'storagePath'] },

  // ── Venue contributions ──
  { collection: 'venueRatings', fields: ['userId'] },
  { collection: 'venueReports', fields: ['reporterUid'] },
  {
    collection: 'venueVerificationApplications',
    fields: ['applicantUid'],
    storagePathArray: { field: 'proofDocuments', pathKey: 'storagePath' },
  },

  // ── Lists and sharing ──
  // sharedCollections embeds a full copy of the user's show history.
  { collection: 'sharedCollections', fields: ['ownerUid'] },
  { collection: 'wishlists', fields: ['userId'] },
  { collection: 'bucketList', fields: ['userId'] },
  { collection: 'bucketListVenues', fields: ['userId'] },
  { collection: 'favoriteTours', fields: ['userId'] },
  { collection: 'yearInReviews', fields: ['userId'] },
  { collection: 'commentViews', fields: ['uid'] },

  // ── Social plumbing (these were already handled; they live here now) ──
  { collection: 'friendRequests', fields: ['from', 'to'] },
  { collection: 'showTags', fields: ['fromUid', 'toUid'] },
  { collection: 'invites', fields: ['inviterUid'] },
  { collection: 'pendingEmailTags', fields: ['fromUid'] },
  // `fromUid` catches notifications sitting in *other* people's inboxes that
  // are about this user.
  { collection: 'notifications', fields: ['uid', 'fromUid'] },

  // send-email's per-sender hourly counter (v5.38.0).
  { collection: 'emailRateLimits', fields: ['uid'] },

  // One doc per device that takes push alerts, id = the FCM token (5.49.0).
  { collection: 'pushTokens', fields: ['userId'] },

  // On-sale alerts (5.52.0): home location and radius, and the alerts sent.
  { collection: 'alertSettings', fields: ['uid'] },
  { collection: 'onsaleAlerts', fields: ['uid'] },
];

/**
 * Shared documents where the user is one entry in an array. The document
 * belongs to everyone, so it stays; the user comes out of it.
 *
 * `mapField` additionally removes a map key named for the uid.
 */
const ARRAY_MEMBERSHIPS = [
  { collection: 'showComments', field: 'likedBy' },
  { collection: 'showPhotos', field: 'likedBy' },
  { collection: 'meetups', field: 'attendeeUids', mapField: 'attendeeNames' },
  { collection: 'userBlocks', field: 'blockedUserIds' },
];

/**
 * Documents that must outlive the user with the uid scrubbed out.
 *
 * `reports` is the important one: a moderation record should survive the
 * reporter deleting their account, or reporting becomes a way to erase the
 * evidence. Same for a reported user — the report stays, the identity does not.
 *
 * `festivals` (top-level, canonical) is shared across every user who attended;
 * firestore.rules gives it `allow delete: if false` precisely so one person
 * leaving cannot break everyone else's attendance records.
 */
const TOMBSTONES = [
  { collection: 'reports', field: 'reporterId', to: TOMBSTONE_UID },
  { collection: 'reports', field: 'reportedUserId', to: TOMBSTONE_UID },
  { collection: 'meetups', field: 'createdBy', to: TOMBSTONE_UID, alsoNull: ['createdByName'] },
  { collection: 'festivals', field: 'createdBy', to: null },
  { collection: 'venues', field: 'verifiedOwnerUid', to: null },
  { collection: 'roadmapItems', field: 'submitterUid', to: TOMBSTONE_UID, alsoNull: ['submitterEmail'] },
  {
    collection: 'guestSessions',
    field: 'convertedUserId',
    to: null,
    // The session's own stats are anonymous once the link is cut.
  },
];

/** Subcollections under users/{uid}. recursiveDelete covers any we forget. */
const USER_SUBTREE = ['shows', 'friends', 'festivals'];

// ── helpers ──────────────────────────────────────────────────────────────

async function commitDeletes(db, refs) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    refs.slice(i, i + BATCH_LIMIT).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

async function queryDocs(db, collection, field, value) {
  try {
    const snap = await db.collection(collection).where(field, '==', value).get();
    return snap.docs;
  } catch (e) {
    // A collection that does not exist yet is not an error.
    if (e.code === 5 || /NOT_FOUND/i.test(e.message || '')) return [];
    throw e;
  }
}

function collectStoragePaths(spec, data) {
  const paths = [];
  if (spec.storagePathField && data[spec.storagePathField]) {
    paths.push(data[spec.storagePathField]);
  }
  if (spec.nestedStoragePath) {
    const [outer, inner] = spec.nestedStoragePath;
    const v = data[outer] && data[outer][inner];
    if (v) paths.push(v);
  }
  if (spec.storagePathArray) {
    const arr = data[spec.storagePathArray.field];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const v = item && item[spec.storagePathArray.pathKey];
        if (v) paths.push(v);
      }
    }
  }
  return paths;
}

// ── the purge ────────────────────────────────────────────────────────────

/**
 * Remove every trace of `uid`.
 *
 * @param {object}  deps          { db, auth, bucket }  bucket may be null to
 *                                skip Storage (the emulator has none).
 * @param {string}  uid
 * @param {object}  [opts]        { deleteAuthUser = true }
 * @returns {object} a per-collection report, suitable for logging and for the
 *                   completeness test to assert against.
 */
/**
 * Run one phase of the purge. A phase that throws must not abort the ones
 * after it: by the time purgeUserData is called the account has already been
 * disabled and the user signed out, so aborting halfway leaves them locked out
 * of an account that still exists, with their data still in place — the worst
 * of both outcomes, and an App Store Guideline 5.1.1(v) failure.
 *
 * This is not hypothetical. Step 9 is a collection-group query, and Firestore
 * does not create collection-group indexes automatically; without the
 * fieldOverride in firestore.indexes.json it throws FAILED_PRECONDITION and
 * every step after it — including deleting users/{uid} and the auth record —
 * never ran.
 *
 * Failures are recorded, not swallowed: they land in report.errors, are logged
 * by the caller, and scripts/purge-user.js can finish the remainder by uid
 * because purgeUserData is idempotent.
 */
async function runStep(report, label, fn) {
  try {
    await fn();
  } catch (e) {
    report.errors.push(`${label}: ${e.message}`);
  }
}

async function purgeUserData({ db, auth, bucket }, uid, opts = {}) {
  const { FieldValue } = require('firebase-admin/firestore');
  const { deleteAuthUser = true } = opts;
  const report = {
    uid,
    deleted: {},
    tombstoned: {},
    storage: { deleted: 0, failed: 0 },
    errors: [],
    authUserDeleted: false,
  };

  // 1. Storage paths must be read BEFORE the documents that record them go.
  const storagePaths = [];

  // 2. Owned documents.
  for (const spec of OWNED_DOCUMENTS) {
    await runStep(report, `owned:${spec.collection}`, async () => {
      const seen = new Map();
      for (const field of spec.fields) {
        for (const doc of await queryDocs(db, spec.collection, field, uid)) {
          if (!seen.has(doc.ref.path)) {
            seen.set(doc.ref.path, doc.ref);
            storagePaths.push(...collectStoragePaths(spec, doc.data() || {}));
          }
        }
      }
      if (seen.size) {
        await commitDeletes(db, [...seen.values()]);
        report.deleted[spec.collection] = seen.size;
      }
    });
  }

  // 3. showSuggestions — the user is one of two participants; the suggestion
  //    is meaningless without them.
  await runStep(report, 'showSuggestions', async () => {
    const snap = await db.collection('showSuggestions').where('participants', 'array-contains', uid).get();
    if (!snap.empty) {
      await commitDeletes(db, snap.docs.map(d => d.ref));
      report.deleted.showSuggestions = snap.size;
    }
  });

  // 4. Array memberships on shared documents.
  for (const spec of ARRAY_MEMBERSHIPS) {
    await runStep(report, `array:${spec.collection}.${spec.field}`, async () => {
      const snap = await db.collection(spec.collection).where(spec.field, 'array-contains', uid).get();
      if (snap.empty) return;
      for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const doc of snap.docs.slice(i, i + BATCH_LIMIT)) {
          const update = { [spec.field]: FieldValue.arrayRemove(uid) };
          if (spec.mapField) update[`${spec.mapField}.${uid}`] = FieldValue.delete();
          batch.update(doc.ref, update);
        }
        await batch.commit();
      }
      report.tombstoned[`${spec.collection}.${spec.field}`] = snap.size;
    });
  }

  // 5. Tombstones.
  for (const spec of TOMBSTONES) {
    await runStep(report, `tombstone:${spec.collection}.${spec.field}`, async () => {
      const docs = await queryDocs(db, spec.collection, spec.field, uid);
      if (!docs.length) return;
      for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const doc of docs.slice(i, i + BATCH_LIMIT)) {
          const update = { [spec.field]: spec.to };
          for (const f of spec.alsoNull || []) update[f] = null;
          batch.update(doc.ref, update);
        }
        await batch.commit();
      }
      report.tombstoned[`${spec.collection}.${spec.field}`] = docs.length;
    });
  }

  // 6. Roadmap votes. The doc id is the uid and there is no uid field, so this
  //    cannot be queried — enumerate the items. Each removed vote decrements
  //    the denormalized count, or the roadmap shows phantom votes forever.
  await runStep(report, 'roadmapVotes', async () => {
    let votes = 0;
    const items = await db.collection('roadmapItems').get();
    for (const item of items.docs) {
      const voteRef = item.ref.collection('voters').doc(uid);
      const vote = await voteRef.get();
      if (!vote.exists) continue;
      await voteRef.delete();
      await item.ref.update({ voteCount: FieldValue.increment(-1) }).catch(() => {});
      votes++;
    }
    if (votes) report.deleted.roadmapVotes = votes;
  });

  // 7. The handle. Not releasing it leaves the name squatted by an account
  //    that no longer exists, permanently unclaimable by anyone else.
  await runStep(report, 'handles', async () => {
    const handles = await queryDocs(db, 'handles', 'uid', uid);
    if (handles.length) {
      await commitDeletes(db, handles.map(d => d.ref));
      report.deleted.handles = handles.length;
    }
  });

  // 8. Their own block list.
  await db.doc(`userBlocks/${uid}`).delete().catch(() => {});

  // 9. Friend edges pointing at this user from other people's subcollections.
  //    Collection-group query — requires the friends.friendUid COLLECTION_GROUP
  //    fieldOverride in firestore.indexes.json.
  await runStep(report, 'inboundFriendEdges', async () => {
    const snap = await db.collectionGroup('friends').where('friendUid', '==', uid).get();
    if (!snap.empty) {
      await commitDeletes(db, snap.docs.map(d => d.ref));
      report.deleted.inboundFriendEdges = snap.size;
    }
  });

  // 10. The users/{uid} subtree. Firestore does NOT cascade, so a plain
  //     delete() on the parent would strand every subcollection under it.
  await runStep(report, 'userSubtree', async () => {
    try {
      await db.recursiveDelete(db.doc(`users/${uid}`));
      report.deleted.userSubtree = USER_SUBTREE.join(',');
    } catch (e) {
      // Older admin SDKs, or a permissions edge — fall back to the known list.
      for (const sub of USER_SUBTREE) {
        const snap = await db.collection(`users/${uid}/${sub}`).get();
        await commitDeletes(db, snap.docs.map(d => d.ref));
      }
      await db.doc(`users/${uid}`).delete().catch(() => {});
      report.errors.push(`recursiveDelete unavailable (${e.message}); used the explicit subtree list`);
    }
  });

  // 11. The profile.
  await db.doc(`userProfiles/${uid}`).delete().catch(() => {});

  // 12. Storage. Best-effort per object: one missing file must not abort the
  //     deletion and strand the account half-removed.
  if (bucket) {
    await runStep(report, 'storage', async () => {
      for (const path of [...new Set(storagePaths)]) {
        try {
          await bucket.file(path).delete();
          report.storage.deleted++;
        } catch (e) {
          if (e.code === 404) continue;
          report.storage.failed++;
          report.errors.push(`storage ${path}: ${e.message}`);
        }
      }
    });
  }

  // 13. The auth record, last — up to here the user could still be signed in.
  //     This runs even if a step above failed: the user asked to be deleted,
  //     and leaving the login alive because a friend edge would not delete is
  //     exactly the Guideline 5.1.1(v) failure we are fixing.
  if (deleteAuthUser && auth) {
    await runStep(report, 'authUser', async () => {
      try {
        await auth.deleteUser(uid);
      } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
      }
      report.authUserDeleted = true;
    });
  } else {
    report.authUserDeleted = true; // caller owns the auth record
  }

  return report;
}

/**
 * Assert nothing anywhere still references `uid`. Used by the completeness
 * test; also handy to run by hand after a deletion you want to be sure about.
 *
 * `reports` and `adminAuditLog` are excluded by design — they are the records
 * that the account existed and was deleted.
 *
 * @returns {string[]} human-readable traces. Empty means clean.
 */
async function findRemainingTraces({ db }, uid) {
  const traces = [];

  for (const spec of OWNED_DOCUMENTS) {
    for (const field of spec.fields) {
      const docs = await queryDocs(db, spec.collection, field, uid);
      if (docs.length) traces.push(`${spec.collection}.${field}: ${docs.length} document(s)`);
    }
  }
  for (const spec of ARRAY_MEMBERSHIPS) {
    const snap = await db.collection(spec.collection).where(spec.field, 'array-contains', uid).get();
    if (!snap.empty) traces.push(`${spec.collection}.${spec.field}: still contains uid in ${snap.size}`);
  }
  for (const spec of TOMBSTONES) {
    const docs = await queryDocs(db, spec.collection, spec.field, uid);
    if (docs.length) traces.push(`${spec.collection}.${spec.field}: ${docs.length} not tombstoned`);
  }

  const sugg = await db.collection('showSuggestions').where('participants', 'array-contains', uid).get();
  if (!sugg.empty) traces.push(`showSuggestions: ${sugg.size} document(s)`);

  const handles = await queryDocs(db, 'handles', 'uid', uid);
  if (handles.length) traces.push(`handles: ${handles.length} not released`);

  const inbound = await db.collectionGroup('friends').where('friendUid', '==', uid).get();
  if (!inbound.empty) traces.push(`inbound friend edges: ${inbound.size}`);

  for (const path of [`userProfiles/${uid}`, `users/${uid}`, `userBlocks/${uid}`]) {
    if ((await db.doc(path).get()).exists) traces.push(`${path} still exists`);
  }
  for (const sub of USER_SUBTREE) {
    const snap = await db.collection(`users/${uid}/${sub}`).limit(1).get();
    if (!snap.empty) traces.push(`users/${uid}/${sub} still has documents`);
  }

  const items = await db.collection('roadmapItems').get();
  for (const item of items.docs) {
    if ((await item.ref.collection('voters').doc(uid).get()).exists) {
      traces.push(`roadmapItems/${item.id}/voters/${uid} still exists`);
    }
  }

  return traces;
}

module.exports = {
  TOMBSTONE_UID,
  OWNED_DOCUMENTS,
  ARRAY_MEMBERSHIPS,
  TOMBSTONES,
  USER_SUBTREE,
  purgeUserData,
  findRemainingTraces,
};
