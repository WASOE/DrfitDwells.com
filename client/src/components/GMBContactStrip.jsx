import { MapPin, Phone } from 'lucide-react';
import { GMB_LOCATIONS, CONTACT_PHONE } from '../data/gmbLocations';

/**
 * NAP (Name, Address, Phone) strip for local SEO & GMB consistency.
 * Renders "Get directions" and "Call" buttons linked to the correct location.
 */
const GMBContactStrip = ({
  locationKey = 'cabin',
  variant = 'dark',
  directionsLabel = 'Get directions',
  callLabel = 'Call'
}) => {
  const loc = GMB_LOCATIONS[locationKey];
  if (!loc) return null;

  const mapsUrl = loc.getMapsUrl();
  const telHref = `tel:${CONTACT_PHONE.replace(/\s/g, '')}`;

  const isDark = variant === 'dark';
  const btnClass = isDark
    ? 'border-white/40 text-white hover:bg-white/10'
    : 'border-gray-300 text-gray-800 hover:bg-gray-50';

  return (
    <div className={`flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-start sm:items-center ${isDark ? 'text-neutral-300' : 'text-gray-600'}`}>
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 flex-shrink-0" aria-hidden />
        <span className="text-sm">{loc.address.formatted}</span>
      </div>
      <div className="flex items-center gap-3">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border transition-colors ${btnClass}`}
        >
          <MapPin className="w-4 h-4" aria-hidden />
          {directionsLabel}
        </a>
        <a
          href={telHref}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border transition-colors ${btnClass}`}
        >
          <Phone className="w-4 h-4" aria-hidden />
          {callLabel}
        </a>
      </div>
    </div>
  );
};

export default GMBContactStrip;
