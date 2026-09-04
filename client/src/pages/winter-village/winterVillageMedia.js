/**
 * Winter Village media slots.
 *
 * Ready slots point at verified real assets. Pending slots render as silent
 * atmospheric plates — no public photography briefs or placeholder copy in the DOM.
 */

const WINTER_DIR = '/media/winter';

function sources(basePath, widths) {
  return {
    avif: widths.map((w) => `${basePath}-${w}w.avif ${w}w`).join(', '),
    webp: widths.map((w) => `${basePath}-${w}w.webp ${w}w`).join(', '),
    fallback: `${basePath}.jpg`
  };
}

function realSlot({ slug, widths, alt, ratio, focus = 'center center' }) {
  return {
    ready: true,
    alt,
    ratio,
    focus,
    ...sources(`${WINTER_DIR}/${slug}`, widths)
  };
}

function pendingSlot({ ratio, alt }) {
  return { ready: false, ratio, alt, focus: 'center center' };
}

export const WINTER_VILLAGE_SLOTS = Object.freeze({
  hero: pendingSlot({
    ratio: '16 / 9',
    alt: "Snow-covered cabins at The Valley in Bulgaria's Rhodope Mountains"
  }),

  wayStay: pendingSlot({
    ratio: '4 / 5',
    alt: 'A-frame cabin in winter at The Valley'
  }),

  wayParent: pendingSlot({
    ratio: '4 / 5',
    alt: 'Parent and child on a winter weekend in the Rhodope Mountains'
  }),

  wayChristmas: realSlot({
    slug: 'christmas-interior',
    widths: [480, 720, 960, 1200],
    ratio: '4 / 5',
    alt: 'Family Christmas around the fire at The Valley',
    focus: 'center 70%'
  }),

  christmasPlate: realSlot({
    slug: 'christmas-interior',
    widths: [480, 720, 960, 1200],
    ratio: '4 / 5',
    alt: 'Family Christmas around the fire at The Valley',
    focus: 'center center'
  }),

  parentPlate: realSlot({
    slug: 'cabin-fire-interior',
    widths: [480, 720, 960, 1200, 1920],
    ratio: '16 / 9',
    alt: 'Wood fire inside a private cabin at The Valley',
    focus: 'center 60%'
  }),

  closePlate: realSlot({
    slug: 'cabin-fire-interior',
    widths: [480, 720, 960, 1200, 1920],
    ratio: '16 / 9',
    alt: 'Firelight inside a Valley cabin after dark',
    focus: '70% 55%'
  }),

  datesPlate: realSlot({
    slug: 'porch-dusk',
    widths: [480, 720, 960, 1200],
    ratio: '3 / 2',
    alt: 'Two chairs on a Valley cabin porch in the cold season',
    focus: 'center center'
  })
});

/** Preload a real winter still until a dedicated hero photograph lands. */
export const WINTER_VILLAGE_HERO_PRELOAD = `${WINTER_DIR}/cabin-fire-interior-1920w.avif`;

export function getSlot(name) {
  return WINTER_VILLAGE_SLOTS[name] || WINTER_VILLAGE_SLOTS.hero;
}
