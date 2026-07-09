const mongoose = require('mongoose');

const PROBE_COLLECTION = '__mongo_txn_probe';

async function canUseMongoTransactions() {
  let session;
  try {
    session = await mongoose.startSession();
    const probe = mongoose.connection.collection(PROBE_COLLECTION);
    await session.withTransaction(async () => {
      await probe.insertOne({ probe: true, at: new Date() }, { session });
    });
    await probe.deleteMany({ probe: true });
    return true;
  } catch (err) {
    if (err?.code === 20 || /replica set|mongos/i.test(String(err?.message || ''))) {
      return false;
    }
    return false;
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

module.exports = {
  canUseMongoTransactions
};
