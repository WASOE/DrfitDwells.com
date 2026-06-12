#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Cabin Bulgarian content completeness check — read-only.
 *
 * Queries GET /api/availability (the same endpoint that powers /search and
 * /bg/search) and asserts that every listing it returns carries non-empty
 * `i18n.bg.{name,location,description}`. Per-field English fallback remains
 * the runtime safety net, but no live listing should rely on it silently —
 * this check is how we notice.
 *
 * Usage:
 *   node scripts/checkCabinI18nCompleteness.cjs                 # http://localhost:5000
 *   node scripts/checkCabinI18nCompleteness.cjs --url https://driftdwells.com
 *
 * Exit codes: 0 = complete, 1 = missing translations, 2 = request failed.
 */
'use strict';

const REQUIRED_FIELDS = ['name', 'location', 'description'];

const parseBaseUrl = () => {
  const idx = process.argv.indexOf('--url');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1].replace(/\/+$/, '');
  return process.env.CHECK_BASE_URL || 'http://localhost:5000';
};

const futureDateOnly = (daysFromToday) => {
  const d = new Date(Date.now() + daysFromToday * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

const main = async () => {
  const baseUrl = parseBaseUrl();
  const query = new URLSearchParams({
    checkIn: futureDateOnly(30),
    checkOut: futureDateOnly(32),
    adults: '2',
    children: '0'
  });
  const url = `${baseUrl}/api/availability?${query}`;

  console.log(`[i18n-check] GET ${url}`);
  let body;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (error) {
    console.error(`[i18n-check] Request failed: ${error.message}`);
    process.exit(2);
  }

  const cabins = body?.data?.cabins;
  if (!Array.isArray(cabins) || cabins.length === 0) {
    console.error('[i18n-check] No cabins returned — cannot verify.');
    process.exit(2);
  }

  const incomplete = [];
  for (const cabin of cabins) {
    const bg = cabin?.i18n?.bg || {};
    const missing = REQUIRED_FIELDS.filter(
      (field) => !(typeof bg[field] === 'string' && bg[field].trim())
    );
    if (missing.length > 0) {
      incomplete.push({ name: cabin.name, id: cabin._id, missing });
    }
  }

  console.log(`[i18n-check] Listings checked: ${cabins.length}`);
  if (incomplete.length === 0) {
    console.log('[i18n-check] OK — every live listing has Bulgarian name, location and description.');
    process.exit(0);
  }

  console.error(`[i18n-check] FAIL — ${incomplete.length} listing(s) missing Bulgarian content:`);
  for (const item of incomplete) {
    console.error(`  - ${item.name} (${item.id}): missing bg.{${item.missing.join(', ')}}`);
  }
  console.error('[i18n-check] Run scripts/backfillCabinI18nBg.cjs or fill the BG fields in Ops → Cabins → Edit content.');
  process.exit(1);
};

main();
