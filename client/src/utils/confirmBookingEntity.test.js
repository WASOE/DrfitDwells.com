import { describe, expect, it } from 'vitest';
import { entityFromStayResolve, initialConfirmBookingEntity } from './confirmBookingEntity';

describe('confirmBookingEntity', () => {
  it('uses cabin id from /cabin/:id route without navigation state', () => {
    expect(
      initialConfirmBookingEntity({
        routeId: 'cabin-1',
        routeSlug: null,
        initialState: {}
      })
    ).toEqual({
      bookingEntityType: 'cabin',
      bookingEntityId: 'cabin-1',
      bookingEntitySlug: null,
      needsSlugResolve: false
    });
  });

  it('requires stay resolve for /stays/:slug direct navigation', () => {
    expect(
      initialConfirmBookingEntity({
        routeId: null,
        routeSlug: 'the-cabin',
        initialState: {}
      })
    ).toEqual({
      bookingEntityType: null,
      bookingEntityId: null,
      bookingEntitySlug: 'the-cabin',
      needsSlugResolve: true
    });
  });

  it('preserves cabinType state from in-app navigation', () => {
    expect(
      initialConfirmBookingEntity({
        routeId: null,
        routeSlug: 'a-frame',
        initialState: {
          bookingEntityType: 'cabinType',
          bookingEntityId: 'type-1',
          bookingEntitySlug: 'a-frame'
        }
      })
    ).toEqual({
      bookingEntityType: 'cabinType',
      bookingEntityId: 'type-1',
      bookingEntitySlug: 'a-frame',
      needsSlugResolve: false
    });
  });

  it('maps stay resolve cabin and cabinType payloads', () => {
    expect(
      entityFromStayResolve({ kind: 'cabin', cabinId: 'c1', slug: 'the-cabin' }, 'the-cabin')
    ).toEqual({
      ok: true,
      bookingEntityType: 'cabin',
      bookingEntityId: 'c1',
      bookingEntitySlug: 'the-cabin'
    });
    expect(
      entityFromStayResolve({ kind: 'cabinType', cabinTypeId: 't1', slug: 'a-frame' }, 'a-frame')
    ).toEqual({
      ok: true,
      bookingEntityType: 'cabinType',
      bookingEntityId: 't1',
      bookingEntitySlug: 'a-frame'
    });
  });
});
