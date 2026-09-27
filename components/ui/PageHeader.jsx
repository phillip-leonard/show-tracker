// components/ui/PageHeader.jsx
//
// Top-of-page title block. Consistent across every route.
//
// Usage:
//   <PageHeader
//     eyebrow="Library"
//     title="My Shows"
//     subtitle="87 shows · 24 artists · 19 venues"
//     actions={<Button icon={Plus}>Add show</Button>}
//   />
//
// `compact` tightens the block on phones only (below md:) — smaller gaps,
// and action buttons slim enough for two to share a row — for pages whose
// content has to start above the fold (My Shows). Desktop is identical
// either way: every compact class is restored at md:.

import React from 'react';

export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  compact = false,
  className = '',
}) {
  const spacing = compact
    ? 'gap-3 pb-4 mb-4 md:gap-4 md:pb-6 md:mb-7'
    : 'gap-4 pb-6 mb-7';
  return (
    <header
      className={`flex flex-col md:flex-row md:items-end md:justify-between ${spacing} border-b border-subtle ${className}`}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className={`text-[12px] font-extrabold text-brand tracking-[0.1em] uppercase ${compact ? 'mb-1 md:mb-2' : 'mb-2'}`}>
            {eyebrow}
          </div>
        )}
        {title && (
          <h1
            // The mobile header watches this with an IntersectionObserver
            // and fades its own compact title in once this one has scrolled
            // away — see components/layout/MobileHeader.jsx.
            data-page-title
            className="text-[26px] md:text-[40px] leading-[1.08] md:leading-[1.05] font-extrabold tracking-[-0.025em] text-primary"
          >
            {title}
          </h1>
        )}
        {subtitle && (
          <p className={`text-[15px] text-secondary max-w-2xl ${compact ? 'mt-1 md:mt-2' : 'mt-2'}`}>{subtitle}</p>
        )}
      </div>
      {actions && (
        <div
          className={[
            'flex gap-2.5 flex-wrap flex-shrink-0',
            // `>button` outranks Button's own single-class padding and font
            // size, so these win on phones without touching Button itself.
            compact && 'max-md:gap-2 max-md:[&>button]:px-3.5 max-md:[&>button]:text-[14px]',
          ].filter(Boolean).join(' ')}
        >
          {actions}
        </div>
      )}
    </header>
  );
}
