// components/ui/Select.jsx
//
// Styled native <select> — zero dependency, accessible by default, matches Input.

import React, { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

const Select = forwardRef(function Select(
  { label, error, hint, options = [], className = '', containerClassName = '', id, ...rest },
  ref,
) {
  const inputId = id || (label ? `sel-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

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
          error ? 'border-danger' : 'border-subtle focus-within:border-brand',
          'focus-within:ring-2',
          error ? 'focus-within:ring-danger/20' : 'focus-within:ring-brand/15',
        ].join(' ')}
      >
        <select
          id={inputId}
          ref={ref}
          // 16px below md: (iOS zooms a focused control under 16px), and
          // min-h-touch for the 44pt target.
          className={`flex-1 bg-transparent text-[16px] md:text-[15px] text-primary outline-none py-2.5 min-h-touch md:fine:min-h-0 pl-3.5 pr-10 appearance-none cursor-pointer ${className}`}
          {...rest}
        >
          {options.map((opt) =>
            typeof opt === 'string' ? (
              <option key={opt} value={opt}>{opt}</option>
            ) : (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            )
          )}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 text-muted pointer-events-none"
        />
      </div>
      {(error || hint) && (
        <span className={`text-xs ${error ? 'text-danger' : 'text-muted'}`}>
          {error || hint}
        </span>
      )}
    </div>
  );
});

export default Select;
