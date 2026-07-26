import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import {
  PROPERTY_KIND_OPTIONS,
  currentMonthDateRange,
  daysBetweenInclusive
} from './utils/opsIntelligenceFilters';

const MAX_RANGE_DAYS = 180;

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'checkout_started', label: 'Checkout started' },
  { value: 'converted', label: 'Converted' },
  { value: 'expired', label: 'Expired' },
  { value: 'superseded', label: 'Superseded' },
  { value: 'ineligible', label: 'Ineligible' }
];

const ELIGIBILITY_OPTIONS = [
  { value: '', label: 'All eligibility' },
  { value: 'missing_email', label: 'Missing email' },
  { value: 'no_valid_consent', label: 'No valid consent' },
  { value: 'already_converted', label: 'Already converted' },
  { value: 'quote_expired_too_long', label: 'Quote expired' },
  { value: 'checkout_still_active', label: 'Checkout still active' },
  { value: 'already_recovered', label: 'Already recovered' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'eligible_marketing', label: 'Eligible marketing' },
  { value: 'eligible_transactional_continuation', label: 'Eligible transactional' }
];

function ageLabel(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function OpsConversionRecovery() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useMemo(() => currentMonthDateRange(), []);
  const filters = useMemo(
    () => ({
      propertyKind: searchParams.get('propertyKind') || 'cabin',
      from: searchParams.get('from') || defaults.from,
      to: searchParams.get('to') || defaults.to,
      status: searchParams.get('status') || '',
      eligibility: searchParams.get('eligibility') || '',
      cabinId: searchParams.get('cabinId') || '',
      cabinTypeId: searchParams.get('cabinTypeId') || '',
      page: searchParams.get('page') || '1'
    }),
    [searchParams, defaults]
  );

  const [data, setData] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ cabins: [], cabinTypes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const updateFilter = (key, value, { resetPage = true } = {}) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key === 'cabinId' && value) next.delete('cabinTypeId');
    if (key === 'cabinTypeId' && value) next.delete('cabinId');
    if (key === 'propertyKind') {
      next.delete('cabinId');
      next.delete('cabinTypeId');
    }
    if (resetPage && key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  useEffect(() => {
    let cancelled = false;
    opsReadAPI
      .insightsFilterOptions({ propertyKind: filters.propertyKind })
      .then((res) => {
        if (cancelled) return;
        const payload = res.data?.data || {};
        setFilterOptions({ cabins: payload.cabins || [], cabinTypes: payload.cabinTypes || [] });
      })
      .catch(() => {
        if (!cancelled) setFilterOptions({ cabins: [], cabinTypes: [] });
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
          page: filters.page,
          limit: 50
        };
        if (filters.status) params.status = filters.status;
        if (filters.eligibility) params.eligibility = filters.eligibility;
        if (filters.cabinId) params.cabinId = filters.cabinId;
        if (filters.cabinTypeId) params.cabinTypeId = filters.cabinTypeId;
        const res = await opsReadAPI.conversionRecovery(params);
        if (cancelled) return;
        setData(res.data?.data || null);
      } catch (err) {
        if (cancelled) return;
        setError(err?.response?.data?.message || 'Failed to load recovery list');
        setData(null);
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
    filters.status,
    filters.eligibility,
    filters.cabinId,
    filters.cabinTypeId,
    filters.page
  ]);

  const page = Number(data?.pagination?.page || 1);
  const hasMore = Boolean(data?.pagination?.hasMore);

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Quote recovery foundation</h2>
            <p className="text-xs text-gray-500 mt-1">
              Saved commercial quotes and checkout intent. No automated sending in this batch.
            </p>
          </div>
          <Link to="/ops/conversion" className="text-sm text-gray-700 underline">
            Back to conversion funnel
          </Link>
        </div>
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Recovery eligibility does not guarantee that a message may legally be sent. Automated
          sending is not enabled in this batch.
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
            <span className="block text-xs text-gray-500 mb-1">Status</span>
            <select
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Eligibility</span>
            <select
              value={filters.eligibility}
              onChange={(e) => updateFilter('eligibility', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            >
              {ELIGIBILITY_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
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
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Cabin type</span>
            <select
              value={filters.cabinTypeId}
              onChange={(e) => updateFilter('cabinTypeId', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
              disabled={Boolean(filters.cabinId)}
            >
              <option value="">All cabin types</option>
              {(filterOptions.cabinTypes || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        {loading ? (
          <p className="text-sm text-gray-500">Loading recovery journeys...</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">Stage</th>
                    <th className="py-2 pr-3">Stay</th>
                    <th className="py-2 pr-3">Dates</th>
                    <th className="py-2 pr-3">Quote</th>
                    <th className="py-2 pr-3">Age</th>
                    <th className="py-2 pr-3">Checkout</th>
                    <th className="py-2 pr-3">Consent</th>
                    <th className="py-2 pr-3">Eligibility</th>
                    <th className="py-2">Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((row) => (
                    <tr key={row.savedQuoteId} className="border-b border-gray-100">
                      <td className="py-2 pr-3 capitalize">{String(row.status).replaceAll('_', ' ')}</td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {String(row.entityId).slice(-6)}
                      </td>
                      <td className="py-2 pr-3">
                        {row.checkIn} → {row.checkOut}
                      </td>
                      <td className="py-2 pr-3">{formatMoneyFromCents(row.quotedTotalCents)}</td>
                      <td className="py-2 pr-3">{ageLabel(row.quotedAt)}</td>
                      <td className="py-2 pr-3">{row.checkoutStartedAt ? 'Yes' : '—'}</td>
                      <td className="py-2 pr-3 text-xs">{row.consentBasis}</td>
                      <td className="py-2 pr-3 text-xs">{row.recoveryEligibilityReason}</td>
                      <td className="py-2">{row.recoverySendCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(data?.rows || []).length === 0 ? (
              <p className="text-sm text-gray-500 mt-3">No saved quotes for these filters.</p>
            ) : null}
            <div className="flex items-center justify-between text-sm text-gray-600 mt-3">
              <span>
                Page {page} · {data?.pagination?.total ?? 0} total
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => updateFilter('page', String(page - 1), { resetPage: false })}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!hasMore}
                  onClick={() => updateFilter('page', String(page + 1), { resetPage: false })}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
