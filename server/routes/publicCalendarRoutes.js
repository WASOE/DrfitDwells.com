const express = require('express');
const { getPublicCabinCalendarIcs, getPublicUnitCalendarIcs } = require('../controllers/publicCalendarController');

const router = express.Router();

router.get('/calendar/unit/:unitId.ics', getPublicUnitCalendarIcs);
router.get('/calendar/:cabinId.ics', getPublicCabinCalendarIcs);

module.exports = router;
