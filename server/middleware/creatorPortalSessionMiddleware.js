const CreatorPartner = require('../../models/CreatorPartner');
const { readPortalSessionCookie, verifySessionToken } = require('../services/creatorPortal/creatorPortalSession');

/**
 * Attaches req.creatorPortalPartner (lean) when a valid creator portal session cookie is present.
 * Does not send 401 — use requireCreatorPortalSession for protected routes.
 */
async function optionalCreatorPortalSession(req, res, next) {
  req.creatorPortalPartner = null;
  const token = readPortalSessionCookie(req);
  if (!token) return next();
  const payload = verifySessionToken(token);
  if (!payload?.cp) return next();
  try {
    const partner = await CreatorPartner.findById(payload.cp)
      .select('_id name slug status')
      .lean();
    if (!partner || partner.status === 'draft') return next();
    req.creatorPortalPartner = partner;
    req.creatorPortalSessionPayload = payload;
  } catch {
    // ignore
  }
  next();
}

function requireCreatorPortalSession(req, res, next) {
  if (!req.creatorPortalPartner?._id) {
    return res.status(401).json({ success: false, message: 'Creator portal session required.' });
  }
  next();
}

module.exports = { optionalCreatorPortalSession, requireCreatorPortalSession };
