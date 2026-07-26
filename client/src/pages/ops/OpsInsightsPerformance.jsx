import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import {
  PROPERTY_KIND_OPTIONS,
  currentMonthDateRange,
  daysBetweenInclusive
} from './utils/opsIntelligenceFilters';

const MAX_RANGE_DAYS = 800;

const GROUP_BY_OPTIONS = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' }
];

const CHANNEL_OPTIONS = [
  { value: '', label: 'All channels' },
  { value: 'website', label: 'Website' },
  { value: 'staff', label: 'Staff' },
  { value: 'other', label: 'Other' }
];

const CONFIDENCE_OPTIONS = [
  { value: 'all', label: 'All confidence' },
  { value: 'verified', label: 'Verified only' },
  { value: 'usable', label: 'Verified + usable' }
];

const REVENUE_BASIS_OPTIONS = [
  { value: 'checkIn', label: 'Check-in date' },
  { value: 'booked', label: 'Booked date' }
];

function pct(rate) {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

function money(cents) {
  if (cents == null) return '—';
  return formatMoneyFromCents(cents);
}

export default function OpsInsightsPerformance() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useMemo(() => currentMonthDateRange(), []);
  const filters = useMemo(
    () => ({
      propertyKind: searchParams.get('propertyKind') || 'cabin',
      from: searchParams.get('from') || defaults.from,
      to: searchParams.get('to') || defaults.to,
      groupBy: searchParams.get('groupBy') || 'month',
      revenueBasis: searchParams.get('revenueBasis') || 'checkIn',
      cabinId: searchParams.get('cabinId') || '',
      cabinTypeId: searchParams.get('cabinTypeId') || '',
      unitId: searchParams.get('unitId') || '',
      channel: searchParams.get('channel') || '',
      confidence: searchParams.get('confidence') || 'all'
    }),
    [searchParams, defaults]
  );

  const [data, setData] = useState(null);
  const [quality, setQuality] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ cabins: [], cabinTypes: [], units: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key === 'cabinId' && value) {
      next.delete('cabinTypeId');
      next.delete('unitId');
    }
    if (key === 'cabinTypeId') {
      next.delete('cabinId');
      if (!value) next.delete('unitId');
    }
    if (key === 'propertyKind') {
      next.delete('cabinId');
      next.delete('cabinTypeId');
      next.delete('unitId');
    }
    setSearchParams(next);
  };

  useEffect(() => {
    let cancelled = false;
    opsReadAPI
      .insightsFilterOptions({ propertyKind: filters.propertyKind })
      .then((res) => {
        if (!cancelled) setFilterOptions(res.data?.data || { cabins: [], cabinTypes: [], units: [] });
      })
      .catch(() => {
        if (!cancelled) setFilterOptions({ cabins: [], cabinTypes: [], units: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [filters.propertyKind]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      const span = daysBetweenInclusive(filters.from, filters.to);
      if (span == null) {
        setError('Invalid date range');
        setData(null);
        setLoading(false);
        return;
      }
      if (span > MAX_RANGE_DAYS) {
        setError(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
        setData(null);
        setLoading(false);
        return;
      }
      try {
        const params = {
          propertyKind: filters.propertyKind,
          from: filters.from,
          to: filters.to,
          groupBy: filters.groupBy,
          revenueBasis: filters.revenueBasis,
          confidence: filters.confidence
        };
        if (filters.cabinId) params.cabinId = filters.cabinId;
        if (filters.cabinTypeId) params.cabinTypeId = filters.cabinTypeId;
        if (filters.unitId) params.unitId = filters.unitId;
        if (filters.channel) params.channel = filters.channel;

        const [perfRes, qualityRes] = await Promise.all([
          opsReadAPI.insightsPerformance(params),
          opsReadAPI.insightsHistoricalDataQuality({ propertyKind: filters.propertyKind })
        ]);
        if (cancelled) return;
        setData(perfRes.data?.data || null);
        setQuality(qualityRes.data?.data || null);
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || 'Failed to load historical performance');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [
    filters.propertyKind,
    filters.from,
    filters.to,
    filters.groupBy,
    filters.revenueBasis,
    filters.cabinId,
    filters.cabinTypeId,
    filters.unitId,
    filters.channel,
    filters.confidence
  ]);

  const summary = data?.summary || {};
  const occupancyUnavailable = summary.sellableNights == null;
  const unitsForType = useMemo(() => {
    if (!filters.cabinTypeId) return filterOptions.units || [];
    return (filterOptions.units || []).filter((u) => u.cabinTypeId === filters.cabinTypeId);
  }, [filterOptions.units, filters.cabinTypeId]);

  return (
    <div className="space-y-4 pb-16 sm:pb-0 max-w-7xl mx-auto">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Historical performance</h2>
            <p className="text-xs text-gray-500 mt-1">
              Direct bookings only. External channels (Airbnb and others) are not included yet.
            </p>
          </div>
          <Link to="/ops/insights" className="text-sm text-gray-700 underline">
            Back to revenue insights
          </Link>
        </div>
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Direct revenue per sellable night is not total RevPAR. Occupancy uses configured operating
          periods minus verified maintenance/owner blocks. Unidentified iCal blocks are not
          subtracted.
        </div>
        {error ? <p className="text-sm text-red-600 mt-2">{error}</p> : null}
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {PROPERTY_KIND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => updateFilter('propertyKind', option.value)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                filters.propertyKind === option.value
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-700 border-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">From</span>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => updateFilter('from', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">To</span>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => updateFilter('to', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Group by</span>
            <select
              value={filters.groupBy}
              onChange={(e) => updateFilter('groupBy', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            >
              {GROUP_BY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Revenue basis</span>
            <select
              value={filters.revenueBasis}
              onChange={(e) => updateFilter('revenueBasis', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            >
              {REVENUE_BASIS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Channel</span>
            <select
              value={filters.channel}
              onChange={(e) => updateFilter('channel', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            >
              {CHANNEL_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Confidence</span>
            <select
              value={filters.confidence}
              onChange={(e) => updateFilter('confidence', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            >
              {CONFIDENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {filters.propertyKind === 'cabin' ? (
            <label className="text-sm text-gray-700">
              <span className="block text-xs text-gray-500 mb-1">Cabin</span>
              <select
                value={filters.cabinId}
                onChange={(e) => updateFilter('cabinId', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2"
              >
                <option value="">All cabins</option>
                {(filterOptions.cabins || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="text-sm text-gray-700">
                <span className="block text-xs text-gray-500 mb-1">Cabin type</span>
                <select
                  value={filters.cabinTypeId}
                  onChange={(e) => updateFilter('cabinTypeId', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2"
                >
                  <option value="">All cabin types</option>
                  {(filterOptions.cabinTypes || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-gray-700">
                <span className="block text-xs text-gray-500 mb-1">Unit</span>
                <select
                  value={filters.unitId}
                  onChange={(e) => updateFilter('unitId', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2"
                >
                  <option value="">All units</option>
                  {unitsForType.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label || u.unitNumber || u.id}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-gray-500">Loading historical performance…</p>
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Direct revenue', value: money(summary.grossBookedRevenueCents) },
              { label: 'Bookings', value: summary.bookingCount ?? 0 },
              { label: 'Sold nights', value: summary.soldNights ?? 0 },
              { label: 'Occupied nights', value: summary.occupiedNights ?? 0 },
              {
                label: 'Sellable nights',
                value: occupancyUnavailable ? '—' : summary.sellableNights
              },
              { label: 'Occupancy', value: pct(summary.occupancyRate) },
              { label: 'ADR', value: money(summary.adrCents) },
              {
                label: 'Direct revenue / sellable night',
                value: money(summary.revenuePerSellableNightCents)
              },
              {
                label: 'Cancelled revenue',
                value: money(summary.cancelledRevenueCents)
              }
            ].map((card) => (
              <div
                key={card.label}
                className="bg-white border border-gray-200 rounded-xl p-4 max-w-md"
              >
                <p className="text-xs text-gray-500">{card.label}</p>
                <p className="text-xl font-semibold text-gray-900 mt-1">{card.value}</p>
              </div>
            ))}
          </section>

          {occupancyUnavailable ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              Occupancy unavailable for this period because historical sellable inventory cannot be
              verified.
            </div>
          ) : null}

          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Trend</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">Period</th>
                    <th className="py-2 pr-3">Bookings</th>
                    <th className="py-2 pr-3">Occupied</th>
                    <th className="py-2 pr-3">Sellable</th>
                    <th className="py-2 pr-3">Occupancy</th>
                    <th className="py-2 pr-3">Revenue</th>
                    <th className="py-2 pr-3">ADR</th>
                    <th className="py-2">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.series || []).map((row) => (
                    <tr key={row.period} className="border-b border-gray-100">
                      <td className="py-2 pr-3 font-mono text-xs">{row.period}</td>
                      <td className="py-2 pr-3">{row.bookingCount}</td>
                      <td className="py-2 pr-3">{row.occupiedNights}</td>
                      <td className="py-2 pr-3">
                        {row.sellableNights == null ? '—' : row.sellableNights}
                      </td>
                      <td className="py-2 pr-3">{pct(row.occupancyRate)}</td>
                      <td className="py-2 pr-3">{money(row.grossBookedRevenueCents)}</td>
                      <td className="py-2 pr-3">{money(row.adrCents)}</td>
                      <td className="py-2 text-xs">{row.dataConfidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Entity comparison</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">Entity</th>
                    <th className="py-2 pr-3">Bookings</th>
                    <th className="py-2 pr-3">Occupied</th>
                    <th className="py-2 pr-3">Sellable</th>
                    <th className="py-2 pr-3">Occupancy</th>
                    <th className="py-2 pr-3">Revenue</th>
                    <th className="py-2 pr-3">ADR</th>
                    <th className="py-2">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.entities || []).map((row) => (
                    <tr key={`${row.entityType}:${row.entityId}`} className="border-b border-gray-100">
                      <td className="py-2 pr-3">
                        <div>{row.displayName}</div>
                        <div className="text-xs text-gray-500">
                          {row.entityType} · {row.dataConfidence}
                        </div>
                      </td>
                      <td className="py-2 pr-3">{row.bookingCount}</td>
                      <td className="py-2 pr-3">{row.occupiedNights}</td>
                      <td className="py-2 pr-3">
                        {row.sellableNights == null ? '—' : row.sellableNights}
                      </td>
                      <td className="py-2 pr-3">{pct(row.occupancyRate)}</td>
                      <td className="py-2 pr-3">{money(row.grossBookedRevenueCents)}</td>
                      <td className="py-2 pr-3">{money(row.adrCents)}</td>
                      <td className="py-2 text-xs">{(row.issues || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Historical data confidence</h3>
            <p className="text-xs text-gray-600">
              Earliest reliable revenue:{' '}
              {quality?.earliestReliableRevenueDate || '—'} · Earliest reliable occupancy:{' '}
              {quality?.earliestReliableOccupancyDate || 'not configured'}
            </p>
            <ul className="text-xs text-gray-700 space-y-1">
              {Object.values(quality?.issues || {})
                .filter((issue) => issue.count > 0)
                .map((issue) => (
                  <li key={issue.code}>
                    {issue.code}: {issue.count}
                    {issue.affectedMonths?.length
                      ? ` · months ${issue.affectedMonths.slice(0, 6).join(', ')}`
                      : ''}
                  </li>
                ))}
            </ul>
            {(quality?.confidenceByMonth || []).length ? (
              <div className="text-xs text-gray-600 pt-2">
                Monthly confidence:{' '}
                {quality.confidenceByMonth
                  .slice(-12)
                  .map((m) => `${m.month}=${m.dataConfidence}`)
                  .join(' · ')}
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
