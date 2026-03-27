/**
 * Writes offline arrival assets for /guides/the-cabin from parsed KML JSON.
 * Run: node ./scripts/export-the-cabin-arrival-assets.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, '..');
const dataPath = path.join(clientDir, 'src/data/guides/theCabinGuideRoutes.json');
const outDir = path.join(clientDir, 'public/guides/the-cabin');

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lineToKmlCoord(coords) {
  return coords.map((c) => `${c.lng},${c.lat},0`).join(' ');
}

function lineToGpxTrkpts(coords) {
  return coords
    .map((c) => `      <trkpt lat="${c.lat}" lon="${c.lng}"></trkpt>`)
    .join('\n');
}

function main() {
  const raw = fs.readFileSync(dataPath, 'utf8');
  const data = JSON.parse(raw);
  const dv = data.defaultVisible;
  const sec = data.secondary;

  const recommended = dv?.safestRoute?.coordinates || [];
  const walking = sec?.walkingRoute?.coordinates || [];
  const cabin = dv?.cabinLocation?.coordinates?.[0];
  const park = dv?.primaryParkAndWalk?.coordinates?.[0];
  const signal = dv?.signalPoint?.coordinates?.[0];
  const routeStart = recommended[0];

  if (!recommended.length || !cabin) {
    throw new Error('export-the-cabin: missing recommended route or cabin point');
  }

  fs.mkdirSync(outDir, { recursive: true });

  const features = [
    {
      type: 'Feature',
      properties: { kind: 'recommended' },
      geometry: {
        type: 'LineString',
        coordinates: recommended.map((c) => [c.lng, c.lat])
      }
    }
  ];
  if (walking.length > 1) {
    features.push({
      type: 'Feature',
      properties: { kind: 'walking' },
      geometry: {
        type: 'LineString',
        coordinates: walking.map((c) => [c.lng, c.lat])
      }
    });
  }
  features.push(
    {
      type: 'Feature',
      properties: { kindPoint: 'route_start', label: 'Route start' },
      geometry: { type: 'Point', coordinates: [routeStart.lng, routeStart.lat] }
    },
    {
      type: 'Feature',
      properties: { kindPoint: 'cabin', label: 'Cabin' },
      geometry: { type: 'Point', coordinates: [cabin.lng, cabin.lat] }
    },
    {
      type: 'Feature',
      properties: { kindPoint: 'park_here', label: 'Park here' },
      geometry: { type: 'Point', coordinates: [park.lng, park.lat] }
    },
    {
      type: 'Feature',
      properties: { kindPoint: 'phone_signal', label: 'Phone signal' },
      geometry: { type: 'Point', coordinates: [signal.lng, signal.lat] }
    }
  );

  const geojson = { type: 'FeatureCollection', features };
  fs.writeFileSync(path.join(outDir, 'routes.geojson'), JSON.stringify(geojson));

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>The Cabin — Drift &amp; Dwells arrival pack</name>
    <description>${escXml('Recommended guest route and key points. Advanced 4x4 routes not included.')}</description>
    <Placemark>
      <name>Recommended route</name>
      <LineString>
        <coordinates>${lineToKmlCoord(recommended)}</coordinates>
      </LineString>
    </Placemark>
    ${walking.length > 1 ? `<Placemark>
      <name>Optional walking route</name>
      <LineString>
        <coordinates>${lineToKmlCoord(walking)}</coordinates>
      </LineString>
    </Placemark>` : ''}
    <Placemark><name>Route start</name><Point><coordinates>${routeStart.lng},${routeStart.lat},0</coordinates></Point></Placemark>
    <Placemark><name>Cabin</name><Point><coordinates>${cabin.lng},${cabin.lat},0</coordinates></Point></Placemark>
    <Placemark><name>Park here</name><Point><coordinates>${park.lng},${park.lat},0</coordinates></Point></Placemark>
    <Placemark><name>Phone signal</name><Point><coordinates>${signal.lng},${signal.lat},0</coordinates></Point></Placemark>
  </Document>
</kml>`;
  fs.writeFileSync(path.join(outDir, 'arrival-pack.kml'), kml);

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" creator="drift-dwells-booking-portal" version="1.1">
  <metadata><name>The Cabin arrival pack</name></metadata>
  <trk><name>Recommended route</name><trkseg>
${lineToGpxTrkpts(recommended)}
  </trkseg></trk>
  ${walking.length > 1 ? `<trk><name>Optional walking route</name><trkseg>
${lineToGpxTrkpts(walking)}
  </trkseg></trk>` : ''}
  <wpt lat="${routeStart.lat}" lon="${routeStart.lng}"><name>Route start</name></wpt>
  <wpt lat="${cabin.lat}" lon="${cabin.lng}"><name>Cabin</name></wpt>
  <wpt lat="${park.lat}" lon="${park.lng}"><name>Park here</name></wpt>
  <wpt lat="${signal.lat}" lon="${signal.lng}"><name>Phone signal</name></wpt>
</gpx>`;
  fs.writeFileSync(path.join(outDir, 'arrival-pack.gpx'), gpx);

  const lat = cabin.lat.toFixed(6);
  const lon = cabin.lng.toFixed(6);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>The Cabin — Offline arrival checklist</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 24px auto; padding: 0 16px; color: #1a1a1a; line-height: 1.5; }
    h1 { font-size: 1.35rem; margin: 0 0 8px; }
    .muted { color: #4a4a4a; font-size: 0.95rem; }
    ul { padding-left: 1.2rem; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 12px 14px; margin: 14px 0; }
    @media print { body { margin: 12px; } .no-print { display: none; } }
  </style>
</head>
<body>
  <h1>The Cabin — Arrival checklist</h1>
  <p class="muted">Drift &amp; Dwells · Bachevo area · Print or Save as PDF from your browser.</p>
  <div class="box">
    <p><strong>Coordinates (cabin):</strong> ${lat}, ${lon}</p>
    <p class="muted">Before you lose signal: save this page; download KML/GPX from the online guide; open offline map in Organic Maps or OsmAnd if you use them.</p>
  </div>
  <div class="box">
    <p><strong>If lost</strong></p>
    <ol>
      <li>Stop. Do not push further on unfamiliar forest tracks.</li>
      <li>Return to the last place you clearly recognized.</li>
      <li>Use the <strong>phone signal</strong> waypoint if you need coverage.</li>
      <li>Call support before continuing past uncertainty.</li>
    </ol>
  </div>
  <p class="no-print muted">This file is a fallback. The main guide: /guides/the-cabin</p>
</body>
</html>`;
  fs.writeFileSync(path.join(outDir, 'arrival-pack-print.html'), html);

  console.log('Wrote The Cabin arrival assets to', outDir);
}

main();
