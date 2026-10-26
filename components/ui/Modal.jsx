// components/ui/Modal.jsx
//
// Accessible modal with backdrop, escape-to-close, scroll-lock, focus trap-ish.
// Named size presets: sm / md / lg / xl / full.
//
// Usage:
//   <Modal open={isOpen} onClose={close} title="Add a show" size="lg">
//     <div>content</div>
//     <Modal.Footer>
//       <Button variant="secondary" onClick={close}>Cancel</Button>
//       <Button onClick={save}>Save</Button>
//     </Modal.Footer>
//   </Modal>

'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useDismissable } from '@/context/DismissStackContext';
import useSheetDrag from '@/hooks/useSheetDrag';
import useIsMobile from '@/hooks/useIsMobile';
import useKeyboardInset from '@/hooks/useKeyboardInset';
import { maxHeightAboveKeyboard } from '@/lib/keyboardInset';

const SIZES = {
  sm:   'max-w-md',
  md:   'max-w-lg',
  lg:   'max-w-2xl',
  xl:   'max-w-4xl',
  full: 'max-w-[calc(100vw-2rem)]',
};

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = 'md',
  showClose = true,
  footer,
}) {
  // How much of the layout viewport the on-screen keyboard covers.
  //
  // This modal is `position: fixed; inset: 0`, so it is laid out against
  // the *layout* viewport. Capacitor's `Keyboard: { resize: 'body' }`
  // resizes the body element, which a fixed-position element is not
  // affected by — so on iOS the sheet stayed anchored to the bottom of the
  // screen, behind the keyboard, and its buttons could not be tapped at all.
  //
  // The visualViewport listener that used to live here was the only working
  // keyboard measurement in the app, and worked only inside this component.
  // It is now lib/keyboardInset.js, shared with everything else that has to
  // ride above the keyboard, and correct on native as well as on web.
  const keyboardInset = useKeyboardInset();

  // This call went missing in 5.36.0, while the refs and drag props it
  // returns stayed in the markup below. They were left as free variables, so
  // opening any Modal threw a ReferenceError before it painted — the delete-
  // account and block-user confirmations among them. `if (!open) return null`
  // meant a closed Modal was fine, which is why nothing caught it.
  const isMobileViewport = useIsMobile();
  const { sheetRef, backdropRef, scrollRef, dragHandleProps } = useSheetDrag({
    enabled: isMobileViewport,
    onDismiss: onClose,
  });

  // Escape to close + scroll lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-end md:items-center justify-center pl-safe-left pr-safe-right md:p-safe-gutter"
      style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      {/* Backdrop as its own element so the swipe-down drag can fade it
          with the sheet. */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        className="absolute inset-0 bg-sidebar/60 backdrop-blur-sm animate-fade-in"
      />
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        style={
          keyboardInset
            // dvh, not vh: vh is the largest-possible viewport, so with the
            // keyboard up this used to compute a sheet taller than the space
            // actually left for it. It also leaves out the status bar, or the
            // header ends up under the Dynamic Island.
            ? { maxHeight: maxHeightAboveKeyboard(keyboardInset) }
            : undefined
        }
        className={[
          // 92dvh, but never into the status bar: on a short viewport 8% is
          // less than the top inset.
          'relative bg-surface w-full shadow-theme-xl flex flex-col max-h-[min(92dvh,calc(100dvh_-_var(--safe-top)_-_0.5rem))] md:max-h-[min(92dvh,100%)] animate-slide-up',
          'rounded-t-2xl md:rounded-2xl',
          // The home indicator sits over the bottom of a full-width sheet.
          'pb-safe-bottom md:pb-0',
          SIZES[size],
        ].join(' ')}
      >
        {/* Grabber — mobile only, and the primary drag region. Also the
            affordance that tells you the sheet can be dragged at all. */}
        <div
          {...dragHandleProps}
          className="md:hidden flex-shrink-0 flex items-center justify-center pt-2.5 pb-1 cursor-grab"
        >
          <div className="sheet-grabber" />
        </div>
        {/* Header */}
        {(title || showClose) && (
          <div
            {...dragHandleProps}
            className="flex items-start justify-between gap-4 px-5 pb-5 pt-2 md:p-6 border-b border-subtle"
          >
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id="modal-title" className="text-xl md:text-2xl font-bold tracking-[-0.015em] text-primary">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-sm text-secondary mt-1">{subtitle}</p>
              )}
            </div>
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="flex-shrink-0 tap-target -mr-2 -mt-1 rounded-lg text-muted hover:text-primary hover:bg-hover transition-colors pressable"
              >
                <X size={22} strokeWidth={2.2} />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 md:p-6">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex-shrink-0 flex justify-end gap-2.5 p-5 md:p-6 border-t border-subtle bg-base/40">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Convenience — <Modal.Footer> passes children straight through,
// but renders nothing if you use the `footer` prop directly. Useful for
// callers who prefer the compositional form.
Modal.Footer = function ModalFooter({ children }) {
  return <>{children}</>;
};
