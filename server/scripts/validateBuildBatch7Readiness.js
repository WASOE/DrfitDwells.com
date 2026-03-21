/* eslint-disable no-console */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');

const { computeOpsReadiness } = require('../services/ops/readiness/opsReadinessService');
const { MODULE_VERDICTS, OVERLAP_STATUSES } = require('../config/opsReadinessConfig');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  try {
    const readiness = await computeOpsReadiness();
    assert(readiness?.readinessByModule, 'missing readinessByModule');

    const requiredModules = ['dashboard', 'calendar', 'reservations', 'payments_payouts', 'sync_center', 'cabins', 'reviews_communications'];
    for (const m of requiredModules) {
      assert(readiness.readinessByModule[m], `missing module readiness: ${m}`);
    }

    const allowedVerdicts = Object.values(MODULE_VERDICTS);
    const allowedOverlap = Object.values(OVERLAP_STATUSES);

    for (const m of requiredModules) {
      const mod = readiness.readinessByModule[m];
      assert(allowedVerdicts.includes(mod?.readiness?.verdict), `invalid verdict for ${m}`);
      assert(allowedOverlap.includes(mod?.readiness?.overlapStatus), `invalid overlap status for ${m}`);

      const critical = mod?.parity?.criticalMismatchCount || 0;
      if (critical > 0) {
        assert(mod.readiness.verdict === MODULE_VERDICTS.not_ready, `critical mismatches must yield not_ready for ${m}`);
        assert(mod.readiness.overlapStatus === OVERLAP_STATUSES.read_only, `critical mismatches must yield read_only for ${m}`);
      }
    }

    assert(typeof readiness.computedAt === 'string', 'missing computedAt');
    assert(readiness.qaSmoke && typeof readiness.qaSmoke === 'object', 'missing qaSmoke');

    console.log(JSON.stringify({ success: true, batch: 'build-batch-7', computedAt: readiness.computedAt }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, batch: 'build-batch-7', error: error.message }, null, 2));
  process.exit(1);
});

