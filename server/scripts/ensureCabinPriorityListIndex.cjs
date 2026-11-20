#!/usr/bin/env node
'use strict';

/**
 * Guarded production index ensure for CabinPriorityList.
 * Refuses to create the unique index when duplicates exist. Never deletes rows.
 * Production disables automatic index creation, so this must be run explicitly.
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const CabinPriorityList = require('../models/CabinPriorityList');

const INDEX_NAME = 'cabin_priority_email_cabin_unique';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri);
  const collection = CabinPriorityList.collection;

  const duplicates = await collection.aggregate([
    { $group: { _id: { email: '$email', cabinId: '$cabinId' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'groups' }
  ]).toArray();
  if (duplicates.length) {
    throw new Error(`Refusing index: ${duplicates[0].groups} duplicate email+cabin group(s) exist`);
  }

  const indexes = await collection.indexes();
  const existing = indexes.find((idx) => idx.name === INDEX_NAME);
  if (existing) {
    const key = existing.key || {};
    if (key.email !== 1 || key.cabinId !== 1 || existing.unique !== true) {
      throw new Error(`Index ${INDEX_NAME} exists with unexpected definition`);
    }
    console.log(JSON.stringify({ status: 'already_present', name: INDEX_NAME, unique: true }));
    await mongoose.disconnect();
    return;
  }

  await collection.createIndex(
    { email: 1, cabinId: 1 },
    { unique: true, name: INDEX_NAME, background: true }
  );
  const after = await collection.indexes();
  const created = after.find((idx) => idx.name === INDEX_NAME);
  if (!created?.unique) throw new Error('Unique index creation could not be verified');
  console.log(JSON.stringify({ status: 'created', name: INDEX_NAME, unique: true }));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error?.message || error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
