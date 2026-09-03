const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  exchangeMagicTokenForSession,
  requestPortalLinkForEmail
} = require('../services/creatorPortal/creatorPortalAccessService');
const {
  setPortalSessionCookie,
  clearPortalSessionCookie
} = require('../services/creatorPortal/creatorPortalSession');
const { buildCreatorPortalMe } = require('../services/creatorPortal/creatorPortalMeService');
const {
  renameOwnCreatorReferralCode
} = require('../services/creatorPortal/creatorPortalReferralCodeService');
const {
  optionalCreatorPortalSession,
  requireCreatorPortalSession
} = require('../middleware/creatorPortalSessionMiddleware');
const { applyReferralCodeNormalization, REFERRAL_CODE_RE } = require('../models/CreatorPartner');

const router = express.Router();

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' }
});

const requestLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: true,
    data: { delivered: 'if-on-file' },
    message: 'If this email is linked to a creator account, we’ll send a private sign-in link.'
  }
});

const renameReferralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // Identity is the authenticated creator only (session middleware runs first).
  keyGenerator: (req) => `creator-rename:${String(req.creatorPortalPartner._id)}`,
  validate: { keyGeneratorIpFallback: false },
  message: { success: false, message: 'Too many referral code changes. Please try again later.' }
});

const SELF_SERVE_GENERIC_RESPONSE = Object.freeze({
  success: true,
  data: { delivered: 'if-on-file' },
  message: 'If this email is linked to a creator account, we’ll send a private sign-in link.'
});

function portalRedirectBase() {
  const b = process.env.CREATOR_PORTAL_SPA_BASE;
  if (b && String(b).trim()) return String(b).trim().replace(/\/$/, '');
  return '';
}

function redirectSuccess(res) {
  const base = portalRedirectBase();
  const target = base ? `${base}/creator` : '/creator';
  return res.redirect(302, target);
}

function redirectFailure(res) {
  const base = portalRedirectBase();
  const target = base ? `${base}/creator/login?portal_error=1` : '/creator/login?portal_error=1';
  return res.redirect(302, target);
}

/**
 * Magic-link exchange: single-use token → httpOnly session cookie → redirect to SPA /creator.
 */
router.get('/verify', verifyLimiter, async (req, res) => {
  try {
    const raw = req.query?.token;
    if (!raw || typeof raw !== 'string') {
      return redirectFailure(res);
    }
    const out = await exchangeMagicTokenForSession(raw);
    if (!out.ok || !out.session?.token) {
      return redirectFailure(res);
    }
    setPortalSessionCookie(res, out.session.token, out.session.maxAgeMs);
    return redirectSuccess(res);
  } catch {
    return redirectFailure(res);
  }
});

/**
 * Self-serve magic-link request (public, unauthenticated).
 * Always returns the same generic 200 payload. Never reveals whether the email matched.
 * Behaviour is gated by CREATOR_PORTAL_REQUEST_LINK_ENABLED inside the service.
 */
router.post('/request-link', requestLinkLimiter, async (req, res) => {
  try {
    const rawEmail = req.body && typeof req.body.email === 'string' ? req.body.email : null;
    await requestPortalLinkForEmail(rawEmail);
  } catch {
    /* never reveal to requester */
  }
  return res.status(200).json(SELF_SERVE_GENERIC_RESPONSE);
});

router.use(optionalCreatorPortalSession);

router.get('/session', (req, res) => {
  if (!req.creatorPortalPartner) {
    return res.json({ success: true, data: { authenticated: false } });
  }
  const p = req.creatorPortalPartner;
  return res.json({
    success: true,
    data: {
      authenticated: true,
      creator: {
        id: String(p._id),
        name: p.name || '',
        slug: p.slug || '',
        status: p.status
      }
    }
  });
});

router.get('/me', requireCreatorPortalSession, async (req, res) => {
  try {
    const me = await buildCreatorPortalMe(req.creatorPortalPartner._id);
    if (!me) {
      return res.status(403).json({ success: false, message: 'Creator portal access is not available.' });
    }
    return res.json({ success: true, data: me });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to load creator portal data.' });
  }
});

/**
 * Creator self-service: change current referral code (Batch B1).
 * Partner target is always the authenticated session partner — never from body.
 */
router.patch('/me/referral-code', requireCreatorPortalSession, renameReferralLimiter, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const allowedKeys = new Set(['code', 'expectedCurrentCode']);
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        return res.status(400).json({ success: false, message: 'Unexpected field in request body' });
      }
    }

    const rawCode = body.code;
    if (rawCode == null || typeof rawCode !== 'string') {
      return res.status(400).json({ success: false, message: 'code is required' });
    }
    if (rawCode.length > 120) {
      return res.status(400).json({ success: false, message: 'code is invalid' });
    }

    const normalizedPreview = applyReferralCodeNormalization(rawCode);
    if (!normalizedPreview || !REFERRAL_CODE_RE.test(normalizedPreview)) {
      return res.status(400).json({
        success: false,
        message:
          'Referral code must be Instagram-style: a-z, 0-9, ., -, _ (max 80 chars); optional leading @ is removed'
      });
    }

    const expectedRaw = body.expectedCurrentCode;
    if (expectedRaw == null || typeof expectedRaw !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'expectedCurrentCode is required',
        code: 'INVALID_EXPECTED_CURRENT'
      });
    }
    if (expectedRaw.length > 120) {
      return res.status(400).json({
        success: false,
        message: 'expectedCurrentCode is invalid',
        code: 'INVALID_EXPECTED_CURRENT'
      });
    }
    const expectedNormalized = applyReferralCodeNormalization(expectedRaw);
    if (!expectedNormalized || !REFERRAL_CODE_RE.test(expectedNormalized)) {
      return res.status(400).json({
        success: false,
        message: 'expectedCurrentCode is invalid',
        code: 'INVALID_EXPECTED_CURRENT'
      });
    }

    const result = await renameOwnCreatorReferralCode({
      partnerId: req.creatorPortalPartner._id,
      desiredRawCode: rawCode,
      expectedCurrentCode: expectedRaw
    });

    if (!result.ok) {
      if (
        result.code === 'INVALID_CODE' ||
        result.code === 'INVALID_CURRENT' ||
        result.code === 'INVALID_EXPECTED_CURRENT'
      ) {
        return res.status(400).json({ success: false, message: result.message, code: result.code });
      }
      if (
        result.code === 'CODE_TAKEN' ||
        result.code === 'CODE_CHANGED' ||
        result.code === 'ALIAS_LIMIT' ||
        result.code === 'CONFLICT'
      ) {
        return res.status(409).json({ success: false, message: result.message, code: result.code });
      }
      if (result.code === 'REFERRAL_CODE_CHANGE_UNAVAILABLE' || result.code === 'STATUS_NOT_ALLOWED') {
        return res.status(403).json({
          success: false,
          message: result.message,
          code: 'REFERRAL_CODE_CHANGE_UNAVAILABLE'
        });
      }
      if (result.code === 'NOT_FOUND') {
        return res.status(404).json({ success: false, message: result.message, code: result.code });
      }
      return res.status(500).json({ success: false, message: 'Unable to update referral code' });
    }

    return res.json({
      success: true,
      data: {
        referralCode: result.referralCode,
        changed: !!result.changed
      }
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A creator partner with this referral code already exists',
        code: 'CODE_TAKEN'
      });
    }
    return res.status(500).json({ success: false, message: 'Unable to update referral code' });
  }
});

router.post('/logout', (req, res) => {
  clearPortalSessionCookie(res);
  return res.json({ success: true, data: { loggedOut: true } });
});

module.exports = router;
