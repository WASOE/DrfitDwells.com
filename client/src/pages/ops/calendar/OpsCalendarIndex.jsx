import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';
import {
  BLOCK_DOT,
  CONFLICT_RING,
  PREVIEW_DOT_CONFLICT,
  PREVIEW_DOT_EMPTY,
  PREVIEW_DOT_WARNING
} from './calendarVisualTokens';
import { eachDayKeyInRange, parseIsoDay } from './opsCalendarDateUtils';
import LocationBlockSheet from './LocationBlockSheet';
import OpsCalendarLegend from './OpsCalendarLegend';
import OpsPage from '../../../ops/primitives/OpsPage';
import OpsPageHeader from '../../../ops/primitives/OpsPageHeader';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsBadge from '../../../ops/primitives/OpsBadge';
import OpsStatus from '../../../ops/primitives/OpsStatus';
import OpsLoadingState from '../../../ops/primitives/OpsLoadingState';
import OpsConfirmDialog from '../../../ops/primitives/OpsConfirmDialog';
import OpsInlineError from '../../../ops/primitives/OpsInlineError';
import { opsCx } from '../../../ops/primitives/opsCx';
import './OpsCalendar.css';

function dayStripCells(fromIso, toIso) {
  const a = parseIsoDay(fromIso);
  const b = parseIsoDay(toIso);
  if (!a || !b) return [];
  return eachDayKeyInRange(a, b);
}

function formatStripDayLabel(dayKey) {
  const d = parseIsoDay(dayKey);
  if (!d) return '';
  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return weekdays[d.getUTCDay()];
}

function cellToneForDay(dayKey, blocks) {
  let hard = false;
  let warn = false;
  const types = new Set();
  for (const b of blocks) {
    const keys = b.render?.occupiedDayKeys || [];
    if (!keys.includes(dayKey)) continue;
    if (b.render?.conflictToken === 'hard') hard = true;
    if (b.render?.conflictToken === 'warning') warn = true;
    types.add(b.blockType);
  }
  if (hard) return { dot: PREVIEW_DOT_CONFLICT, ring: CONFLICT_RING.hard };
  if (warn) return { dot: PREVIEW_DOT_WARNING, ring: CONFLICT_RING.warning };
  if (types.has('maintenance')) return { dot: BLOCK_DOT.maintenance, ring: '' };
  if (types.has('reservation')) return { dot: BLOCK_DOT.reservation, ring: '' };
  if (types.has('manual_block')) return { dot: BLOCK_DOT.manual_block, ring: '' };
  if (types.has('external_hold')) return { dot: BLOCK_DOT.external_hold, ring: '' };
  return { dot: PREVIEW_DOT_EMPTY, ring: '' };
}

function initialsFromName(name) {
  const s = String(name || '').trim();
  if (!s) return '—';
  const parts = s.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '';
  const out = `${a}${b}`.toUpperCase();
  return out || '—';
}

function conflictAccentClass(hardN, warnN) {
  if (hardN > 0) return 'ops-cal-row--conflict';
  if (warnN > 0) return 'ops-cal-row--warning';
  return '';
}

/** Stable id for calendar routes (single cabin or multi-unit type from ops cabins list). */
function propertyRouteId(cabinLike) {
  return cabinLike.cabinId || cabinLike.cabinTypeId || '';
}

function formatGroupDateRange(startIso, endIso) {
  const s = String(startIso || '').slice(0, 10);
  const e = String(endIso || '').slice(0, 10);
  return `${s} → ${e} (exclusive end)`;
}

function syncStatusValue(sync) {
  if (sync === 'healthy' || sync === 'warning' || sync === 'failed' || sync === 'stale') return sync;
  return 'stale';
}

