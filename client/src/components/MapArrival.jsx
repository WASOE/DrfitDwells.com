import { useMemo } from 'react';

// Static map image generator (placeholder - can be replaced with actual map service)
function generateMapUrl(latitude, longitude, zoom = 11) {
  // Using a placeholder service - replace with your preferred map provider
  // Options: Google Maps Static API, Mapbox Static Images, or OpenStreetMap
  if (!latitude || !longitude) return null;
  
  // Example: OpenStreetMap static image (free, no API key needed)
  // For production, consider using Mapbox or Google Maps Static API
  const tileSize = 256;
  const scale = 2; // Retina
  const size = `${tileSize * scale}x${tileSize * scale}`;
  
  // Note: This is a placeholder. For production, use a proper map service
  return `https://api.mapbox.com/styles/v1/mapbox/outdoors-v11/static/pin-s+81887A(${longitude},${latitude})/${longitude},${latitude},${zoom}/${size}?access_token=YOUR_TOKEN`;
}

export default function MapArrival({ cabin }) {
  const hasGeoLocation = cabin?.geoLocation?.latitude && cabin?.geoLocation?.longitude;
  const latitude = cabin?.geoLocation?.latitude;
  const longitude = cabin?.geoLocation?.longitude;
  const zoom = cabin?.geoLocation?.zoom || 11;
  const location = cabin?.location || 'Rila Mountains, Bulgaria';
  
  // Route hint - can be customized per cabin
  const routeHint = useMemo(() => {
    // Default route hint for The Valley
    return 'Eleshnitza → new road → park at 41.950040, 23.715822';
  }, []);

  return (
    <section className="mt-12 md:mt-16">
      <h2 className="section-title mb-4">Getting here</h2>
      
      {/* Route Hint */}
      <div className="mb-4 bg-gray-50 rounded-xl p-4 border border-gray-200">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#81887A] flex items-center justify-center mt-0.5">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900 mb-1">Route</p>
            <p className="text-sm text-gray-600">{routeHint}</p>
            <p className="text-xs text-gray-500 mt-2 italic">
              Last 1 km is protected area: on foot / ATV / horse.
            </p>
          </div>
        </div>
      </div>
      
      {/* Map Card */}
      <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-md mb-6 bg-gray-50">
        {hasGeoLocation ? (
          <div className="relative aspect-[16/9] bg-gray-100">
            {/* Placeholder map - replace with actual map service */}
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
              <div className="text-center p-8">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#81887A] flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-600 font-medium">{location}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Coordinates: {latitude.toFixed(4)}, {longitude.toFixed(4)}
                </p>
                <p className="text-xs text-gray-400 mt-2 italic">
                  Exact location shared after booking
                </p>
              </div>
            </div>
            {/* In production, uncomment and use actual map:
            <img
              src={generateMapUrl(latitude, longitude, zoom)}
              alt={`Map showing ${location}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            */}
          </div>
        ) : (
          <div className="aspect-[16/9] bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
            <div className="text-center p-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-300 flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <p className="text-sm text-gray-600 font-medium">{location}</p>
              <p className="text-xs text-gray-500 mt-2">
                Map coordinates will be available after booking
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Parking Pin */}
      {cabin?.meetingPoint?.label && (
        <div className="mt-4 bg-blue-50 rounded-xl p-4 border border-blue-200">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center mt-0.5">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900 mb-1">Guest Parking</p>
              <p className="text-sm text-blue-700">{cabin.meetingPoint.label}</p>
              {cabin.meetingPoint.what3words && (
                <p className="text-xs text-blue-600 mt-1 font-mono">
                  {cabin.meetingPoint.what3words}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

