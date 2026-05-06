const express = require('express');
const { adminAuth } = require('../../middleware/adminAuth');
const foundationRoutes = require('./modules/foundationRoutes');
const dashboardRoutes = require('./modules/dashboardRoutes');
const calendarRoutes = require('./modules/calendarRoutes');
const reservationsRoutes = require('./modules/reservationsRoutes');
const syncRoutes = require('./modules/syncRoutes');
const paymentsRoutes = require('./modules/paymentsRoutes');
const cabinsRoutes = require('./modules/cabinsRoutes');
const reviewsRoutes = require('./modules/reviewsRoutes');
const communicationsRoutes = require('./modules/communicationsRoutes');
const availabilityActionsRoutes = require('./modules/availabilityActionsRoutes');
const healthRoutes = require('./modules/healthRoutes');
const manualReviewRoutes = require('./modules/manualReviewRoutes');
const readinessRoutes = require('./modules/readinessRoutes');
const creatorPartnersRoutes = require('./modules/creatorPartnersRoutes');
const promoCodesRoutes = require('./modules/promoCodesRoutes');
const creatorCommissionsRoutes = require('./modules/creatorCommissionsRoutes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      namespace: 'ops',
      status: 'ok'
    }
  });
});

router.use(adminAuth);
router.get('/session', (req, res) => {
  return res.json({
    success: true,
    data: {
      authenticated: true,
      role: req.user?.role || 'admin',
      actorId: req.user?.id || null
    }
  });
});
router.use('/foundation', foundationRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/calendar', calendarRoutes);
router.use('/reservations', reservationsRoutes);
router.use('/sync', syncRoutes);
router.use('/payments', paymentsRoutes);
router.use('/cabins', cabinsRoutes);
router.use('/reviews', reviewsRoutes);
router.use('/communications', communicationsRoutes);
router.use('/availability', availabilityActionsRoutes);
router.use('/health', healthRoutes);
router.use('/manual-review', manualReviewRoutes);
router.use('/readiness', readinessRoutes);
router.use('/creator-partners', creatorPartnersRoutes);
router.use('/promo-codes', promoCodesRoutes);
router.use('/creator-commissions', creatorCommissionsRoutes);

module.exports = router;
