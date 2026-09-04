import { describe, expect, it } from 'vitest';
import {
  blockDisplayLabel,
  blockTooltip,
  isLocationWideManualBlock
} from './calendarBlockLabels';

describe('calendarBlockLabels', () => {
  it('renders unit label on pooled reservation bars', () => {
    const block = {
      blockType: 'reservation',
      startDate: '2026-09-05T00:00:00.000Z',
      endDate: '2026-09-07T00:00:00.000Z',
      render: { labelShort: 'N. Mirchev', unitLabel: 'A-Frame 2' }
    };
    expect(blockDisplayLabel(block)).toBe('A-Frame 2 · N. Mirchev');
    expect(blockTooltip(block)).toContain('A-Frame 2 · N. Mirchev');
    expect(blockTooltip(block)).toContain('2026-09-05 → 2026-09-07');
  });

  it('renders unit label on channel hold and manual bars', () => {
    expect(
      blockDisplayLabel({
        blockType: 'external_hold',
        render: { labelShort: 'Channel hold', unitLabel: 'A-Frame 3' }
      })
    ).toBe('A-Frame 3 · Channel hold');

    expect(
      blockDisplayLabel({
        blockType: 'manual_block',
        render: { labelShort: 'Manual', unitLabel: 'A-Frame 2' }
      })
    ).toBe('A-Frame 2 · Manual');
  });

  it('omits unit prefix for non-pooled bars', () => {
    expect(
      blockDisplayLabel({
        blockType: 'reservation',
        render: { labelShort: 'M. Stoimenova', unitLabel: null }
      })
    ).toBe('M. Stoimenova');
  });

  it('keeps location-wide label without inventing a unit', () => {
    const block = {
      blockType: 'manual_block',
      isLocationWideBlock: true,
      locationKey: 'valley',
      locationBlockGroupId: 'grp-1',
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-03T00:00:00.000Z',
      render: { labelShort: 'Manual', unitLabel: null }
    };
    expect(isLocationWideManualBlock(block)).toBe(true);
    expect(blockDisplayLabel(block)).toBe('Location-wide');
    expect(blockTooltip(block)).toContain('Location-wide block (The Valley)');
  });
});
