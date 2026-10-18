import { describe, expect, it } from 'vitest';
import {
  BG_EXCLUDED_PATHS,
  buildHreflangAlternates,
  localizePath
} from './localizedRoutes';

describe('public SEO locale routes', () => {
  it('limits English-only pages to English and x-default alternates', () => {
    expect(BG_EXCLUDED_PATHS.has('/about')).toBe(true);
    expect(buildHreflangAlternates('/about')).toEqual([
      { href: '/about/', hreflang: 'en' },
      { href: '/about/', hreflang: 'x-default' }
    ]);
    expect(buildHreflangAlternates('/cabin/faq')).toEqual([
      { href: '/cabin/faq/', hreflang: 'en' },
      { href: '/cabin/faq/', hreflang: 'x-default' }
    ]);
  });

  it('emits reciprocal bilingual stay URLs with trailing slashes', () => {
    expect(buildHreflangAlternates('/bg/stays/lux-cabin')).toEqual([
      { href: '/stays/lux-cabin/', hreflang: 'en' },
      { href: '/bg/stays/lux-cabin/', hreflang: 'bg' },
      { href: '/stays/lux-cabin/', hreflang: 'x-default' }
    ]);
    expect(localizePath('/stays/lux-cabin', 'bg')).toBe('/bg/stays/lux-cabin');
  });
});
