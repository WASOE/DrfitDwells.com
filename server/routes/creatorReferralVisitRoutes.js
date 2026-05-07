const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const CreatorReferralVisit = require('../models/CreatorReferralVisit');
const CreatorPartner = require('../models/CreatorPartner');
const { normalizeReferralCode } = require('../models/CreatorPartner');

const router = express.Router();

const createVisitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' }
});

function sanitizeText(value, max = 500) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  return v.slice(0, max);
}

function sanitizeKey(value, max = 120) {
  if (value == null) return null;
  const v = String(value).trim().replace(/[^a-zA-Z0-9_.:-]/g, '');
  if (!v) return null;
  return v.slice(0, max);
}

function getDayBucket(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

router.post(
  '/',
  createVisitLimiter,
  [
    body('referralCode').isString().isLength({ min: 1, max: 120 }).withMessage('referralCode is required'),
    body('landingPath').optional().isString().isLength({ max: 1000 }),
    body('referrer').optional().isString().isLength({ max: 1000 }),
    body('visitorKey').optional().isString().isLength({ max: 180 }),
    body('sessionKey').optional().isString().isLength({ max: 180 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const referralCode = normalizeReferralCode(req.body?.referralCode);
      if (!referralCode) {
        return res.status(400).json({ success: false, message: 'Invalid referral code' });
      }

      const landingPath = sanitizeText(req.body?.landingPath, 500);
      const referrer = sanitizeText(req.body?.referrer, 500);
      const visitorKey = sanitizeKey(req.body?.visitorKey, 120);
      const sessionKey = sanitizeKey(req.body?.sessionKey, 120);
      const now = new Date();
      const dayBucket = getDayBucket(now);

      const creator = await CreatorPartner.findOne({
        'referral.code': referralCode,
        status: { $in: ['active', 'paused'] }
      })
        .select('_id')
        .lean();

      const matchFilter =
        visitorKey != null
          ? { referralCode, visitorKey, dayBucket }
          : sessionKey != null
            ? { referralCode, sessionKey, dayBucket }
            : { referralCode, landingPath: landingPath || null, dayBucket };

      const insertFields = {
        referralCode,
        dayBucket,
        firstSeenAt: now
      };
      if (visitorKey) insertFields.visitorKey = visitorKey;
      if (sessionKey) insertFields.sessionKey = sessionKey;

      const setFields = {
        creatorPartnerId: creator?._id || null,
        landingPath: landingPath || null,
        lastSeenAt: now,
        referrer: referrer || null
      };

      await CreatorReferralVisit.findOneAndUpdate(
        matchFilter,
        {
          $setOnInsert: insertFields,
          $set: setFields,
          $inc: { visitCount: 1 }
        },
        { upsert: true, setDefaultsOnInsert: true }
      );

      return res.status(202).json({ success: true });
    } catch (error) {
      console.error('[creator-referral-visits] failed to record visit', {
        referralCode: normalizeReferralCode(req.body?.referralCode) || null,
        dayBucket: getDayBucket(new Date()),
        message: error?.message || String(error)
      });
      return res.status(202).json({ success: false, message: 'Visit tracking failed' });
    }
  }
);

module.exports = router;
