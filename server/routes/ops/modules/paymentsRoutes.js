const express = require('express');
const {
  getPaymentsSummaryReadModel,
  getPaymentsLedgerReadModel,
  getPayoutsListReadModel,
  getPayoutDetailReadModel,
  getPayoutReconciliationSummaryReadModel
} = require('../../../services/ops/readModels/paymentsReadModel');

const router = express.Router();

router.get('/summary', async (req, res) => {
  try {
    const data = await getPaymentsSummaryReadModel();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/ledger', async (req, res) => {
  try {
    const data = await getPaymentsLedgerReadModel(req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/payouts', async (req, res) => {
  try {
    const data = await getPayoutsListReadModel(req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/payouts/reconciliation-summary', async (req, res) => {
  try {
    const data = await getPayoutReconciliationSummaryReadModel();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/payouts/:id', async (req, res) => {
  try {
    const data = await getPayoutDetailReadModel(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Payout not found' });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
