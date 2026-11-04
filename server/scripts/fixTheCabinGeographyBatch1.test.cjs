const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EN_LOCATION,
  BG_LOCATION,
  hasPirin,
  scrubGeographyText,
  buildGeographyUpdate
} = require('./fixTheCabinGeographyBatch1');

test('location fields become the approved geography without touching amenities', () => {
  const amenities = ['Wood stove', 'Wood-fired hot tub'];
  const { $set, notes } = buildGeographyUpdate({
    location: 'Pirin mountains, near Bachevo',
    description: 'Off-grid, wood stove, composting toilet, and a wood-fired hot tub.',
    amenities,
    i18n: {
      bg: {
        location: 'Пирин планина, край Бачево',
        description: 'Офгрид, с печка на дърва, компостна тоалетна и джакузи, подгрявано на дърва.'
      }
    }
  });

  assert.equal($set.location, EN_LOCATION);
  assert.equal($set['i18n.bg.location'], BG_LOCATION);
  assert.equal($set.description, undefined);
  assert.equal($set['i18n.bg.description'], undefined);
  assert.deepEqual(notes, ['location', 'i18n.bg.location']);
  assert.equal(JSON.stringify(amenities), JSON.stringify(['Wood stove', 'Wood-fired hot tub']));
});

test('descriptions keep non-geographical sentences and drop only Pirin wording', () => {
  const original =
    'Nestled in the rugged folds of the Pirin Mountains, The Cabin is a testament to the beauty of subtraction. Formerly Bucephalus, this is a sanctuary for the over-connected. Off-grid, wood stove, composting toilet, and a wood-fired hot tub.';
  const next = scrubGeographyText(original);
  assert.equal(hasPirin(next), false);
  assert.match(next, /wood stove, composting toilet, and a wood-fired hot tub/);
  assert.match(next, /Formerly Bucephalus/);
  assert.match(next, /Near Bachevo, in the Razlog area of southwestern Bulgaria/);

  const bg = scrubGeographyText(
    'Скътана в суровите гънки на Пирин, Къщата е доказателство за красотата на изваждането. Офгрид, с печка на дърва и джакузи, подгрявано на дърва.'
  );
  assert.equal(hasPirin(bg), false);
  assert.match(bg, /печка на дърва и джакузи/);
  assert.match(bg, new RegExp(BG_LOCATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 20)));
});
