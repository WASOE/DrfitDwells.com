import { describe, expect, it, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, matchRoutes, useParams } from 'react-router-dom';
import {
  OPS_CALENDAR_BASE_PATH,
  OPS_CALENDAR_CABIN_PARAM_PATH,
  OPS_WORK_WINDOWS_PATH,
  OPS_WORK_WINDOWS_SEGMENT,
  buildOpsCalendarRouteTree,
  isOpsCalendarCabinIdParam,
  isOpsCalendarReservedSegment
} from './opsCalendarRoutes';

const VALID_CABIN_ID = '507f1f77bcf86cd799439011';

function WorkWindowsStub() {
  return <div data-testid="work-windows-page">Work Windows</div>;
}

function CalendarIndexStub() {
  return <div data-testid="calendar-index-page">Calendar Index</div>;
}

function CalendarMonthStub() {
  const { cabinId } = useParams();
  return (
    <div data-testid="calendar-month-page" data-cabin-id={cabinId}>
      Cabin Calendar
    </div>
  );
}

/** Mirrors App.jsx nested calendar route structure exactly. */
function renderCalendarRoutes(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={OPS_CALENDAR_BASE_PATH} element={<Outlet />}>
          <Route index element={<CalendarIndexStub />} />
          <Route path={OPS_WORK_WINDOWS_SEGMENT} element={<WorkWindowsStub />} />
          <Route path={OPS_CALENDAR_CABIN_PARAM_PATH} element={<CalendarMonthStub />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('OPS calendar route collision (work-windows vs :cabinId)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders Work Windows for /ops/calendar/work-windows and does not render cabin calendar', () => {
    renderCalendarRoutes(OPS_WORK_WINDOWS_PATH);

    expect(screen.getByTestId('work-windows-page')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-month-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('calendar-index-page')).not.toBeInTheDocument();
  });

  it('never passes "work-windows" as cabinId', () => {
    const tree = buildOpsCalendarRouteTree({
      index: 'index',
      workWindows: 'ww',
      cabinMonth: 'month'
    });
    const matches = matchRoutes(tree, OPS_WORK_WINDOWS_PATH);
    expect(matches).toBeTruthy();
    const leaf = matches[matches.length - 1];
    expect(leaf.route.id).toBe('ops-work-windows');
    expect(leaf.params.cabinId).toBeUndefined();

    // Contrast: greedy :cabinId alone would bind the reserved segment.
    const greedyOnly = [
      {
        path: OPS_CALENDAR_BASE_PATH,
        children: [{ path: ':cabinId', id: 'greedy-month' }]
      }
    ];
    const greedy = matchRoutes(greedyOnly, OPS_WORK_WINDOWS_PATH);
    expect(greedy?.[greedy.length - 1]?.params?.cabinId).toBe(OPS_WORK_WINDOWS_SEGMENT);
  });

  it('still routes a valid ObjectId to the cabin calendar', () => {
    renderCalendarRoutes(`${OPS_CALENDAR_BASE_PATH}/${VALID_CABIN_ID}`);

    const month = screen.getByTestId('calendar-month-page');
    expect(month).toBeInTheDocument();
    expect(month).toHaveAttribute('data-cabin-id', VALID_CABIN_ID);
    expect(screen.queryByTestId('work-windows-page')).not.toBeInTheDocument();
  });

  it('still routes /ops/calendar to the calendar index', () => {
    renderCalendarRoutes(OPS_CALENDAR_BASE_PATH);

    expect(screen.getByTestId('calendar-index-page')).toBeInTheDocument();
    expect(screen.queryByTestId('work-windows-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('calendar-month-page')).not.toBeInTheDocument();
  });

  it('treats work-windows as reserved, not a cabin ObjectId', () => {
    expect(isOpsCalendarReservedSegment(OPS_WORK_WINDOWS_SEGMENT)).toBe(true);
    expect(isOpsCalendarCabinIdParam(OPS_WORK_WINDOWS_SEGMENT)).toBe(false);
    expect(isOpsCalendarCabinIdParam(VALID_CABIN_ID)).toBe(true);
  });
});
