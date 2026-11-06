import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en/home.json';
import bg from '../i18n/locales/bg/home.json';
import {
  PLANNER_PARTY_OPTIONS,
  buildAvailabilitySearch,
  buildBuyoutHandoff,
  buildCombinationEnquiryHandoff,
  buildItinerary,
  capacityExceeded,
  getPlannerSteps,
  recommendStay,
} from './homepagePlanner';

function keyTree(value) {
  if (Array.isArray(value)) return value.map(keyTree);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, keyTree(value[key])]));
  }
  return typeof value;
}

describe('homepage planner', () => {
  it('keeps English and Bulgarian homepage copy in the same shape', () => {
    expect(keyTree(bg)).toEqual(keyTree(en));
  });

  it('offers exact party sizes instead of falsified buckets', () => {
    expect(PLANNER_PARTY_OPTIONS).toEqual(
      Array.from({ length: 18 }, (_, index) => String(index + 1))
    );
    for (const size of PLANNER_PARTY_OPTIONS) {
      expect(en.planner.steps.party.options[size]).toBeTruthy();
      expect(bg.planner.steps.party.options[size]).toBeTruthy();
    }
  });

  it('keeps exact guest counts and never auto-picks buyout for a large party', () => {
    const cases = [
      { party: '3', stayId: 'stone' },
      { party: '4', stayId: 'stone' },
      { party: '6', stayId: 'stone' },
      { party: '7', stayId: 'combination' },
      { party: '10', stayId: 'combination' },
      { party: '16', stayId: 'combination' },
      { party: '17', stayId: 'buyout' },
      { party: '18', stayId: 'buyout' },
    ];
    for (const { party, stayId } of cases) {
      const result = recommendStay({ party, mood: 'group', connectivity: 'either' });
      expect(result).toMatchObject({
        stayId,
        party: Number(party),
        searchAdults: Number(party),
        capacityExceeded: false,
      });
      expect(result.capacityTotal).toBeGreaterThanOrEqual(Number(party));
    }
  });

  it('puts 6 comfortable guests in the Stone House on a single booking', () => {
    const result = recommendStay({ party: '6', mood: 'group', connectivity: 'either', sharing: 'share' });
    expect(result).toMatchObject({
      stayId: 'stone',
      bookingMode: 'single',
      units: [{ id: 'stone', count: 1, guests: 6 }],
      capacityTotal: 6,
      upgradeBuyout: false,
    });
  });

  it('gives 7 friends sharing the Stone House plus one A-frame, not the whole Valley', () => {
    const result = recommendStay({ party: '7', mood: 'group', connectivity: 'either', sharing: 'share', exclusivity: 'no' });
    expect(result).toMatchObject({
      stayId: 'combination',
      bookingMode: 'enquiry',
      searchAdults: 7,
      units: [
        { id: 'stone', count: 1, guests: 6 },
        { id: 'aframe', count: 1, guests: 1 },
      ],
      capacityTotal: 8,
    });
    expect(result.stayId).not.toBe('buyout');
  });

  it('gives 8 sharing guests the Stone House plus two A-frames', () => {
    expect(recommendStay({ party: '8', mood: 'group', connectivity: 'some', sharing: 'share' })).toMatchObject({
      stayId: 'combination',
      units: [
        { id: 'stone', count: 1, guests: 6 },
        { id: 'aframe', count: 1, guests: 2 },
      ],
    });
    expect(recommendStay({ party: '9', mood: 'group', connectivity: 'some', sharing: 'share' }).units).toEqual([
      { id: 'stone', count: 1, guests: 6 },
      { id: 'aframe', count: 2, guests: 3 },
    ]);
  });

  it('gives 3 couples and 1 more guest four two-person units, not three A-frames', () => {
    const result = recommendStay({
      party: '7',
      mood: 'couple',
      connectivity: 'either',
      sharing: 'pairs',
      couples: 3,
    });
    expect(result).toMatchObject({ stayId: 'combination', bookingMode: 'enquiry', searchAdults: 7 });
    expect(result.units).toEqual([{ id: 'aframe', count: 4, guests: 7 }]);
    expect(result.units.some((unit) => unit.id === 'stone')).toBe(false);
    expect(recommendStay({ party: '7', mood: 'couple', connectivity: 'either', sharing: 'pairs' }).units)
      .toEqual([{ id: 'aframe', count: 4, guests: 7 }]);
  });

  it('uses enough two-person units for 8 guests who want separate places', () => {
    const result = recommendStay({ party: '8', mood: 'group', connectivity: 'either', sharing: 'pairs' });
    expect(result.units).toEqual([{ id: 'aframe', count: 4, guests: 8 }]);
    expect(result.capacityTotal).toBe(8);

    const solo = recommendStay({ party: '6', mood: 'group', connectivity: 'either', sharing: 'own' });
    expect(solo.units).toEqual([
      { id: 'aframe', count: 5, guests: 5 },
      { id: 'lux', count: 1, guests: 1 },
    ]);
  });

  it('falls back to Stone House sharing when private places run out, and says so', () => {
    const result = recommendStay({ party: '8', mood: 'group', connectivity: 'either', sharing: 'own' });
    expect(result).toMatchObject({ stayId: 'combination', privacyRelaxed: true, whyKey: 'privacyRelaxed' });
    expect(result.units[0]).toMatchObject({ id: 'stone', guests: 6 });
  });

  it('only buys out when asked or when the party needs the full inventory', () => {
    expect(recommendStay({ party: '7', mood: 'group', connectivity: 'either', exclusivity: 'yes' })).toMatchObject({
      stayId: 'buyout',
      bookingMode: 'buyout',
      searchAdults: 7,
      whyKey: 'buyoutChosen',
      capacityTotal: 18,
    });
    for (const party of ['17', '18']) {
      expect(recommendStay({ party, mood: 'group', connectivity: 'either', sharing: 'pairs' })).toMatchObject({
        stayId: 'buyout',
        bookingMode: 'buyout',
        whyKey: 'buyoutFull',
        searchAdults: Number(party),
      });
    }
  });

  it('never puts more than 18 overnight guests in a unit list and flags overflow honestly', () => {
    for (let party = 1; party <= 18; party += 1) {
      for (const sharing of ['share', 'pairs', 'own']) {
        const result = recommendStay({ party: String(party), mood: 'group', connectivity: 'either', sharing });
        expect(result.searchAdults).toBe(party);
        expect(result.capacityExceeded).toBe(false);
        const stoneOrCombo = result.stayId === 'combination';
        if (stoneOrCombo) {
          const aframes = result.units.find((unit) => unit.id === 'aframe')?.count ?? 0;
          const lux = result.units.find((unit) => unit.id === 'lux')?.count ?? 0;
          const stone = result.units.find((unit) => unit.id === 'stone')?.count ?? 0;
          expect(aframes).toBeLessThanOrEqual(5);
          expect(lux).toBeLessThanOrEqual(1);
          expect(stone).toBeLessThanOrEqual(1);
          expect(result.units.some((unit) => unit.id === 'cabin')).toBe(false);
        }
      }
    }
    expect(recommendStay({ party: '25', mood: 'group', connectivity: 'either' })).toMatchObject({
      stayId: 'buyout',
      searchAdults: 25,
      capacityExceeded: true,
    });
  });

  it('keeps the original four questions for one or two guests and adds group questions from three', () => {
    expect(getPlannerSteps('2').map((step) => step.id)).toEqual(['party', 'mood', 'connectivity', 'nights']);
    expect(getPlannerSteps(undefined).map((step) => step.id)).toEqual(['party', 'mood', 'connectivity', 'nights']);
    expect(getPlannerSteps('7').map((step) => step.id)).toEqual([
      'party', 'sharing', 'exclusivity', 'mood', 'connectivity', 'nights',
    ]);
    expect(getPlannerSteps('17').map((step) => step.id)).toEqual(['party', 'mood', 'connectivity', 'nights']);
  });

  it('has copy for every planner step option, result reason and unit in both languages', () => {
    for (const locale of [en, bg]) {
      for (const stepId of ['sharing', 'exclusivity']) {
        const step = getPlannerSteps('7').find((item) => item.id === stepId);
        for (const option of step.options) {
          expect(locale.planner.steps[stepId].options[option]).toBeTruthy();
        }
      }
      for (const key of [
        'stoneShared', 'stoneStarlink', 'stoneAndCabins', 'privatePairs', 'privateOwn',
        'privateNoStarlink', 'privacyRelaxed', 'buyoutChosen', 'buyoutFull',
        'cabinOffline', 'cabinQuiet', 'aframeNature', 'luxDefault', 'luxConnected',
      ]) {
        expect(locale.planner.why[key]).toBeTruthy();
      }
      for (const key of ['cabinToValley', 'aframeToLux', 'luxToAframe', 'privateUnits', 'sharedStone', 'combination']) {
        expect(locale.planner.alternatives[key]).toBeTruthy();
      }
    }
    // Every whyKey / alternative the engine can emit resolves in English.
    const seen = new Set();
    for (let party = 1; party <= 18; party += 1) {
      for (const sharing of ['share', 'pairs', 'own']) {
        for (const connectivity of ['none', 'some', 'either']) {
          for (const mood of ['quiet', 'couple', 'nature', 'group']) {
            for (const exclusivity of ['no', 'yes']) {
              const result = recommendStay({ party: String(party), mood, connectivity, sharing, exclusivity });
              expect(en.planner.why[result.whyKey]).toBeTruthy();
              if (result.alternative) expect(en.planner.alternatives[result.alternative]).toBeTruthy();
              seen.add(result.whyKey);
            }
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  it('sends two offline guests to The Cabin without clamping', () => {
    expect(recommendStay({ party: '2', mood: 'quiet', connectivity: 'none' })).toMatchObject({
      stayId: 'cabin',
      searchAdults: 2,
      capacityExceeded: false,
      offlineMismatch: false,
    });
  });

  it('does not put a guest who wants connectivity in the offline cabin', () => {
    expect(recommendStay({ party: '2', mood: 'couple', connectivity: 'some' }).stayId).toBe('lux');
  });

  it('flags capacity overflow without changing the exact party size', () => {
    const result = recommendStay({ party: '2', mood: 'quiet', connectivity: 'none' });
    expect(capacityExceeded('cabin', 4)).toBe(true);
    expect(result.searchAdults).toBe(2);
    expect(recommendStay({ party: '4', mood: 'quiet', connectivity: 'none' })).toMatchObject({
      stayId: 'stone',
      searchAdults: 4,
      capacityExceeded: false,
    });
  });

  it('builds a practical itinerary and flags a one-night request', () => {
    expect(buildItinerary('cabin', 2).map((day) => day.label)).toEqual(['arrival', 'full', 'departure']);
    expect(buildItinerary('buyout', 4).map((day) => day.body)).toContain('openDay');
    expect(buildItinerary('aframe', 1)[0]).toMatchObject({ body: 'arrivalValley', oneNight: true });
  });

  it('keys the itinerary to the mood and has copy for it', () => {
    expect(buildItinerary('combination', 2, 'group')[1].body).toBe('dayGroup');
    expect(buildItinerary('combination', 2, 'nature')[1].body).toBe('dayNature');
    expect(buildItinerary('stone', 2, 'quiet')[1].body).toBe('dayQuiet');
    expect(buildItinerary('stone', 2, 'couple')[1].body).toBe('dayCouple');
    expect(buildItinerary('cabin', 2, 'group')[1].body).toBe('dayCabin');
    expect(buildItinerary('buyout', 2, 'nature')[1].body).toBe('dayBuyout');
    for (const body of ['dayGroup', 'dayNature', 'dayQuiet', 'dayCouple']) {
      expect(en.planner.itinerary[body]).toBeTruthy();
      expect(bg.planner.itinerary[body]).toBeTruthy();
    }
  });

  it('preserves children, babies and pets in the search query contract', () => {
    expect(buildAvailabilitySearch({
      checkIn: new Date(2026, 10, 12),
      checkOut: new Date(2026, 10, 14),
      adults: 4,
      children: 2,
      babies: 1,
      pets: 1,
      language: 'bg',
    })).toBe('/bg/search?checkIn=2026-11-12&checkOut=2026-11-14&adults=4&children=2&babies=1&pets=1');

    expect(buildAvailabilitySearch({
      checkIn: null,
      checkOut: new Date(2026, 10, 14),
      adults: 2,
      language: 'en',
    })).toBeNull();
  });

  it('carries exact guests and dates into the whole-Valley quote handoff', () => {
    expect(buildBuyoutHandoff({
      checkIn: new Date(2026, 10, 12),
      checkOut: new Date(2026, 10, 15),
      adults: 10,
      children: 2,
      babies: 0,
      pets: 1,
      language: 'en',
    })).toBe('/retreats/the-valley?adults=10&children=2&babies=0&pets=1&checkIn=2026-11-12&checkOut=2026-11-15');

    expect(buildBuyoutHandoff({
      adults: 18,
      children: 0,
      babies: 0,
      pets: 0,
      language: 'bg',
    })).toBe('/bg/retreats/the-valley?adults=18&children=0&babies=0&pets=0');
  });

  it('hands a multi-unit combination to the Valley as an enquiry with exact guests and units', () => {
    const units = [
      { id: 'stone', count: 1, guests: 6 },
      { id: 'aframe', count: 1, guests: 1 },
    ];
    expect(buildCombinationEnquiryHandoff({
      units,
      checkIn: new Date(2026, 10, 12),
      checkOut: new Date(2026, 10, 15),
      adults: 7,
      children: 2,
      babies: 1,
      pets: 1,
      language: 'en',
    })).toBe('/retreats/the-valley?adults=7&children=2&babies=1&pets=1&checkIn=2026-11-12&checkOut=2026-11-15&planner=combination&units=stone:1,aframe:1');

    // No dates are invented when none were chosen.
    const noDates = buildCombinationEnquiryHandoff({ units, adults: 7, language: 'bg' });
    expect(noDates).toBe('/bg/retreats/the-valley?adults=7&children=0&babies=0&pets=0&planner=combination&units=stone:1,aframe:1');
    expect(noDates).not.toContain('checkIn');
  });
});
