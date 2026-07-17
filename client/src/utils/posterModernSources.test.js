import { describe, it, expect } from 'vitest';
import { posterModernSources } from './posterModernSources';

describe('posterModernSources', () => {
  it('derives avif/webp siblings from jpg', () => {
    const src = '/uploads/Videos/The-cabin-header.summer-poster.jpg';
    expect(posterModernSources(src)).toEqual({
      jpg: src,
      avif: '/uploads/Videos/The-cabin-header.summer-poster.avif',
      webp: '/uploads/Videos/The-cabin-header.summer-poster.webp'
    });
  });

  it('leaves non-jpeg paths without modern siblings', () => {
    expect(posterModernSources('/x.png')).toEqual({
      jpg: '/x.png',
      avif: null,
      webp: null
    });
  });
});
