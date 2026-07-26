'use strict';

const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const { isAllowedPropertyKind } = require('./propertyKindJoin');

async function getInsightsFilterOptions({ propertyKind }) {
  if (!isAllowedPropertyKind(propertyKind)) {
    const error = new Error('propertyKind must be cabin or valley');
    error.statusCode = 400;
    throw error;
  }

  const archivedClause = { $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] };

  const [cabins, cabinTypes] = await Promise.all([
    Cabin.find({ ...archivedClause, propertyKind })
      .select('_id name')
      .sort({ name: 1 })
      .lean(),
    CabinType.find({ isActive: { $ne: false }, propertyKind })
      .select('_id name')
      .sort({ name: 1 })
      .lean()
  ]);

  const typeIds = cabinTypes.map((ct) => ct._id);
  const units =
    typeIds.length === 0
      ? []
      : await Unit.find({ cabinTypeId: { $in: typeIds }, isActive: { $ne: false } })
          .select('_id name unitNumber cabinTypeId')
          .sort({ unitNumber: 1, name: 1 })
          .lean();

  return {
    propertyKind,
    cabins: cabins.map((c) => ({ id: String(c._id), name: c.name || String(c._id) })),
    cabinTypes: cabinTypes.map((ct) => ({
      id: String(ct._id),
      name: ct.name || String(ct._id)
    })),
    units: units.map((u) => ({
      id: String(u._id),
      cabinTypeId: String(u.cabinTypeId),
      name: u.name || (u.unitNumber != null ? `Unit ${u.unitNumber}` : String(u._id))
    }))
  };
}

module.exports = {
  getInsightsFilterOptions
};
