'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeContentLocale,
  localizeCabinContent,
  LOCALIZED_CABIN_TEXT_FIELDS
} = require('../utils/cabinLocalization');
const { sanitizeCabinPayload } = require('../services/cabins/cabinManagementService');

test('normalizeContentLocale', () => {
  assert.equal(normalizeContentLocale('bg'), 'bg');
  assert.equal(normalizeContentLocale(' BG '), 'bg');
  assert.equal(normalizeContentLocale('en'), 'en');
  assert.equal(normalizeContentLocale(undefined), 'en');
  assert.equal(normalizeContentLocale(null), 'en');
  assert.equal(normalizeContentLocale('de'), 'en');
  assert.equal(normalizeContentLocale(''), 'en');
});

const baseCabin = () => ({
  name: 'Lux Cabin',
  location: 'Chereshovo / Ortsevo, Rhodope Mountains, Bulgaria',
  description: 'A fully private off-grid cabin.',
  pricePerNight: 85,
  i18n: {
    bg: {
      name: 'Лукс къща',
      location: 'Черешово / Орцево, Родопите, България',
      description: 'Напълно самостоятелна офгрид къща.'
    }
  }
});

test('localizeCabinContent returns base fields for en locale', () => {
  const result = localizeCabinContent(baseCabin(), 'en');
  assert.equal(result.name, 'Lux Cabin');
  assert.equal(result.location, 'Chereshovo / Ortsevo, Rhodope Mountains, Bulgaria');
  assert.equal(result.description, 'A fully private off-grid cabin.');
});

test('localizeCabinContent overlays all bg translations for bg locale', () => {
  const result = localizeCabinContent(baseCabin(), 'bg');
  assert.equal(result.name, 'Лукс къща');
  assert.equal(result.location, 'Черешово / Орцево, Родопите, България');
  assert.equal(result.description, 'Напълно самостоятелна офгрид къща.');
  // Non-localized fields untouched
  assert.equal(result.pricePerNight, 85);
});

test('localizeCabinContent falls back per-field when translation missing or empty', () => {
  const cabin = baseCabin();
  cabin.i18n.bg.location = '   ';
  delete cabin.i18n.bg.description;
  const result = localizeCabinContent(cabin, 'bg');
  assert.equal(result.name, 'Лукс къща');
  assert.equal(result.location, 'Chereshovo / Ortsevo, Rhodope Mountains, Bulgaria');
  assert.equal(result.description, 'A fully private off-grid cabin.');
});

test('localizeCabinContent falls back entirely when no i18n exists (legacy documents)', () => {
  const cabin = baseCabin();
  delete cabin.i18n;
  const result = localizeCabinContent(cabin, 'bg');
  for (const field of LOCALIZED_CABIN_TEXT_FIELDS) {
    assert.equal(result[field], baseCabin()[field]);
  }
});

test('localizeCabinContent does not mutate the source object', () => {
  const cabin = baseCabin();
  localizeCabinContent(cabin, 'bg');
  assert.equal(cabin.name, 'Lux Cabin');
});

test('localizeCabinContent converts mongoose-like documents via toObject', () => {
  const plain = baseCabin();
  const docLike = { toObject: () => plain };
  const result = localizeCabinContent(docLike, 'bg');
  assert.equal(result.name, 'Лукс къща');
  const enResult = localizeCabinContent(docLike, 'en');
  assert.equal(enResult.name, 'Lux Cabin');
});

test('localizeCabinContent passes through null/undefined', () => {
  assert.equal(localizeCabinContent(null, 'bg'), null);
  assert.equal(localizeCabinContent(undefined, 'bg'), undefined);
});

test('sanitizeCabinPayload accepts and trims i18n.bg fields', () => {
  const { sanitized, errors } = sanitizeCabinPayload(
    { i18n: { bg: { name: '  А-фрейм ', location: ' Родопите ', description: ' Текст ' } } },
    { isUpdate: true }
  );
  assert.equal(errors.length, 0);
  assert.deepEqual(sanitized.i18n, {
    bg: { name: 'А-фрейм', location: 'Родопите', description: 'Текст' }
  });
});

test('sanitizeCabinPayload allows clearing translations with empty strings', () => {
  const { sanitized, errors } = sanitizeCabinPayload(
    { i18n: { bg: { name: '', location: '', description: '' } } },
    { isUpdate: true }
  );
  assert.equal(errors.length, 0);
  assert.deepEqual(sanitized.i18n, { bg: { name: '', location: '', description: '' } });
});

test('sanitizeCabinPayload rejects non-object and non-string i18n payloads', () => {
  const bad1 = sanitizeCabinPayload({ i18n: 'nope' }, { isUpdate: true });
  assert.equal(bad1.errors.some((e) => e.field === 'i18n'), true);

  const bad2 = sanitizeCabinPayload({ i18n: { bg: [] } }, { isUpdate: true });
  assert.equal(bad2.errors.some((e) => e.field === 'i18n'), true);

  const bad3 = sanitizeCabinPayload({ i18n: { bg: { name: 42 } } }, { isUpdate: true });
  assert.equal(bad3.errors.some((e) => e.field === 'i18n'), true);
});
