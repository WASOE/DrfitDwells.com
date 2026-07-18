/**
 * Guard against client/server legal acceptance copy drift.
 * Reads the client ESM module as text and asserts locale maps match.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE,
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION
} = require('../config/legalAcceptance');

function extractExportedStringLiteral(source, exportName) {
  const re = new RegExp(
    `export const ${exportName} = '([^']+)'`
  );
  const match = source.match(re);
  assert.ok(match, `Missing export ${exportName} in client legalAcceptance.js`);
  return match[1];
}

function extractLocaleCheckbox(source, locale, field) {
  // Match: locale: Object.freeze({ ... checkbox1: '...', ... })
  const localeBlockRe = new RegExp(
    `${locale}: Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`,
    'm'
  );
  const block = source.match(localeBlockRe);
  assert.ok(block, `Missing locale block ${locale}`);
  const fieldRe = new RegExp(`${field}:\\s*'((?:\\\\'|[^'])*)'`);
  const fieldMatch = block[1].match(fieldRe);
  assert.ok(fieldMatch, `Missing ${locale}.${field}`);
  return fieldMatch[1].replace(/\\'/g, "'");
}

describe('legalAcceptance client/server sync', () => {
  const clientPath = path.join(
    __dirname,
    '../../client/src/constants/legalAcceptance.js'
  );
  const clientSource = fs.readFileSync(clientPath, 'utf8');

  it('keeps version strings identical', () => {
    assert.equal(
      extractExportedStringLiteral(clientSource, 'LEGAL_ACCEPTANCE_TERMS_VERSION'),
      LEGAL_ACCEPTANCE_TERMS_VERSION
    );
    assert.equal(
      extractExportedStringLiteral(clientSource, 'LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION'),
      LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION
    );
  });

  it('keeps en/bg checkbox snapshots identical', () => {
    for (const locale of ['en', 'bg']) {
      for (const field of ['checkbox1', 'checkbox2', 'termsLinkLabel', 'cancellationLinkLabel']) {
        const clientValue = extractLocaleCheckbox(clientSource, locale, field);
        assert.equal(
          clientValue,
          LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE[locale][field],
          `${locale}.${field} drifted between client and server`
        );
      }
    }
  });
});
