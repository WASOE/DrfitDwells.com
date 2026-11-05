/**
 * Standard nightly rates already published on the stay pages.
 * Totals are those rates added up. The calendar confirms the price for the dates.
 * Whole-Valley hire is quoted — there is no published flat rate.
 */
export const STANDARD_NIGHTLY = Object.freeze({
  cabin: 100,
  aframe: 60,
  lux: 110,
  stone: 75,
});

function setup({ id, stayId, sleeps, nightly, quote = false }) {
  return Object.freeze({ id, stayId, sleeps, nightly, quote });
}

/**
 * Concrete ways to house this exact party. Not a single “best” property.
 * @param {number|string} party
 */
export function setupsForParty(party) {
  const count = Math.floor(Number(party));
  if (!Number.isFinite(count) || count < 1) return [];
  if (count > 18) return [];

  if (count <= 2) {
    return [
      setup({ id: 'cabin', stayId: 'cabin', sleeps: 2, nightly: STANDARD_NIGHTLY.cabin }),
      setup({ id: 'aframe', stayId: 'aframe', sleeps: 2, nightly: STANDARD_NIGHTLY.aframe }),
      setup({ id: 'lux', stayId: 'lux', sleeps: 2, nightly: STANDARD_NIGHTLY.lux }),
    ];
  }

  if (count <= 4) {
    return [
      setup({ id: 'twoAframes', stayId: 'aframe', sleeps: 4, nightly: STANDARD_NIGHTLY.aframe * 2 }),
      setup({ id: 'stone', stayId: 'stone', sleeps: 6, nightly: STANDARD_NIGHTLY.stone }),
    ];
  }

  if (count <= 6) {
    return [
      setup({ id: 'stone', stayId: 'stone', sleeps: 6, nightly: STANDARD_NIGHTLY.stone }),
      setup({ id: 'threeAframes', stayId: 'aframe', sleeps: 6, nightly: STANDARD_NIGHTLY.aframe * 3 }),
    ];
  }

  if (count <= 8) {
    return [
      setup({
        id: 'stoneOne',
        stayId: 'stone',
        sleeps: 8,
        nightly: STANDARD_NIGHTLY.stone + STANDARD_NIGHTLY.aframe,
      }),
      setup({
        id: 'stoneTwo',
        stayId: 'stone',
        sleeps: 10,
        nightly: STANDARD_NIGHTLY.stone + STANDARD_NIGHTLY.aframe * 2,
      }),
    ];
  }

  if (count === 9) {
    return [
      setup({
        id: 'stoneTwo',
        stayId: 'stone',
        sleeps: 10,
        nightly: STANDARD_NIGHTLY.stone + STANDARD_NIGHTLY.aframe * 2,
      }),
    ];
  }

  return [
    setup({ id: 'buyout', stayId: 'buyout', sleeps: 18, nightly: null, quote: true }),
  ];
}
