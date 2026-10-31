/**
 * Resolve ConfirmBooking entity identity from route params + navigation state.
 * Direct /stays/:slug/confirm loads must not depend on location.state alone.
 */

/**
 * @param {{
 *   routeId?: string | null,
 *   routeSlug?: string | null,
 *   initialState?: {
 *     bookingEntityType?: string | null,
 *     bookingEntityId?: string | null,
 *     cabinId?: string | null,
 *     bookingEntitySlug?: string | null
 *   } | null
 * }} input
 */
export function initialConfirmBookingEntity({ routeId = null, routeSlug = null, initialState = null } = {}) {
  const state = initialState && typeof initialState === 'object' ? initialState : {};
  const id = state.bookingEntityId || state.cabinId || routeId || null;
  const slug = state.bookingEntitySlug || routeSlug || null;
  let type = state.bookingEntityType || null;
  if (!type && id && !slug) type = 'cabin';
  return {
    bookingEntityType: type,
    bookingEntityId: id,
    bookingEntitySlug: slug,
    needsSlugResolve: Boolean(!id && slug)
  };
}

/**
 * Map stayAPI.resolve payload into ConfirmBooking entity fields.
 * @param {{ kind?: string, cabinId?: string, cabinTypeId?: string, slug?: string } | null} data
 * @param {string | null} fallbackSlug
 */
export function entityFromStayResolve(data, fallbackSlug = null) {
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: 'unresolved' };
  }
  const slug = data.slug || fallbackSlug || null;
  if (data.kind === 'cabinType') {
    const id = data.cabinTypeId || null;
    if (!id || !slug) return { ok: false, reason: 'missing_cabin_type' };
    return {
      ok: true,
      bookingEntityType: 'cabinType',
      bookingEntityId: id,
      bookingEntitySlug: slug
    };
  }
  if (data.kind === 'cabin') {
    const id = data.cabinId || null;
    if (!id) return { ok: false, reason: 'missing_cabin' };
    return {
      ok: true,
      bookingEntityType: 'cabin',
      bookingEntityId: id,
      bookingEntitySlug: slug
    };
  }
  return { ok: false, reason: 'unknown_kind' };
}
