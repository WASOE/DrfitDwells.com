/**
 * Bulgarian copy wiring for /bg/retreats/the-valley (retreat redesign).
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
const heroSource = fs.readFileSync(
  path.join(__dirname, '../../client/src/pages/retreats/the-valley/RetreatHeroSection.jsx'),
  'utf8'
);
const pageSource = fs.readFileSync(
  path.join(__dirname, '../../client/src/pages/retreats/the-valley/TheValleyRetreatPage.jsx'),
  'utf8'
);

const report = { results: {} };

function record(name, pass, detail) {
  report.results[name] = { pass, detail };
}

function getNested(obj, keyPath) {
  return keyPath.split('.').reduce((acc, part) => acc?.[part], obj);
}

test.after(() => {
  console.log('\n=== RETREAT BG COPY REPORT ===');
  console.log(JSON.stringify(report, null, 2));
});

test('BG-01 hero, stays, and panel keys exist in BG and differ from EN', () => {
  const keys = [
    'retreat.hero.title',
    'retreat.hero.capacity',
    'retreat.hero.fromPrice',
    'retreat.stays.confirmNote',
    'retreat.stays.loadError',
    'retreat.quote.panelTitle',
    'retreat.quote.panelIntro',
    'retreat.quote.holdExpiredTitle',
    'retreat.quote.holdExpiredBody'
  ];

  for (const key of keys) {
    const bg = getNested(valleyBg, key);
    const en = getNested(valleyEn, key);
    assert.ok(bg && typeof bg === 'string', `missing bg: ${key}`);
    assert.notEqual(bg, en, `bg should differ from en for ${key}`);
  }

  assert.ok(bookingBg.cta?.checkAvailability);
  assert.ok(bookingBg.search?.unavailableForDates);

  record('bg_i18n_keys', true, {
    heroTitleBg: valleyBg.retreat.hero.title,
    heroCapacityBg: valleyBg.retreat.hero.capacity,
    heroFromPriceBg: valleyBg.retreat.hero.fromPrice,
    panelTitleBg: valleyBg.retreat.quote.panelTitle
  });
});

test('BG-02 components use retreat i18n keys and inventory-on-load wiring', () => {
  assert.ok(panelSource.includes("tv('retreat.quote.holdExpiredTitle')"));
  assert.ok(panelSource.includes("tv('retreat.quote.holdExpiredBody')"));
  assert.ok(panelSource.includes("tb('search.unavailableForDates')"));
  assert.ok(staysSource.includes("t('retreat.stays.loadError')"));
  assert.ok(heroSource.includes("t('retreat.hero.capacity'"));
  assert.ok(heroSource.includes("t('retreat.hero.fromPrice'"));
  assert.ok(pageSource.includes('locationInventoryAPI.getInventory'));
  record('bg_component_wiring', true, 'Retreat hero/stays/page use i18n + inventory API');
});

test('BG-03 simulated render strings for hero and panel edge states', () => {
  const heroCapacity = valleyBg.retreat.hero.capacity
    .replace('{{sleeps}}', '12')
    .replace('{{buildings}}', '4');
  const heroFromPrice = valleyBg.retreat.hero.fromPrice
    .replace('{{nightly}}', '385')
    .replace('{{nights}}', '2');
  const holdExpired = `${valleyBg.retreat.quote.holdExpiredTitle} — ${valleyBg.retreat.quote.holdExpiredBody}`;

  assert.match(heroCapacity, /12/);
  assert.match(heroCapacity, /4/);
  assert.match(heroFromPrice, /385/);
  assert.match(heroFromPrice, /2/);
  assert.match(heroFromPrice, /нощувка/i);
  assert.match(holdExpired, /изтече/i);
  assert.match(valleyBg.retreat.quote.panelTitle, /Наличност/i);

  record('bg_simulated_render_copy', true, {
    heroCapacity,
    heroFromPrice,
    panelTitle: valleyBg.retreat.quote.panelTitle,
    holdExpiredPreview: holdExpired.slice(0, 120)
  });
});
