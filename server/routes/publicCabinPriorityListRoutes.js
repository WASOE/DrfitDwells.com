'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createCabinPriorityList } = require('../services/cabinPriorityList/service');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many submissions. Please try again later.' }
});

router.post('/', limiter, async (req, res) => {
  try {
    const result = await createCabinPriorityList(req.body);
    if (result.honeypot) return res.status(204).send();
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message: 'Invalid priority list signup',
        errors: result.errors
      });
    }
    return res.status(result.duplicate ? 200 : 201).json({ success: true });
  } catch (error) {
    console.error('[cabin-priority-list] create failed', error?.message || error);
    return res.status(503).json({
      success: false,
      message: 'Could not save your request. Please try again shortly.'
    });
  }
});

module.exports = router;
