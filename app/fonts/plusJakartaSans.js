import localFont from 'next/font/local';

// Plus Jakarta Sans, self-hosted from files committed next to this module
// (SIL OFL 1.1, see OFL.txt). It used to come from next/font/google, which
// downloads the Google Fonts stylesheet on every `next build`; a bad response
// from Google failed the whole Netlify build ("An error occurred in
// `next/font`"), even when the code hadn't changed. These are the exact files
// that loader served (Google Fonts v12, variable wght axis), so nothing
// renders differently and the build makes no font requests.
//
// next/font/google declared four subsets with unicode-range and preloaded
// only latin; the browser fetched the others only for a character in their
// range (ł, ř, ő, Vietnamese, extended Cyrillic). next/font/local applies
// one set of declarations to every file in a call, so each subset is its own
// call and fontFamily below chains them into one stack, in the order
// Google's CSS gave them precedence (latin first). Only latin is preloaded,
// as before. The size-adjusted Arial fallback goes last; its @font-face is
// in app/globals.css with the metrics next/font/google generated.
//
// Weights 300–700, normal and italic, as layout.jsx asked Google for. One
// variable file covers every weight, so a '300 700' range renders the same as
// Google's five single-weight faces pointing at that same file.
//
// next/font needs literal options in every call, hence the repetition.

const latin = localFont({
  src: [
    { path: './PlusJakartaSans-latin.woff2', style: 'normal' },
    { path: './PlusJakartaSans-latin-italic.woff2', style: 'italic' },
  ],
  weight: '300 700',
  display: 'swap',
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const latinExt = localFont({
  src: [
    { path: './PlusJakartaSans-latin-ext.woff2', style: 'normal' },
    { path: './PlusJakartaSans-latin-ext-italic.woff2', style: 'italic' },
  ],
  weight: '300 700',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
});

const vietnamese = localFont({
  src: [
    { path: './PlusJakartaSans-vietnamese.woff2', style: 'normal' },
    { path: './PlusJakartaSans-vietnamese-italic.woff2', style: 'italic' },
  ],
  weight: '300 700',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    },
  ],
});

const cyrillicExt = localFont({
  src: [
    { path: './PlusJakartaSans-cyrillic-ext.woff2', style: 'normal' },
    { path: './PlusJakartaSans-cyrillic-ext-italic.woff2', style: 'italic' },
  ],
  weight: '300 700',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
    },
  ],
});

export const plusJakartaSansFamily = [
  latin.style.fontFamily,
  latinExt.style.fontFamily,
  vietnamese.style.fontFamily,
  cyrillicExt.style.fontFamily,
  "'Plus Jakarta Sans Fallback'",
].join(', ');
