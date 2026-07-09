const express = require('express');
const rateLimit = require('express-rate-limit');
const { submitLocationEnquiry } = require('../services/locationQuote/locationEnquiryService');

const router = express.Router();

const locationEnquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many enquiries. Please try again later.' }
});

function handleEnquiryError(err, res) {
  if (err?.code === 'validation') {
    const status = err.status || 400;
    return res.status(status).json({ success: false, message: err.message });
  }
  console.error('Location enquiry error:', err);
  return res.status(500).json({ success: false, message: 'Error submitting enquiry' });
}

router.post('/location-enquiries', locationEnquiryLimiter, async (req, res) => {
  try {
    const result = await submitLocationEnquiry(req.body);
    return res.status(201).json({
      success: true,
      message: "Request received. We'll confirm availability and details before booking.",
      data: result
    });
  } catch (err) {
    return handleEnquiryError(err, res);
  }
});

module.exports = router;
