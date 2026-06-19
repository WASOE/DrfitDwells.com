import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import {
  PROPERTY_KIND_OPTIONS,
  currentMonthDateRange
} from './utils/opsIntelligenceFilters';

const REVENUE_BASIS_OPTIONS = [
  { value: 'checkIn', label: 'Check-in date' },
  { value: 'booked', label: 'Booked date' }
];

export default function OpsInsights() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useMemo(() => currentMonthDateRange(), []);
  const filters = useMemo(
    () => ({
      propertyKind: searchParams.get('propertyKind') || 'cabin',
      from: searchParams.get('from') || defaults.from,
      to: searchParams.get('to') || defaults.to,
      revenueBasis: searchParams.get('revenueBasis') || 'checkIn'
    }),
    [searchParams, defaults]
  );

  const [summary, setSummary] = useState(null);
  const [dataQuality, setDataQuality] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [summaryRes, qualityRes] = await Promise.all([
          opsReadAPI.insightsSummary({
            propertyKind: filters.propertyKind,
            from: filters.from,
            to: filters.to,
            revenueBasis: filters.revenueBasis
          }),
          opsReadAPI.insightsDataQuality({ propertyKind: filters.propertyKind })
        ]);
        if (cancelled) return;
        setSummary(summaryRes.data?.data || null);
        setDataQuality(qualityRes.data?.data || null);
      } catch (err) {
        if (cancelled) return;
        setError(err?.response?.data?.message || 'Failed to load insights');
        setSummary(null);
        setDataQuality(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [filters.propertyKind, filters.from, filters.to, filters.revenueBasis]);

  if (loading) {
    return <div className="text-sm text-gray-500">Loading insights...</div>;
  }

  const metrics = summary?.metrics || {};
  const channels = summary?.channelBreakdown || {};
  const issues = dataQuality?.issues || [];
  const totalIssues = issues.reduce((sum, issue) => sum + (issue.count || 0), 0);

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Revenue insights</h2>
        <p className="text-xs text-gray-500 mt-1">
          Direct booking revenue for {filters.propertyKind === 'valley' ? 'The Valley' : 'The Cabin'}.
        </p>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">From</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => updateFilter('from', event.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">To</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => updateFilter('to', event.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Revenue basis</span>
            <select
              value={filters.revenueBasis}
              onChange={(event) => updateFilter('revenueBasis', event.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            >
              {REVENUE_BASIS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {totalIssues > 0 ? (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-amber-900">Data quality attention</h3>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {issues
              .filter((issue) => issue.count > 0)
              .map((issue) => (
                <li key={issue.code}>
                  {issue.code}: {issue.count}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Bookings</p>
          <p className="text-2xl font-semibold text-gray-900">{metrics.bookingCount ?? 0}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Gross booked</p>
          <p className="text-2xl font-semibold text-gray-900">
            {formatMoneyFromCents(metrics.grossBookedRevenueCents)}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Cash collected</p>
          <p className="text-2xl font-semibold text-gray-900">
            {formatMoneyFromCents(metrics.cashCollectedCents)}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Avg booking value</p>
          <p className="text-2xl font-semibold text-gray-900">
            {formatMoneyFromCents(metrics.avgBookingValueCents)}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Cancelled</p>
          <p className="text-2xl font-semibold text-gray-900">{metrics.cancelledCount ?? 0}</p>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Channel breakdown</h3>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-4">Channel</th>
              <th className="py-2 pr-4">Bookings</th>
              <th className="py-2">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {['website', 'staff', 'other'].map((channel) => (
              <tr key={channel} className="border-b border-gray-100">
                <td className="py-2 pr-4 capitalize">{channel}</td>
                <td className="py-2 pr-4">{channels[channel]?.count ?? 0}</td>
                <td className="py-2">{formatMoneyFromCents(channels[channel]?.revenueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">Inventory health</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-gray-500">Cabins with propertyKind</p>
            <p className="font-semibold text-gray-900">
              {dataQuality?.inventoryHealth?.cabinsWithPropertyKind ?? 0}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Cabins missing propertyKind</p>
            <p className="font-semibold text-gray-900">
              {dataQuality?.inventoryHealth?.cabinsMissingPropertyKind ?? 0}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Cabin types with propertyKind</p>
            <p className="font-semibold text-gray-900">
              {dataQuality?.inventoryHealth?.cabinTypesWithPropertyKind ?? 0}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Active valley units</p>
            <p className="font-semibold text-gray-900">
              {dataQuality?.inventoryHealth?.activeUnits ?? '—'}
            </p>
          </div>
        </div>
        {summary?.provenance ? (
          <p className="text-xs text-gray-500 pt-2">{summary.provenance.revenueBasisNote}</p>
        ) : null}
        {summary?.provenance?.cashCollectedNote ? (
          <p className="text-xs text-gray-500">{summary.provenance.cashCollectedNote}</p>
        ) : null}
      </section>
    </div>
  );
}
