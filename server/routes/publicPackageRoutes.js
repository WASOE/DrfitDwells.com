'use strict';

const express = require('express');
const { createPublicPackageService } = require('../services/publicPackageService');

const router = express.Router();
const service = createPublicPackageService();

function sendError(res, result) {
  return res.status(result.status || 500).json({
    error: result.code || 'PACKAGE_UNAVAILABLE',
    message: result.message || 'Package is unavailable'
  });
}

router.get('/', async (req, res) => {
  try {
    return res.json({ packages: await service.list() });
  } catch (err) {
    console.error('[public-packages] list failed', err);
    return res.status(503).json({ error: 'PACKAGE_UNAVAILABLE', message: 'Packages are temporarily unavailable' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const result = await service.detail(req.params.slug);
    return result.ok ? res.json(result.package) : sendError(res, result);
  } catch (err) {
    console.error('[public-packages] detail failed', err);
    return res.status(503).json({ error: 'PACKAGE_UNAVAILABLE', message: 'Package is temporarily unavailable' });
  }
});

router.post('/:slug/quote', async (req, res) => {
  try {
    const result = await service.quote(req.params.slug, req.body || {});
    return result.ok ? res.json(result.quote) : sendError(res, result);
  } catch (err) {
    console.error('[public-packages] quote failed', err);
    return res.status(503).json({ error: 'QUOTE_UNAVAILABLE', message: 'Package quote is temporarily unavailable' });
  }
});

module.exports = router;
