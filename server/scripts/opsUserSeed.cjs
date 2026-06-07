#!/usr/bin/env node
/**
 * Seed a cleaner OpsUser for local/staging bootstrap.
 *
 * Usage:
 *   node server/scripts/opsUserSeed.cjs
 *
 * Optional env:
 *   OPS_CLEANER_SEED_EMAIL=cleaner@example.com
 *   OPS_CLEANER_SEED_PASSWORD='change-me-8+'
 *   OPS_CLEANER_SEED_NAME='Cleaning Team'
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const OpsUser = require('../models/OpsUser');
const { createOpsUser } = require('../services/ops/opsUserService');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(1);
  }

  const email = process.env.OPS_CLEANER_SEED_EMAIL || 'cleaner@driftdwells.local';
  const password = process.env.OPS_CLEANER_SEED_PASSWORD || 'cleaner-change-me';
  const name = process.env.OPS_CLEANER_SEED_NAME || 'Cleaning Team';

  await mongoose.connect(uri);
  try {
    const existing = await OpsUser.findOne({ email: email.toLowerCase() }).lean();
    if (existing) {
      console.log(`OpsUser already exists for ${email} (role=${existing.role}). Skipping create.`);
      return;
    }

    const user = await createOpsUser({
      email,
      name,
      password,
      role: 'cleaner'
    });

    console.log('Created cleaner OpsUser:');
    console.log(JSON.stringify({ id: user.id, email: user.email, role: user.role, modules: user.modules }, null, 2));
    console.log('Login at /login using the seeded email as username.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
