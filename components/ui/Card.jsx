// components/ui/Card.jsx
//
// The base surface for grouped content. Use everywhere a box is needed.
//
// Variants:
//   default   — white surface with subtle border (main card style)
//   elevated  — white surface with md shadow (for modals, floating panels)
//   inset     — no border, bg-base (for cards-within-cards)
//   dark      — navy sidebar surface (for inverted sections like Showcase)
//
// Props:
//   interactive — adds hover lift + pointer cursor
//   padding     — 'none' | 'sm' | 'md' | 'lg'

import React, { forwardRef } from 'react';

const VARIANTS = {
  default:  'bg-surface border border-subtle',
  elevated: 'bg-surface shadow-theme-md',
  inset:    'bg-base border border-subtle',
  dark:     'bg-sidebar text-on-dark',
};

const PAD = {
  none: '',
  sm:   'p-4',
  md:   'p-6',
  lg:   'p-8',
};

const INTERACTIVE =
  'cursor-pointer transition-all hover:border-active hover:-translate-y-0.5 hover:shadow-theme-md';

// forwardRef so a caller can reach the DOM node. Purely additive: rendering
// is unchanged.
const Card = forwardRef(function Card({
  children,
  variant = 'default',
  padding = 'md',
  interactive = false,
  className = '',
  as: As = 'div',
  ...rest
}, ref) {
  return (
    <As
      ref={ref}
      className={[
        'rounded-2xl',
        VARIANTS[variant],
        PAD[padding],
        interactive && INTERACTIVE,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </As>
  );
});

export default Card;
