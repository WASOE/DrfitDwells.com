'use strict';

const mongoose = require('mongoose');
const OpsPushSubscription = require('../../../models/OpsPushSubscription');

function emptyPushHealth() {
  return {
    activeCount: 0,
    invalidatedCount: 0,
    lastSuccessAt: null,
    latestUserAgent: null
  };
}

async function getPushHealthMapForUserIds(opsUserIds = []) {
  const ids = (opsUserIds || [])
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  const map = new Map();
  for (const id of ids) {
    map.set(String(id), emptyPushHealth());
  }
  if (ids.length === 0) {
    return map;
  }

  const rows = await OpsPushSubscription.aggregate([
    { $match: { opsUserId: { $in: ids } } },
    { $sort: { lastSuccessAt: -1, updatedAt: -1 } },
    {
      $group: {
        _id: '$opsUserId',
        activeCount: {
          $sum: {
            $cond: [{ $ifNull: ['$invalidatedAt', false] }, 0, 1]
          }
        },
        invalidatedCount: {
          $sum: {
            $cond: [{ $ifNull: ['$invalidatedAt', false] }, 1, 0]
          }
        },
        lastSuccessAt: { $max: '$lastSuccessAt' },
        latestUserAgent: { $first: '$userAgent' }
      }
    }
  ]);

  for (const row of rows) {
    map.set(String(row._id), {
      activeCount: row.activeCount || 0,
      invalidatedCount: row.invalidatedCount || 0,
      lastSuccessAt: row.lastSuccessAt ?? null,
      latestUserAgent: row.latestUserAgent ?? null
    });
  }

  return map;
}

module.exports = {
  emptyPushHealth,
  getPushHealthMapForUserIds
};
