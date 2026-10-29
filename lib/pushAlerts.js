// lib/pushAlerts.js
//
// Push alerts on iOS: the permission, this device's token, and taps.
//
// The followed-band job (netlify/functions/lib/followedBandAlerts.js) pushes
// a band alert to every token in pushTokens whose userId is the follower.
// This file keeps this iPhone's entry right:
//
//   permission  asked only in context — the first time someone follows a
//               band (components/notifications/PushOfferModal.jsx) or from
//               "Turn on push alerts" in Notifications settings. Never at
//               launch. The plugin does register with APNs at launch, which
//               shows nothing to the user.
//   token       pushTokens/{fcmToken} = { userId, platform, updatedAt },
//               rewritten on every launch while signed in with permission,
//               and again whenever FCM rotates it. Removed on sign-out, and
//               on account deletion with the rest of the account
//               (netlify/functions/lib/userDataPurge.js). The job deletes a
//               token FCM reports dead.
//   taps        the push carries data.link, a universal link
//               (https://mysetlists.net/bands/?band=goose);
//               components/layout/DeepLinkListener.jsx routes it the way it
//               routes any other link.
//
// @capacitor-firebase/messaging, not @capacitor/push-notifications: it
// hands back an FCM token, so the server sends iOS and web push the same
// way. The two plugins cannot both be installed (each claims the app's
// notification handler). Nothing here runs off native.

import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { isNativePlatform } from '@/lib/platform';

const TOKEN_KEY = 'mysetlists.pushToken';
const OFFERED_KEY = 'mysetlists.pushOffered';

let currentUid = null;
let rotationListener = null;

function stored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function store(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode: the token is rewritten on the next launch anyway */ }
}

async function messaging() {
  if (!isNativePlatform()) return null;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    return FirebaseMessaging;
  } catch {
    return null;
  }
}

/** 'unsupported' | 'prompt' | 'granted' | 'denied' for this device. */
export async function pushPermission() {
  const fm = await messaging();
  if (!fm) return 'unsupported';
  try {
    const { receive } = await fm.checkPermissions();
    return receive === 'prompt-with-rationale' ? 'prompt' : receive;
  } catch {
    return 'unsupported';
  }
}

async function saveToken(uid, token) {
  if (!uid || !token) return;
  const previous = stored(TOKEN_KEY);
  if (previous && previous !== token) {
    await deleteDoc(doc(db, 'pushTokens', previous)).catch(() => {});
  }
  await setDoc(doc(db, 'pushTokens', token), {
    userId: uid,
    platform: 'ios',
    updatedAt: serverTimestamp(),
  });
  store(TOKEN_KEY, token);
}

async function registerToken(fm, uid) {
  currentUid = uid;
  if (!rotationListener) {
    rotationListener = fm.addListener('tokenReceived', ({ token }) => {
      if (currentUid) saveToken(currentUid, token).catch((err) => console.warn('[push] token save failed', err));
    });
  }
  const { token } = await fm.getToken();
  await saveToken(uid, token);
}

/**
 * Ask iOS for permission (shows the system prompt the first time only) and,
 * if granted, register this device for `uid`. Resolves the new permission.
 */
export async function requestPushPermission(uid) {
  const fm = await messaging();
  if (!fm) return 'unsupported';
  let state;
  try {
    ({ receive: state } = await fm.requestPermissions());
  } catch (err) {
    console.warn('[push] permission request failed', err);
    return pushPermission();
  }
  if (state === 'granted' && uid) {
    await registerToken(fm, uid).catch((err) => console.warn('[push] token save failed', err));
  }
  return state;
}

/** On launch and sign-in: refresh this device's token if push is allowed. Never prompts. */
export async function syncPushToken(uid) {
  if (!uid || (await pushPermission()) !== 'granted') return;
  const fm = await messaging();
  await registerToken(fm, uid).catch((err) => console.warn('[push] token sync failed', err));
}

// A Firestore write resolves when the server has it, so offline it never
// does. Sign-out must not wait on that.
function within(ms, promise) {
  return Promise.race([promise.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}

/**
 * Before sign-out (and after account deletion): stop pushes to this device.
 * Deletes its pushTokens doc while still signed in, then the FCM token
 * itself, so the next account on this iPhone gets a fresh one. If the doc
 * delete can't reach the server but the FCM token is deleted, the job's
 * next push to it comes back unregistered and the job deletes the doc. If
 * neither can (offline), the next sign-in here gets the same token back and
 * takes the doc over (firestore.rules).
 */
export async function forgetPushToken() {
  currentUid = null;
  const token = stored(TOKEN_KEY);
  store(TOKEN_KEY, null);
  if (token) await within(3000, deleteDoc(doc(db, 'pushTokens', token)));
  const fm = await messaging();
  if (fm) await within(3000, fm.deleteToken());
}

/** True the first time a follow should offer push: native, never asked, never offered. */
export async function shouldOfferPush() {
  if (stored(OFFERED_KEY)) return false;
  return (await pushPermission()) === 'prompt';
}

export function markPushOffered() {
  store(OFFERED_KEY, String(Date.now()));
}

/** Calls back with a tapped push's link. Resolves a remover. */
export async function onPushTap(callback) {
  const fm = await messaging();
  if (!fm) return () => {};
  const handle = await fm.addListener('notificationActionPerformed', (event) => {
    if (event?.actionId === 'dismiss') return;
    const link = event?.notification?.data?.link;
    if (link) callback(link);
  });
  return () => handle.remove();
}
