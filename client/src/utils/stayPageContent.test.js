import { describe, expect, it } from 'vitest';
import { resolveStayAmenities, resolveStayHighlights } from './stayPageContent';

const tEn = (key, opts = {}) => {
  const bundles = {
    'stayContent.lux-cabin.highlights': [
      'Private luxury cabin in a protected valley',
      'Large windows, forest views, and complete tranquility'
    ],
    'stayContent.lux-cabin.amenities': [
      'Double bed',
      'Private fully equipped kitchen',
      'Starlink internet'
    ],
    'stayContent.the-cabin.highlights': [
      'Off-grid comfort: wood stove, steaming hot tub'
    ],
    'stayContent.the-cabin.amenities': ['Steaming hot tub', 'Wood stove']
  };
  if (opts.returnObjects && bundles[key]) return bundles[key];
  return bundles[key] || opts.defaultValue || key;
};

describe('stayPageContent', () => {
  it('uses localized lux-cabin highlights without hot tub', () => {
    const highlights = resolveStayHighlights({
      slug: 'lux-cabin',
      apiHighlights: ['Off-grid comfort: wood stove, steaming hot tub'],
      t: tEn
    });
    expect(highlights.join(' ')).not.toMatch(/hot tub/i);
    expect(highlights[0]).toContain('Private luxury cabin');
  });

  it('uses localized lux-cabin amenities without hot tub', () => {
    const amenities = resolveStayAmenities({
      slug: 'lux-cabin',
      apiAmenities: ['Steaming hot tub', 'Double bed'],
      t: tEn
    });
    expect(amenities.join(' ')).not.toMatch(/hot tub/i);
    expect(amenities).toContain('Starlink internet');
  });

  it('allows hot tub for the-cabin', () => {
    const highlights = resolveStayHighlights({
      slug: 'the-cabin',
      apiHighlights: [],
      t: tEn
    });
    expect(highlights.join(' ')).toMatch(/hot tub/i);
  });
});
