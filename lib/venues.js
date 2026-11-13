/**
 * Firestore + Storage helpers for venue verification — official "blue
 * checkmark" venue pages, similar in spirit to lib/meetups.js's
 * find-or-create-by-deterministic-key pattern.
 *
 * There is no pre-existing Venue entity anywhere in the app (venues only
 * ever appeared as denormalized `venue`/`city` strings on show docs, see
 * VenueRatingModal.jsx's `venueKey`). This file introduces the first one,
 * reusing that exact same `${venue}::${city}` key so a venue page and the
 * pre-existing `venueRatings` collection stay joinable.
 *
 * Schema:
 *   venues/{venueKey}
 *     {
 *       venueKey, name, city, country,
 *       isVerified: boolean, verifiedDate: serverTimestamp() | null,
 *       verifiedOwnerUid: string | null,
 *       officialWebsite, officialEmail, capacity, yearOpened, phone,
 *       address, bio: string | null,
 *       createdAt, updatedAt: serverTimestamp(),
 *     }
 *
 *   venueVerificationApplications/{autoId}
 *     {
 *       venueKey, venueName, venueCity,
 *       applicantUid, applicantName, applicantEmail, applicantPhone,
 *       proofDocuments: [{ url, storagePath, name }],
 *       status: 'pending' | 'approved' | 'rejected',
 *       submittedDate: serverTimestamp(), reviewedDate,
 *       reviewerNotes: string | null, rejectionReason: string | null,
 *     }
 *
 *   venueAnnouncements/{autoId}
 *     { venueKey, text, authorUid, authorName, createdAt }
 *
 *   venuePhotos/{autoId}
 *     { venueKey, url, storagePath, caption, uploadedBy, uploaderName, createdAt }
 *
 *   venueReports/{autoId}
 *     { venueKey, venueName, reporterUid, reporterName, reason, comment, status, createdAt }
 *
 * Security rules live in firestore.rules / storage.rules — deploy with
 * `npm run deploy:rules` after any change there.
 */

