/**
 * OPS calendar URL segments — keep App.jsx and route regression tests in sync.
 *
 * `/ops/calendar/:cabinId` is a greedy param. Reserved static segments (work-windows)
 * must be registered as siblings under `/ops/calendar` so they never bind as cabinId.
 * React Router 6.x does not support reliable `:param(regex)` constraints here.
 */

export const OPS_CALENDAR_BASE_PATH = '/ops/calendar';
export const OPS_WORK_WINDOWS_SEGMENT = 'work-windows';
export const OPS_WORK_WINDOWS_PATH = `${OPS_CALENDAR_BASE_PATH}/${OPS_WORK_WINDOWS_SEGMENT}`;

/** Dynamic cabin / cabin-type calendar segment (Mongo ObjectId in practice). */
export const OPS_CALENDAR_CABIN_PARAM_PATH = ':cabinId';

/** Reserved second-segments under /ops/calendar that must not bind to :cabinId. */
export const OPS_CALENDAR_RESERVED_SEGMENTS = Object.freeze([OPS_WORK_WINDOWS_SEGMENT]);

/**
 * Route objects matching App.jsx calendar nesting (for matchRoutes / MemoryRouter tests).
 * Pass stub or real elements for index / workWindows / cabinMonth.
 */
export function buildOpsCalendarRouteTree({ index, workWindows, cabinMonth, layout = null } = {}) {
  return [
    {
      path: OPS_CALENDAR_BASE_PATH,
      element: layout,
      children: [
        { index: true, element: index, id: 'ops-calendar-index' },
        { path: OPS_WORK_WINDOWS_SEGMENT, element: workWindows, id: 'ops-work-windows' },
        { path: OPS_CALENDAR_CABIN_PARAM_PATH, element: cabinMonth, id: 'ops-calendar-month' }
      ]
    }
  ];
}

export function isOpsCalendarCabinIdParam(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

export function isOpsCalendarReservedSegment(value) {
  return OPS_CALENDAR_RESERVED_SEGMENTS.includes(String(value || ''));
}
