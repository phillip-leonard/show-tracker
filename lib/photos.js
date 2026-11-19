/**
 * Firebase Storage + Firestore helpers for concert photos, videos,
 * posters, and setlist photos — one collection, split by `category`.
 *
 * Same "keyed by concert, not by any one user's private show" shape as
 * lib/comments.js — anyone who's logged a matching show (via
 * AppContext's normalizeShowKey()) can see and add to the gallery, so
 * attendees can share what they shot without a friend relationship.
 *
 * Three categories, one collection (not three), so a show page needs
 * only one Firestore listener (subscribePhotos()) instead of three near-
 * identical ones — see components/photos/ShowMediaSection.jsx, which
 * subscribes once and splits the result by category client-side rather
 * than every gallery instance running its own `where('category', '==', …)`
 * query against the same concert:
 *   - 'photo'   — concert photos/videos (the only category that allows
 *                 video files or a YouTube link; this is the original
 *                 shape before posters/setlist photos existed, and any
 *                 pre-existing doc with no `category` field at all is
 *                 treated as 'photo' — see CATEGORY_FALLBACK)
 *   - 'poster'  — concert announcement / show poster images
 *   - 'setlist' — photos of a physically written setlist (paper, board)
 * Posters and setlist photos are images only — a poster or a setlist
 * isn't a video or a YouTube link by definition.
 *
 * Two kinds of media within 'photo':
 *  - Uploaded files (image/* or video/mp4) go to Firebase Storage at
 *    showPhotos/{concertKey}/{uid}/{timestamp}-{filename}, capped at
 *    MAX_FILE_BYTES per file and MAX_CONCERT_BYTES total per concert
 *    (checked client-side against the already-loaded gallery before
 *    starting the upload — see checkUploadAllowed()). The 50MB cap is
 *    shared across all three categories for a concert, not per-category.
 *  - YouTube links are stored as a Firestore doc only, no Storage
 *    involved — `type: 'youtube'`, `url` holds the original link,
 *    `storagePath`/`fileSize` are null.
 *
 * Schema:
 *   showPhotos/{autoId}
 *     {
 *       concertKey: string,
 *       category: 'photo' | 'poster' | 'setlist',
 *       uploadedBy: string,
 *       uploaderName: string,
 *       type: 'image' | 'video' | 'youtube',
 *       url: string,             // Storage download URL, or the YouTube link
 *       storagePath: string | null,
 *       fileSize: number | null, // bytes; null for youtube
 *       caption: string,
 *       likedBy: string[],
 *       createdAt: serverTimestamp(),
 *     }
 *
 * Storage rules live in storage.rules (new, alongside firestore.rules) —
 * deploy both with `npm run deploy:rules`.
 */

import {
  collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, where, limit,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, deleteObject } from 'firebase/storage';
import { db, storage, auth } from '@/lib/firebase';
import { apiUrl, authedFetch } from '@/lib/api';
import { mediaPathSegment } from '@/lib/concertKeys';

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB per file
export const MAX_CONCERT_BYTES = 50 * 1024 * 1024; // 50MB total per concert, shared across categories

export const CATEGORY_FALLBACK = 'photo'; // pre-existing docs from before categories existed

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_TYPES = [...IMAGE_TYPES, 'video/mp4'];

// Posters and setlist photos are images only; 'photo' also allows video.
export function allowedTypesFor(category) {
  return category === 'poster' || category === 'setlist' ? IMAGE_TYPES : ALLOWED_TYPES;
}

// The concert's Storage folder is lib/concertKeys.js mediaPathSegment
// (shared with the server and the native app, fixtures/concert-keys/).

