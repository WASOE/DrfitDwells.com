import { describe, expect, it } from 'vitest';
import { formatWorkDurationMinutes, formatWorkWindowRange } from './workWindowsFormat';

describe('workWindowsFormat', () => {
  it('formats durations without decimals', () => {
    expect(formatWorkDurationMinutes(18 * 60)).toBe('18h');
    expect(formatWorkDurationMinutes(27 * 60)).toBe('1d 3h');
    expect(formatWorkDurationMinutes(124 * 60)).toBe('5d 4h');
    expect(formatWorkDurationMinutes(168 * 60)).toBe('7 days');
    expect(formatWorkDurationMinutes(1176 * 60)).toBe('49 days');
  });

  it('marks range-truncated ends as at least DATE', () => {
    const start = '2026-10-11T08:00:00.000Z'; // 11:00 Sofia (EEST)
    const end = '2026-10-24T21:00:00.000Z'; // 25 Oct 00:00 Sofia
    expect(formatWorkWindowRange(start, end, 'Europe/Sofia', { continuesBeyondRange: true })).toBe(
      '11 Oct 11:00 → at least 25 Oct'
    );
    expect(formatWorkWindowRange(start, end, 'Europe/Sofia', { continuesBeyondRange: false })).toMatch(
      /^11 Oct 11:00 → 25 Oct 00:00$/
    );
  });
});
