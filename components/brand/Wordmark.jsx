// components/brand/Wordmark.jsx
// "my · setlists · .net" lockup. Use `inverse` on dark backgrounds.

import React from 'react';

// Sizes (px) of the Pick + wordmark lockup at the top of each surface, in one
// place so they stay in proportion. Every value is the pre-5.41.0 size × 1.1
// (Pick and wordmark scaled together, so the pick stays aligned to the text):
// mobile header 24/13, sidebar 32/16, landing nav 32/20.
const scaled = (px) => Math.round(px * 1.1 * 10) / 10;
export const BRAND_LOCKUP = {
  mobileHeader: { pick: scaled(24), wordmark: scaled(13) },
  sidebar: { pick: scaled(32), wordmark: scaled(16) },
  landingNav: { pick: scaled(32), wordmark: scaled(20) },
};

export default function Wordmark({ size = 18, inverse = false, showTld = false, className = '' }) {
  const prefix = inverse ? 'text-on-dark' : 'text-primary';
  const muted = inverse ? 'text-on-dark-muted' : 'text-muted';
  return (
    <span
      className={`inline-flex items-baseline font-extrabold tracking-[-0.02em] leading-none ${className}`}
      style={{ fontSize: size }}
      aria-label="MySetlists"
    >
      <span className={prefix}>my</span>
      <span className="text-amber">setlists</span>
      {showTld && <span className={`${muted} font-bold`} style={{ fontSize: size * 0.75 }}>.net</span>}
    </span>
  );
}
