const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveCabinSlugFromDoc,
  KNOWN_CABIN_ID_TO_SLUG,
  STAY_SLUGS
} = require('../utils/staySlug');

test('resolveCabinSlugFromDoc uses stored slug', () => {
  assert.equal(resolveCabinSlugFromDoc({ slug: 'the-cabin', name: 'The Cabin' }), 'the-cabin');
});

test('resolveCabinSlugFromDoc maps known IDs', () => {
  assert.equal(
    resolveCabinSlugFromDoc({ _id: '69b2ff933a7fff6621e785cc', name: 'X' }),
    STAY_SLUGS.THE_CABIN
  );
});

test('resolveCabinSlugFromDoc maps cleaning tags', () => {
  assert.equal(
    resolveCabinSlugFromDoc({ name: 'Unit', cleaningTags: ['stone-house'] }),
    STAY_SLUGS.STONE_HOUSE
  );
});

test('KNOWN_CABIN_ID_TO_SLUG is stable', () => {
  assert.equal(KNOWN_CABIN_ID_TO_SLUG['69b2ff947f141a71ffa7c492'], STAY_SLUGS.LUX_CABIN);
});
