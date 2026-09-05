// Shared constants and data for The Valley page
import { VALLEY_MEDIA } from '../../config/mediaConfig';

// Valley hero always uses the primary firaplace video pair here:
// - winter video -> winter poster
// - summer video -> summer poster
// Do not change these video paths when updating page stills.
export const VALLEY_VIDEOS = VALLEY_MEDIA.heroVideo;
export const VALLEY_STILLS = VALLEY_MEDIA.heroPoster;

/** SEO-named winter stills under /media/winter/ (page body only — not hero video). */
function winterStill(slug, alt, caption) {
  const path = `/media/winter/${slug}.jpg`;
  return {
    path,
    encoded: path.replace(/ /g, '%20'),
    alt,
    ...(caption ? { caption } : {})
  };
}

/**
 * Season-aware stills for /valley page sections.
 * Hero video/poster stay on VALLEY_VIDEOS / VALLEY_STILLS above.
 */
export const VALLEY_PAGE_SEASON_IMAGES = Object.freeze({
  editorialOverview: Object.freeze({
    summer: Object.freeze({
      path: '/uploads/The Valley/Screencastfrom2024-09-3022-01-26-ezgif.com-video-to-gif-converter-1-1.gif',
      encoded: '/uploads/The%20Valley/Screencastfrom2024-09-3022-01-26-ezgif.com-video-to-gif-converter-1-1.gif',
      alt: 'The Valley animated overview showing mountain village layout, A-frame cabins, and natural landscape'
    }),
    winter: winterStill(
      'stone-house-aframes-winter-morning',
      'Stone house and frosted A-frame cabins on a winter morning at The Valley, Rhodope Mountains, Bulgaria'
    )
  }),

  editorialCarousel: Object.freeze({
    summer: Object.freeze([
      Object.freeze({
        path: '/uploads/Content website/drift-dwells-bulgaria-fireside-lounge.avif',
        encoded: '/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif',
        alt: 'Communal fireside lounge interior at The Valley Stone House showing fireplace, comfortable seating, and cozy gathering space for guests, Rhodope Mountains',
        caption: 'The communal Stone House at The Valley, a shared gathering space for guests to connect, cook, and relax together.'
      }),
      Object.freeze({
        path: '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg',
        encoded: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.23%20AM.jpeg',
        alt: 'Panoramic landscape view of The Valley mountain village showing Stone House, A-frame cabins, and forest backdrop at 1,550m altitude, Rhodope Mountains, Bulgaria',
        caption: 'The Valley at 1,550m altitude, a mountain village where each stay is private but the land is shared.'
      }),
      Object.freeze({
        path: '/uploads/The Valley/1768207815-2996ea84.jpg',
        encoded: '/uploads/The%20Valley/1768207815-2996ea84.jpg',
        alt: 'Panoramic summer view of The Valley mountain village at 1,550m altitude showing A-frame cabins, Stone House, and shared spaces, Rhodope Mountains, Bulgaria',
        caption: 'A small, walkable mountain village where each stay is private, but the land itself is shared.'
      })
    ]),
    winter: Object.freeze([
      winterStill(
        'winter-cabin-fireplace-mountain-view',
        'Wood stove fire inside a winter cabin with snowy mountain forest beyond the door at The Valley',
        'Warm cabin interiors and wood fires for quiet winter evenings in The Valley.'
      ),
      winterStill(
        'stone-house-aframes-winter-morning',
        'Stone house and frosted A-frame cabins under snowy Rhodope forest at The Valley',
        'The Valley at 1,550m in winter — private cabins, shared land, and mountain quiet.'
      ),
      winterStill(
        'rhodope-winter-valley-aerial',
        "Aerial view of a snow-covered winter valley cabin in Bulgaria's Rhodope Mountains",
        'A small winter mountain village where each stay is private, but the land itself is shared.'
      )
    ])
  }),

  vibeCompare: Object.freeze({
    summer: Object.freeze({
      path: '/uploads/The Valley/1768207815-2996ea84.jpg',
      encoded: '/uploads/The%20Valley/1768207815-2996ea84.jpg',
      alt: 'Panoramic summer view of The Valley mountain village at 1,550m altitude showing A-frame cabins, Stone House, and shared spaces, Rhodope Mountains, Bulgaria'
    }),
    winter: winterStill(
      'winter-aframe-cabins-frost',
      'Frosted A-frame winter cabins at The Valley in the Rhodope Mountains, Bulgaria'
    )
  }),

  vibeMoments: Object.freeze({
    summer: Object.freeze([
      Object.freeze({
        image: Object.freeze({
          path: '/uploads/The Valley/-03e7a985-8967-4a35-9169-36206d128506.png',
          encoded: '/uploads/The%20Valley/-03e7a985-8967-4a35-9169-36206d128506.png',
          alt: 'Communal fireplace evening gathering at The Valley showing glowing fire and warm atmosphere at 1,550m altitude, Rhodope Mountains, Bulgaria',
          ratio: '4/5'
        }),
        moment: 'Evenings by the communal firepit'
      }),
      Object.freeze({
        image: Object.freeze({
          path: '/uploads/The Valley/WhatsApp Image 2025-12-03 at 4.36.14 PM.jpeg',
          encoded: '/uploads/The%20Valley/WhatsApp%20Image%202025-12-03%20at%204.36.14%20PM.jpeg',
          alt: 'Couple enjoying front of A-frame cabin at The Valley with mountain forest backdrop at 1,550m altitude, Rhodope Mountains, Bulgaria',
          ratio: '4/5'
        }),
        moment: 'Morning coffee on the porch with mountain views'
      }),
      Object.freeze({
        image: Object.freeze({
          path: '/uploads/The Valley/Lux-cabin-exterior-1768207498-98737209.jpg',
          encoded: '/uploads/The%20Valley/Lux-cabin-exterior-1768207498-98737209.jpg',
          alt: 'Person reading in nature at The Valley showing outdoor reading space and natural setting at 1,550m altitude, Rhodope Mountains, Bulgaria',
          ratio: '4/5'
        }),
        moment: 'Quiet reading in nature'
      }),
      Object.freeze({
        image: Object.freeze({
          path: '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.42 AM (1).jpeg',
          encoded: '/uploads/The%20Valley/Lux-cabin-WhatsApp%20Image%202026-01-11%20at%2011.43.42%20AM%20%281%29.jpeg',
          alt: 'Luxury cabin interior with sunset window view at The Valley showing person looking out at golden hour, 1,550m altitude, Rhodope Mountains, Bulgaria',
          ratio: '4/5'
        }),
        moment: 'Sunrise from your cabin window'
      }),
      Object.freeze({
        image: Object.freeze({
          path: '/uploads/Content website/drift-dwells-bulgaria-starlit-mountain.avif',
          encoded: '/uploads/Content%20website/drift-dwells-bulgaria-starlit-mountain.avif',
          alt: 'Starry night sky over The Valley showing mountains, starry sky, and night landscape at 1,550m altitude, Rhodope Mountains, Bulgaria',
          ratio: '4/5'
        }),
        moment: 'Hot tub under the stars'
      }),
      Object.freeze({
        image: Object.freeze({
          path: '/uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.40 AM.jpeg',
          encoded: '/uploads/The%20Valley/WhatsApp%20Image%202026-01-11%20at%2011.43.40%20AM.jpeg',
          alt: 'ATVs in mountain landscape at The Valley showing red vehicles and mountain views at 1,550m altitude, Rhodope Mountains, Bulgaria',
          ratio: '4/5'
        }),
        moment: 'ATV adventures through mountain trails'
      })
    ]),
    winter: Object.freeze([
      Object.freeze({
        image: Object.freeze({
          ...winterStill(
            'winter-village-fire-pit-sunset',
            'Fire pit and snowy cabins at sunset in a Rhodope winter village'
          ),
          ratio: '4/5'
        }),
        moment: 'Evenings by the communal firepit'
      }),
      Object.freeze({
        image: Object.freeze({
          ...winterStill(
            'porch-dusk',
            'Winter porch at dusk looking out over snowy mountain forest at The Valley'
          ),
          ratio: '4/5'
        }),
        moment: 'Morning coffee on the porch with mountain views'
      }),
      Object.freeze({
        image: Object.freeze({
          ...winterStill(
            'cabin-fire-interior',
            'Cozy cabin interior with wood fire for quiet winter reading at The Valley'
          ),
          ratio: '4/5'
        }),
        moment: 'Quiet reading by the fire'
      }),
      Object.freeze({
        image: Object.freeze({
          ...winterStill(
            'winter-cabin-morning-snow-view',
            'Quiet morning in a winter cabin looking out over snowy Rhodope forest'
          ),
          ratio: '4/5'
        }),
        moment: 'Sunrise from your cabin window'
      }),
      Object.freeze({
        image: Object.freeze({
          ...winterStill(
            'winter-village-sunset-lanterns',
            'Winter sunset at The Valley with cabin lights and lanterns'
          ),
          ratio: '4/5'
        }),
        moment: 'Lantern-lit winter evenings'
      }),
      Object.freeze({
        image: Object.freeze({
          ...winterStill(
            'stone-house-winter-village-dusk',
            'Stone house and glowing A-frame cabins at dusk in winter at The Valley'
          ),
          ratio: '4/5'
        }),
        moment: 'Snow days around the village'
      })
    ])
  }),

  bookingCta: Object.freeze({
    summer: Object.freeze({
      path: '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg',
      encoded: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.23%20AM.jpeg',
      alt: 'Panoramic view of The Valley mountain village at sunset'
    }),
    winter: winterStill(
      'stone-house-winter-village-dusk',
      'Stone house and glowing A-frame cabins at winter dusk in The Valley, Rhodope Mountains'
    )
  }),

  /** Stay card covers when Winter is selected (overrides listing summer covers). */
  stayCovers: Object.freeze({
    'luxury-cabin': winterStill(
      'winter-cabin-fireplace-mountain-view',
      'Luxury winter cabin interior with wood stove and mountain snow view at The Valley'
    ),
    'stone-house': winterStill(
      'stone-house-aframes-winter-morning',
      'Stone House and frosted A-frames on a winter morning at The Valley'
    ),
    'a-frames': winterStill(
      'winter-aframe-cabins-frost',
      'Frosted A-frame winter cabins at The Valley in the Rhodope Mountains'
    )
  })
});

