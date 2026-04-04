const CabinType = require('../models/CabinType');

function isMultiUnitCabin(cabin) {
  const mode = cabin.inventoryMode || cabin.inventoryType || 'single';
  return mode === 'multi';
}

function resolveLinkedCabinTypeId(cabin) {
  if (!cabin) return null;
  return cabin.cabinTypeId || cabin.cabinTypeRef || null;
}

/**
 * Plain-object copies of embedded cabin images for assigning to CabinType.images.
 */
function cloneImagesForCabinType(images) {
  if (!Array.isArray(images)) return [];
  return images.map((img) => {
    const o = img && typeof img.toObject === 'function' ? img.toObject() : { ...(img || {}) };
    return {
      _id: o._id,
      url: o.url,
      alt: typeof o.alt === 'string' ? o.alt : '',
      sort: typeof o.sort === 'number' ? o.sort : 0,
      isCover: Boolean(o.isCover),
      width: typeof o.width === 'number' ? o.width : 0,
      height: typeof o.height === 'number' ? o.height : 0,
      bytes: typeof o.bytes === 'number' ? o.bytes : 0,
      createdAt: o.createdAt,
      tags: Array.isArray(o.tags) ? [...o.tags] : [],
      spaceOrder: typeof o.spaceOrder === 'number' ? o.spaceOrder : 0
    };
  });
}

function deriveImageUrl(images, cabinImageUrl) {
  const arr = Array.isArray(images) ? images : [];
  const cover = arr.find((i) => i && i.isCover) || arr[0];
  if (cover && cover.url) return cover.url;
  if (typeof cabinImageUrl === 'string' && cabinImageUrl.trim()) return cabinImageUrl.trim();
  return '';
}

/**
 * Guest search and public cabin-type pages read CabinType; admin image routes write Cabin.
 * For linked multi-unit cabins, mirror the cabin gallery after every mutation.
 */
async function syncMultiUnitGalleryToCabinType(cabin) {
  if (!cabin || !isMultiUnitCabin(cabin)) return;
  const typeId = resolveLinkedCabinTypeId(cabin);
  if (!typeId) return;

  const cabinType = await CabinType.findById(typeId);
  if (!cabinType) return;

  const cloned = cloneImagesForCabinType(cabin.images);
  cabinType.images = cloned;
  const nextUrl = deriveImageUrl(cloned, cabin.imageUrl);
  if (nextUrl) {
    cabinType.imageUrl = nextUrl;
  }

  await cabinType.save();
}

module.exports = { syncMultiUnitGalleryToCabinType };