export default function OpsCalendarIndex() {
  const [preview, setPreview] = useState(null);
  const [cabinsExtra, setCabinsExtra] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [locationBlockOpen, setLocationBlockOpen] = useState(false);
  const [locationBlockFlash, setLocationBlockFlash] = useState('');
  const [removeGroup, setRemoveGroup] = useState(null);
  const [removeError, setRemoveError] = useState('');
  const [removeLoading, setRemoveLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [calRes, cabRes] = await Promise.all([
        opsReadAPI.calendar({ indexPreview: '1', previewDays: 14 }),
        opsReadAPI.cabins({ page: 1, limit: 100 })
      ]);
      setPreview(calRes.data?.data || null);
      setCabinsExtra(cabRes.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load calendar index');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stripKeys = useMemo(() => {
    const from = preview?.request?.from;
    const to = preview?.request?.to;
    if (!from || !to) return [];
    return dayStripCells(from, to);
  }, [preview]);

  const mergedRows = useMemo(() => {
    const byId = new Map();
    (preview?.previewByCabin || []).forEach((row) => {
      byId.set(row.cabinId, row);
    });
    const items = cabinsExtra?.items || [];
    const rows = items.map((c) => {
      const routeId = propertyRouteId(c);
      const p = byId.get(routeId) || byId.get(c.cabinId) || byId.get(c.cabinTypeId);
      return { cabin: c, preview: p || null };
    });
    const seen = new Set(rows.map((r) => propertyRouteId(r.cabin)).filter(Boolean));
    (preview?.previewByCabin || []).forEach((p) => {
      if (seen.has(p.cabinId)) return;
      rows.push({
        cabin: {
          cabinId: p.cabinId,
          name: p.listing?.name || `Cabin ${p.cabinId}`,
          location: '',
          isActive: p.listing?.isActive !== false,
          operational: {},
          content: { imageUrl: p.listing?.imageUrl || null, imagesCount: 0, descriptionPresent: false }
        },
        preview: p
      });
    });
    return rows;
  }, [preview, cabinsExtra]);

  const previewDays = preview?.request?.previewDays || 14;
  const timezone = preview?.meta?.propertyTimezone || 'Europe/Sofia';
  const activeLocationBlockGroups = preview?.activeLocationBlockGroups || [];

  const openRemoveGroup = (group) => {
    if (!group?.locationBlockGroupId) return;
    setRemoveError('');
    setRemoveGroup(group);
  };

  const closeRemoveGroup = () => {
    if (removeLoading) return;
    setRemoveGroup(null);
    setRemoveError('');
  };

  const confirmRemoveGroup = async () => {
    const groupId = removeGroup?.locationBlockGroupId;
    if (!groupId) {
      setRemoveError('Cannot remove location-wide block: group id is missing.');
      return;
    }

    setRemoveLoading(true);
    setRemoveError('');
    try {
      await opsWriteAPI.removeLocationBlockGroup(groupId, 'ops_calendar_index');
      setRemoveGroup(null);
      setRemoveError('');
      setLocationBlockFlash('Location-wide block removed from all properties in this group.');
      await load();
    } catch (err) {
      setRemoveError(err?.response?.data?.message || 'Remove failed');
    } finally {
      setRemoveLoading(false);
    }
  };

  return (
    <OpsPage width="full">
      <div className="ops-cal">
        <OpsPageHeader
          title="Calendar"
          description={`Pick a property to open the month view. Preview shows the next ${previewDays} nights (${timezone}).`}
          meta={
            preview?.meta?.today ? (
              <p className="ops-cal__hint">
                Today: <strong>{preview.meta.today}</strong>
              </p>
            ) : null
          }
          actions={
            <OpsButton variant="secondary" onClick={() => setLocationBlockOpen(true)}>
              Block location
            </OpsButton>
          }
        />

        <div className="ops-cal__legend-wrap">
          <OpsCalendarLegend />
        </div>

        {locationBlockFlash ? <OpsBanner tone="success" body={locationBlockFlash} /> : null}
        {error ? <OpsBanner tone="danger" body={error} /> : null}

        {loading ? <OpsLoadingState label="Loading properties" /> : null}

        {!loading && activeLocationBlockGroups.length > 0 ? (
          <section className="ops-cal-sheet-stack">
            <h2 className="ops-cal-section-title">Active location blocks</h2>
            <ul className="ops-cal-groups">
              {activeLocationBlockGroups.map((group) => {
                const label = group.locationLabel || group.locationKey || 'Location';
                const count = group.targetCount ?? 0;
                return (
                  <li key={group.locationBlockGroupId} className="ops-cal-group">
                    <div className="ops-cal-group__row">
                      <div className="ops-cal-sheet-stack">
                        <div className="ops-cal__meta-row">
                          <h3 className="ops-cal-group__title">{label}</h3>
                          <span className="ops-cal-chip ops-cal-chip--location">Location-wide block</span>
                        </div>
                        <p className="ops-cal-group__meta">{formatGroupDateRange(group.startDate, group.endDate)}</p>
                        <p className="ops-cal-group__meta">
                          {count} propert{count === 1 ? 'y' : 'ies'} blocked
                        </p>
                      </div>
                      <OpsButton variant="destructive" onClick={() => openRemoveGroup(group)}>
                        Remove
                      </OpsButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {!loading ? (
          <ul className="ops-cal-rows">
            {mergedRows.length === 0 ? <li className="ops-cal-empty">No properties found.</li> : null}
            {mergedRows.map(({ cabin, preview: pr }) => {
              const routeId = propertyRouteId(cabin);
              const rowKey = routeId || `row-${cabin.name}`;
              const blocks = pr?.blocks || [];
              const sync = syncStatusValue(pr?.syncIndicators?.syncStatus || 'stale');
              const img = cabin.content?.imageUrl || pr?.listing?.imageUrl;
              const hardN = pr?.summary?.hardConflictCount ?? pr?.conflictMarkers?.hard?.length ?? 0;
              const warnN = pr?.summary?.warningCount ?? pr?.conflictMarkers?.warnings?.length ?? 0;
              const accentCls = conflictAccentClass(hardN, warnN);

              return (
                <li key={rowKey}>
                  <Link
                    to={routeId ? `/ops/calendar/${routeId}` : '#'}
                    className={opsCx('ops-cal-row', accentCls, !routeId && 'ops-cal-row--disabled')}
                  >
                    <div className="ops-cal-row__body">
                      <div className="ops-cal-row__thumb">
                        {img ? (
                          <img src={img} alt="" loading="lazy" />
                        ) : (
                          <span className="ops-cal-row__thumb-fallback">{initialsFromName(cabin.name)}</span>
                        )}
                      </div>

                      <div className="ops-cal-row__main">
                        <div className="ops-cal-row__title-row">
                          <div>
                            <h2 className="ops-cal-row__name">{cabin.name}</h2>
                            <p className="ops-cal-row__location">{cabin.location || '—'}</p>
                          </div>
                          {routeId ? <ChevronRight size={20} aria-hidden="true" /> : null}
                        </div>

                        <div className="ops-cal-row__badges">
                          {cabin.kind === 'multi_unit_type' ? <OpsBadge tone="info">Multi-unit</OpsBadge> : null}
                          {cabin.isActive !== false ? (
                            <OpsStatus domain="cabin" value="active" />
                          ) : (
                            <OpsStatus domain="cabin" value="inactive" />
                          )}
                          <OpsStatus domain="sync" value={sync} />
                          {hardN > 0 ? (
                            <span className="ops-cal-chip ops-cal-chip--danger">
                              {hardN} conflict{hardN === 1 ? '' : 's'}
                            </span>
                          ) : null}
                          {warnN > 0 ? (
                            <span className="ops-cal-chip ops-cal-chip--warning">
                              {warnN} warning{warnN === 1 ? '' : 's'}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {stripKeys.length > 0 ? (
                      <div className="ops-cal-strip">
                        <p className="ops-cal-strip__label">Next {previewDays} nights</p>
                        <div className="ops-cal-strip__scroll">
                          <div className="ops-cal-strip__days">
                            {stripKeys.map((dk) => {
                              const { dot, ring } = cellToneForDay(dk, blocks);
                              const isToday = dk === preview?.meta?.today;
                              return (
                                <div key={dk} title={dk} className="ops-cal-strip__day">
                                  <span className="ops-cal-strip__dow">{formatStripDayLabel(dk)}</span>
                                  <span className={opsCx('ops-cal-strip__cell', isToday && 'ops-cal-strip__cell--today')}>
                                    <span className={opsCx(dot, ring)} />
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}

        <LocationBlockSheet
          open={locationBlockOpen}
          onClose={() => setLocationBlockOpen(false)}
          onSuccess={(data) => {
            setLocationBlockFlash(`Entire location blocked for ${data?.targetCount || 0} properties.`);
            load();
          }}
        />

        <OpsConfirmDialog
          open={Boolean(removeGroup)}
          title="Remove entire location block?"
          body="This removes the location-wide block from every property/unit included in this group. Existing reservations, external holds, maintenance blocks, and separate manual blocks remain unchanged."
          confirmLabel={removeLoading ? 'Removing…' : 'Remove entire location block'}
          cancelLabel="Cancel"
          tone="destructive"
          loading={removeLoading}
          onConfirm={confirmRemoveGroup}
          onClose={closeRemoveGroup}
        >
          <div className="ops-cal-sheet-stack">
            <p className="ops-cal-sheet-stack__title">
              {removeGroup?.locationLabel || removeGroup?.locationKey || 'Location-wide block'}
            </p>
            <p className="ops-cal-sheet-stack__meta">
              {formatGroupDateRange(removeGroup?.startDate, removeGroup?.endDate)}
            </p>
            {removeGroup?.targetCount != null ? (
              <p className="ops-cal-sheet-stack__meta">
                {removeGroup.targetCount} propert{removeGroup.targetCount === 1 ? 'y' : 'ies'} in this group
              </p>
            ) : null}
            {removeError ? <OpsInlineError>{removeError}</OpsInlineError> : null}
          </div>
        </OpsConfirmDialog>
      </div>
    </OpsPage>
  );
}
