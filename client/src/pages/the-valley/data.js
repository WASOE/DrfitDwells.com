// Shared constants and data for The Valley page
import { VALLEY_MEDIA } from '../../config/mediaConfig';

// Valley hero always uses the primary firaplace video pair here:
// - winter video -> winter poster
// - summer video -> summer poster
export const VALLEY_VIDEOS = VALLEY_MEDIA.heroVideo;
export const VALLEY_STILLS = VALLEY_MEDIA.heroPoster;

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

// Stay cards data
export const STAY_CARDS = [
  {
    id: 'luxury-cabin',
    title: 'Luxury Cabin',
    backendName: 'Lux Cabin',
    route: null,
    sleeps: '2',
    price: '€85/night',
    image: '/uploads/The%20Valley/Lux-cabin-exterior-watermark-remover-20260113071503.jpg',
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
    backendName: 'Stone House',
    route: null,
    sleeps: 'up to 6',
    price: '€25/person (min 3)',
    image: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.24%20AM.jpeg',
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
    backendName: null,
    route: '/stays/a-frame',
    sleeps: '2 per cabin',
    price: '€60/night',
    image: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.24%20AM%20(4).jpeg',
    imagePath: '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (4).jpeg',
    bullets: [
      'Minimal design immersed in nature',
      'Focused on simplicity and quiet',
      'Perfect for solo travelers or couples'
    ]
  }
];
