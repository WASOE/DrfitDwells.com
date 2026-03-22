const express = require('express');
const { getPublicCabinCalendarIcs } = require('../controllers/publicCalendarController');

const router = express.Router();

router.get('/calendar/:cabinId.ics', getPublicCabinCalendarIcs);

module.exports = router;
