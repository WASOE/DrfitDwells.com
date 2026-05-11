const express = require('express');
const rateLimit = require('express-rate-limit');
const { exchangeMagicTokenForSession } = require('../services/creatorPortal/creatorPortalAccessService');
const {
  setPortalSessionCookie,
  clearPortalSessionCookie
} = require('../services/creatorPortal/creatorPortalSession');
const { buildCreatorPortalMe } = require('../services/creatorPortal/creatorPortalMeService');
const {
  optionalCreatorPortalSession,
  requireCreatorPortalSession
} = require('../middleware/creatorPortalSessionMiddleware');

const router = express.Router();

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' }
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

router.post('/logout', (req, res) => {
  clearPortalSessionCookie(res);
  return res.json({ success: true, data: { loggedOut: true } });
});

module.exports = router;
