/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './context/**/*.{js,jsx}',
    './lib/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        hover: 'var(--bg-hover)',
        sidebar: 'var(--bg-sidebar)',
        subtle: 'var(--border-subtle)',
        active: 'var(--border-active)',
        brand: {
          DEFAULT: 'var(--green-primary)',
          light: 'var(--green-light)',
          subtle: 'var(--green-subtle)',
        },
        amber: {
          DEFAULT: 'var(--amber)',
          light: 'var(--amber-light)',
          subtle: 'var(--amber-subtle)',
        },
        accent: 'var(--accent-purple)',
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted: 'var(--text-muted)',
        'on-dark': 'var(--text-on-dark)',
        'on-dark-muted': 'var(--text-on-dark-muted)',
        success: 'var(--success)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
      },
      spacing: {
        // Device insets, from the tokens in app/globals.css. Use these
        // (pt-safe-top, pb-safe-bottom, …) rather than spelling out
        // env(safe-area-inset-*) in a component.
        'safe-top': 'var(--safe-top)',
        'safe-bottom': 'var(--safe-bottom)',
        'safe-left': 'var(--safe-left)',
        'safe-right': 'var(--safe-right)',
        // The mobile header's bar plus the status-bar inset above it —
        // what a fixed-header page has to offset its content by.
        'header': 'calc(var(--mobile-header-h) + var(--safe-top))',
        // Keyboard height, so a sticky control can ride above it.
        'keyboard': 'var(--keyboard-height)',
        // The fixed sidebar, left inset included (w-sidebar, md:left-sidebar).
        'sidebar': 'var(--sidebar-w)',
      },
      minHeight: {
        // 44x44pt is the minimum comfortable touch target.
        'touch': '44px',
        // "Fills the visible viewport" — dvh, because 100vh is wrong the
        // moment the iOS URL bar or the keyboard moves.
        'dscreen': '100dvh',
      },
      minWidth: {
        'touch': '44px',
      },
      inset: {
        // So a fixed bottom control can sit above the keyboard with
        // `bottom-keyboard`. Resolves to 0px when no keyboard is up.
        'keyboard': 'var(--keyboard-height)',
      },
      height: {
        'header': 'calc(var(--mobile-header-h) + var(--safe-top))',
        'dscreen': '100dvh',
      },
      maxHeight: {
        'dscreen': '100dvh',
      },
      boxShadow: {
        'theme-sm': 'var(--shadow-sm)',
        'theme-md': 'var(--shadow-md)',
        'theme-lg': 'var(--shadow-lg)',
        'theme-xl': 'var(--shadow-xl)',
      },
    },
  },
  plugins: [
    // `fine:` — the primary pointer is a mouse or trackpad. `md:` means wide,
    // not "has a mouse": an iPad is wide and touch, so anything that shrinks
    // for a mouse (44pt tap targets, keyboard-shortcut hints) gates on this
    // as well as on the width.
    ({ addVariant }) => {
      addVariant('fine', '@media (hover: hover) and (pointer: fine)');
    },
  ],
}
