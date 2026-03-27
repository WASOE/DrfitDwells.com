const fs = require('fs');
const path = require('path');

const KML_PATH = '/home/wasoe/Downloads/The Cabin_ Bucephalus.kml';
const OUTPUT_JSON_PATH = path.join(__dirname, '../../client/src/data/guides/theCabinGuideRoutes.json');
const OUTPUT_REVIEW_PATH = path.join(__dirname, '../../docs/the-cabin-kml-review.md');

function cleanText(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function parseCoordinates(coordBlob = '') {
  return coordBlob
    .trim()
    .split(/\s+/)
    .map((triple) => triple.split(',').map(Number))
    .filter((parts) => parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]))
    .map(([lng, lat, alt]) => ({ lng, lat, alt: Number.isFinite(alt) ? alt : null }));
}

function parsePlacemarks(kmlText) {
  const placemarks = [];
  const placemarkRegex = /<Placemark[\s\S]*?<\/Placemark>/g;
  const matches = kmlText.match(placemarkRegex) || [];

  for (const raw of matches) {
    const name = (raw.match(/<name>([\s\S]*?)<\/name>/) || [])[1];
    const description = (raw.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
    const lineCoords = (raw.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/) || [])[1];
    const pointCoords = (raw.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/) || [])[1];

    if (!name) continue;
    const parsed = {
      name: cleanText(name),
      description: cleanText(description),
      geometryType: lineCoords ? 'LineString' : pointCoords ? 'Point' : 'Unknown',
      coordinates: parseCoordinates(lineCoords || pointCoords || ''),
      classification: 'unknown'
    };
    placemarks.push(parsed);
  }
  return placemarks;
}

function classify(item) {
  const n = item.name.toLowerCase();
  if (n === 'the cabin: bucephalus') return 'cabin_location';
  if (n === 'route to the cabin') return 'primary_route';
  if (n === 'walking route') return 'walking_route';
  if (n.includes('route a')) return 'advanced_route_a';
  if (n.includes('route b')) return 'advanced_route_b';
  if (n.includes('route c')) return 'advanced_route_c';
  if (n.includes('phone signal')) return 'signal_point';
  if (n.includes('park and walk')) return 'park_and_walk';
  return 'extra_poi';
}

function summarizeForReview(items, normalized) {
  const lines = [];
  lines.push('# The Cabin KML review');
  lines.push('');
  lines.push('## Proposed default guest-safe map content');
  lines.push(`- Cabin location: ${normalized.defaultVisible.cabinLocation?.name || 'MISSING'}`);
  lines.push(`- Safest default route: ${normalized.defaultVisible.safestRoute?.name || 'MISSING'}`);
  lines.push(`- Park-and-walk fallback: ${normalized.defaultVisible.primaryParkAndWalk?.name || 'MISSING'}`);
  lines.push(`- 4G signal point: ${normalized.defaultVisible.signalPoint?.name || 'MISSING'}`);
  lines.push('');
  lines.push('## Hidden by default');
  for (const r of normalized.hiddenByDefault.advancedRoutes) lines.push(`- ${r.name}`);
  for (const p of normalized.hiddenByDefault.extraPois) lines.push(`- ${p.name}`);
  lines.push('');
  lines.push('## Parsed items');
  lines.push('| Name | Type | Classification | Coordinate sample |');
  lines.push('|---|---|---|---|');
  for (const i of items) {
    const c = i.coordinates[0];
    const sample = c ? `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}` : 'n/a';
    lines.push(`| ${i.name} | ${i.geometryType} | ${i.classification} | ${sample} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const kmlText = fs.readFileSync(KML_PATH, 'utf8');
  const parsed = parsePlacemarks(kmlText).map((item) => ({ ...item, classification: classify(item) }));

  const byClass = (cls) => parsed.filter((p) => p.classification === cls);

  const cabinLocation = byClass('cabin_location')[0] || null;
  const safestRoute = byClass('primary_route')[0] || null;
  const walkingRoute = byClass('walking_route')[0] || null;
  const signalPoint = byClass('signal_point')[0] || null;
  const parkAndWalkOptions = byClass('park_and_walk');
  const primaryParkAndWalk =
    parkAndWalkOptions.find((p) => /rainy|snow|mudy|muddy/i.test(p.description)) || parkAndWalkOptions[0] || null;

  const normalized = {
    source: {
      file: path.basename(KML_PATH),
      parsedAt: new Date().toISOString(),
      note: 'Generated from KML for Drift & Dwells guide map module'
    },
    defaultVisible: {
      cabinLocation,
      safestRoute,
      primaryParkAndWalk,
      signalPoint
    },
    secondary: {
      walkingRoute,
      parkAndWalkAlternatives: parkAndWalkOptions.filter((p) => p !== primaryParkAndWalk)
    },
    hiddenByDefault: {
      advancedRoutes: [...byClass('advanced_route_a'), ...byClass('advanced_route_b'), ...byClass('advanced_route_c')],
      extraPois: byClass('extra_poi')
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT_JSON_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_REVIEW_PATH, summarizeForReview(parsed, normalized), 'utf8');

  console.log(`Wrote normalized guide JSON: ${OUTPUT_JSON_PATH}`);
  console.log(`Wrote review summary: ${OUTPUT_REVIEW_PATH}`);
}

main();
