/**
 * Winter Village media slots.
 *
 * Filenames are SEO-oriented descriptive slugs under /media/winter/.
 * Every public slot is a ready responsive picture — no photography placeholders.
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

export const WINTER_VILLAGE_SLOTS = Object.freeze({
  hero: realSlot({
    slug: 'rhodope-winter-valley-aerial',
    widths: [480, 720, 960, 1200, 1600, 1920],
    ratio: '16 / 9',
    alt: "Aerial view of a snow-covered winter valley cabin in Bulgaria's Rhodope Mountains",
    focus: 'center 45%'
  }),

  wayStay: realSlot({
    slug: 'winter-aframe-cabins-frost',
    widths: [480, 720, 960],
    ratio: '4 / 5',
    alt: 'Frosted A-frame winter cabins at The Valley in the Rhodope Mountains',
    focus: 'center 55%'
  }),

  wayParent: realSlot({
    slug: 'winter-cabin-morning-snow-view',
    widths: [480, 720, 960],
    ratio: '4 / 5',
    alt: 'Quiet morning in a winter cabin looking out over snowy Rhodope forest',
    focus: 'center 40%'
  }),

  wayChristmas: realSlot({
    slug: 'winter-village-sunset-lanterns',
    widths: [480, 720, 960, 1200],
    ratio: '4 / 5',
    alt: 'Winter sunset at The Valley with cabin lights, lanterns and Christmas warmth',
    focus: 'center 48%'
  }),

  christmasPlate: realSlot({
    slug: 'christmas-interior',
    widths: [480, 720, 960, 1200],
    ratio: '4 / 5',
    alt: 'Family Christmas around the fire inside a Valley cabin',
    focus: 'center center'
  }),

  parentPlate: realSlot({
    slug: 'winter-cabin-fireplace-mountain-view',
    widths: [480, 720, 960, 1200],
    ratio: '16 / 9',
    alt: 'Wood stove fire inside a winter cabin with mountain snow beyond the door',
    focus: 'center 55%'
  }),

  closePlate: realSlot({
    slug: 'winter-village-fire-pit-sunset',
    widths: [480, 720, 960, 1200, 1600, 1920],
    ratio: '16 / 9',
    alt: 'Fire pit and snowy cabins at sunset in a Rhodope winter village',
    focus: 'center 55%'
  }),

  datesPlate: realSlot({
    slug: 'stone-house-winter-village-dusk',
    widths: [480, 720, 960, 1200],
    ratio: '3 / 2',
    alt: 'Stone house and glowing A-frame cabins at dusk in winter at The Valley',
    focus: 'center 40%'
  }),

  preparePlate: realSlot({
    slug: 'stone-house-aframes-winter-morning',
    widths: [480, 720, 960, 1200],
    ratio: '16 / 9',
    alt: 'Stone house and A-frame winter cabins under frosted Rhodope forest',
    focus: 'center 42%'
  })
});

export const WINTER_VILLAGE_HERO_PRELOAD = `${WINTER_DIR}/rhodope-winter-valley-aerial-1920w.avif`;

export function getSlot(name) {
  return WINTER_VILLAGE_SLOTS[name] || WINTER_VILLAGE_SLOTS.hero;
}
