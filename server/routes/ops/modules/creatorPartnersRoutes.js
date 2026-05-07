const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { validateId } = require('../../../middleware/validateId');
const PromoCode = require('../../../models/PromoCode');
const CreatorPartner = require('../../../models/CreatorPartner');
const {
  buildAllCreatorPartnerStats,
  buildSingleCreatorPartnerStats,
  listCreatorPartnerAttributedBookings
} = require('../../../services/ops/creatorPartnerStatsService');
const {
  recalculateCreatorCommissionForPartner,
  listCreatorCommissionForPartner
} = require('../../../services/ops/creatorCommissionLedgerService');
const {
  normalizePartnerKey,
  PARTNER_KEY_RE,
  applyReferralCodeNormalization,
  REFERRAL_CODE_RE
} = require('../../../models/CreatorPartner');

const router = express.Router();

function getOpsIdentity(req) {
  return process.env.ADMIN_EMAIL || req.user?.email || 'admin';
}

function sanitizePromoCode(raw) {
  if (raw == null) return null;
  const code = String(raw).trim().toUpperCase();
  return code || null;
}

function escapeRegex(raw) {
  return String(raw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCreatorPartner(doc) {
  return {
    _id: String(doc._id),
    name: doc.name,
    slug: doc.slug,
    status: doc.status,
    contact: doc.contact || {},
    profiles: doc.profiles || {},
    referral: doc.referral || {},
    promo: doc.promo || {},
    commission: doc.commission || {},
    contentAgreement: doc.contentAgreement || {},
    notes: doc.notes || null,
    createdBy: doc.createdBy || null,
    updatedBy: doc.updatedBy || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

async function resolvePromoLink(promoCodeRaw) {
  const promoCode = sanitizePromoCode(promoCodeRaw);
  if (!promoCode) {
    return {
      promo: { code: null, promoCodeId: null },
      warnings: []
    };
  }

  const promoDoc = await PromoCode.findOne({ code: promoCode }).select('_id code').lean();
  if (!promoDoc) {
    return {
      promo: { code: promoCode, promoCodeId: null },
      warnings: [{ code: 'PROMO_CODE_NOT_FOUND', message: `Promo code ${promoCode} does not exist yet.` }]
    };
  }

  return {
    promo: { code: promoCode, promoCodeId: promoDoc._id },
    warnings: []
  };
}

function validatePartnerKeyField(value, fieldLabel) {
  const normalized = normalizePartnerKey(value);
  if (!normalized || !PARTNER_KEY_RE.test(normalized)) {
    throw new Error(`${fieldLabel} must contain only a-z, 0-9, - or _ and be max 80 chars`);
  }
  return true;
}

function validateReferralCodeField(value, fieldLabel) {
  const normalized = applyReferralCodeNormalization(value);
  if (!normalized || !REFERRAL_CODE_RE.test(normalized)) {
    throw new Error(
      `${fieldLabel} must be Instagram-style: a-z, 0-9, ., -, _ (max 80 chars); optional leading @ is removed`
    );
  }
  return true;
}

function formatCreatorPartnerStats(stats) {
  return {
    visits: Number(stats?.visits || 0),
    uniqueVisitors: Number(stats?.uniqueVisitors || 0),
    lastVisitAt: stats?.lastVisitAt || null,
    attributedBookings: Number(stats?.attributedBookings || 0),
    paidConfirmedBookings: Number(stats?.paidConfirmedBookings || 0),
    cancelledRefundedVoidBookings: Number(stats?.cancelledRefundedVoidBookings || 0),
    grossBookingRevenue: Number(stats?.grossBookingRevenue || 0),
    commissionableRevenueEstimate: Number(stats?.commissionableRevenueEstimate || 0),
    giftVoucherPurchases: Number(stats?.giftVoucherPurchases || 0),
    giftVoucherRevenueCents: Number(stats?.giftVoucherRevenueCents || 0),
    giftVoucherCommissionCents: Number(stats?.giftVoucherCommissionCents || 0),
    stayBookingRevenueCents: Number(stats?.stayBookingRevenueCents || 0),
    stayBookingCommissionCents: Number(stats?.stayBookingCommissionCents || 0),
    totalCommissionCents: Number(stats?.totalCommissionCents || 0),
    lastBookingAt: stats?.lastBookingAt || null,
    conversionRate: Number(stats?.conversionRate || 0)
  };
}

router.get(
  '/',
  [
    query('status').optional().isIn(['draft', 'active', 'paused', 'archived']),
    query('search').optional().isString().isLength({ max: 120 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { status, search } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (search && String(search).trim()) {
        const q = new RegExp(escapeRegex(String(search).trim()), 'i');
        filter.$or = [
          { name: q },
          { slug: q },
          { 'referral.code': q },
          { 'promo.code': q },
          { 'contact.email': q }
        ];
      }

      const items = await CreatorPartner.find(filter).sort({ createdAt: -1 }).lean();
      return res.json({ success: true, data: { creatorPartners: items.map(formatCreatorPartner) } });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Unable to list creator partners' });
    }
  }
);

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 1, max: 200 }).withMessage('name is required'),
    body('slug').custom((v) => validatePartnerKeyField(v, 'slug')),
    body('status').optional().isIn(['draft', 'active', 'paused', 'archived']),
    body('referral').isObject().withMessage('referral is required'),
    body('referral.code').custom((v) => validateReferralCodeField(v, 'referral.code')),
    body('referral.cookieDays').optional().isInt({ min: 1, max: 365 }),
    body('commission.rateBps').optional().isInt({ min: 0, max: 10000 }),
    body('commission.basis').optional().isIn(['accommodation_net']),
    body('commission.eligibleAfter').optional().isIn(['stay_completed', 'manual_approval'])
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const warnings = [];
      const promoLink = await resolvePromoLink(req.body?.promo?.code);
      warnings.push(...promoLink.warnings);
      const actor = getOpsIdentity(req);
      const doc = await CreatorPartner.create({
        name: String(req.body.name).trim(),
        slug: normalizePartnerKey(req.body.slug),
        status: req.body.status || 'draft',
        contact: {
          email: req.body?.contact?.email ? String(req.body.contact.email).trim().toLowerCase() : null,
          phone: req.body?.contact?.phone ? String(req.body.contact.phone).trim() : null
        },
        profiles: {
          instagram: req.body?.profiles?.instagram ? String(req.body.profiles.instagram).trim() : null,
          tiktok: req.body?.profiles?.tiktok ? String(req.body.profiles.tiktok).trim() : null,
          youtube: req.body?.profiles?.youtube ? String(req.body.profiles.youtube).trim() : null,
          website: req.body?.profiles?.website ? String(req.body.profiles.website).trim() : null
        },
        referral: {
          code: applyReferralCodeNormalization(req.body?.referral?.code),
          cookieDays: req.body?.referral?.cookieDays ?? 60
        },
        promo: promoLink.promo,
        commission: {
          rateBps: req.body?.commission?.rateBps ?? 1000,
          basis: req.body?.commission?.basis || 'accommodation_net',
          eligibleAfter: req.body?.commission?.eligibleAfter || 'stay_completed'
        },
        contentAgreement: {
          compStayOffered: !!req.body?.contentAgreement?.compStayOffered,
          deliverables: req.body?.contentAgreement?.deliverables
            ? String(req.body.contentAgreement.deliverables).trim()
            : null,
          usageRights: req.body?.contentAgreement?.usageRights
            ? String(req.body.contentAgreement.usageRights).trim()
            : null,
          agreedAt: req.body?.contentAgreement?.agreedAt ? new Date(req.body.contentAgreement.agreedAt) : null
        },
        notes: req.body?.notes ? String(req.body.notes).trim() : null,
        createdBy: actor,
        updatedBy: actor
      });

      return res.status(201).json({
        success: true,
        data: { creatorPartner: formatCreatorPartner(doc), warnings }
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ success: false, message: 'A creator partner with this slug or referral code already exists' });
      }
      if (error?.name === 'ValidationError') {
        return res.status(400).json({ success: false, message: error.message });
      }
      return res.status(500).json({ success: false, message: 'Unable to create creator partner' });
    }
  }
);

