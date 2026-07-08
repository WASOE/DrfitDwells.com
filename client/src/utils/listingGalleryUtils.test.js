import { describe, expect, it } from 'vitest';
import {
  buildListingCardSlides,
  getListingCoverImage,
  normalizeListingImageSrc,
  pickListingCoverImageRecord
} from './listingGalleryUtils';

describe('listingGalleryUtils', () => {
  const uploads = ['', 'uploads'].join('/');

  it('normalizeListingImageSrc handles absolute, rooted, and bare filenames', () => {
    expect(normalizeListingImageSrc('https://cdn.example/photo.jpg')).toBe(
      'https://cdn.example/photo.jpg'
    );
    expect(normalizeListingImageSrc(`${uploads}/foo.jpg`)).toBe(`${uploads}/foo.jpg`);
    expect(normalizeListingImageSrc('bare.jpg')).toBe(`${uploads}/cabins/bare.jpg`);
    expect(normalizeListingImageSrc('')).toBe('');
  });

  it('getListingCoverImage prefers isCover over first image and imageUrl', () => {
    const listing = {
      name: 'Lux Cabin',
      imageUrl: '/legacy.jpg',
      images: [
        { url: '/first.jpg', isCover: false },
        { url: '/cover.jpg', isCover: true },
        { url: '/third.jpg', isCover: false }
      ]
    };

    expect(getListingCoverImage(listing).url).toBe('/cover.jpg');
  });

  it('getListingCoverImage falls back to first image then imageUrl then static fallback', () => {
    expect(
      getListingCoverImage({
        name: 'Stone House',
        imageUrl: '/legacy.jpg',
        images: [{ url: '/first.jpg' }]
      }).url
    ).toBe('/first.jpg');

    expect(
      getListingCoverImage({
        name: 'Stone House',
        imageUrl: '/legacy.jpg',
        images: []
      }).url
    ).toBe('/legacy.jpg');

    expect(getListingCoverImage(null, { fallbackUrl: '/static.jpg' }).url).toBe('/static.jpg');
  });

  it('pickListingCoverImageRecord mirrors cover selection on raw arrays', () => {
    const images = [
      { url: '/a.jpg' },
      { url: '/cover.jpg', isCover: true }
    ];
    expect(pickListingCoverImageRecord(images)?.url).toBe('/cover.jpg');
  });

  it('buildListingCardSlides puts cover first and dedupes', () => {
    const listing = {
      name: 'Lux Cabin',
      images: [
        { url: '/interior.jpg', sort: 2 },
        { url: '/cover.jpg', isCover: true, sort: 1 },
        { url: '/view.jpg', sort: 3 }
      ]
    };

    const slides = buildListingCardSlides(listing, { maxSlides: 5 });
    expect(slides[0].url).toBe('/cover.jpg');
    expect(slides.map((s) => s.url)).toEqual(['/cover.jpg', '/interior.jpg', '/view.jpg']);
  });

  it('buildListingCardSlides uses emergency fallback when listing missing', () => {
    const slides = buildListingCardSlides(null, { fallbackUrl: '/static.jpg' });
    expect(slides).toEqual([{ url: '/static.jpg', alt: 'Stay photo' }]);
  });
});
