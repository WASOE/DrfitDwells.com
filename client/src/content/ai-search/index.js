import offGridEn from './01_off_grid_weekends_en.md?raw';
import offGridBg from './01_off_grid_weekends_bg.md?raw';
import detoxEn from './02_digital_detox_en.md?raw';
import detoxBg from './02_digital_detox_bg.md?raw';
import corporateEn from './03_corporate_retreat_en.md?raw';
import corporateBg from './03_corporate_retreat_bg.md?raw';

export const contentSources = {
  offGrid: { en: offGridEn, bg: offGridBg },
  detox: { en: detoxEn, bg: detoxBg },
  corporate: { en: corporateEn, bg: corporateBg }
};

const ctaPattern = /^(?:CTA|Secondary CTA|Secondary|Второстепенно CTA|Второ CTA):\s*/;

export function parseEditorial(source) {
  const start = source.indexOf('\n# ');
  if (start < 0) throw new Error('Editorial copy needs a public H1 after its implementation header.');
  const header = source.slice(0, start);
  const field = (name) => {
    const value = header.split('\n').find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
    if (!value) throw new Error(`Editorial copy is missing ${name}.`);
    return value;
  };
  const lines = source.slice(start + 1).trim().split('\n');
  const heading = lines.shift().slice(2);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line.startsWith('## ')) blocks.push({ type: 'h2', text: line.slice(3) });
    else if (line.startsWith('### ')) blocks.push({ type: 'h3', text: line.slice(4) });
    else if (ctaPattern.test(line)) blocks.push({ type: 'cta', text: line.replace(ctaPattern, '') });
    else if (line.startsWith('- ')) {
      const items = [line.slice(2)];
      while (lines[index + 1]?.startsWith('- ')) items.push(lines[++index].slice(2));
      blocks.push({ type: 'list', items });
    } else {
      let text = line;
      while (lines[index + 1]?.trim() &&
        !/^(?:#{2,3} |- |Source:|Източник:)/.test(lines[index + 1]) &&
        !ctaPattern.test(lines[index + 1])) {
        text += ` ${lines[++index].trim()}`;
      }
      blocks.push({ type: 'paragraph', text });
    }
  }
  return {
    title: field('SEO title'),
    description: field('Meta description'),
    socialTitle: field('Social title'),
    heading,
    blocks
  };
}

export const editorial = Object.fromEntries(Object.entries(contentSources).map(([kind, locales]) => [
  kind,
  Object.fromEntries(Object.entries(locales).map(([locale, source]) => [locale, parseEditorial(source)]))
]));

export const editorialPaths = {
  offGrid: '/off-grid-cabins-bulgaria',
  detox: '/digital-detox-bulgaria',
  corporate: '/retreat-venue-bulgaria'
};

export const editorialPhotos = {
  offGrid: [
    { src: '/media/ai-search/cabin-forest-1200w.webp', height: 675, en: 'The Cabin at the edge of the forest near Bachevo.', bg: 'The Cabin на края на гората край Бачево.' },
    { src: '/media/enduro/hero-aerial-1200w.webp', height: 675, en: 'The Valley and its mountain landscape.', bg: 'The Valley и околният планински пейзаж.' }
  ],
  detox: [
    { src: '/media/ai-search/cabin-stove-1200w.webp', height: 636, en: 'The Cabin interior and its wood-burning stove.', bg: 'Интериорът на The Cabin с печка на дърва.' },
    { src: '/media/ai-search/cabin-forest-1200w.webp', height: 675, en: 'The Cabin at the edge of the forest near Bachevo.', bg: 'The Cabin на края на гората край Бачево.' }
  ],
  corporate: [
    { src: '/media/enduro/hero-aerial-1200w.webp', height: 675, en: 'The Valley buildings in the mountain landscape.', bg: 'Сградите на The Valley сред планинския пейзаж.' },
    { src: '/media/enduro/aframes-sunset-1200w.webp', height: 1600, en: 'The Valley A-frame accommodation at sunset.', bg: 'A-frame къщичките в The Valley по залез.' },
    { src: '/media/enduro/firepit-sunset-1200w.webp', height: 1600, en: 'The Valley outdoor fire area at sunset.', bg: 'Външното огнище в The Valley по залез.' }
  ]
};
