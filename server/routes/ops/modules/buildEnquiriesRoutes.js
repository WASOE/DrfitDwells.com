'use strict';

const express = require('express');
const {
  listBuildEnquiries,
  getBuildEnquiryDetail,
  updateBuildEnquiryStatus
} = require('../../../services/ops/readModels/buildEnquiriesReadModel');

const router = express.Router();

function errorMessage(error, fallback) {
  const status = error?.statusCode || 500;
  if (status >= 400 && status < 500 && error?.message) {
    return error.message;
  }
  return fallback;
}

router.get('/', async (req, res) => {
  try {
    const data = await listBuildEnquiries({
      status: req.query.status,
      q: req.query.q,
      page: req.query.page,
      limit: req.query.limit,
      emailAttention: req.query.emailAttention
    });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error('[ops/build-enquiries] list failed', error?.message || error);
    }
    return res.status(status).json({
      success: false,
      message: errorMessage(error, 'Failed to list build enquiries')
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const data = await getBuildEnquiryDetail({ id: req.params.id });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error('[ops/build-enquiries] detail failed', error?.message || error);
    }
    return res.status(status).json({
      success: false,
      message: errorMessage(error, 'Failed to load build enquiry')
    });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const data = await updateBuildEnquiryStatus({
      id: req.params.id,
      status: req.body?.status
    });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error('[ops/build-enquiries] patch failed', error?.message || error);
    }
    return res.status(status).json({
      success: false,
      message: errorMessage(error, 'Failed to update build enquiry')
    });
  }
});

module.exports = router;
