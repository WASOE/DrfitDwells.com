#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Cabin content Bulgarian translation backfill — controlled, idempotent.
 *
 * Sets `i18n.bg.{name,location,description}` on the three live listings
 * (A-Frame cabin type, Stone House, Lux Cabin). Existing non-empty
 * translations are preserved unless --force is passed.
 *
 * Modes:
 *   Dry-run (default — NO WRITES):
 *     node scripts/backfillCabinI18nBg.cjs
 *
 *   Apply (explicit):
 *     node scripts/backfillCabinI18nBg.cjs --apply [--force]
 *
 * Production apply additionally requires:
 *   ALLOW_PRODUCTION_CABIN_I18N_BACKFILL=1
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');

const BG_LOCATION = 'Черешово / Орцево, Родопите, България';

const TRANSLATIONS = Object.freeze([
  {
    model: 'CabinType',
    match: { slug: 'a-frame' },
    bg: {
      name: 'А-фрейм',
      location: BG_LOCATION,
      description:
        'Офгрид А-фрейм къщички в скрита планинска долина под Орцево — най-високото обитаемо село на Балканите. Създадени за тихи престои, потапяне в природата и изключване от ежедневието. Семпли, топли и уединени, с общи съоръжения в сърцето на долината.'
    }
  },
  {
    model: 'Cabin',
    match: { name: 'Stone House' },
    bg: {
      name: 'Каменна къща',
      location: BG_LOCATION,
      description:
        'Реставрирана 400-годишна каменна къща в центъра на долината, заобиколена от гора, вода и открити поляни. Разполага с панорамен балкон на 360 градуса, обща кухня, външни бани и общи пространства за групи, семейства или ритрийти.'
    }
  },
  {
    model: 'Cabin',
    match: { name: 'Lux Cabin' },
    bg: {
      name: 'Лукс къща',
      location: BG_LOCATION,
      description:
        'Напълно самостоятелна офгрид къща със собствена кухня, баня и панорамни прозорци от пода до тавана с изглед към гората и потока. Създадена за двойки, които търсят истински комфорт сред природата — просторна, топла и изцяло независима, с течаща вода непосредствено до къщата.'
    }
  }
]);

const MODELS = { Cabin, CabinType };
const FIELDS = ['name', 'location', 'description'];

const main = async () => {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  if (
    apply &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PRODUCTION_CABIN_I18N_BACKFILL !== '1'
  ) {
    console.error(
      '[i18n-backfill] Refused: NODE_ENV=production. Set ALLOW_PRODUCTION_CABIN_I18N_BACKFILL=1 to apply intentionally.'
    );
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/drift-dwells-booking');
  console.log(`[i18n-backfill] Connected. Mode: ${apply ? 'APPLY' : 'DRY-RUN (no writes)'}${force ? ' + force' : ''}`);

  let changed = 0;
  for (const entry of TRANSLATIONS) {
    const Model = MODELS[entry.model];
    const doc = await Model.findOne(entry.match);
    const label = `${entry.model} ${JSON.stringify(entry.match)}`;

    if (!doc) {
      console.warn(`[i18n-backfill] SKIP (not found): ${label}`);
      continue;
    }

    const currentBg = (doc.i18n && doc.i18n.bg) || {};
    const nextBg = { ...((doc.i18n && doc.i18n.bg) || {}) };
    const updates = [];
    for (const field of FIELDS) {
      const existing = typeof currentBg[field] === 'string' ? currentBg[field].trim() : '';
      if (existing && !force) continue;
      if (existing === entry.bg[field]) continue;
      nextBg[field] = entry.bg[field];
      updates.push(field);
    }

    if (updates.length === 0) {
      console.log(`[i18n-backfill] OK (already translated): ${label}`);
      continue;
    }

    console.log(`[i18n-backfill] ${apply ? 'UPDATE' : 'WOULD UPDATE'}: ${label} → bg.{${updates.join(', ')}}`);
    if (apply) {
      doc.i18n = { ...(doc.i18n || {}), bg: nextBg };
      await doc.save();
      changed += 1;
    }
  }

  console.log(`[i18n-backfill] Done. Documents ${apply ? 'updated' : 'that would be updated'}: ${apply ? changed : 'see above'}`);
  await mongoose.disconnect();
};

main().catch((error) => {
  console.error('[i18n-backfill] Failed:', error);
  process.exit(1);
});
