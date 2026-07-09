/**
 * BATCH 5 — Bulgarian copy wiring for /bg/retreats/the-valley.
 * Run: node --test server/scripts/locationRetreatBatch5BgCopy.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const valleyBg = require('../../client/src/i18n/locales/bg/valley.json');
const valleyEn = require('../../client/src/i18n/locales/en/valley.json');
const bookingBg = require('../../client/src/i18n/locales/bg/booking.json');

const panelSource = fs.readFileSync(
  path.join(__dirname, '../../client/src/pages/retreats/the-valley/LocationRetreatQuotePanel.jsx'),
  'utf8'
);
const staysSource = fs.readFileSync(
  path.join(__dirname, '../../client/src/pages/retreats/the-valley/RetreatStaysSection.jsx'),
  'utf8'
);

const report = { results: {} };

function record(name, pass, detail) {
  report.results[name] = { pass, detail };
}

test.after(() => {
  console.log('\n=== BATCH 5 BG COPY REPORT ===');
  console.log(JSON.stringify(report, null, 2));
});

test('BG-01 retreat panel + edge-state keys exist and differ from EN', () => {
  const keys = [
    'retreat.quote.panelTitle',
    'retreat.quote.panelEyebrow',
    'retreat.stays.emptyHint',
    'retreat.quote.holdExpiredTitle',
    'retreat.quote.holdExpiredBody'
  ];

  for (const key of keys) {
    const parts = key.split('.');
    let bg = valleyBg;
    let en = valleyEn;
    for (const p of parts) {
      bg = bg[p];
      en = en[p];
    }
    assert.ok(bg && typeof bg === 'string', `missing bg: ${key}`);
    assert.notEqual(bg, en, `bg should differ from en for ${key}`);
  }

  assert.ok(bookingBg.cta?.checkAvailability);
  assert.ok(bookingBg.search?.unavailableForDates);

  record('bg_i18n_keys', true, {
    panelTitleBg: valleyBg.retreat.quote.panelTitle,
    emptyHintBg: valleyBg.retreat.stays.emptyHint,
    holdExpiredTitleBg: valleyBg.retreat.quote.holdExpiredTitle,
    unavailableBg: bookingBg.search.unavailableForDates
  });
});

test('BG-02 components reference valley retreat i18n keys (not hardcoded EN)', () => {
  assert.ok(panelSource.includes("tv('retreat.quote.holdExpiredTitle')"));
  assert.ok(panelSource.includes("tv('retreat.quote.holdExpiredBody')"));
  assert.ok(panelSource.includes("tb('search.unavailableForDates')"));
  assert.ok(staysSource.includes("t('retreat.stays.emptyHint')"));
  record('bg_component_wiring', true, 'LocationRetreatQuotePanel + RetreatStaysSection use i18n keys');
});

test('BG-03 simulated render strings for quote panel edge states', () => {
  const unavailableBanner = `${bookingBg.search.unavailableForDates}: ${valleyBg.retreat.stays.emptyHint}`;
  const holdExpired = `${valleyBg.retreat.quote.holdExpiredTitle} — ${valleyBg.retreat.quote.holdExpiredBody}`;

  assert.match(unavailableBanner, /Неналично|наличност/i);
  assert.match(holdExpired, /изтече/i);
  assert.match(valleyBg.retreat.quote.panelTitle, /Наличност/i);

  record('bg_simulated_render_copy', true, {
    panelTitle: valleyBg.retreat.quote.panelTitle,
    unavailableLine: bookingBg.search.unavailableForDates,
    holdExpiredPreview: holdExpired.slice(0, 120)
  });
});
