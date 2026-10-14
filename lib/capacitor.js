/**
 * Capacitor native plugin initialization.
 *
 * Called once on app mount to configure StatusBar, Keyboard, and
 * other native-only features. No-ops gracefully on web.
 */

import { isNativePlatform } from '@/lib/platform';

let initialized = false;

export async function initCapacitorPlugins() {
  if (initialized) return;
  initialized = true;

  let isNative = false;
  try {
    const { Capacitor } = require('@capacitor/core');
    isNative = Capacitor.isNativePlatform();
  } catch {
    return; // Not in a Capacitor environment
  }

  if (!isNative) return;

  // --- StatusBar: dark content on dark background ---
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    // Make status bar overlay the WebView (content renders behind it)
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch (e) {
    console.warn('StatusBar plugin not available:', e.message);
  }

  // --- Keyboard ---
  // Deliberately NOT here any more. `--keyboard-height` used to be written
  // from this function, and nothing in the app ever read it, while
  // ui/Modal.jsx kept a second, unrelated visualViewport implementation of
  // its own. Both now live in lib/keyboardInset.js, which owns the
  // property and the plugin listeners for every platform — one source, one
  // value. It is started from app/AppProviderWrapper.jsx.

  // --- SplashScreen: auto-hide after app is ready ---
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch (e) {
    console.warn('SplashScreen plugin not available:', e.message);
  }
}

// --- Haptics ---

const IMPACT_STYLES = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };

/**
 * Builds an `impact` from its two dependencies, so the native path can be
 * tested without a device. Everything else should use `impact` below.
 */
export function createImpact({ isNative, loadHaptics }) {
  return async function impact(style = 'light') {
    try {
      if (!isNative()) return;
      const { Haptics, ImpactStyle } = await loadHaptics();
      await Haptics.impact({ style: ImpactStyle[IMPACT_STYLES[style] || 'Light'] });
    } catch {
      // A haptic is garnish. It must never reject into a gesture's commit
      // handler — the callers fire it unawaited, just before they navigate,
      // dismiss or close.
    }
  };
}

/**
 * One haptic tap on native ('light' | 'medium' | 'heavy', default light).
 * No-op on web, mobile web, PWA and desktop. Resolves, never throws.
 * Fired by the three swipe gestures when they commit.
 */
export const impact = createImpact({
  isNative: isNativePlatform,
  loadHaptics: () => import('@capacitor/haptics'),
});
