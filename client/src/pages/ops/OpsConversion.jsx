import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import {
  PROPERTY_KIND_OPTIONS,
  currentMonthDateRange,
  formatPercent,
  humanizeEventType,
  daysBetweenInclusive
} from './utils/opsIntelligenceFilters';

const MAX_CONVERSION_RANGE_DAYS = 180;

export default function OpsConversion() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useMemo(() => currentMonthDateRange(), []);
  const filters = useMemo(
    () => ({
      propertyKind: searchParams.get('propertyKind') || 'cabin',
      from: searchParams.get('from') || defaults.from,
      to: searchParams.get('to') || defaults.to,
      cabinId: searchParams.get('cabinId') || '',
      cabinTypeId: searchParams.get('cabinTypeId') || ''
    }),
    [searchParams, defaults]
  );

  const [summary, setSummary] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ cabins: [], cabinTypes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    if (key === 'cabinId' && value) next.delete('cabinTypeId');
    if (key === 'cabinTypeId' && value) next.delete('cabinId');
    if (key === 'propertyKind') {
      next.delete('cabinId');
      next.delete('cabinTypeId');
    }
    setSearchParams(next);
  };

  useEffect(() => {
    let cancelled = false;
    const loadOptions = async () => {
      try {
        const res = await opsReadAPI.insightsFilterOptions({ propertyKind: filters.propertyKind });
        if (cancelled) return;
        const data = res.data?.data || {};
        setFilterOptions({ cabins: data.cabins || [], cabinTypes: data.cabinTypes || [] });
      } catch {
        if (!cancelled) setFilterOptions({ cabins: [], cabinTypes: [] });
      }
    };
    loadOptions();
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
        setSummary(null);
        setLoading(false);
        return;
      }
      if (span > MAX_CONVERSION_RANGE_DAYS) {
        setError(`Date range cannot exceed ${MAX_CONVERSION_RANGE_DAYS} days`);
        setSummary(null);
        setLoading(false);
        return;
      }

      try {
        const params = {
          propertyKind: filters.propertyKind,
          from: filters.from,
          to: filters.to
        };
        if (filters.cabinId) params.cabinId = filters.cabinId;
        if (filters.cabinTypeId) params.cabinTypeId = filters.cabinTypeId;

        const response = await opsReadAPI.conversionSummary(params);
        if (cancelled) return;
        setSummary(response.data?.data || null);
      } catch (err) {
        if (cancelled) return;
        setError(err?.response?.data?.message || 'Failed to load conversion summary');
        setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [filters.propertyKind, filters.from, filters.to, filters.cabinId, filters.cabinTypeId]);

  if (loading) {
    return <div className="text-sm text-gray-500">Loading conversion summary...</div>;
  }

  const searchResults = summary?.supplementary?.searchResults;
  const quoteFailed = summary?.supplementary?.quoteFailed;
  const provenance = summary?.provenance || {};

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Conversion funnel</h2>
        <p className="text-xs text-gray-500 mt-1">
          Zone-specific funnel for {filters.propertyKind === 'valley' ? 'The Valley' : 'The Cabin'}.
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Cabin</span>
            <select
              value={filters.cabinId}
              onChange={(event) => updateFilter('cabinId', event.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
            >
              <option value="">All cabins</option>
              {(filterOptions.cabins || []).map((cabin) => (
                <option key={cabin.id} value={cabin.id}>
                  {cabin.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Cabin type</span>
            <select
              value={filters.cabinTypeId}
              onChange={(event) => updateFilter('cabinTypeId', event.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
              disabled={Boolean(filters.cabinId)}
            >
              <option value="">All cabin types</option>
              {(filterOptions.cabinTypes || []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-gray-500">
          Default range is the current month. Maximum range is {MAX_CONVERSION_RANGE_DAYS} days.
          Unit filtering is not supported on conversion.
        </p>
      </section>

      {!error ? (
        <>
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Zone funnel steps</h3>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4">Step</th>
                  <th className="py-2 pr-4">Sessions</th>
                  <th className="py-2 pr-4">Events</th>
                  <th className="py-2">Orphan events</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.steps || []).map((step) => (
                  <tr key={step.eventType} className="border-b border-gray-100">
                    <td className="py-2 pr-4">{step.label || humanizeEventType(step.eventType)}</td>
                    <td className="py-2 pr-4">{step.sessionCount ?? 0}</td>
                    <td className="py-2 pr-4">{step.eventCount ?? 0}</td>
                    <td className="py-2">{step.orphanEventCount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Drop-off (session-sequential)</h3>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4">From → To</th>
                  <th className="py-2 pr-4">Sessions at from</th>
                  <th className="py-2 pr-4">Continued</th>
                  <th className="py-2">Drop-off</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.dropOff || []).map((row) => (
                  <tr key={`${row.from}-${row.to}`} className="border-b border-gray-100">
                    <td className="py-2 pr-4">
                      {humanizeEventType(row.from)} → {humanizeEventType(row.to)}
                    </td>
                    <td className="py-2 pr-4">{row.fromSessionCount ?? 0}</td>
                    <td className="py-2 pr-4">{row.continuedSessionCount ?? 0}</td>
                    <td className="py-2">{formatPercent(row.dropOffRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Supplementary: search results (site-wide)</h3>
            <p className="text-sm text-gray-700">
              Site-wide sessions: {searchResults?.sessionCount ?? 0} · Events:{' '}
              {searchResults?.eventCount ?? 0}
            </p>
            <p className="text-xs text-gray-500">{searchResults?.note}</p>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Supplementary: quote failures</h3>
            <p className="text-sm text-gray-700">
              Failed quotes: {quoteFailed?.eventCount ?? 0} · Orphan failures:{' '}
              {quoteFailed?.orphanEventCount ?? 0}
            </p>
            {quoteFailed?.byClass ? (
              <ul className="text-sm text-gray-700 space-y-1">
                {Object.entries(quoteFailed.byClass).map(([cls, count]) => (
                  <li key={cls}>
                    {cls}: {count}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-600 space-y-1">
            <p>{provenance.funnelModelNote}</p>
            <p>{provenance.propertyKindFilterNote}</p>
            <p>{provenance.entityFilterNote}</p>
            <p>{provenance.consentNote}</p>
            <p>{provenance.checkoutStartedNote}</p>
            <p>{provenance.searchResultsNote}</p>
          </section>
        </>
      ) : null}
    </div>
  );
}
