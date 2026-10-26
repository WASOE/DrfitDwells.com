'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createBuildEnquiry } = require('../services/buildEnquiries/buildEnquiryService');

const router = express.Router();

/** Dedicated public limiter: 5 submissions / 15 minutes / IP. */
const buildEnquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many enquiry submissions. Please try again later.' }
});

router.post('/', buildEnquiryLimiter, async (req, res) => {
  try {
    const outcome = await createBuildEnquiry(req.body || {}, { isTest: false });

    if (outcome.kind === 'honeypot') {
      // Silent success — do not persist spam bait fills.
      return res.status(204).send();
    }

    if (outcome.kind === 'validation') {
      return res.status(400).json({
        success: false,
        message: 'Invalid build enquiry',
        errors: outcome.errors
      });
    }

    const status = outcome.kind === 'created' ? 201 : 200;
    return res.status(status).json(outcome.result);
  } catch (err) {
    console.error('[build-enquiries] create failed', err?.message || err);
    return res.status(503).json({
      success: false,
      message: 'Could not save enquiry. Please try again shortly.'
    });
  }
});

module.exports = router;
module.exports.buildEnquiryLimiter = buildEnquiryLimiter;
