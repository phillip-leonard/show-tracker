// lib/liveShows.js — the user's shows, kept live (5.60.10, R-06 part 2).
//
// Until 5.60.10 the app read a user's shows once (getDocs in
// AppContext.loadShows) and never again, so an edit made on another device
// appeared only after a reload. Now it listens (onSnapshot), with two rules
// that come from the app's history:
//
// 1. IT FAILS LOUDLY; IT NEVER HANGS. In 5.36.4 a Firestore change made
//    every getDocs and onSnapshot never settle, the loading flag never
//    cleared, and every page sat on a spinner with no error anywhere
//    (see lib/firebase.js). So the first snapshot has a deadline: if it
//    hasn't arrived (or the listener errors), the shows are read once
//    instead, with a deadline of its own, and whatever happens, the
//    loading state ends and the failure is reported. A listener that
//    answers late is still used.
//
// 2. A SNAPSHOT NEVER UNDOES WHAT THIS DEVICE JUST DID. Firestore shows
//    this device's ordinary writes in the next snapshot at once, but not a
//    transaction until it commits, and not a show the device wrote while
//    offline until the write reaches the server. So the merge keeps:
//      - a show this device is still saving (written offline, or in the
//        outbox, lib/showAdd.js), which the server doesn't have yet
//      - the setlist of a show with a setlist edit in flight
//        (AppContext.editSetlist, lib/setlistEdits.js), until its
//        transaction returns
//    Everything else is the server's: a show deleted elsewhere goes, an
//    edit made elsewhere appears.
//
// Pure apart from the timers and the functions passed in, so tests drive
// it with fakes. CommonJS, like lib/showDate.js.

const FIRST_SNAPSHOT_MS = 10000;
const READ_ONCE_MS = 15000;

/**
 * mergeShowsSnapshot(serverShows, localShows, { pendingIds, setlistInFlight })
 *   -> the shows to hold
 * serverShows: [{ id, …data }] as the snapshot has them. pendingIds: ids of
 * shows this device is still saving. setlistInFlight: ids whose setlist
 * edit hasn't come back.
 */
function mergeShowsSnapshot(serverShows, localShows, { pendingIds = new Set(), setlistInFlight = new Set() } = {}) {
  const local = new Map((localShows || []).filter(Boolean).map((s) => [s.id, s]));
  const out = [];
  const onServer = new Set();
  for (const server of serverShows || []) {
    if (!server || !server.id) continue;
    onServer.add(server.id);
    const mine = local.get(server.id);
    const show = { ...server, setlist: server.setlist || [] };
    if (mine && setlistInFlight.has(server.id)) show.setlist = mine.setlist || [];
    out.push(show);
  }
  for (const show of localShows || []) {
    if (show && !onServer.has(show.id) && pendingIds.has(show.id)) out.push(show);
  }
  return out;
}

const docsToShows = (docs) => (docs || []).map((d) => ({ id: d.id, ...d.data() }));

function withDeadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} took longer than ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * startShowsListener({ subscribe, readOnce, onShows, onLoaded, onError, firstSnapshotMs, readOnceMs })
 *   -> stop()
 *
 * subscribe(next, fail) -> unsubscribe       onSnapshot on the shows
 * readOnce() -> Promise<docs>                getDocs on the shows
 * onShows(serverShows)                       every snapshot (and the one-time read)
 * onLoaded({ live, error })                  exactly once, however loading ends:
 *     live: true when the listener is the source, error: what went wrong, if anything
 * onError(error, stage)                      every failure: 'listener', 'first-snapshot', 'read-once'
 */
function startShowsListener({
  subscribe, readOnce, onShows, onLoaded = () => {}, onError = () => {},
  firstSnapshotMs = FIRST_SNAPSHOT_MS, readOnceMs = READ_ONCE_MS,
}) {
  let stopped = false;
  let loaded = false;
  let unsubscribe = null;
  let fallingBack = false;

  const finish = (result) => {
    if (loaded || stopped) return;
    loaded = true;
    onLoaded(result);
  };

  const fallBack = async (error, stage) => {
    onError(error, stage);
    if (loaded || stopped || fallingBack) return;
    fallingBack = true;
    try {
      const docs = await withDeadline(Promise.resolve().then(readOnce), readOnceMs, 'Reading your shows');
      if (stopped) return;
      // The listener may have answered while this read ran: then it is the source.
      if (!loaded) onShows(docsToShows(docs));
      finish({ live: false, error });
    } catch (readError) {
      onError(readError, 'read-once');
      finish({ live: false, error: readError });
    }
  };

  const timer = setTimeout(() => {
    if (!loaded) fallBack(new Error(`Your shows didn't arrive within ${firstSnapshotMs} ms`), 'first-snapshot');
  }, firstSnapshotMs);

  try {
    unsubscribe = subscribe(
      (snapshot) => {
        if (stopped) return;
        onShows(docsToShows(snapshot && snapshot.docs));
        clearTimeout(timer);
        finish({ live: true, error: null });
      },
      (error) => {
        clearTimeout(timer);
        if (!stopped) fallBack(error, 'listener');
      },
    );
  } catch (error) {
    clearTimeout(timer);
    fallBack(error, 'listener');
  }

  return function stop() {
    stopped = true;
    clearTimeout(timer);
    if (typeof unsubscribe === 'function') {
      try { unsubscribe(); } catch { /* already gone */ }
    }
    unsubscribe = null;
  };
}

module.exports = { mergeShowsSnapshot, startShowsListener, FIRST_SNAPSHOT_MS, READ_ONCE_MS };
