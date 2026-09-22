import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import {
  PROPERTY_KIND_OPTIONS,
  currentMonthDateRange
} from './utils/opsIntelligenceFilters';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsFilterBar from '../../ops/primitives/OpsFilterBar';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsMetric, { OpsMetricGroup } from '../../ops/primitives/OpsMetric';
import OpsSurface, { OpsSurfaceHeader, OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../ops/primitives/OpsTable';
import './OpsInsights.css';

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

  const metrics = summary?.metrics || {};
  const channels = summary?.channelBreakdown || {};
  const issues = dataQuality?.issues || [];
  const totalIssues = issues.reduce((sum, issue) => sum + (issue.count || 0), 0);
  const page = Number(bookings?.pagination?.page || 1);
  const hasMore = Boolean(bookings?.pagination?.hasMore);
  const propertyLabel = filters.propertyKind === 'valley' ? 'The Valley' : 'The Cabin';

  return (
    <OpsPage width="wide" className="ops-insights">
      <div data-testid="ops-insights-page">
      <OpsPageHeader
        title="Revenue insights"
        description={`Direct booking revenue for ${propertyLabel}.`}
        actions={
          <Link to="/ops/insights/performance" className="ops-insights__link">
            Historical performance
          </Link>
        }
      />

      {error ? <OpsBanner tone="danger" body={error} /> : null}

      <OpsSurface className="ops-insights__surface">
        <div className="ops-insights__kind-row" data-testid="insights-property-kind">
          {PROPERTY_KIND_OPTIONS.map((option) => (
            <OpsButton
              key={option.value}
              type="button"
              variant={filters.propertyKind === option.value ? 'primary' : 'secondary'}
              size="compact"
              onClick={() => updateFilter('propertyKind', option.value)}
            >
              {option.label}
            </OpsButton>
          ))}
        </div>
        <OpsFilterBar className="ops-insights__filters">
          <OpsTextField
            label="From"
            type="date"
            value={filters.from}
            onChange={(event) => updateFilter('from', event.target.value)}
          />
          <OpsTextField
            label="To"
            type="date"
            value={filters.to}
            onChange={(event) => updateFilter('to', event.target.value)}
          />
          <OpsSelect
            label="Revenue basis"
            value={filters.revenueBasis}
            onChange={(event) => updateFilter('revenueBasis', event.target.value)}
          >
            {REVENUE_BASIS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </OpsSelect>
          <OpsSelect
            label="Cabin"
            value={filters.cabinId}
            onChange={(event) => updateFilter('cabinId', event.target.value)}
          >
            <option value="">All cabins</option>
            {(filterOptions.cabins || []).map((cabin) => (
              <option key={cabin.id} value={cabin.id}>
                {cabin.name}
              </option>
            ))}
          </OpsSelect>
          <OpsSelect
            label="Cabin type"
            value={filters.cabinTypeId}
            onChange={(event) => updateFilter('cabinTypeId', event.target.value)}
            disabled={Boolean(filters.cabinId)}
          >
            <option value="">All cabin types</option>
            {(filterOptions.cabinTypes || []).map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </OpsSelect>
          <OpsSelect
            label="Unit"
            value={filters.unitId}
            onChange={(event) => updateFilter('unitId', event.target.value)}
            disabled={Boolean(filters.cabinId)}
          >
            <option value="">All units</option>
            {unitsForType.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </OpsSelect>
        </OpsFilterBar>
      </OpsSurface>

      {loading ? (
        <OpsLoadingState label="Loading insights..." data-testid="insights-loading" />
      ) : error && !summary ? null : (
        <>
          {totalIssues > 0 ? (
            <OpsSurface className="ops-insights__surface" data-testid="insights-data-quality">
              <OpsBanner tone="warning" title="Data quality attention" />
              <ul className="ops-insights__issue-list">
                {issues
                  .filter((issue) => issue.count > 0)
                  .map((issue) => (
                    <li key={issue.code}>
                      <span className="ops-insights__mono">{issue.code}</span>: {issueLabel(issue.code)}{' '}
                      — {issue.count}
                    </li>
                  ))}
              </ul>
            </OpsSurface>
          ) : null}

          <OpsMetricGroup className="ops-insights__metric-group ops-metric-group--display" data-testid="insights-metrics">
            <OpsMetric label="Bookings" value={metrics.bookingCount ?? 0} />
            <OpsMetric
              label="Gross booked"
              value={formatMoneyFromCents(metrics.grossBookedRevenueCents)}
            />
            <OpsMetric
              label="Payment snapshot at booking"
              value={formatMoneyFromCents(metrics.cashCollectedCents)}
              meta="Captured from booking finalization. Does not reflect later refunds or payment changes. Not live Stripe balance."
            />
            <OpsMetric
              label="Avg booking value"
              value={formatMoneyFromCents(metrics.avgBookingValueCents)}
            />
            <OpsMetric label="Cancelled" value={metrics.cancelledCount ?? 0} />
            <OpsMetric
              label="Cancelled revenue"
              value={formatMoneyFromCents(metrics.cancelledRevenueCents)}
            />
          </OpsMetricGroup>

          <OpsSurface className="ops-insights__surface" data-testid="insights-reconciliation">
            <OpsSurfaceHeader className="ops-insights__surface-head">
              <OpsSurfaceTitle as="h3" className="ops-insights__surface-title">
                Cash reconciliation (read-only)
              </OpsSurfaceTitle>
            </OpsSurfaceHeader>
            <p className="ops-insights__note">
              Additive comparison of commercial value, booking payment snapshot, and linked Stripe
              Payment ledger. Not a full accounting P&amp;L.
            </p>
            {reconciliation ? (
              <>
                <div className="ops-insights__recon-grid">
                  <div className="ops-insights__recon-item">
                    <p className="ops-insights__recon-label">Gross booked commercial</p>
                    <p className="ops-insights__recon-value">
                      {formatMoneyFromCents(reconciliation.commercial?.grossBookedRevenueCents?.value)}
                    </p>
                    <p className="ops-insights__recon-meta">
                      {reconciliation.commercial?.grossBookedRevenueCents?.source} ·{' '}
                      {reconciliation.commercial?.grossBookedRevenueCents?.basis}
                    </p>
                  </div>
                  <div className="ops-insights__recon-item">
                    <p className="ops-insights__recon-label">Payment snapshot at booking</p>
                    <p className="ops-insights__recon-value">
                      {formatMoneyFromCents(reconciliation.paymentSnapshotAtBooking?.amountCents?.value)}
                    </p>
                    <p className="ops-insights__recon-meta">
                      {reconciliation.paymentSnapshotAtBooking?.amountCents?.source} ·{' '}
                      {reconciliation.paymentSnapshotAtBooking?.amountCents?.basis}
                    </p>
                  </div>
                  <div className="ops-insights__recon-item">
                    <p className="ops-insights__recon-label">Linked ledger gross</p>
                    <p className="ops-insights__recon-value">
                      {formatMoneyFromCents(
                        reconciliation.linkedPaymentLedger?.grossPaidAmountCents?.value
                      )}
                    </p>
                    <p className="ops-insights__recon-meta">
                      {reconciliation.linkedPaymentLedger?.grossPaidAmountCents?.basis}
                    </p>
                  </div>
                  <div className="ops-insights__recon-item">
                    <p className="ops-insights__recon-label">Linked refunds</p>
                    <p className="ops-insights__recon-value">
                      {formatMoneyFromCents(
                        reconciliation.linkedPaymentLedger?.refundedAmountCents?.value
                      )}
                    </p>
                    <p className="ops-insights__recon-meta">
                      {reconciliation.linkedPaymentLedger?.refundedAmountCents?.basis}
                    </p>
                  </div>
                  <div className="ops-insights__recon-item">
                    <p className="ops-insights__recon-label">Linked ledger net</p>
                    <p className="ops-insights__recon-value">
                      {formatMoneyFromCents(
                        reconciliation.linkedPaymentLedger?.netPaidAmountCents?.value
                      )}
                    </p>
                    <p className="ops-insights__recon-meta">
                      {reconciliation.linkedPaymentLedger?.linkedPaymentCount ?? 0} linked payments
                    </p>
                  </div>
                  <div className="ops-insights__recon-item">
                    <p className="ops-insights__recon-label">Snapshot vs linked net</p>
                    <p className="ops-insights__recon-value">
                      {formatMoneyFromCents(reconciliation.variance?.snapshotVsLinkedLedgerCents)}
                    </p>
                    <p className="ops-insights__recon-meta">
                      Commercial vs linked net:{' '}
                      {formatMoneyFromCents(reconciliation.variance?.commercialVsLinkedNetPaidCents)}
                    </p>
                  </div>
                </div>
                <div className="ops-insights__callout">
                  <p className="ops-insights__callout-title">
                    Site-wide unlinked payments (not attributed to Cabin/Valley)
                  </p>
                  <p className="ops-insights__note">
                    Count: {reconciliation.siteWideUnlinkedPayments?.count ?? 0} · Amount shown for ops
                    review only:{' '}
                    {formatMoneyFromCents(reconciliation.siteWideUnlinkedPayments?.amountCents)}
                  </p>
                  <p className="ops-insights__note">
                    Excluded from zone variance. {reconciliation.siteWideUnlinkedPayments?.source}
                  </p>
                  <Link to="/ops/payments" className="ops-insights__link">
                    Review payments ledger
                  </Link>
                </div>
                {reconciliation.exclusions?.locationBookingTreatment ? (
                  <p className="ops-insights__note">
                    {reconciliation.exclusions.locationBookingTreatment}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="ops-insights__empty">Reconciliation unavailable.</p>
            )}
          </OpsSurface>

          <OpsSurface className="ops-insights__surface" data-testid="insights-channels">
            <OpsSurfaceTitle as="h3" className="ops-insights__surface-title">Channel breakdown</OpsSurfaceTitle>
            <OpsTable caption="Channel breakdown">
              <OpsTableHead>
                <OpsTableRow>
                  <OpsTableHeader>Channel</OpsTableHeader>
                  <OpsTableHeader numeric>Bookings</OpsTableHeader>
                  <OpsTableHeader numeric>Revenue</OpsTableHeader>
                </OpsTableRow>
              </OpsTableHead>
              <OpsTableBody>
                {['website', 'staff', 'other'].map((channel) => (
                  <OpsTableRow key={channel}>
                    <OpsTableCell className="capitalize">{channel}</OpsTableCell>
                    <OpsTableCell numeric>{channels[channel]?.count ?? 0}</OpsTableCell>
                    <OpsTableCell numeric>
                      {formatMoneyFromCents(channels[channel]?.revenueCents)}
                    </OpsTableCell>
                  </OpsTableRow>
                ))}
              </OpsTableBody>
            </OpsTable>
          </OpsSurface>

          <OpsSurface className="ops-insights__surface" data-testid="insights-bookings">
            <div className="ops-insights__table-tools">
              <OpsSurfaceTitle as="h3" className="ops-insights__surface-title">Bookings / stays</OpsSurfaceTitle>
              <div className="ops-insights__table-filters">
                <OpsSelect
                  label="Channel"
                  value={filters.channel}
                  onChange={(event) => updateFilter('channel', event.target.value)}
                >
                  {CHANNEL_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </OpsSelect>
                <OpsSelect
                  label="Status"
                  value={filters.status}
                  onChange={(event) => updateFilter('status', event.target.value)}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </OpsSelect>
              </div>
            </div>
            {bookingsLoading ? (
              <OpsLoadingState label="Loading bookings..." />
            ) : (bookings?.rows || []).length === 0 ? (
              <p className="ops-insights__empty">No data for this period.</p>
            ) : (
              <>
                <OpsTable caption="Bookings and stays">
                  <OpsTableHead>
                    <OpsTableRow>
                      <OpsTableHeader>Stay</OpsTableHeader>
                      <OpsTableHeader>Status</OpsTableHeader>
                      <OpsTableHeader>Channel</OpsTableHeader>
                      <OpsTableHeader>Check-in</OpsTableHeader>
                      <OpsTableHeader numeric>Revenue</OpsTableHeader>
                      <OpsTableHeader numeric>Snapshot</OpsTableHeader>
                    </OpsTableRow>
                  </OpsTableHead>
                  <OpsTableBody>
                    {(bookings?.rows || []).map((row) => (
                      <OpsTableRow key={`${row.stayKind}-${row.bookingId}`}>
                        <OpsTableCell>
                          <div className="ops-insights__stay-cell">
                            {row.detailHref ? (
                              <Link
                                to={row.detailHref}
                                className={`ops-insights__mono ops-insights__stay-link`}
                              >
                                {String(row.bookingId).slice(-8)}
                              </Link>
                            ) : (
                              <span className="ops-insights__mono">
                                {String(row.bookingId).slice(-8)}
                              </span>
                            )}
                            {row.stayKind === 'location_booking' ? (
                              <span className="ops-insights__chip">Valley buyout</span>
                            ) : null}
                          </div>
                        </OpsTableCell>
                        <OpsTableCell className="capitalize">{row.status}</OpsTableCell>
                        <OpsTableCell className="capitalize">{row.channel}</OpsTableCell>
                        <OpsTableCell>{row.checkInDateOnly || '—'}</OpsTableCell>
                        <OpsTableCell numeric>
                          {formatMoneyFromCents(row.bookedRevenueCents)}
                        </OpsTableCell>
                        <OpsTableCell numeric>
                          {formatMoneyFromCents(row.paymentSnapshotAtBookingCents)}
                        </OpsTableCell>
                      </OpsTableRow>
                    ))}
                  </OpsTableBody>
                </OpsTable>
                <div className="ops-insights__pager">
                  <span>
                    Page {page} · {bookings?.pagination?.total ?? 0} total
                  </span>
                  <div className="ops-insights__pager-actions">
                    <OpsButton
                      type="button"
                      variant="secondary"
                      size="compact"
                      disabled={page <= 1}
                      onClick={() => updateFilter('page', String(page - 1), { resetPage: false })}
                    >
                      Previous
                    </OpsButton>
                    <OpsButton
                      type="button"
                      variant="secondary"
                      size="compact"
                      disabled={!hasMore}
                      onClick={() => updateFilter('page', String(page + 1), { resetPage: false })}
                    >
                      Next
                    </OpsButton>
                  </div>
                </div>
                {bookings?.provenance?.locationBookingLimitations ? (
                  <p className="ops-insights__note">
                    {bookings.provenance.locationBookingLimitations}
                  </p>
                ) : null}
              </>
            )}
          </OpsSurface>

          <OpsSurface className="ops-insights__surface" data-testid="insights-inventory-health">
            <OpsSurfaceTitle as="h3" className="ops-insights__surface-title">Inventory health</OpsSurfaceTitle>
            <div className="ops-insights__health-grid">
              <div className="ops-insights__health-item">
                <p className="ops-insights__health-label">Cabins with propertyKind</p>
                <p className="ops-insights__health-value">
                  {dataQuality?.inventoryHealth?.cabinsWithPropertyKind ?? 0}
                </p>
              </div>
              <div className="ops-insights__health-item">
                <p className="ops-insights__health-label">Cabins missing propertyKind</p>
                <p className="ops-insights__health-value">
                  {dataQuality?.inventoryHealth?.cabinsMissingPropertyKind ?? 0}
                </p>
              </div>
              <div className="ops-insights__health-item">
                <p className="ops-insights__health-label">Cabin types with propertyKind</p>
                <p className="ops-insights__health-value">
                  {dataQuality?.inventoryHealth?.cabinTypesWithPropertyKind ?? 0}
                </p>
              </div>
              <div className="ops-insights__health-item">
                <p className="ops-insights__health-label">Active valley units</p>
                <p className="ops-insights__health-value">
                  {dataQuality?.inventoryHealth?.activeUnits ?? '—'}
                </p>
              </div>
            </div>
            {summary?.provenance ? (
              <p className="ops-insights__note">{summary.provenance.revenueBasisNote}</p>
            ) : null}
            {summary?.provenance?.paymentSnapshotNote ? (
              <p className="ops-insights__note">{summary.provenance.paymentSnapshotNote}</p>
            ) : null}
          </OpsSurface>
        </>
      )}
      </div>
    </OpsPage>
  );
}
