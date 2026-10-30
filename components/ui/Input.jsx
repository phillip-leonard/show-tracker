// components/ui/Input.jsx
//
// Text input with optional left icon, right-aligned affix, error state, label.
//
// Usage:
//   <Input label="Email" type="email" value={v} onChange={e => setV(e.target.value)} />
//   <Input icon={Search} placeholder="Search shows…" />
//   <Input label="Rating" error="Must be between 1 and 5" value={r} />

import React, { forwardRef } from 'react';

// Mobile keyboard defaults per input type. There were none of these
// anywhere in the app — inputMode, enterKeyHint, autoComplete and
// autoCapitalize appeared zero times — so an email field got the same
// alphabetic keyboard and the same capitalised first letter as a comment
// box. Set here rather than at ~60 call sites; every one is overridable
// by passing the prop explicitly.
const TYPE_DEFAULTS = {
  email: {
    inputMode: 'email',
    enterKeyHint: 'next',
    autoComplete: 'email',
    autoCapitalize: 'none',
    autoCorrect: 'off',
    spellCheck: false,
  },
  password: {
    enterKeyHint: 'go',
    autoComplete: 'current-password',
    autoCapitalize: 'none',
    autoCorrect: 'off',
    spellCheck: false,
  },
  search: {
    inputMode: 'search',
    enterKeyHint: 'search',
    autoCapitalize: 'none',
    autoCorrect: 'off',
    spellCheck: false,
  },
  url: {
    inputMode: 'url',
    enterKeyHint: 'go',
    autoComplete: 'url',
    autoCapitalize: 'none',
    autoCorrect: 'off',
    spellCheck: false,
  },
  tel: { inputMode: 'tel', autoComplete: 'tel' },
  number: { inputMode: 'numeric' },
  date: { autoComplete: 'off' },
};

const Input = forwardRef(function Input(
  {
    label,
    error,
    hint,
    icon: Icon,
    rightElement,
    className = '',
    containerClassName = '',
    id,
    ...rest
  },
  ref,
) {
  const inputId = id || (label ? `in-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  // Caller's props win: `...rest` is spread after these on the element.
  const typeDefaults = TYPE_DEFAULTS[rest.type] || {};

  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-semibold text-secondary">
          {label}
        </label>
      )}
      <div
        className={[
          'relative flex items-center bg-surface border rounded-xl transition-colors',
          error
            ? 'border-danger focus-within:border-danger'
            : 'border-subtle focus-within:border-brand',
          'focus-within:ring-2',
          error ? 'focus-within:ring-danger/20' : 'focus-within:ring-brand/15',
        ].join(' ')}
      >
        {Icon && (
          <Icon size={18} strokeWidth={2} className="ml-3.5 text-muted flex-shrink-0" />
        )}
        <input
          id={inputId}
          ref={ref}
          className={[
            // 16px below md:, not 15px. Safari zooms the whole page when a
            // focused input's font-size is under 16px, which jolted the
            // layout on every form in the app; 15px is kept from md: up
            // where the zoom rule does not apply.
            'flex-1 bg-transparent text-[16px] md:text-[15px] text-primary placeholder:text-muted',
            // min-h-touch takes the field to the 44pt minimum on touch.
            'outline-none py-2.5 min-h-touch md:fine:min-h-0',
            Icon ? 'pl-2.5 pr-3.5' : 'px-3.5',
            rightElement ? 'pr-2' : '',
            className,
          ].join(' ')}
          {...typeDefaults}
          {...rest}
        />
        {rightElement && <div className="mr-2 flex-shrink-0">{rightElement}</div>}
      </div>
      {(error || hint) && (
        <span className={`text-xs ${error ? 'text-danger' : 'text-muted'}`}>
          {error || hint}
        </span>
      )}
    </div>
  );
});

export default Input;
