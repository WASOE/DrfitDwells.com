const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const { findParentCabinForCabinType } = require('../../publicAvailabilityService');

async function resolveAccommodationIdentity(id) {
  const cabin = await Cabin.findById(id).lean();
  if (cabin && cabin.inventoryType !== 'multi') {
    return { cabin, cabinType: null, parentCabin: cabin };
  }
  const typeId = cabin ? cabin.cabinTypeId || cabin.cabinTypeRef : id;
  if (!typeId) throw new Error('Multi-unit accommodation has no canonical cabin type');
  const cabinType = await CabinType.findById(typeId).lean();
  if (cabin && !cabinType) throw new Error('Multi-unit accommodation cabin type was not found');
  const parentCabin = cabin || (cabinType ? await findParentCabinForCabinType(cabinType._id) : null);
  return { cabin, cabinType, parentCabin };
}

module.exports = { resolveAccommodationIdentity };
