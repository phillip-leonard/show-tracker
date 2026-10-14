'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { X, Info, AlertTriangle, Sparkles, Megaphone, ExternalLink } from 'lucide-react';

const VARIANT_CONFIG = {
  info: {
    icon: Info,
    iconBg: 'bg-accent/10',
    iconColor: 'text-accent',
    accentBorder: 'border-accent/30',
    buttonBg: 'bg-accent hover:bg-accent/90',
  },
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-subtle',
    iconColor: 'text-amber',
    accentBorder: 'border-amber/30',
    buttonBg: 'bg-amber hover:bg-amber-light',
  },
  feature: {
    icon: Sparkles,
    iconBg: 'bg-brand-subtle',
    iconColor: 'text-brand',
    accentBorder: 'border-brand/30',
    buttonBg: 'bg-gradient-to-r from-brand to-amber hover:from-brand hover:to-amber',
  },
  announcement: {
    icon: Megaphone,
    iconBg: 'bg-brand-subtle',
    iconColor: 'text-brand',
    accentBorder: 'border-brand/30',
    buttonBg: 'bg-gradient-to-r from-brand to-brand hover:from-brand/90 hover:to-brand/90',
  },
};

/**
 * PopupOverlay — modal popup with consistent MySetlists styling.
 *
 * Props:
 *   popupId        (string)   — unique ID for tracking dismissal
 *   title          (string)   — popup title
 *   children       (ReactNode) — popup body content
 *   onDismiss      (fn)       — fires when user clicks "Got It"
 *   variant        ('info'|'warning'|'feature'|'announcement') — default 'feature'
 *   showCloseButton (bool)    — show X button, default true
 *   learnMoreUrl   (string)   — optional URL for "Learn More" button
 *   learnMoreLabel (string)   — label for learn more button, default "Learn More"
 *   dismissLabel   (string)   — label for dismiss button, default "Got It"
 */
export default function PopupOverlay({
  popupId,
  title,
  children,
  onDismiss,
  variant = 'feature',
  showCloseButton = true,
  learnMoreUrl,
  learnMoreLabel = 'Learn More',
  dismissLabel = 'Got It',
}) {
  const overlayRef = useRef(null);
  const contentRef = useRef(null);
  const previousFocusRef = useRef(null);

  const config = VARIANT_CONFIG[variant] || VARIANT_CONFIG.feature;
  const Icon = config.icon;

  // Focus trap + body scroll lock
  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    document.body.style.overflow = 'hidden';

    // Focus the content container
    const timer = setTimeout(() => {
      contentRef.current?.focus();
    }, 50);

    return () => {
      document.body.style.overflow = '';
      previousFocusRef.current?.focus?.();
      clearTimeout(timer);
    };
  }, []);

  // Keyboard: Escape to dismiss, Tab trap
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss?.();
      return;
    }
    // Tab trap within modal
    if (e.key === 'Tab' && contentRef.current) {
      const focusable = contentRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onDismiss]);

  // Click outside to close via X behavior (not dismissal tracking)
  const handleBackdropClick = (e) => {
    if (e.target === overlayRef.current && showCloseButton) {
      onDismiss?.();
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 animate-fade-in"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-sidebar/60 backdrop-blur-sm" aria-hidden="true" />

      {/* Modal */}
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`popup-title-${popupId}`}
        tabIndex={-1}
        className={`relative w-full max-w-md bg-elevated border ${config.accentBorder} rounded-2xl shadow-2xl
          transform transition-all duration-200 ease-out
          animate-slide-up
          focus:outline-none`}
      >
        {/* Close button */}
        {showCloseButton && (
          <button
            onClick={() => onDismiss?.()}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-muted hover:text-secondary hover:bg-hover transition-colors"
            aria-label="Close popup"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Content */}
        <div className="p-6">
          {/* Icon + Title */}
          <div className="flex items-start gap-4 mb-4">
            <div className={`shrink-0 w-12 h-12 ${config.iconBg} rounded-xl flex items-center justify-center`}>
              <Icon className={`w-6 h-6 ${config.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <h2
                id={`popup-title-${popupId}`}
                className="text-lg font-bold text-primary leading-tight"
              >
                {title}
              </h2>
            </div>
          </div>

          {/* Body */}
          <div className="text-secondary text-sm leading-relaxed mb-6">
            {children}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => onDismiss?.()}
              className={`flex-1 px-5 py-2.5 ${config.buttonBg} text-white rounded-xl font-semibold text-sm transition-all shadow-lg shadow-brand/20`}
            >
              {dismissLabel}
            </button>
            {learnMoreUrl && (
              <a
                href={learnMoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2.5 bg-hover hover:bg-hover text-secondary rounded-xl font-medium text-sm transition-colors"
              >
                {learnMoreLabel}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
