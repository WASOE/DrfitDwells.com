/* eslint-env node */
/**
 * Hardcoded-string inventory config — run via `npm run lint:i18n`.
 *
 * Deliberately NOT merged into .eslintrc.cjs: the main `npm run lint` uses
 * --max-warnings 0 (required by PRODUCTION_CHECKLIST.md), so even a warning
 * there would hard-fail the checklist. This standalone config runs ONLY
 * i18next/no-literal-string (warning) to inventory untranslated JSX literals
 * (About page, gift voucher pages, inline ternaries) without inheriting the
 * base rules — pre-existing base-rule errors must not affect this report.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true }
  },
  // ops/admin are internal English-only back-office tools, never under /bg.
  ignorePatterns: ['dist', 'node_modules', 'src/pages/ops', 'src/pages/admin'],
  plugins: ['i18next'],
  rules: {
    'i18next/no-literal-string': [
      'warn',
      {
        mode: 'jsx-only',
        'jsx-attributes': {
          exclude: [
            'className',
            'styleName',
            'style',
            'type',
            'key',
            'id',
            'name',
            'width',
            'height',
            'size',
            'variant',
            'color',
            'fill',
            'stroke',
            'viewBox',
            'd',
            'points',
            'transform',
            'xmlns',
            'data-testid',
            'to',
            'href',
            'src',
            'srcSet',
            'sizes',
            'alt',
            'rel',
            'target',
            'loading',
            'decoding',
            'fetchpriority',
            'autoComplete',
            'inputMode',
            'role',
            'as',
            'method',
            'action',
            'lang',
            'dir',
            'value',
            'defaultValue',
            'maxLength',
            'aria-hidden'
          ]
        },
        // Punctuation, numbers, and short symbol-only literals are not copy.
        words: {
          exclude: ['[0-9!-/:-@[-`{-~]+', '[A-Z_-]+', '\\s*[•·–—:|/\\\\]\\s*']
        }
      }
    ]
  }
};
