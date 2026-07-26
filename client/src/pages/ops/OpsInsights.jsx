import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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

const CHANNEL_OPTIONS = [
  { value: '', label: 'All channels' },
  { value: 'website', label: 'Website' },
  { value: 'staff', label: 'Staff' },
  { value: 'other', label: 'Other' }
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' }
];

function issueLabel(code) {
  const labels = {
    missing_property_kind: 'Missing propertyKind on inventory',
    both_cabin_and_cabin_type: 'Both cabinId and cabinTypeId set',
    missing_inventory_ref: 'Missing cabinId and cabinTypeId',
    zero_price_manual: 'Zero-price manual booking',
    missing_unit_on_valley_booking: 'Valley booking missing unitId'
  };
  return labels[code] || code;
}

export default function OpsInsights() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useMemo(() => currentMonthDateRange(), []);
  const filters = useMemo(
    () => ({
      propertyKind: searchParams.get('propertyKind') || 'cabin',
      from: searchParams.get('from') || defaults.from,
      to: searchParams.get('to') || defaults.to,
      revenueBasis: searchParams.get('revenueBasis') || 'checkIn',
      cabinId: searchParams.get('cabinId') || '',
      cabinTypeId: searchParams.get('cabinTypeId') || '',
      unitId: searchParams.get('unitId') || '',
      channel: searchParams.get('channel') || '',
      status: searchParams.get('status') || 'active',
      page: searchParams.get('page') || '1'
    }),
    [searchParams, defaults]
  );

  const [summary, setSummary] = useState(null);
  const [dataQuality, setDataQuality] = useState(null);
  const [bookings, setBookings] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ cabins: [], cabinTypes: [], units: [] });
  const [loading, setLoading] = useState(true);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [error, setError] = useState('');

  const updateFilter = (key, value, { resetPage = true } = {}) => {
    const next = new URLSearchParams(searchParams);
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
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
    if (resetPage && key !== 'page') {
      next.delete('page');
    }
    setSearchParams(next);
  };

  useEffect(() => {
    let cancelled = false;
    const loadOptions = async () => {
      try {
        const res = await opsReadAPI.insightsFilterOptions({ propertyKind: filters.propertyKind });
        if (cancelled) return;
        setFilterOptions(res.data?.data || { cabins: [], cabinTypes: [], units: [] });
      } catch {
        if (!cancelled) setFilterOptions({ cabins: [], cabinTypes: [], units: [] });
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
      try {
        const summaryParams = {
          propertyKind: filters.propertyKind,
          from: filters.from,
          to: filters.to,
          revenueBasis: filters.revenueBasis
        };
        if (filters.cabinId) summaryParams.cabinId = filters.cabinId;
        if (filters.cabinTypeId) summaryParams.cabinTypeId = filters.cabinTypeId;
        if (filters.unitId) summaryParams.unitId = filters.unitId;

        const [summaryRes, qualityRes, reconRes] = await Promise.all([
          opsReadAPI.insightsSummary(summaryParams),
          opsReadAPI.insightsDataQuality({ propertyKind: filters.propertyKind }),
          opsReadAPI.insightsReconciliation(summaryParams)
        ]);
        if (cancelled) return;
        setSummary(summaryRes.data?.data || null);
        setDataQuality(qualityRes.data?.data || null);
        setReconciliation(reconRes.data?.data || null);
      } catch (err) {
        if (cancelled) return;
        setError(err?.response?.data?.message || 'Failed to load insights');
        setSummary(null);
        setDataQuality(null);
        setReconciliation(null);
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
    filters.revenueBasis,
    filters.cabinId,
    filters.cabinTypeId,
    filters.unitId
  ]);

  useEffect(() => {
    let cancelled = false;
    const loadBookings = async () => {
      setBookingsLoading(true);
      try {
        const params = {
          propertyKind: filters.propertyKind,
          from: filters.from,
          to: filters.to,
          revenueBasis: filters.revenueBasis,
          status: filters.status,
          page: filters.page,
          limit: 50
        };
        if (filters.cabinId) params.cabinId = filters.cabinId;
        if (filters.cabinTypeId) params.cabinTypeId = filters.cabinTypeId;
        if (filters.unitId) params.unitId = filters.unitId;
        if (filters.channel) params.channel = filters.channel;

        const res = await opsReadAPI.insightsBookings(params);
        if (cancelled) return;
        setBookings(res.data?.data || null);
      } catch (err) {
        if (cancelled) return;
        setBookings(null);
        setError(err?.response?.data?.message || 'Failed to load bookings');
      } finally {
        if (!cancelled) setBookingsLoading(false);
      }
    };
    loadBookings();
    return () => {
      cancelled = true;
    };
  }, [
    filters.propertyKind,
    filters.from,
    filters.to,
    filters.revenueBasis,
    filters.cabinId,
    filters.cabinTypeId,
    filters.unitId,
    filters.channel,
    filters.status,
    filters.page
  ]);

  const unitsForType = useMemo(() => {
    if (!filters.cabinTypeId) return filterOptions.units || [];
    return (filterOptions.units || []).filter((u) => u.cabinTypeId === filters.cabinTypeId);
  }, [filterOptions.units, filters.cabinTypeId]);

  if (loading) {
    return <div className="text-sm text-gray-500">Loading insights...</div>;
  }

  const metrics = summary?.metrics || {};
  const channels = summary?.channelBreakdown || {};
  const issues = dataQuality?.issues || [];
  const totalIssues = issues.reduce((sum, issue) => sum + (issue.count || 0), 0);
  const page = Number(bookings?.pagination?.page || 1);
  const hasMore = Boolean(bookings?.pagination?.hasMore);

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Revenue insights</h2>
            <p className="text-xs text-gray-500 mt-1">
              Direct booking revenue for {filters.propertyKind === 'valley' ? 'The Valley' : 'The Cabin'}.
            </p>
          </div>
          <Link to="/ops/insights/performance" className="text-sm text-gray-700 underline">
            Historical performance
          </Link>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Unit</span>
            <select
              value={filters.unitId}
              onChange={(event) => updateFilter('unitId', event.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2"
              disabled={Boolean(filters.cabinId)}
            >
              <option value="">All units</option>
              {unitsForType.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
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
                  <span className="font-mono text-xs">{issue.code}</span>: {issueLabel(issue.code)} —{' '}
                  {issue.count}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
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
          <p className="text-xs text-gray-500 uppercase">Payment snapshot at booking</p>
          <p className="text-2xl font-semibold text-gray-900">
            {formatMoneyFromCents(metrics.cashCollectedCents)}
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Captured from booking finalization. Does not reflect later refunds or payment changes.
            Not live Stripe balance.
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
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Cancelled revenue</p>
          <p className="text-2xl font-semibold text-gray-900">
            {formatMoneyFromCents(metrics.cancelledRevenueCents)}
          </p>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Cash reconciliation (read-only)</h3>
        <p className="text-xs text-gray-500 mb-3">
          Additive comparison of commercial value, booking payment snapshot, and linked Stripe Payment
          ledger. Not a full accounting P&amp;L.
        </p>
        {reconciliation ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase">Gross booked commercial</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatMoneyFromCents(reconciliation.commercial?.grossBookedRevenueCents?.value)}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {reconciliation.commercial?.grossBookedRevenueCents?.source} ·{' '}
                  {reconciliation.commercial?.grossBookedRevenueCents?.basis}
                </p>
              </div>
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase">Payment snapshot at booking</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatMoneyFromCents(reconciliation.paymentSnapshotAtBooking?.amountCents?.value)}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {reconciliation.paymentSnapshotAtBooking?.amountCents?.source} ·{' '}
                  {reconciliation.paymentSnapshotAtBooking?.amountCents?.basis}
                </p>
              </div>
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase">Linked ledger gross</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatMoneyFromCents(
                    reconciliation.linkedPaymentLedger?.grossPaidAmountCents?.value
                  )}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {reconciliation.linkedPaymentLedger?.grossPaidAmountCents?.basis}
                </p>
              </div>
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase">Linked refunds</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatMoneyFromCents(
                    reconciliation.linkedPaymentLedger?.refundedAmountCents?.value
                  )}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {reconciliation.linkedPaymentLedger?.refundedAmountCents?.basis}
                </p>
              </div>
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase">Linked ledger net</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatMoneyFromCents(reconciliation.linkedPaymentLedger?.netPaidAmountCents?.value)}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {reconciliation.linkedPaymentLedger?.linkedPaymentCount ?? 0} linked payments
                </p>
              </div>
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase">Snapshot vs linked net</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatMoneyFromCents(reconciliation.variance?.snapshotVsLinkedLedgerCents)}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  Commercial vs linked net:{' '}
                  {formatMoneyFromCents(reconciliation.variance?.commercialVsLinkedNetPaidCents)}
                </p>
              </div>
            </div>
            <div className="border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50">
              <p className="text-xs font-semibold text-gray-700 uppercase">
                Site-wide unlinked payments (not attributed to Cabin/Valley)
              </p>
              <p className="text-sm text-gray-800 mt-1">
                Count: {reconciliation.siteWideUnlinkedPayments?.count ?? 0} · Amount shown for ops
                review only:{' '}
                {formatMoneyFromCents(reconciliation.siteWideUnlinkedPayments?.amountCents)}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                Excluded from zone variance. {reconciliation.siteWideUnlinkedPayments?.source}
              </p>
              <Link to="/ops/payments" className="inline-block mt-2 text-sm text-gray-900 underline">
                Review payments ledger
              </Link>
            </div>
            {reconciliation.exclusions?.locationBookingTreatment ? (
              <p className="text-xs text-gray-500">{reconciliation.exclusions.locationBookingTreatment}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Reconciliation unavailable.</p>
        )}
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

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-900">Bookings / stays</h3>
          <div className="flex flex-wrap gap-2">
            <select
              value={filters.channel}
              onChange={(event) => updateFilter('channel', event.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {bookingsLoading ? (
          <p className="text-sm text-gray-500">Loading bookings...</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">Stay</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Channel</th>
                    <th className="py-2 pr-3">Check-in</th>
                    <th className="py-2 pr-3">Revenue</th>
                    <th className="py-2">Snapshot</th>
                  </tr>
                </thead>
                <tbody>
                  {(bookings?.rows || []).map((row) => (
                    <tr
                      key={`${row.stayKind}-${row.bookingId}`}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {row.detailHref ? (
                            <Link
                              to={row.detailHref}
                              className="font-mono text-xs text-gray-900 hover:underline"
                            >
                              {String(row.bookingId).slice(-8)}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-gray-700">
                              {String(row.bookingId).slice(-8)}
                            </span>
                          )}
                          {row.stayKind === 'location_booking' ? (
                            <span className="inline-flex items-center rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                              Valley buyout
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3 capitalize">{row.status}</td>
                      <td className="py-2 pr-3 capitalize">{row.channel}</td>
                      <td className="py-2 pr-3">{row.checkInDateOnly || '—'}</td>
                      <td className="py-2 pr-3">{formatMoneyFromCents(row.bookedRevenueCents)}</td>
                      <td className="py-2">
                        {formatMoneyFromCents(row.paymentSnapshotAtBookingCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>
                Page {page} · {bookings?.pagination?.total ?? 0} total
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
            {bookings?.provenance?.locationBookingLimitations ? (
              <p className="text-xs text-gray-500">{bookings.provenance.locationBookingLimitations}</p>
            ) : null}
          </>
        )}
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
        {summary?.provenance?.paymentSnapshotNote ? (
          <p className="text-xs text-gray-500">{summary.provenance.paymentSnapshotNote}</p>
        ) : null}
      </section>
    </div>
  );
}
