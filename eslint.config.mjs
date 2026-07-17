import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import i18next from 'eslint-plugin-i18next';
import i18nextHtmlEntities from 'eslint-plugin-i18next/lib/options/htmlEntities.js';

// ESLint 9 flat config. eslint-config-next 16 ships native flat configs and
// peer-requires eslint >=9, so they are spread in directly (no FlatCompat).
const eslintConfig = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/build/**',
      '**/*.min.js',
      // Generated reports and vendored/CommonJS build scripts — not app source.
      'e2e/playwright-report/**',
      'apps/frontend/public/**',
      '**/*.cjs',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Repo root is not the Next.js app (App Router lives in apps/frontend),
      // so this rule only emits a spurious "Pages directory cannot be found" notice.
      '@next/next/no-html-link-for-pages': 'off',
      'react/no-unescaped-entities': 'off',
      // The following rules are globally disabled because the existing codebase
      // has a large volume of occurrences and fixing them safely is tracked
      // debt. They should be re-enabled incrementally per-area rather than in
      // one giant PR. See remediation runbooks L-01..L-08 and T-13.
      '@typescript-eslint/no-explicit-any': 'off',                 // BLOCKED: ~7,167 occurrences across 999 files — unsafe mass refactor
      '@typescript-eslint/no-unused-vars': 'off',                  // BLOCKED: ~1,106 occurrences across 451 files — many intentional destructurings
      'react/display-name': 'error',                               // re-enabled TD-01c
      '@typescript-eslint/ban-ts-comment': 'off',                  // BLOCKED: ~189 ts-ignore comments across 76 files — needs per-site verification
      '@typescript-eslint/no-empty-object-type': 'error',          // re-enabled TD-01e
      '@typescript-eslint/prefer-as-const': 'error',               // already enabled TD-01f
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off', // BLOCKED: ~98 occurrences across 22 files incl. core services/provider adapters
      // React Compiler rule: 108 occurrences across 42 frontend files. Each fix
      // requires careful dependency review to avoid breaking memoization semantics.
      // Tracked debt (L-02 / F-07); downgrade to warn so CI stays green while the
      // debt remains visible.
      'react-hooks/preserve-manual-memoization': 'warn',           // BLOCKED: ~108 occurrences across 42 files — careful memoization review required
    },
  },
  {
    // Accessibility rules for the Next.js frontend. eslint-config-next already
    // registers the jsx-a11y plugin, so only its recommended ruleset is turned
    // on here (scoped to the frontend source).
    files: ['apps/frontend/src/**/*.{js,jsx,ts,tsx}'],
    rules: {
      ...jsxA11y.configs.recommended.rules,
      // High-volume rules that can't be safely auto-fixed are tracked as
      // warnings (visible, non-blocking) instead of being silently disabled:
      //   - the click-on-<div> pattern is pervasive and each fix needs a real
      //     keyboard handler / element change (tracked debt);
      //   - <video>/<audio> show user-generated media for which no caption
      //     track exists;
      //   - autoFocus is used intentionally on a handful of modals/inputs;
      //   - most flagged <label>s sit beside custom widgets (role="switch"
      //     buttons, comboboxes, button grids) with no labelable form control,
      //     so a correct fix is per-case (aria-labelledby) rather than auto.
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/media-has-caption': 'warn',
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      // The Designer canvas + video timeline are keyboard-interactive editor
      // surfaces (a focusable container with key handlers); jsx-a11y 6.7.1 has
      // no accepted role for that shape, so these two are tracked as warnings.
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-tabindex': 'warn',
    },
  },
  {
    // i18n literal-string audit for the Next.js frontend (dev/I18N_UPDATE.md §S0/§G1).
    // OPT-IN: enabled only with I18N_LINT=1 (e.g. `I18N_LINT=1 pnpm exec eslint apps/frontend/src`).
    // Off by default because the residual warnings are dominated by known false positives
    // (label fallbacks on internally-translated components), and CI's eslint.yml uploads
    // SARIF to GitHub code scanning — a warn-level default floods it with ~13k alerts and
    // fails the code-scanning PR gate. Promote to always-on 'error' (full G1) only after
    // the false-positive allowlist is complete.
    files: ['apps/frontend/src/**/*.{js,jsx,ts,tsx}'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        process.env.I18N_LINT ? 'warn' : 'off',
        {
          // Catch JSX text, JSX attributes, and non-JSX literals (e.g. hook
          // throws, option labels) so the report covers the whole UI surface.
          mode: 'all',
          message: 'literal string should be translated (i18n)',
          'jsx-attributes': {
            exclude: [
              // Defaults provided by the plugin.
              'className',
              'styleName',
              'style',
              'type',
              'key',
              'id',
              'width',
              'height',
              // Non-user-facing / technical identifiers.
              'name',
              'data-.*',
              'src',
              'href',
              'to',
              'target',
              'rel',
              'role',
              // Bespoke form primitives translate internally: `translationKey` is
              // the i18n key; `label` is its English fallback passed alongside.
              'translationKey',
              'autoComplete',
              'autoCapitalize',
              // Next.js <Script> and similar enum props.
              'strategy',
              // Color values (hex / named colors) are design tokens, not copy.
              'color',
              // fetch/CopilotKit credential mode is a technical enum.
              'credentials',
              // aria-* is technical except aria-label, which is user-facing.
              'aria-(?!label).*',
            ],
          },
          callees: {
            exclude: [
              // Defaults provided by the plugin.
              'i18n(ext)?',
              't',
              'require',
              // react-hook-form field registration — the string is a field name.
              'register',
              '.*\\.register',
              'addEventListener',
              'removeEventListener',
              'postMessage',
              'getElementById',
              'dispatch',
              'commit',
              'includes',
              'indexOf',
              'endsWith',
              'startsWith',
              // Translation helpers used in this codebase.
              'i18n\\.t',
              'i18next\\.t',
              'getT',
              // Logging is never user-facing UI copy.
              'console.*',
              'Logger.*',
              // DOM APIs whose string arguments are technical identifiers.
              'setAttribute',
              'removeAttribute',
              'querySelector',
              'querySelectorAll',
              'classList\\..*',
              'window\\.open',
              // Network / cookie APIs with technical string args.
              'fetch',
              'useCookie',
              'getCookie',
              'setCookie',
              'mutate',
              'searchParams\\..*',
              // Analytics / event APIs with technical event names.
              'gtag',
              // Standard library / locale APIs with technical string args.
              'Intl\\..*',
              'countries\\.getName',
              // SWR cache keys / class-name helpers are technical identifiers.
              'useSWR(?:<.*>)?',
              'useSWRInfinite(?:<.*>)?',
              'cn',
              'clsx',
              'twMerge',
              'classNames',
            ],
          },
          words: {
            exclude: [
              // Defaults provided by the plugin.
              '[0-9!-/:-@[-`{-~]+',
              '[A-Z_-]+',
              i18nextHtmlEntities,
              /^\p{Emoji}+$/u,
              // Next.js directives and strict mode pragma.
              'use client',
              'use server',
              'use strict',
            ],
          },
        },
      ],
    },
  },
];

export default eslintConfig;
