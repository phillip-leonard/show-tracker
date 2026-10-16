// hooks/useDrawerSwipeClose.js
//
// Leftward swipe-to-close for the mobile nav drawer.
//
// Deliberately close-only. A right-edge swipe-to-OPEN would collide head-on
// with the back gesture, which owns the left edge — and an open gesture that
// sometimes navigates instead is worse than no open gesture.

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { impact } from '@/lib/capacitor';
import { TOUCH_GESTURES_ENABLED } from '@/lib/platform';

/** Fraction of drawer width past which release closes it. */
export const DRAWER_CLOSE_FRACTION = 0.4;

/** Or a leftward flick faster than this, in px/ms. */
export const DRAWER_CLOSE_VELOCITY = 0.35;

const SETTLE_MS = 220;
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

export default function useDrawerSwipeClose({ isOpen, onClose, enabled: enabledByCaller = true } = {}) {
  // See TOUCH_GESTURES_ENABLED in lib/platform.js. Sidebar passes
  // `enabled: isMobileViewport`, so the master switch has to be ANDed in
  // here rather than changed as a default. The drawer still closes by its
  // own control, by the backdrop, and by navigating.
  const enabled = TOUCH_GESTURES_ENABLED && enabledByCaller;
  const drawerRef = useRef(null);
  const drag = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const paint = useCallback((dx, { animate = false } = {}) => {
    const el = drawerRef.current;
    if (!el) return;
    el.style.transition = animate ? `transform ${SETTLE_MS}ms ${EASING}` : 'none';
    // dx is negative (leftward). Clamped, so dragging right does not peel
    // the drawer off the edge of the screen.
    el.style.transform = `translate3d(${Math.min(0, dx)}px, 0, 0)`;
  }, []);

  const reset = useCallback(() => {
    const el = drawerRef.current;
    if (el) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.willChange = '';
    }
    drag.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || !isOpen || typeof window === 'undefined') return undefined;
    const el = drawerRef.current;
    if (!el) return undefined;

    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      // A drawer item being tapped is not a drag; the direction lock below
      // sorts that out, but a field inside the drawer never is.
      if (e.target?.closest?.('input, textarea, select')) return;
      drag.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        samples: [{ x: e.clientX, t: e.timeStamp }],
        claimed: false,
      };
    };

    const onPointerMove = (e) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      d.samples.push({ x: e.clientX, t: e.timeStamp });
      if (d.samples.length > 16) d.samples.shift();

      if (!d.claimed) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // Leftward and more horizontal than vertical, or the drawer's own
        // vertical scrolling wins.
        if (dx >= 0 || Math.abs(dx) <= Math.abs(dy)) {
          drag.current = null;
          return;
        }
        d.claimed = true;
        el.style.willChange = 'transform';
      }
      paint(dx);
    };

    const finish = (e) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      if (!d.claimed) { reset(); return; }

      const dx = e.clientX - d.startX;
      const width = el.offsetWidth || 1;
      const recent = d.samples[Math.max(0, d.samples.length - 5)];
      const last = d.samples[d.samples.length - 1];
      const dt = last.t - recent.t;
      const velocity = dt > 0 ? (recent.x - last.x) / dt : 0;

      if (-dx > width * DRAWER_CLOSE_FRACTION || velocity > DRAWER_CLOSE_VELOCITY) {
        impact('light');
        paint(-width, { animate: true });
        window.setTimeout(() => { reset(); onCloseRef.current?.(); }, SETTLE_MS);
        return;
      }
      paint(0, { animate: true });
      window.setTimeout(reset, SETTLE_MS);
    };

    // iOS WebKit fires pointercancel a few frames into a horizontal drag it
    // takes as a native pan, so the drawer stopped following the finger
    // ~30px in and a slow swipe snapped back (5.44.1, simulator). Cancelling
    // the touchmove keeps the pointer stream alive: always once claimed,
    // and before that only for a leftward drag at least as horizontal as
    // it is vertical, so the drawer's own list still scrolls.
    const onTouchMove = (e) => {
      const d = drag.current;
      if (!d || !e.cancelable) return;
      if (d.claimed) {
        e.preventDefault();
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - d.startX;
      const dy = touch.clientY - d.startY;
      if (dx < 0 && Math.abs(dx) >= Math.abs(dy)) e.preventDefault();
    };

    el.addEventListener('pointerdown', onPointerDown, { passive: true });
    el.addEventListener('pointermove', onPointerMove, { passive: true });
    el.addEventListener('pointerup', finish, { passive: true });
    el.addEventListener('pointercancel', finish, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      el.removeEventListener('touchmove', onTouchMove);
      reset();
    };
  }, [enabled, isOpen, paint, reset]);

  return { drawerRef };
}
