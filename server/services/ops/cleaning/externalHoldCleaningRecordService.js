'use strict';

async function createOrGetExternalHoldCleaningRecord(CleaningRecord, insert) {
  try {
    return await CleaningRecord.create(insert);
  } catch (error) {
    if (error?.code !== 11000) throw error;

    const existing = await CleaningRecord.findOne({
      availabilityBlockId: insert.availabilityBlockId,
      cleaningDate: insert.cleaningDate
    });
    if (!existing) throw error;
    return existing;
  }
}

module.exports = { createOrGetExternalHoldCleaningRecord };
