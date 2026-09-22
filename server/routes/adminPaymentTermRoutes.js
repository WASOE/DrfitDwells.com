/**
 * Admin PaymentTermTemplate management API (SP7).
 */
'use strict';

const express = require('express');
const { validateId } = require('../middleware/validateId');
const mgmt = require('../services/paymentTermManagementService');

const router = express.Router();

function operatorFromReq(req) {
  return req.user?.email || req.user?.id || req.user?.username || 'ops';
}

function mapError(err, res) {
  const code = err?.code || err?.name;
  const statusBy = {
    [mgmt.MGMT_CODES.INVALID_OPERATOR]: 400,
    [mgmt.MGMT_CODES.VALIDATION_FAILED]: 400,
    [mgmt.MGMT_CODES.NOT_FOUND]: 404,
    [mgmt.MGMT_CODES.IMMUTABLE_TEMPLATE]: 409,
    [mgmt.MGMT_CODES.INVALID_STATUS_TRANSITION]: 409,
    [mgmt.MGMT_CODES.DUPLICATE_VERSION]: 409,
    [mgmt.MGMT_CODES.STALE_REVISION]: 409,
    [mgmt.MGMT_CODES.IDENTITY_IMMUTABLE]: 409
  };
  const status = statusBy[code] || 500;
  return res.status(status).json({
    success: false,
    error: { code: code || 'INTERNAL', message: err.message }
  });
}

router.get('/', async (req, res) => {
  try {
    const paymentTerms = await mgmt.listPaymentTermTemplates({
      status: req.query.status || null,
      code: req.query.code || null,
      limit: req.query.limit
    });
    res.json({ success: true, data: { paymentTerms } });
  } catch (err) {
    mapError(err, res);
  }
});

router.get('/:id', validateId('id'), async (req, res) => {
  try {
    const paymentTerm = await mgmt.getPaymentTermTemplate(req.params.id);
    res.json({ success: true, data: { paymentTerm } });
  } catch (err) {
    mapError(err, res);
  }
});

router.post('/', async (req, res) => {
  try {
    const paymentTerm = await mgmt.createDraftPaymentTermTemplate({
      input: req.body || {},
      operator: operatorFromReq(req)
    });
    res.status(201).json({ success: true, data: { paymentTerm } });
  } catch (err) {
    mapError(err, res);
  }
});

router.patch('/:id', validateId('id'), async (req, res) => {
  try {
    const paymentTerm = await mgmt.updateDraftPaymentTermTemplate({
      id: req.params.id,
      input: req.body || {},
      operator: operatorFromReq(req),
      expectedRevision: req.body?.expectedRevision
    });
    res.json({ success: true, data: { paymentTerm } });
  } catch (err) {
    mapError(err, res);
  }
});

router.post('/:id/clone', validateId('id'), async (req, res) => {
  try {
    const paymentTerm = await mgmt.clonePaymentTermTemplate({
      id: req.params.id,
      operator: operatorFromReq(req)
    });
    res.status(201).json({ success: true, data: { paymentTerm } });
  } catch (err) {
    mapError(err, res);
  }
});

router.post('/:id/activate', validateId('id'), async (req, res) => {
  try {
    const paymentTerm = await mgmt.activatePaymentTermTemplate({
      id: req.params.id,
      operator: operatorFromReq(req),
      expectedRevision: req.body?.expectedRevision
    });
    res.json({ success: true, data: { paymentTerm } });
  } catch (err) {
    mapError(err, res);
  }
});

router.post('/:id/retire', validateId('id'), async (req, res) => {
  try {
    const paymentTerm = await mgmt.retirePaymentTermTemplate({
      id: req.params.id,
      operator: operatorFromReq(req),
      expectedRevision: req.body?.expectedRevision
    });
    res.json({ success: true, data: { paymentTerm } });
  } catch (err) {
    mapError(err, res);
  }
});

module.exports = router;
