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
    { src: '/media/seo/aframe-site-wide.jpeg', height: 1493, en: 'The A-frame cabins across the Drift & Dwells valley.', bg: 'A-frame къщичките в долината на Drift & Dwells.' },
    { src: '/media/seo/stone-house-winter-wide.jpeg', height: 1500, en: 'The Stone House and A-frames in winter.', bg: 'Каменната къща и A-frame къщичките през зимата.' }
  ],
  detox: [
    { src: '/media/seo/aframe-bedroom-winter.jpeg', height: 1660, en: 'A quiet A-frame bedroom in winter.', bg: 'Тиха спалня в A-frame къщичка през зимата.' },
    { src: '/media/seo/aframe-winter-site.jpeg', height: 1672, en: 'The A-frame site in a winter landscape.', bg: 'A-frame селището в зимния пейзаж.' }
  ],
  corporate: [
    { src: '/media/seo/stone-house-winter-wide.jpeg', height: 1500, en: 'The Stone House and A-frames in the mountain setting.', bg: 'Каменната къща и A-frame къщичките в планината.' },
    { src: '/media/seo/aframe-row-sunset.png', height: 1154, en: 'A-frame cabins across the valley at sunset.', bg: 'A-frame къщичките в долината по залез.' },
    { src: '/media/seo/stone-house-sunset-site.jpeg', height: 2000, en: 'The Stone House and the surrounding site.', bg: 'Каменната къща и околният терен.' }
  ]
};
