#!/usr/bin/env node
'use strict';

const { loadServerEnv } = require('../config/loadServerEnv');
loadServerEnv();
const mongoose = require('mongoose');
const Lead = require('../models/CorporateGiftLead');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI or MONGO_URI is required');
  await mongoose.connect(uri, { autoIndex: false });
  try {
    if (!process.argv.includes('--apply')) {
      console.log('Read-only preflight: use --apply to create the corporate gift lead indexes.');
      const collections = await mongoose.connection.db.listCollections({ name: Lead.collection.name }).toArray();
      console.log(collections.length ? await Lead.collection.indexes() : 'Collection does not exist yet.');
      return;
    }
    await Lead.createCollection();
    await Lead.createIndexes();
    console.log('Corporate gift lead indexes created or verified.');
  } finally {
    await mongoose.disconnect();
  }
}
main().catch((error) => { console.error('[corporate-gift-lead-indexes]', error.message); process.exitCode = 1; });
