const path = require('path');
const fs = require('fs');
const Cabin = require('../../models/Cabin');
const { requirePermission, ACTIONS } = require('../permissionService');
const { appendAuditEvent } = require('../auditWriter');
const { syncMultiUnitGalleryToCabinType } = require('../syncMultiUnitGalleryToCabinType');

const VALID_IMAGE_TAGS = [
  'bedroom',
  'living_room',
  'kitchen',
  'dining',
  'bathroom',
  'outdoor',
  'view',
  'hot_tub_sauna',
  'amenities',
  'floorplan',
  'map',
  'other'
];

async function uploadCabinImage({ cabinId, file }) {
  const cabin = await Cabin.findById(cabinId);
  if (!cabin) {
    const error = new Error('Cabin not found');
    error.status = 404;
    throw error;
  }
  if (!file) {
    const error = new Error('No file uploaded');
    error.status = 400;
    throw error;
  }

  const relPath = path.join('/uploads', 'cabins', cabinId, 'original', file.filename);
  const imageDoc = {
    url: relPath.replace(/\\/g, '/'),
    alt: '',
    sort: cabin.images?.length || 0,
    isCover: cabin.images.length === 0,
    width: 0,
    height: 0,
    bytes: file.size
  };
  cabin.images.push(imageDoc);

  if (imageDoc.isCover) {
    cabin.imageUrl = imageDoc.url;
  }

  await cabin.save();
  await syncMultiUnitGalleryToCabinType(cabin);
  return { image: imageDoc, images: cabin.images };
}

async function reorderCabinImages({ cabinId, rawBody }) {
  const order = Array.isArray(rawBody?.order)
    ? rawBody.order
    : Array.isArray(rawBody)
      ? rawBody
      : [];

  if (process.env.NODE_ENV !== 'production') {
    console.log('[admin] PATCH cabins/:id/images/reorder matched', { cabinId, orderItems: order.length });
  }

  const cabin = await Cabin.findById(cabinId);
  if (!cabin) {
    const error = new Error('Cabin not found');
    error.status = 404;
    throw error;
  }

  const sortMap = new Map(
    order.map((o) => [String(o.imageId), typeof o.sort === 'number' ? o.sort : Number(o.sort) || 0])
  );
  const spaceOrderMap = new Map(
    order.map((o) => {
      const so = o.spaceOrder;
      const n = typeof so === 'number' ? so : Number(so);
      return [String(o.imageId), Number.isFinite(n) ? n : undefined];
    })
  );

  cabin.images.forEach((i) => {
    const key = String(i._id);
    if (sortMap.has(key)) i.sort = sortMap.get(key);
    const so = spaceOrderMap.get(key);
    if (so !== undefined) i.spaceOrder = so;
  });

  await cabin.save();
  await syncMultiUnitGalleryToCabinType(cabin);
  return { images: cabin.images };
}

async function updateCabinImageMetadata({ cabinId, imageId, payload }) {
  const { alt, isCover, sort, tags, spaceOrder } = payload;
  const cabin = await Cabin.findById(cabinId);
  if (!cabin) {
    const error = new Error('Cabin not found');
    error.status = 404;
    throw error;
  }

  const img = cabin.images.find((i) => i._id === imageId);
  if (!img) {
    const error = new Error('Image not found');
    error.status = 404;
    throw error;
  }

  if (typeof alt === 'string') img.alt = alt;
  if (typeof sort === 'number') img.sort = sort;
  if (typeof spaceOrder === 'number') img.spaceOrder = spaceOrder;

  if (Array.isArray(tags)) {
    img.tags = tags.filter((tag) => VALID_IMAGE_TAGS.includes(tag));
  }

  if (typeof isCover === 'boolean') {
    cabin.images.forEach((i) => {
      i.isCover = false;
    });
    img.isCover = isCover;
    if (isCover) {
      cabin.imageUrl = img.url;
    }
  }

  await cabin.save();
  await syncMultiUnitGalleryToCabinType(cabin);
  return { images: cabin.images };
}

async function batchUpdateCabinImages({ cabinId, updates }) {
  const cabin = await Cabin.findById(cabinId);
  if (!cabin) {
    const error = new Error('Cabin not found');
    error.status = 404;
    throw error;
  }
  if (!Array.isArray(updates)) {
    const error = new Error('Updates must be an array');
    error.status = 400;
    throw error;
  }

  for (const update of updates) {
    const img = cabin.images.find((i) => i._id === update.imageId);
    if (!img) continue;

    if (Array.isArray(update.tags)) {
      img.tags = update.tags.filter((tag) => VALID_IMAGE_TAGS.includes(tag));
    }
    if (typeof update.spaceOrder === 'number') {
      img.spaceOrder = update.spaceOrder;
    }
    if (typeof update.alt === 'string') {
      img.alt = update.alt;
    }
    if (typeof update.isCover === 'boolean') {
      if (update.isCover) {
        cabin.images.forEach((i) => {
          i.isCover = false;
        });
        img.isCover = true;
        cabin.imageUrl = img.url;
      } else {
        img.isCover = false;
      }
    }
  }

  await cabin.save();
  await syncMultiUnitGalleryToCabinType(cabin);
  return { images: cabin.images };
}

async function deleteCabinImage({ cabinId, imageId, user, req, sourceRoute }) {
  const cabin = await Cabin.findById(cabinId);
  if (!cabin) {
    const error = new Error('Cabin not found');
    error.status = 404;
    throw error;
  }

  const idx = cabin.images.findIndex((i) => i._id === imageId);
  if (idx === -1) {
    const error = new Error('Image not found');
    error.status = 404;
    throw error;
  }

  requirePermission({
    role: user?.role,
    action: ACTIONS.CABIN_IMAGE_DELETE
  });

  const beforeCount = cabin.images.length;
  const removedImage = cabin.images[idx];
  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: user?.id || 'admin',
      entityType: 'Cabin',
      entityId: cabin._id.toString(),
      action: 'cabin_image_delete',
      beforeSnapshot: {
        imagesCount: beforeCount,
        imageId: String(imageId)
      },
      afterSnapshot: {
        imagesCount: beforeCount - 1,
        imageId: String(imageId)
      },
      metadata: {
        imageUrl: removedImage?.url || null
      },
      reason: 'image_delete',
      sourceContext: {
        route: sourceRoute || 'DELETE /api/admin/cabins/:id/images/:imageId'
      }
    },
    { req }
  );

  const [img] = cabin.images.splice(idx, 1);
  if (img?.url) {
    const abs = path.join(__dirname, '..', '..', '..', img.url.replace('/uploads', 'uploads'));
    fs.promises.unlink(abs).catch(() => {});
  }
  if (!cabin.images.some((i) => i.isCover) && cabin.images[0]) {
    cabin.images[0].isCover = true;
    cabin.imageUrl = cabin.images[0].url;
  }

  await cabin.save();
  await syncMultiUnitGalleryToCabinType(cabin);
  return { images: cabin.images };
}

module.exports = {
  uploadCabinImage,
  reorderCabinImages,
  updateCabinImageMetadata,
  batchUpdateCabinImages,
  deleteCabinImage
};
