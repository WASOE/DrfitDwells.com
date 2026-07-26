'use strict';

const express = require('express');
const { getConversionSummaryReadModel } = require('../../../services/ops/readModels/conversionReadModel');
const {
  listRecoveryQuotes,
  getRecoveryQuoteDetail
} = require('../../../services/ops/readModels/recoveryReadModel');
const SavedBookingQuote = require('../../../models/SavedBookingQuote');
const { buildRecoveryPreview } = require('../../../services/savedQuotes/recoveryTemplateService');
const { evaluateRecoveryDeliveryGate } = require('../../../services/savedQuotes/recoveryDeliveryGateService');
const { prepareRecoveryDelivery } = require('../../../services/savedQuotes/recoveryPreparationService');
const { issuePreferenceAccessToken } = require('../../../services/savedQuotes/preferenceAccessTokenService');
const { issueContinuationToken } = require('../../../services/savedQuotes/recoveryContinuationService');

const router = express.Router();

router.get('/summary', async (req, res) => {
  try {
    const { propertyKind, from, to, cabinId, cabinTypeId, unitId } = req.query;
    if (!propertyKind || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'propertyKind, from, and to are required'
      });
    }

    const data = await getConversionSummaryReadModel({
      propertyKind,
      from,
      to,
      cabinId,
      cabinTypeId,
      unitId
    });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
});

router.get('/recovery', async (req, res) => {
  try {
    const {
      propertyKind,
      from,
      to,
      status,
      eligibility,
      consentBasis,
      suppressed,
      hasEmail,
      entityType,
      cabinId,
      cabinTypeId,
      page,
      limit
    } = req.query;
    if (!propertyKind || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'propertyKind, from, and to are required'
      });
    }

    const data = await listRecoveryQuotes({
      propertyKind,
      from,
      to,
      status,
      eligibility,
      consentBasis,
      suppressed,
      hasEmail,
      entityType,
      cabinId,
      cabinTypeId,
      page,
      limit
    });
    return res.json({ success: true, data });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
});

router.get('/recovery/:id', async (req, res) => {
  try {
    const data = await getRecoveryQuoteDetail({ id: req.params.id });
    return res.json({ success: true, data });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
});

/**
 * OPS preview only — never calls email provider, never status `sent`.
 */
router.post('/recovery/:id/preview', async (req, res) => {
  try {
    const messagePurpose = req.body?.messagePurpose;
    const templateVersion = req.body?.templateVersion || 'v1';
    if (!['quote_delivery', 'booking_reminder'].includes(messagePurpose)) {
      return res.status(400).json({
        success: false,
        message: 'messagePurpose must be quote_delivery or booking_reminder'
      });
    }

    const quote = await SavedBookingQuote.findById(req.params.id).lean();
    if (!quote) {
      return res.status(404).json({ success: false, message: 'Saved quote not found' });
    }

    const gate = await evaluateRecoveryDeliveryGate({
      savedQuoteId: quote._id,
      messagePurpose,
      templateVersion
    });

    const preview = await buildRecoveryPreview({
      savedQuote: quote,
      messagePurpose,
      templateVersion
    });

    // Optional audit-only preview row — never treated as a delivery attempt.
    await prepareRecoveryDelivery({
      savedQuoteId: quote._id,
      messagePurpose,
      templateVersion,
      isPreview: true
    });

    return res.json({
      success: true,
      data: {
        ...preview,
        eligibility: gate,
        noSend: true,
        notice: 'Recovery delivery is disabled. Previews do not send messages.'
      }
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
});

/**
 * Issue preference / continuation link indicators for OPS (no email send).
 */
router.post('/recovery/:id/links', async (req, res) => {
  try {
    const quote = await SavedBookingQuote.findById(req.params.id).lean();
    if (!quote) {
      return res.status(404).json({ success: false, message: 'Saved quote not found' });
    }
    const out = {
      preferenceUrl: null,
      continuationUrl: null,
      preferenceIssued: false,
      continuationIssued: false
    };
    if (quote.emailNormalized || quote.email) {
      const pref = await issuePreferenceAccessToken({
        email: quote.emailNormalized || quote.email,
        savedQuoteId: quote._id
      });
      if (!pref.skipped) {
        out.preferenceUrl = pref.preferenceUrl;
        out.preferenceIssued = true;
      }
    }
    const cont = await issueContinuationToken({ savedQuoteId: quote._id });
    if (!cont.skipped) {
      out.continuationUrl = cont.continuationUrl;
      out.continuationIssued = true;
    }
    return res.json({
      success: true,
      data: {
        ...out,
        noSend: true,
        notice: 'Links generated for OPS preview only. No message was sent.'
      }
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
});

module.exports = router;