import {
  addDoc, collection, doc, getDoc, getDocs, deleteDoc, onSnapshot, orderBy,
  query, serverTimestamp, setDoc, updateDoc, where, limit,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { sendNotification } from '@/lib/email';

export function venueKeyFor(name, city) {
  const key = `${(name || '').trim().toLowerCase()}::${(city || '').trim().toLowerCase()}`;
  return key === '::' ? null : key;
}

function storageSegment(venueKey) {
  return (venueKey || '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'venue';
}

// ── Venue doc ────────────────────────────────────────────────────────────

export function subscribeVenue(venueKey, callback) {
  if (!venueKey) { callback(null); return () => {}; }
  return onSnapshot(doc(db, 'venues', venueKey), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, (err) => {
    console.error('[venues] Listener failed:', err.code || err.message, err);
  });
}

export async function getVenue(venueKey) {
  if (!venueKey) return null;
  const snap = await getDoc(doc(db, 'venues', venueKey));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function ensureVenueDoc(venueKey, name, city, country) {
  const ref = doc(db, 'venues', venueKey);
  const existing = await getDoc(ref);
  if (existing.exists()) return;
  await setDoc(ref, {
    venueKey,
    name: name || '',
    city: city || '',
    country: country || '',
    isVerified: false,
    verifiedDate: null,
    verifiedOwnerUid: null,
    officialWebsite: null,
    officialEmail: null,
    capacity: null,
    yearOpened: null,
    phone: null,
    address: null,
    bio: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function updateVenueInfo(venueKey, updates, uid) {
  const venue = await getVenue(venueKey);
  if (!venue || venue.verifiedOwnerUid !== uid) {
    throw new Error('Only the verified venue owner can edit this venue.');
  }
  await updateDoc(doc(db, 'venues', venueKey), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

// ── Verification applications ───────────────────────────────────────────

export async function submitVerificationApplication({
  venueKey, venueName, venueCity, applicantUid, applicantName, applicantEmail,
  applicantPhone, proofFiles = [], onProgress,
}) {
  if (!venueKey || !applicantUid) throw new Error('Missing venue or applicant.');
  await ensureVenueDoc(venueKey, venueName, venueCity);

  const proofDocuments = [];
  for (let i = 0; i < proofFiles.length; i++) {
    const file = proofFiles[i];
    const path = `venueVerificationDocs/${storageSegment(venueKey)}/${applicantUid}/${Date.now()}-${file.name}`;
    const storageRef = ref(storage, path);
    const url = await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, file);
      task.on(
        'state_changed',
        (snap) => onProgress?.((i + snap.bytesTransferred / snap.totalBytes) / proofFiles.length),
        reject,
        async () => resolve(await getDownloadURL(task.snapshot.ref))
      );
    });
    proofDocuments.push({ url, storagePath: path, name: file.name });
  }

  const appRef = await addDoc(collection(db, 'venueVerificationApplications'), {
    venueKey,
    venueName: venueName || '',
    venueCity: venueCity || '',
    applicantUid,
    applicantName: applicantName || 'Anonymous',
    applicantEmail: applicantEmail || null,
    applicantPhone: applicantPhone || null,
    proofDocuments,
    status: 'pending',
    submittedDate: serverTimestamp(),
    reviewedDate: null,
    reviewerNotes: null,
    rejectionReason: null,
  });

  // The server builds the email from the application and its status.
  if (applicantEmail) {
    sendNotification({ type: 'venue_verification', applicationId: appRef.id }).catch(() => {});
  }

  return appRef.id;
}

export function subscribeVenueVerificationApplications(callback, { status } = {}) {
  const constraints = [orderBy('submittedDate', 'desc'), limit(200)];
  if (status) constraints.unshift(where('status', '==', status));
  return onSnapshot(query(collection(db, 'venueVerificationApplications'), ...constraints), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('[venues] Applications listener failed:', err.code || err.message, err);
  });
}

export async function approveVerificationApplication(application, reviewerNotes = '') {
  await updateDoc(doc(db, 'venueVerificationApplications', application.id), {
    status: 'approved',
    reviewedDate: serverTimestamp(),
    reviewerNotes: reviewerNotes || null,
  });
  await updateDoc(doc(db, 'venues', application.venueKey), {
    isVerified: true,
    verifiedDate: serverTimestamp(),
    verifiedOwnerUid: application.applicantUid,
    officialEmail: application.applicantEmail || null,
    updatedAt: serverTimestamp(),
  });
  if (application.applicantEmail) {
    sendNotification({ type: 'venue_verification', applicationId: application.id }).catch(() => {});
  }
}

export async function rejectVerificationApplication(application, rejectionReason, reviewerNotes = '') {
  await updateDoc(doc(db, 'venueVerificationApplications', application.id), {
    status: 'rejected',
    reviewedDate: serverTimestamp(),
    rejectionReason: rejectionReason || 'Not specified',
    reviewerNotes: reviewerNotes || null,
  });
  if (application.applicantEmail) {
    sendNotification({ type: 'venue_verification', applicationId: application.id }).catch(() => {});
  }
}

// ── Announcements ────────────────────────────────────────────────────────

export async function addVenueAnnouncement(venueKey, { text, authorUid, authorName }) {
  if (!text?.trim()) return;
  await addDoc(collection(db, 'venueAnnouncements'), {
    venueKey,
    text: text.trim().slice(0, 1000),
    authorUid,
    authorName: authorName || 'Venue',
    createdAt: serverTimestamp(),
  });
}

export function subscribeVenueAnnouncements(venueKey, callback) {
  if (!venueKey) { callback([]); return () => {}; }
  return onSnapshot(
    query(collection(db, 'venueAnnouncements'), where('venueKey', '==', venueKey), orderBy('createdAt', 'desc'), limit(50)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.error('[venues] Announcements listener failed:', err.code || err.message, err)
  );
}

// ── Official photos ─────────────────────────────────────────────────────

export async function uploadVenuePhoto({ venueKey, file, uid, uploaderName, caption, onProgress }) {
  const path = `venuePhotos/${storageSegment(venueKey)}/${uid}/${Date.now()}-${file.name}`;
  const storageRef = ref(storage, path);
  const url = await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed', (snap) => onProgress?.(snap.bytesTransferred / snap.totalBytes), reject,
      async () => resolve(await getDownloadURL(task.snapshot.ref)));
  });
  await addDoc(collection(db, 'venuePhotos'), {
    venueKey, url, storagePath: path,
    caption: (caption || '').trim(),
    uploadedBy: uid,
    uploaderName: uploaderName || 'Venue',
    createdAt: serverTimestamp(),
  });
}

export function subscribeVenuePhotos(venueKey, callback) {
  if (!venueKey) { callback([]); return () => {}; }
  return onSnapshot(
    query(collection(db, 'venuePhotos'), where('venueKey', '==', venueKey), orderBy('createdAt', 'desc'), limit(60)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.error('[venues] Photos listener failed:', err.code || err.message, err)
  );
}

export async function deleteVenuePhoto(photo) {
  await deleteDoc(doc(db, 'venuePhotos', photo.id));
  if (photo.storagePath) {
    try { await deleteObject(ref(storage, photo.storagePath)); }
    catch (err) { console.error('[venues] Failed to delete storage object for', photo.storagePath, err); }
  }
}

// ── Reports ──────────────────────────────────────────────────────────────

export async function reportVenue({ venueKey, venueName, reporterUid, reporterName, reason, comment }) {
  await addDoc(collection(db, 'venueReports'), {
    venueKey, venueName: venueName || '',
    reporterUid, reporterName: reporterName || 'Anonymous',
    reason, comment: (comment || '').trim().slice(0, 500),
    status: 'open',
    createdAt: serverTimestamp(),
  });
}

export function subscribeVenueReports(callback) {
  return onSnapshot(
    query(collection(db, 'venueReports'), where('status', '==', 'open'), orderBy('createdAt', 'desc'), limit(200)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.error('[venues] Reports listener failed:', err.code || err.message, err)
  );
}

export async function resolveVenueReport(reportId, resolutionNote = '') {
  await updateDoc(doc(db, 'venueReports', reportId), {
    status: 'resolved',
    resolutionNote: resolutionNote || null,
    resolvedDate: serverTimestamp(),
  });
}
