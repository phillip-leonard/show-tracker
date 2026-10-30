// components/ui/Button.jsx
//
// The canonical button for MySetlists. Uses brand tokens from tailwind.config.js.
//
// Variants:
//   primary   — green, for the main action on a screen (one per screen, ideally)
//   secondary — light gray, for secondary actions
//   ghost     — transparent, for low-weight actions (toolbar, inline)
//   outline   — bordered, for destructive-adjacent or neutral ghost-with-edges
//   danger    — red, for destructive actions
//   dark      — navy (matches sidebar), for surfaces on light bg when you need emphasis
//
// Sizes: sm / md / lg
// Extra: `icon` prop renders a lucide icon with correct spacing. `loading` adds
// a spinner and disables. `full` makes it w-full.

import React from 'react';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary:
    'bg-brand text-[#2a2a4e] hover:bg-[#059669] shadow-[0_1px_2px_rgba(16,185,129,0.25)] ' +
    'hover:shadow-[0_4px_12px_rgba(16,185,129,0.3)] hover:-translate-y-0.5 active:translate-y-0 ' +
    'focus-visible:ring-brand/40',
  secondary:
    'bg-surface text-primary border border-subtle hover:border-active hover:-translate-y-0.5 ' +
    'active:translate-y-0 focus-visible:ring-brand/40',
  ghost:
    'bg-transparent text-secondary hover:bg-hover hover:text-primary ' +
    'focus-visible:ring-brand/40',
  outline:
    'bg-transparent text-primary border border-active hover:bg-hover ' +
    'focus-visible:ring-brand/40',
  danger:
    'bg-danger text-white hover:bg-[#c84848] shadow-[0_1px_2px_rgba(224,85,85,0.25)] ' +
    'hover:shadow-[0_4px_12px_rgba(224,85,85,0.3)] focus-visible:ring-danger/40',
  dark:
    'bg-sidebar text-on-dark hover:bg-[#2a334d] focus-visible:ring-brand/40',
};

// Heights below md: are raised to the 44pt touch minimum via min-h-touch,
// while the padding — and therefore the desktop height — is untouched.
// `sm` was ~32px and `md` ~42px on a phone; both are now 44.
const SIZES = {
  sm: 'text-sm font-semibold px-3 py-1.5 rounded-lg gap-1.5 min-h-touch md:fine:min-h-0',
  md: 'text-[15px] font-bold px-[18px] py-2.5 rounded-full gap-2 min-h-touch md:fine:min-h-0',
  lg: 'text-base font-extrabold px-[26px] py-[14px] rounded-full gap-2',
};

const ICON_SIZE = { sm: 14, md: 16, lg: 18 };

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  full = false,
  type = 'button',
  onClick,
  className = '',
  ...rest
}) {
  const isDisabled = disabled || loading;

  const base =
    'inline-flex items-center justify-center whitespace-nowrap select-none ' +
    'transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-base disabled:opacity-50 disabled:cursor-not-allowed ' +
    'disabled:hover:translate-y-0 disabled:hover:shadow-none ' +
    // On touch there is no hover, so a pressed state is the only
    // confirmation the tap registered at all.
    'active:scale-[0.97] disabled:active:scale-100';

  const iconPx = ICON_SIZE[size];

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      className={[
        base,
        VARIANTS[variant],
        SIZES[size],
        // Icon-only: the horizontal padding alone leaves it narrower than
        // 44pt, so claim the width explicitly.
        !children && Icon && 'min-w-touch md:min-w-0',
        full && 'w-full',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <Loader2 size={iconPx} className="animate-spin" />
      ) : (
        Icon && iconPosition === 'left' && <Icon size={iconPx} strokeWidth={2.4} />
      )}
      {children && <span>{children}</span>}
      {!loading && Icon && iconPosition === 'right' && <Icon size={iconPx} strokeWidth={2.4} />}
    </button>
  );
}