// Noise texture SVG data URL
export const NOISE_TEXTURE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E";

// Grain overlay texture
export const GRAIN_OVERLAY = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23grain)'/%3E%3C/svg%3E";

// Map pin data
export const MAP_PINS = [
  { id: 'drifters', x: 644, y: 804, label: 'The Drifters', subtitle: '13 Geometric Cocoons', tabId: 'drifters' },
  { id: 'swing', x: 1205, y: 60, label: 'Panoramic Swing', subtitle: 'Overlook the valley', tabId: null },
  { id: 'fire', x: 1679, y: 527, label: 'Fireplace', subtitle: 'Gather around the fire', tabId: null },
  { id: 'stone', x: 1701, y: 764, label: 'The Stone House', subtitle: 'Starlink & Community', tabId: 'stone' },
  { id: 'lux', x: 2353, y: 1360, label: 'Lux Cabin', subtitle: 'Secluded Vantage Point', tabId: 'lux' },
];

// Location callout cards data
export const LOCATION_CALLOUTS = [
  {
    title: 'Stone House',
    sleeps: 'up to 6',
    bestFor: 'families or small groups',
    feature: 'Historic stone house with generous shared living spaces and Starlink'
  },
  {
    title: 'A-Frames',
    sleeps: '2 per cabin',
    bestFor: 'solo travelers or couples',
    feature: 'Minimal cabins immersed in nature, focused on simplicity and quiet'
  },
  {
    title: 'Luxury Cabin',
    sleeps: '2',
    bestFor: 'couples',
    feature: 'Private cabin with full comfort, heating, and uninterrupted views'
  }
];

