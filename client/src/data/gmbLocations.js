/**
 * Google My Business (Google Business Profile) - Two separate locations
 * Both are in remote forest areas; we use locality + postal code + coordinates (no street address).
 * Used for schema.org structured data, NAP consistency, and local SEO.
 */

const ORIGIN = import.meta.env.VITE_SITE_URL || 'https://driftdwells.com';

// Shared contact – verified GMB phone
export const CONTACT_PHONE = import.meta.env.VITE_CONTACT_PHONE || '+359 876342540';
export const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || 'jose@driftdwells.com';

/** Official brand profiles (optional VITE_ overrides for staging). */
export const INSTAGRAM_URL =
  (import.meta.env.VITE_INSTAGRAM_URL && String(import.meta.env.VITE_INSTAGRAM_URL).trim()) ||
  'https://www.instagram.com/driftdwells/';
export const FACEBOOK_URL =
  (import.meta.env.VITE_FACEBOOK_URL && String(import.meta.env.VITE_FACEBOOK_URL).trim()) ||
  'https://www.facebook.com/profile.php?id=61569960933269';

// Google Maps share links – open the exact GMB listing for directions
const MAPS_CABIN = 'https://maps.app.goo.gl/5luftFa6jGhLWbVei';
const MAPS_VALLEY = 'https://maps.app.goo.gl/AJuuoOQesyJnWb6CJ';

export const GMB_LOCATIONS = {
  cabin: {
    name: 'Drift & Dwells The Cabin',
    businessName: 'The Cabin – Drift & Dwells',
    slug: 'cabin',
    url: `${ORIGIN}/cabin`,
    description: 'Off-grid mountain cabin for two in the Rhodope Mountains, Bulgaria. Wood stove heating, spring water, and no wifi for a deep digital detox.',
    address: {
      street: '',
      locality: 'Bachevo',
      postalCode: '2769',
      region: 'Blagoevgrad Province',
      country: 'BG',
      // Forest location: locality + postal code (coordinates used for navigation)
      formatted: 'Bachevo area, 2769 • Blagoevgrad Province, Bulgaria'
    },
    geo: {
      latitude: 41.930890053094295,
      longitude: 23.401714820239732
    },
    mapsUrl: import.meta.env.VITE_GMB_CABIN_MAPS_URL || MAPS_CABIN,
    getMapsUrl: function() { return this.mapsUrl; }
  },
  valley: {
    name: 'Drift & Dwells The Valley',
    businessName: 'The Valley – Drift & Dwells',
    slug: 'valley',
    url: `${ORIGIN}/valley`,
    description: 'A private mountain village retreat above the clouds in the Bulgarian mountains with individual cabins, a historic stone house, and shared outdoor spaces.',
    address: {
      street: '',
      locality: 'Chereshovo',
      postalCode: '2787',
      region: 'Blagoevgrad Province',
      country: 'BG',
      formatted: 'Chereshovo area, 2787 • Blagoevgrad Province, Bulgaria'
    },
    geo: {
      latitude: 41.955311344181226,
      longitude: 23.73894933558219
    },
    mapsUrl: import.meta.env.VITE_GMB_VALLEY_MAPS_URL || MAPS_VALLEY,
    getMapsUrl: function() { return this.mapsUrl; }
  }
};
