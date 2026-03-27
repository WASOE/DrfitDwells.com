import { useMemo, useState } from 'react';

function getAllCoords(data) {
  const coords = [];
  const addLine = (line) => {
    (line?.coordinates || []).forEach((c) => {
      if (Number.isFinite(c?.lat) && Number.isFinite(c?.lng)) coords.push(c);
    });
  };
  const addPoint = (point) => {
    const c = point?.coordinates?.[0];
    if (Number.isFinite(c?.lat) && Number.isFinite(c?.lng)) coords.push(c);
  };

  addLine(data?.defaultVisible?.safestRoute);
  addLine(data?.secondary?.walkingRoute);
  addPoint(data?.defaultVisible?.cabinLocation);
  addPoint(data?.defaultVisible?.primaryParkAndWalk);
  addPoint(data?.defaultVisible?.signalPoint);
  return coords;
}

function scalePoint(lat, lng, bounds, width, height, padding) {
  const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng || 1)) * (width - padding * 2) + padding;
  const y = ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat || 1)) * (height - padding * 2) + padding;
  return { x, y };
}

function expandBounds(bounds, ratio = 0.18) {
  const latSpan = bounds.maxLat - bounds.minLat || 0.01;
  const lngSpan = bounds.maxLng - bounds.minLng || 0.01;
  const latPad = latSpan * ratio;
  const lngPad = lngSpan * ratio;
  return {
    minLat: bounds.minLat - latPad,
    maxLat: bounds.maxLat + latPad,
    minLng: bounds.minLng - lngPad,
    maxLng: bounds.maxLng + lngPad
  };
}

function routePath(route, bounds, width, height, padding) {
  const coords = route?.coordinates || [];
  if (!coords.length) return '';
  const points = coords
    .filter((c) => Number.isFinite(c?.lat) && Number.isFinite(c?.lng))
    .map((c) => scalePoint(c.lat, c.lng, bounds, width, height, padding));
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function Marker({ point, bounds, width, height, padding, label, tone, dx = 10, dy = -10 }) {
  const c = point?.coordinates?.[0];
  if (!c) return null;
  const p = scalePoint(c.lat, c.lng, bounds, width, height, padding);
  return (
    <g>
      <circle cx={p.x} cy={p.y} r="6" fill={tone} stroke="#ffffff" strokeWidth="2" />
      <text className="public-guide-map-label" x={p.x + dx} y={p.y + dy} fontSize="11" fill="#1a1a1a" fontWeight="600">
        {label}
      </text>
    </g>
  );
}

export default function GuideMapModule({ data }) {
  const [showWalking, setShowWalking] = useState(false);
  const width = 980;
  const height = 520;
  const padding = 28;

  const rawBounds = useMemo(() => {
    const points = getAllCoords(data);
    if (!points.length) return null;
    return {
      minLat: Math.min(...points.map((p) => p.lat)),
      maxLat: Math.max(...points.map((p) => p.lat)),
      minLng: Math.min(...points.map((p) => p.lng)),
      maxLng: Math.max(...points.map((p) => p.lng))
    };
  }, [data]);

  const bounds = useMemo(() => (rawBounds ? expandBounds(rawBounds) : null), [rawBounds]);

  if (!data || !bounds) {
    return (
      <div className="public-guide-panel">
        <p>Guide map is temporarily unavailable. Use Navigate and coordinates above.</p>
      </div>
    );
  }

  const safest = routePath(data.defaultVisible?.safestRoute, bounds, width, height, padding);
  const walking = routePath(data.secondary?.walkingRoute, bounds, width, height, padding);
  const routeStart = data?.defaultVisible?.safestRoute?.coordinates?.[0]
    ? {
        coordinates: [data.defaultVisible.safestRoute.coordinates[0]]
      }
    : null;

  const staticBaseMapUrl = data?.staticBaseMapUrl;

  return (
    <div className="public-guide-map-block">
      <div className="public-guide-map-head">
        <p className="valley-label">Guide map</p>
        <p className="valley-caption">Recommended arrival route from Bachevo approach to The Cabin.</p>
      </div>
      <div className="public-guide-map-canvas">
        {staticBaseMapUrl ? (
          <img
            src={staticBaseMapUrl}
            alt="Top-down map context around The Cabin arrival route"
            loading="lazy"
          />
        ) : (
          <div className="public-guide-map-missing-base">
            Static base map unavailable for this guide area.
          </div>
        )}
        <svg
          className="public-guide-map-overlay"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="The Cabin arrival guide route overlay"
        >
          <polyline points={safest} fill="none" stroke="#ffffff" strokeOpacity="0.95" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={safest} fill="none" stroke="#1f2a24" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {showWalking && walking ? (
            <>
              <polyline points={walking} fill="none" stroke="#ffffff" strokeOpacity="0.95" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={walking} fill="none" stroke="#81887A" strokeWidth="3" strokeDasharray="8 6" strokeLinecap="round" strokeLinejoin="round" />
            </>
          ) : null}

          <Marker point={routeStart} bounds={bounds} width={width} height={height} padding={padding} label="Route start" tone="#6b7280" dx={12} dy={-12} />
          <Marker point={data.defaultVisible?.cabinLocation} bounds={bounds} width={width} height={height} padding={padding} label="Cabin" tone="#1f2a24" dx={12} dy={16} />
          <Marker point={data.defaultVisible?.primaryParkAndWalk} bounds={bounds} width={width} height={height} padding={padding} label="Park here" tone="#8b6f3d" dx={12} dy={-14} />
          <Marker point={data.defaultVisible?.signalPoint} bounds={bounds} width={width} height={height} padding={padding} label="Phone signal" tone="#81887A" dx={12} dy={16} />
        </svg>
      </div>

      <div className="public-guide-map-controls">
        <div className="public-guide-map-legend">
          <span><i style={{ background: '#6b7280' }} /> Route start</span>
          <span><i style={{ background: '#1f2a24' }} /> Recommended route</span>
          <span><i style={{ background: '#8b6f3d' }} /> Park here</span>
          <span><i style={{ background: '#81887A' }} /> Phone signal</span>
          <span><i style={{ background: '#1f2a24' }} /> Cabin</span>
        </div>
        <button
          type="button"
          onClick={() => setShowWalking((v) => !v)}
          className={`public-guide-map-toggle ${showWalking ? 'active' : ''}`}
        >
          {showWalking ? 'Hide walking route' : 'Show walking route'}
        </button>
      </div>
    </div>
  );
}
