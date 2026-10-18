import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStayBreadcrumbJsonLd,
  buildStayCanonicalPath,
  buildStayCanonicalUrl,
  buildStayLodgingJsonLd
} from './staySeo';

describe('staySeo', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SITE_URL', 'https://driftdwells.com');
  });
  it('buildStayCanonicalPath returns /stays/{slug}', () => {
    expect(buildStayCanonicalPath('the-cabin')).toBe('/stays/the-cabin');
    expect(buildStayCanonicalPath('')).toBeNull();
  });

  it('buildStayCanonicalUrl is absolute and uses the trailing-slash public route policy', () => {
    const url = buildStayCanonicalUrl('lux-cabin', 'en');
    expect(url).toBe('https://driftdwells.com/stays/lux-cabin/');
    expect(url).not.toContain('?');
  });

  it('buildStayLodgingJsonLd identifies the public accommodation without undated pricing or ratings', () => {
    const schema = buildStayLodgingJsonLd({
      name: 'Lux Cabin',
      description: 'Private cabin with views',
      location: 'The Valley',
      imageUrl: '/media/hero/cabin-summer-960w.webp',
      slug: 'lux-cabin'
    });
    expect(schema.url).toBe('https://driftdwells.com/stays/lux-cabin/');
    expect(schema['@type']).toEqual(['LodgingBusiness', 'Accommodation']);
    expect(schema['@id']).toBe('https://driftdwells.com/stays/lux-cabin/#lodging');
    expect(schema).not.toHaveProperty('priceRange');
    expect(schema).not.toHaveProperty('aggregateRating');
    expect(schema.image[0]).toContain('https://driftdwells.com/media/hero/cabin-summer-960w.webp');
  });

  it('buildStayBreadcrumbJsonLd follows Home > Stays > Stay Name', () => {
    const crumbs = buildStayBreadcrumbJsonLd({
      stayName: 'A-Frame',
      slug: 'a-frame'
    });
    expect(crumbs.itemListElement).toHaveLength(3);
    expect(crumbs.itemListElement[0].name).toBe('Home');
    expect(crumbs.itemListElement[1].name).toBe('Stays');
    expect(crumbs.itemListElement[2].name).toBe('A-Frame');
    expect(crumbs.itemListElement[2].item).toBe('https://driftdwells.com/stays/a-frame/');
  });
});
