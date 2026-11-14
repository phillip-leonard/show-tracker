// eslint.config.js — the first lint setup (5.59.12, #398 follow-up).
//
// Deliberately small: rules that catch real bugs, not style. Errors fail
// `npm run lint` and CI; warnings are a backlog to clear over time, not a
// reason to mass-reformat (the counts are in the 5.59.12 PR).
//
//   errors:   no-undef, react/jsx-no-undef, react-hooks/rules-of-hooks,
//             no-restricted-globals (a stray `name` or `event` that happens
//             to resolve to window.name / window.event in a browser)
//   warnings: no-unused-vars, react-hooks/exhaustive-deps, Next.js rules
//
// Three kinds of code:
//   app/ components/ context/ hooks/ lib/   the Next.js app (browser, JSX)
//   netlify/functions/ scripts/ tests/      Node (CommonJS, .mjs as modules)
//   lib/__tests__/ e2e/                     Node test files (ES modules)

const globals = require('globals');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const nextPlugin = require('@next/eslint-plugin-next');

const BUG_RULES = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true, caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-restricted-globals': ['error',
    { name: 'name', message: 'Did you mean a local variable? `name` is window.name in a browser.' },
    { name: 'event', message: 'Use the event parameter, not the global window.event.' },
  ],
};

const nextWarnings = Object.fromEntries(
  Object.keys(nextPlugin.configs.recommended.rules).map((rule) => [rule, 'warn'])
);

module.exports = [
  {
    ignores: [
      'node_modules/**', 'out/**', '.next/**', '.netlify/**', 'ios/**', 'android/**',
      'public/**', 'src/**', 'coverage/**', 'test-results/**', 'playwright-report/**',
      'scripts/output/**', 'netlify/functions/fonts/**', 'next-env.d.ts',
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },

  // The Next.js app.
  {
    files: ['app/**/*.{js,jsx}', 'components/**/*.{js,jsx}', 'context/**/*.{js,jsx}', 'hooks/**/*.{js,jsx}', 'lib/**/*.{js,jsx}'],
    ignores: ['lib/__tests__/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      // process.env is inlined by Next; a few lib files are shared
      // CommonJS (lib/recommendations.js, lib/venueCount.js).
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react, 'react-hooks': reactHooks, '@next/next': nextPlugin },
    settings: { react: { version: 'detect' } },
    rules: {
      ...BUG_RULES,
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...nextWarnings,
    },
  },
  // The two lib files that are CommonJS.
  {
    files: ['lib/recommendations.js', 'lib/venueCount.js'],
    languageOptions: { sourceType: 'commonjs' },
  },

  // Netlify functions, scripts and Node tests.
  {
    files: ['netlify/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.config.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } },
    rules: BUG_RULES,
  },
  {
    files: ['netlify/**/*.mjs', 'scripts/**/*.mjs', 'tests/**/*.mjs', '*.config.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: BUG_RULES,
  },
  // The heard tool's page script is written in a function file but runs in
  // the visitor's browser (inlined by heardPages.js).
  {
    files: ['netlify/functions/lib/heardClient.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  // ES module test files.
  {
    files: ['lib/__tests__/**/*.{js,mjs}', 'e2e/**/*.js', 'playwright.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: BUG_RULES,
  },
  // Playwright specs: code inside page.evaluate() runs in the browser.
  {
    files: ['e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-restricted-globals': 'off' },
  },

  // Keep the recommended set's parser-level checks without its style rules.
  { rules: { 'no-dupe-keys': 'error', 'no-unreachable': 'warn', 'no-func-assign': 'error', 'no-import-assign': 'error' } },
];