router.get('/stats', async (req, res) => {
  try {
    const rows = await buildAllCreatorPartnerStats();
    return res.json({
      success: true,
      data: {
        creatorPartnerStats: rows.map((row) => ({
          creatorPartnerId: row.creatorPartnerId,
          stats: formatCreatorPartnerStats(row.stats)
        }))
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to load creator partner stats' });
  }
});

router.get('/:id', validateId('id'), async (req, res) => {
  try {
    const doc = await CreatorPartner.findById(req.params.id).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Creator partner not found' });
    }
    return res.json({ success: true, data: { creatorPartner: formatCreatorPartner(doc) } });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to fetch creator partner' });
  }
});

router.get('/:id/stats', validateId('id'), async (req, res) => {
  try {
    const creatorPartner = await CreatorPartner.findById(req.params.id)
      .select('_id')
      .lean();
    if (!creatorPartner) {
      return res.status(404).json({ success: false, message: 'Creator partner not found' });
    }

    const stats = await buildSingleCreatorPartnerStats(creatorPartner);
    return res.json({
      success: true,
      data: {
        creatorPartnerId: String(creatorPartner._id),
        stats: formatCreatorPartnerStats(stats)
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to load creator partner stats' });
  }
});

router.get('/:id/bookings', validateId('id'), async (req, res) => {
  try {
    const limit = Number(req.query.limit || 100);
    const creatorPartner = await CreatorPartner.findById(req.params.id)
      .select('_id status promo referral')
      .lean();
    if (!creatorPartner) {
      return res.status(404).json({ success: false, message: 'Creator partner not found' });
    }

    const bookings = await listCreatorPartnerAttributedBookings(creatorPartner, { limit });
    return res.json({
      success: true,
      data: {
        creatorPartnerId: String(creatorPartner._id),
        bookings
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to load creator partner bookings' });
  }
});

router.post('/:id/recalculate', validateId('id'), async (req, res) => {
  try {
    const creatorPartner = await CreatorPartner.findById(req.params.id)
      .select('_id status promo referral commission')
      .lean();
    if (!creatorPartner) {
      return res.status(404).json({ success: false, message: 'Creator partner not found' });
    }

    const result = await recalculateCreatorCommissionForPartner(creatorPartner);
    return res.json({
      success: true,
      data: {
        creatorPartnerId: String(creatorPartner._id),
        ...result
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to recalculate creator commission' });
  }
});

router.get(
  '/:id/commission',
  validateId('id'),
  [
    query('status').optional().isIn(['pending', 'approved', 'paid', 'void']),
    query('eligibilityStatus').optional().isIn(['eligible', 'not_eligible', 'needs_review']),
    query('limit').optional().isInt({ min: 1, max: 500 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const creatorPartner = await CreatorPartner.findById(req.params.id)
        .select('_id')
        .lean();
      if (!creatorPartner) {
        return res.status(404).json({ success: false, message: 'Creator partner not found' });
      }

      const entries = await listCreatorCommissionForPartner(creatorPartner._id, {
        status: req.query.status,
        eligibilityStatus: req.query.eligibilityStatus,
        limit: req.query.limit
      });

      return res.json({
        success: true,
        data: {
          creatorPartnerId: String(creatorPartner._id),
          entries: entries.map((entry) => ({
            _id: String(entry._id),
            bookingId: entry.bookingId ? String(entry.bookingId) : null,
            referralCode: entry.referralCode || null,
            promoCode: entry.promoCode || null,
            source: entry.source,
            rateBpsSnapshot: entry.rateBpsSnapshot,
            commissionableRevenueSnapshot: entry.commissionableRevenueSnapshot,
            amountSnapshot: entry.amountSnapshot,
            currency: entry.currency,
            bookingStatusSnapshot: entry.bookingStatusSnapshot || null,
            paymentStatusSnapshot: entry.paymentStatusSnapshot || null,
            eligibilityStatus: entry.eligibilityStatus,
            status: entry.status,
            voidReason: entry.voidReason || null,
            calculatedAt: entry.calculatedAt || null,
            approvedAt: entry.approvedAt || null,
            paidAt: entry.paidAt || null,
            notes: entry.notes || null
          }))
        }
      });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to load creator commission ledger' });
    }
  }
);

router.patch(
  '/:id',
  validateId('id'),
  [
    body('name').optional().trim().isLength({ min: 1, max: 200 }),
    body('slug').optional().custom((v) => validatePartnerKeyField(v, 'slug')),
    body('status').optional().isIn(['draft', 'active', 'paused', 'archived']),
    body('referral').optional().isObject(),
    body('referral.code').optional().custom((v) => validateReferralCodeField(v, 'referral.code')),
    body('referral.cookieDays').optional().isInt({ min: 1, max: 365 }),
    body('commission.rateBps').optional().isInt({ min: 0, max: 10000 }),
    body('commission.basis').optional().isIn(['accommodation_net']),
    body('commission.eligibleAfter').optional().isIn(['stay_completed', 'manual_approval'])
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const doc = await CreatorPartner.findById(req.params.id);
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Creator partner not found' });
      }

      const warnings = [];
      if (req.body.name !== undefined) doc.name = String(req.body.name).trim();
      if (req.body.slug !== undefined) doc.slug = normalizePartnerKey(req.body.slug);
      if (req.body.status !== undefined) doc.status = req.body.status;

      if (req.body.contact !== undefined) {
        doc.contact = {
          ...doc.contact,
          email: req.body?.contact?.email != null ? String(req.body.contact.email).trim().toLowerCase() : doc.contact?.email || null,
          phone: req.body?.contact?.phone != null ? String(req.body.contact.phone).trim() : doc.contact?.phone || null
        };
      }

      if (req.body.profiles !== undefined) {
        doc.profiles = {
          ...doc.profiles,
          instagram: req.body?.profiles?.instagram != null ? String(req.body.profiles.instagram).trim() : doc.profiles?.instagram || null,
          tiktok: req.body?.profiles?.tiktok != null ? String(req.body.profiles.tiktok).trim() : doc.profiles?.tiktok || null,
          youtube: req.body?.profiles?.youtube != null ? String(req.body.profiles.youtube).trim() : doc.profiles?.youtube || null,
          website: req.body?.profiles?.website != null ? String(req.body.profiles.website).trim() : doc.profiles?.website || null
        };
      }

      if (req.body.referral !== undefined) {
        if (req.body?.referral?.code !== undefined) {
          doc.referral.code = applyReferralCodeNormalization(req.body.referral.code);
        }
        if (req.body?.referral?.cookieDays !== undefined) doc.referral.cookieDays = req.body.referral.cookieDays;
      }

      if (req.body.promo !== undefined) {
        const promoLink = await resolvePromoLink(req.body?.promo?.code);
        warnings.push(...promoLink.warnings);
        doc.promo = promoLink.promo;
      }

      if (req.body.commission !== undefined) {
        if (req.body?.commission?.rateBps !== undefined) doc.commission.rateBps = req.body.commission.rateBps;
        if (req.body?.commission?.basis !== undefined) doc.commission.basis = req.body.commission.basis;
        if (req.body?.commission?.eligibleAfter !== undefined) doc.commission.eligibleAfter = req.body.commission.eligibleAfter;
      }

      if (req.body.contentAgreement !== undefined) {
        if (req.body?.contentAgreement?.compStayOffered !== undefined) {
          doc.contentAgreement.compStayOffered = !!req.body.contentAgreement.compStayOffered;
        }
        if (req.body?.contentAgreement?.deliverables !== undefined) {
          doc.contentAgreement.deliverables = req.body.contentAgreement.deliverables
            ? String(req.body.contentAgreement.deliverables).trim()
            : null;
        }
        if (req.body?.contentAgreement?.usageRights !== undefined) {
          doc.contentAgreement.usageRights = req.body.contentAgreement.usageRights
            ? String(req.body.contentAgreement.usageRights).trim()
            : null;
        }
        if (req.body?.contentAgreement?.agreedAt !== undefined) {
          doc.contentAgreement.agreedAt = req.body.contentAgreement.agreedAt
            ? new Date(req.body.contentAgreement.agreedAt)
            : null;
        }
      }

      if (req.body.notes !== undefined) {
        doc.notes = req.body.notes ? String(req.body.notes).trim() : null;
      }
      doc.updatedBy = getOpsIdentity(req);

      await doc.save();

      return res.json({
        success: true,
        data: { creatorPartner: formatCreatorPartner(doc), warnings }
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ success: false, message: 'A creator partner with this slug or referral code already exists' });
      }
      if (error?.name === 'ValidationError') {
        return res.status(400).json({ success: false, message: error.message });
      }
      return res.status(500).json({ success: false, message: 'Unable to update creator partner' });
    }
  }
);

module.exports = router;
