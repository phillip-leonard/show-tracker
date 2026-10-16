// lib/keyboardInset.js
//
// ONE answer to "how much of the viewport is the keyboard covering?",
// whichever platform is asking.
//
// There were two implementations before this, neither of which knew about
// the other:
//
//   • lib/capacitor.js wrote `--keyboard-height` from the Capacitor
//     Keyboard plugin's events — and nothing in the app ever read the
//     variable. It was written and never used.
//   • components/ui/Modal.jsx kept its own visualViewport listener in
//     component state, which was the only thing that actually worked, and
//     only inside that one component.
//
// Both now live here. Native uses the plugin (it reports the height more
// accurately, and earlier — keyboardWillShow fires before the animation);
// web falls back to visualViewport, the only thing that reports the
// keyboard to the web layer at all. Either way the result lands in the same
// `--keyboard-height` custom property for CSS, and in the same subscriber
// list for JS.

import { isNativePlatform } from './platform';

const VAR = '--keyboard-height';

/** A browser chrome bar is tens of pixels; a keyboard is hundreds. */
const KEYBOARD_MIN_PX = 120;

let started = false;
let current = 0;
const subscribers = new Set();

function publish(px) {
  const next = Math.max(0, Math.round(px));
  if (next === current) return;
  current = next;
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(VAR, `${next}px`);
  }
  subscribers.forEach((fn) => {
    try {
      fn(next);
    } catch (e) {
      console.warn('Keyboard inset subscriber threw:', e);
    }
  });
}

/** Current keyboard height in px, 0 when hidden. Safe on the server. */
export function keyboardHeight() {
  return current;
}

/**
 * The tallest a sheet or dialog can be while the keyboard covers `px` of the
 * screen, as a CSS max-height.
 *
 * The status bar is subtracted too. Without it a sheet with a focused field
 * (TourBrowseModal opens on its artist search, autofocused) grew to fill
 * everything above the keyboard, and on iOS its header — title and close
 * button — went up under the clock and the Dynamic Island.
 */
export function maxHeightAboveKeyboard(px) {
  return `calc(100dvh - ${px}px - var(--safe-top) - 0.5rem)`;
}

/**
 * Be told when the keyboard opens or closes. Returns an unsubscribe.
 *
 * Only fires on an actual change, so a component can hold layout state
 * without re-rendering on every visualViewport scroll event.
 */
export function subscribeKeyboardInset(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * Start tracking. Idempotent — safe to call from more than one mount.
 * Returns a teardown for the web listeners.
 */
export function initKeyboardInsetTracking() {
  if (started || typeof window === 'undefined') return () => {};
  started = true;

  publish(0);

  if (isNativePlatform()) {
    // The plugin is the better source on native and fires before the
    // keyboard animates, so the layout moves with it rather than after it.
    let removers = [];
    import('@capacitor/keyboard')
      .then(({ Keyboard }) => Promise.all([
        Keyboard.addListener('keyboardWillShow', (info) => publish(info.keyboardHeight)),
        Keyboard.addListener('keyboardWillHide', () => publish(0)),
      ]))
      .then((handles) => { removers = handles; })
      .catch((e) => console.warn('Keyboard plugin not available:', e?.message));
    return () => {
      removers.forEach((h) => h?.remove?.());
      removers = [];
    };
  }

  const vv = window.visualViewport;
  if (!vv) return () => {};

  const update = () => {
    const inset = window.innerHeight - vv.height - vv.offsetTop;
    // Ignore the browser chrome bar so the layout does not twitch while
    // scrolling in Safari.
    publish(inset > KEYBOARD_MIN_PX ? inset : 0);
  };

  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  };
}
