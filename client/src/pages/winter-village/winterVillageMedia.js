/**
 * Winter Village media slots.
 *
 * Every image on the page comes from this manifest. A slot either points at a real,
 * verified asset or stays `null` and renders as a designed plate that states the shot
 * we need. Nothing here may be AI-generated, stock, or from a green season — the
 * winter Valley footage in /uploads carries a Veo watermark and is deliberately unused.
 *
 * To fill a slot: drop the photograph in `client/public/media/winter/`, run the
 * variant generator, then set `widths` and `basePath` below.
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

function pendingSlot({ brief, ratio, alt }) {
  return { ready: false, brief, ratio, alt, focus: 'center center' };
}

export const WINTER_VILLAGE_SLOTS = Object.freeze({
  hero: pendingSlot({
    ratio: '16 / 9',
    alt: 'The Valley under snow',
    brief:
      'Wide winter valley at first or last light. Cabins small in the frame, snow reading blue in shadow and warm where the sun hits. Horizontal, room at the base for type.'
  }),

  wayStay: pendingSlot({
    ratio: '4 / 5',
    alt: 'An A-frame in the snow',
    brief:
      'A single A-frame in deep snow, lit from inside, shot at dusk. Vertical. Quiet and unpeopled.'
  }),

  wayParent: pendingSlot({
    ratio: '4 / 5',
    alt: 'A parent and child in the snow',
    brief:
      'One adult and one child outdoors in snow — sledge, firewood, or walking away from camera. Vertical. Faces optional, warmth essential.'
  }),

  wayChristmas: realSlot({
    slug: 'christmas-interior',
    widths: [480, 720, 960, 1200],
    ratio: '4 / 5',
    alt: 'A cabin interior at The Valley with a Christmas tree and bare winter trees outside',
    focus: 'center 70%'
  }),

  christmasPlate: realSlot({
    slug: 'christmas-interior',
    widths: [480, 720, 960, 1200],
    ratio: '4 / 5',
    alt: 'Inside a Valley cabin at Christmas — sheepskin, kilim, leather and a small tree',
    focus: 'center center'
  }),

  parentPlate: realSlot({
    slug: 'cabin-fire-interior',
    widths: [480, 720, 960, 1200, 1920],
    ratio: '16 / 9',
    alt: 'A wood-burning stove alight inside a Valley cabin',
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

/** Preload target for the hero. Falls back to a real asset until the hero photo lands. */
export const WINTER_VILLAGE_HERO_PRELOAD = WINTER_VILLAGE_SLOTS.hero.ready
  ? `${WINTER_DIR}/hero-1920w.avif`
  : `${WINTER_DIR}/cabin-fire-interior-1920w.avif`;

export function getSlot(name) {
  return WINTER_VILLAGE_SLOTS[name] || WINTER_VILLAGE_SLOTS.hero;
}
