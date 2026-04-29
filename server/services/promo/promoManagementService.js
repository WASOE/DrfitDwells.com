const PromoCode = require('../../models/PromoCode');

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

function normalizeUsageLimit(raw) {
  return raw != null && raw !== '' ? Math.max(0, Math.floor(Number(raw))) : null;
}

function normalizeMinSubtotal(raw) {
  return raw != null && raw !== '' ? Math.max(0, Number(raw)) : null;
}

function validatePercentCap(discountType, discountValue) {
  if (discountType === 'percent' && Number(discountValue) > 100) {
    const err = new Error('Percent discount cannot exceed 100');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }
}

async function listPromoCodes() {
  return PromoCode.find({}).sort({ createdAt: -1 }).lean();
}

async function createPromoCode(body = {}) {
  const {
    internalName,
    discountType,
    discountValue,
    isActive = true,
    validFrom,
    validUntil,
    startsAt,
    endsAt,
    usageLimit: usageLimitRaw,
    minSubtotal: minSubtotalRaw
  } = body;

  const code = normalizeCode(body.code);
  if (!code) {
    const err = new Error('Invalid code');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }

  validatePercentCap(discountType, discountValue);

  try {
    return await PromoCode.create({
      code,
      internalName: String(internalName).trim(),
      discountType,
      discountValue: Number(discountValue),
      isActive: !!isActive,
      validFrom: validFrom ? new Date(validFrom) : null,
      validUntil: validUntil ? new Date(validUntil) : null,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
      usageLimit: normalizeUsageLimit(usageLimitRaw),
      minSubtotal: normalizeMinSubtotal(minSubtotalRaw)
    });
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error('A promo code with this value already exists');
      err.code = 'DUPLICATE_CODE';
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

async function updatePromoCode(id, body = {}) {
  const doc = await PromoCode.findById(id);
  if (!doc) {
    const err = new Error('Promo code not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const {
    internalName,
    discountType,
    discountValue,
    isActive,
    validFrom,
    validUntil,
    startsAt,
    endsAt,
    usageLimit,
    minSubtotal
  } = body;

  if (body.code != null) {
    const code = normalizeCode(body.code);
    if (!code) {
      const err = new Error('Invalid code');
      err.code = 'VALIDATION';
      err.status = 400;
      throw err;
    }
    doc.code = code;
  }
  if (internalName != null) doc.internalName = String(internalName).trim();
  if (discountType != null) doc.discountType = discountType;
  if (discountValue != null) doc.discountValue = Number(discountValue);
  if (isActive != null) doc.isActive = !!isActive;
  if (validFrom !== undefined) doc.validFrom = validFrom ? new Date(validFrom) : null;
  if (validUntil !== undefined) doc.validUntil = validUntil ? new Date(validUntil) : null;
  if (startsAt !== undefined) doc.startsAt = startsAt ? new Date(startsAt) : null;
  if (endsAt !== undefined) doc.endsAt = endsAt ? new Date(endsAt) : null;
  if (usageLimit !== undefined) doc.usageLimit = normalizeUsageLimit(usageLimit);
  if (minSubtotal !== undefined) doc.minSubtotal = normalizeMinSubtotal(minSubtotal);

  validatePercentCap(doc.discountType, doc.discountValue);

  try {
    await doc.save();
    return doc;
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error('A promo code with this value already exists');
      err.code = 'DUPLICATE_CODE';
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

module.exports = {
  listPromoCodes,
  createPromoCode,
  updatePromoCode
};