// Stay cards data — images resolve live via `listingSlug`; `fallbackImage` is emergency only.
export const STAY_CARDS = [
  {
    id: 'luxury-cabin',
    title: 'Luxury Cabin',
    listingSlug: 'lux-cabin',
    route: '/stays/lux-cabin',
    sleeps: '2',
    price: '€85/night',
    fallbackImage: '/uploads/The%20Valley/Lux-cabin-exterior-watermark-remover-20260113071503.jpg',
    imagePath: '/uploads/The Valley/Lux-cabin-exterior-watermark-remover-20260113071503.jpg',
    bullets: [
      'Full comfort with heating and modern amenities',
      'Uninterrupted panoramic mountain views',
      'Private, secluded vantage point'
    ]
  },
  {
    id: 'stone-house',
    title: 'Stone House',
    listingSlug: 'stone-house',
    route: '/stays/stone-house',
    sleeps: 'up to 6',
    price: '€75/night',
    fallbackImage: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.24%20AM.jpeg',
    imagePath: '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM.jpeg',
    bullets: [
      'Historic stone construction with generous shared spaces',
      'Starlink internet and coworking space',
      'Perfect for families or small groups'
    ]
  },
  {
    id: 'a-frames',
    title: 'A-Frames',
    listingSlug: 'a-frame',
    route: '/stays/a-frame',
    sleeps: '2 per cabin',
    price: '€60/night',
    fallbackImage: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.24%20AM%20(4).jpeg',
    imagePath: '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (4).jpeg',
    bullets: [
      'Minimal design immersed in nature',
      'Focused on simplicity and quiet',
      'Perfect for solo travelers or couples'
    ]
  }
];