// Checked before starting an upload — returns an error message string, or
// null if the upload is allowed. `existingPhotos` is the gallery's
// already-loaded list (from subscribePhotos), so this doesn't need an
// extra Firestore read.
export function checkUploadAllowed(file, existingPhotos, category = 'photo') {
  const allowed = allowedTypesFor(category);
  if (!allowed.includes(file.type)) {
    return category === 'photo'
      ? 'Only JPEG, PNG, GIF, WEBP images or MP4 videos are supported.'
      : 'Only JPEG, PNG, GIF, or WEBP images are supported.';
  }
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is over the 10MB per-file limit.`;
  }
  // Shared across all three categories — existingPhotos should be the
  // concert's full list, not just the one category being uploaded to.
  const currentTotal = (existingPhotos || []).reduce((sum, p) => sum + (p.fileSize || 0), 0);
  if (currentTotal + file.size > MAX_CONCERT_BYTES) {
    return "This show's media is at the 50MB limit (shared across photos, posters, and setlist photos) — remove something first.";
  }
  return null;
}

export function extractYoutubeId(url) {
  const match = (url || '').match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

export function subscribePhotos(concertKey, callback) {
  if (!concertKey) {
    callback([]);
    return () => {};
  }
  const q = query(
    collection(db, 'showPhotos'),
    where('concertKey', '==', concertKey),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('[photos] Listener failed:', err.code || err.message, err);
    // Without this, a permission-denied/missing-index/offline error leaves
    // every caller's `loading` state stuck true forever, since they only
    // ever flip it false inside the success branch of this callback.
    callback([], err);
  });
}

// One-time fetch (not real-time — this is a browse/search directory, not
// a live view of one show) of setlist photos across every concert, for
// /setlist-photos. Capped at 300 and filtered by artist/date client-side,
// same "fetch a reasonable page, filter in the browser" approach as the
// rest of the app takes where Firestore can't do free-text search
// (there's no `artist` index to query against safely without knowing
// every possible casing/spelling up front).
export async function listAllSetlistPhotos() {
  const q = query(
    collection(db, 'showPhotos'),
    where('category', '==', 'setlist'),
    orderBy('createdAt', 'desc'),
    limit(300)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * The metadata document for an upload is written by
 * netlify/functions/moderate-content.js rather than here, because it
 * carries the caption — free text that Guideline 1.2 requires be filtered
 * before it is published, and a filter that only runs in the browser can
 * be skipped by anyone holding the Firebase SDK. The `showPhotos` create
 * rule is closed to clients for the same reason (see firestore.rules).
 *
 * The FILE still goes to Cloud Storage straight from the browser. Only
 * the document is written server-side: routing tens of megabytes of photo
 * through a Netlify function would be slower, costlier and no safer,
 * since storage.rules already enforces size and content type and bytes
 * are not text a wordlist can read.
 */
async function createMediaDoc(payload) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Please sign in again to upload.');

  const res = await fetch(apiUrl('/api/moderate-content'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: 'showMedia', ...payload }),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "Couldn't save that upload. Please try again.");
  return result.id;
}

// `show` ({ artist, venue, date }) is denormalized onto every doc — not
// read back from anywhere else — so the /setlist-photos directory page
// can filter across every concert's setlist photos without a join back
// to each uploader's private show record (which, per lib/comments.js's
// and lib/activityFeed.js's notes, isn't reachable across users anyway).
export async function uploadShowMedia({ file, concertKey, uid, uploaderName, caption, category = 'photo', show, onProgress }) {
  const path = `showPhotos/${mediaPathSegment(concertKey)}/${uid}/${Date.now()}-${file.name.replace(/\//g, '-')}`;
  const storageRef = ref(storage, path);

  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, { contentType: file.type });
    task.on(
      'state_changed',
      (snap) => onProgress?.(snap.bytesTransferred / snap.totalBytes),
      reject,
      resolve
    );
  });

  // The server reads the file's size, type and download URL from Storage
  // (5.60.38, Stage 6 call I); the document names only the path.
  await createMediaDoc({
    concertKey,
    category,
    show: { artist: show?.artist || null, venue: show?.venue || null, date: show?.date || null },
    ...(show?.id ? { showId: show.id } : {}),
    uploaderName,
    type: file.type.startsWith('video/') ? 'video' : 'image',
    storagePath: path,
    caption,
  });
}

export async function addYoutubeLink({ url, concertKey, uid, uploaderName, caption, show }) {
  const videoId = extractYoutubeId(url);
  if (!videoId) throw new Error('Not a recognizable YouTube link.');

  await createMediaDoc({
    concertKey,
    category: 'photo', // the only category that allows video/YouTube content
    show: { artist: show?.artist || null, venue: show?.venue || null, date: show?.date || null },
    ...(show?.id ? { showId: show.id } : {}),
    uploaderName,
    type: 'youtube',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    caption,
  });
}

/**
 * Likes or unlikes. The server writes `likedBy` and notifies the uploader
 * of a like (engagement-notify, 5.60.38, Stage 6 call A).
 */
export async function togglePhotoLike(photoId, alreadyLiked) {
  const res = await authedFetch('/.netlify/functions/engagement-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'photo_like', id: photoId, liked: !alreadyLiked }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't update your like.");
  return data;
}

export async function deletePhoto(photo) {
  await deleteDoc(doc(db, 'showPhotos', photo.id));
  if (photo.storagePath) {
    try {
      await deleteObject(ref(storage, photo.storagePath));
    } catch (err) {
      // The Firestore doc is already gone (the visible part of "delete");
      // an orphaned Storage file just wastes a little space, so log and
      // move on rather than leaving the doc undeleted over a storage hiccup.
      console.error('[photos] Failed to delete storage object for', photo.storagePath, err);
    }
  }
}
