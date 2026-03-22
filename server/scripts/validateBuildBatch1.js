require('dotenv').config();

const connectDB = require('../config/database');
const AuditEvent = require('../models/AuditEvent');
const ChannelSyncEvent = require('../models/ChannelSyncEvent');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const { runAvailabilityBackfillDryRun } = require('../services/availabilityBackfillService');
const { normalizeExclusiveDateRange } = require('../utils/dateTime');
const { assertScriptWriteAllowedForMongoUri } = require('../utils/scriptProductionGuard');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');

async function main() {
  const conn = await connectDB();
  if (!conn) {
    throw new Error('Database connection unavailable');
  }
  assertScriptWriteAllowedForMongoUri(process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI);

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  normalizeExclusiveDateRange(now, tomorrow);

  const audit = await AuditEvent.create({
    actorType: 'system',
    actorId: null,
    entityType: 'BuildValidation',
    entityId: 'batch1',
    action: 'audit_append_validation',
    metadata: { marker: true }
  });

  let immutableAudit = false;
  try {
    await AuditEvent.updateOne({ _id: audit._id }, { $set: { action: 'changed' } });
  } catch (err) {
    immutableAudit = true;
  }

  const syncEvent = await ChannelSyncEvent.create({
    cabinId: '000000000000000000000001',
    channel: 'airbnb_ical',
    outcome: 'warning',
    message: 'batch1 validation'
  });

  let immutableSync = false;
  try {
    await ChannelSyncEvent.updateOne({ _id: syncEvent._id }, { $set: { outcome: 'success' } });
  } catch (err) {
    immutableSync = true;
  }

  const dryRun = await runAvailabilityBackfillDryRun();

  const result = {
    auditAppendCreated: Boolean(audit?._id),
    auditImmutable: immutableAudit,
    syncAppendCreated: Boolean(syncEvent?._id),
    syncImmutable: immutableSync,
    availabilityBlockTypesSupported: AvailabilityBlock.BLOCK_TYPES || ['reservation', 'manual_block', 'maintenance', 'external_hold'],
    availabilityDryRunSummary: dryRun.summary
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
