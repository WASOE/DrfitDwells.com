/* eslint-disable no-console */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const { getCalendarReadModel } = require('../services/ops/readModels/calendarReadModel');
const Cabin = require('../models/Cabin');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  try {
    const now = new Date();
    const to = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 21);

    const idx = await getCalendarReadModel({ indexPreview: true, previewDays: 14 });
    assert(idx.mode === 'index_preview', 'index preview mode');
    assert(Array.isArray(idx.previewByCabin), 'previewByCabin array');
    assert(idx.meta?.today && typeof idx.meta.today === 'string', 'meta.today');
    if (idx.previewByCabin.length > 0) {
      const row = idx.previewByCabin[0];
      assert(row.cabinId && row.listing, 'preview row shape');
      assert(Array.isArray(row.blocks), 'preview blocks');
      row.blocks.forEach((b) => {
        assert(b.render?.blockTypeToken === b.blockType, 'render.blockTypeToken');
        assert(Array.isArray(b.render?.occupiedDayKeys), 'render.occupiedDayKeys');
      });
    }

    const first = await Cabin.findOne({}).select('_id').lean();
    if (first) {
      const cid = String(first._id);
      const range = await getCalendarReadModel({ from: now, to, cabinId: cid });
      assert(range.mode === 'range', 'range mode');
      assert(range.meta?.today, 'range meta.today');
      assert(Array.isArray(range.blocks), 'range blocks');
      range.blocks.forEach((b) => {
        assert(b.render?.occupiedDayKeys, 'range block render.occupiedDayKeys');
        assert(['hard', 'warning', null].includes(b.render.conflictToken), 'conflictToken');
      });
      assert(range.pricingHint !== undefined, 'pricingHint present');
    }

    const mobileQaChecklist = [
      'Viewport ~390px: /ops/calendar index cards scroll horizontally on preview strip without clipping property name.',
      'Tap property → month grid loads; Prev/Next changes month; Today cell has amber ring.',
      'Tap reservation bar → navigates to /ops/reservations/:id.',
      'Tap manual/maintenance bar → menu: Edit dates / Remove; no silent errors on failure.',
      'Add manual block from form: inclusive start / exclusive end; list refreshes.',
      'Verify /admin/bookings still opens (no ops regression).'
    ];

    console.log(
      JSON.stringify(
        {
          success: true,
          batch: 'calendar-ux',
          indexPreviewCabins: idx.previewByCabin.length,
          rangeSampleCabinId: first ? String(first._id) : null,
          mobileQaChecklist
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((e) => {
  console.error(JSON.stringify({ success: false, batch: 'calendar-ux', error: e.message }, null, 2));
  process.exit(1);
});
