import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import {
  PROPERTY_KIND_OPTIONS,
  currentMonthDateRange,
  daysBetweenInclusive
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
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../ops/primitives/OpsTable';
import './OpsInsights.css';

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
    <OpsPage width="wide" className="ops-insights">
      <div data-testid="ops-insights-performance-page">
      <OpsPageHeader
        title="Historical performance"
        description="Direct bookings only. External channels (Airbnb and others) are not included yet."
        actions={
          <Link to="/ops/insights" className="ops-insights__link">
            Back to revenue insights
          </Link>
        }
      />

      <OpsBanner
        tone="warning"
        body="Direct revenue per sellable night is not total RevPAR. Occupancy uses configured operating periods minus verified maintenance/owner blocks. Unidentified iCal blocks are not subtracted."
      />

      {error ? <OpsBanner tone="danger" body={error} /> : null}

      <section className="ops-insights__surface">
        <div className="ops-insights__kind-row" data-testid="performance-property-kind">
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
            onChange={(e) => updateFilter('from', e.target.value)}
          />
          <OpsTextField
            label="To"
            type="date"
            value={filters.to}
            onChange={(e) => updateFilter('to', e.target.value)}
          />
          <OpsSelect
            label="Group by"
            value={filters.groupBy}
            onChange={(e) => updateFilter('groupBy', e.target.value)}
          >
            {GROUP_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </OpsSelect>
          <OpsSelect
            label="Revenue basis"
            value={filters.revenueBasis}
            onChange={(e) => updateFilter('revenueBasis', e.target.value)}
          >
            {REVENUE_BASIS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </OpsSelect>
          <OpsSelect
            label="Channel"
            value={filters.channel}
            onChange={(e) => updateFilter('channel', e.target.value)}
          >
            {CHANNEL_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </OpsSelect>
          <OpsSelect
            label="Confidence"
            value={filters.confidence}
            onChange={(e) => updateFilter('confidence', e.target.value)}
          >
            {CONFIDENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </OpsSelect>
          {filters.propertyKind === 'cabin' ? (
            <OpsSelect
              label="Cabin"
              value={filters.cabinId}
              onChange={(e) => updateFilter('cabinId', e.target.value)}
            >
              <option value="">All cabins</option>
              {(filterOptions.cabins || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </OpsSelect>
          ) : (
            <>
              <OpsSelect
                label="Cabin type"
                value={filters.cabinTypeId}
                onChange={(e) => updateFilter('cabinTypeId', e.target.value)}
              >
                <option value="">All cabin types</option>
                {(filterOptions.cabinTypes || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </OpsSelect>
              <OpsSelect
                label="Unit"
                value={filters.unitId}
                onChange={(e) => updateFilter('unitId', e.target.value)}
              >
                <option value="">All units</option>
                {unitsForType.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label || u.unitNumber || u.id}
                  </option>
                ))}
              </OpsSelect>
            </>
          )}
        </OpsFilterBar>
      </section>

      {loading ? (
        <OpsLoadingState label="Loading historical performance…" data-testid="performance-loading" />
      ) : error && !data ? null : (
        <>
          <OpsMetricGroup className="ops-insights__metric-group ops-metric-group--display" data-testid="performance-metrics">
            <OpsMetric label="Direct revenue" value={money(summary.grossBookedRevenueCents)} />
            <OpsMetric label="Bookings" value={summary.bookingCount ?? 0} />
            <OpsMetric label="Sold nights" value={summary.soldNights ?? 0} />
            <OpsMetric label="Occupied nights" value={summary.occupiedNights ?? 0} />
            <OpsMetric
              label="Sellable nights"
              value={occupancyUnavailable ? '—' : summary.sellableNights}
            />
            <OpsMetric label="Occupancy" value={pct(summary.occupancyRate)} />
            <OpsMetric label="ADR" value={money(summary.adrCents)} />
            <OpsMetric
              label="Direct revenue / sellable night"
              value={money(summary.revenuePerSellableNightCents)}
            />
            <OpsMetric label="Cancelled revenue" value={money(summary.cancelledRevenueCents)} />
          </OpsMetricGroup>

          {occupancyUnavailable ? (
            <OpsBanner
              tone="warning"
              body="Occupancy unavailable for this period because historical sellable inventory cannot be verified."
            />
          ) : null}

          <section className="ops-insights__surface" data-testid="performance-trend">
            <h3 className="ops-insights__surface-title">Trend</h3>
            {(data?.series || []).length === 0 ? (
              <p className="ops-insights__empty">No data for this period.</p>
            ) : (
              <OpsTable caption="Historical trend">
                <OpsTableHead>
                  <OpsTableRow>
                    <OpsTableHeader>Period</OpsTableHeader>
                    <OpsTableHeader numeric>Bookings</OpsTableHeader>
                    <OpsTableHeader numeric>Occupied</OpsTableHeader>
                    <OpsTableHeader numeric>Sellable</OpsTableHeader>
                    <OpsTableHeader numeric>Occupancy</OpsTableHeader>
                    <OpsTableHeader numeric>Revenue</OpsTableHeader>
                    <OpsTableHeader numeric>ADR</OpsTableHeader>
                    <OpsTableHeader>Confidence</OpsTableHeader>
                  </OpsTableRow>
                </OpsTableHead>
                <OpsTableBody>
                  {(data?.series || []).map((row) => (
                    <OpsTableRow key={row.period}>
                      <OpsTableCell className="ops-insights__mono">{row.period}</OpsTableCell>
                      <OpsTableCell numeric>{row.bookingCount}</OpsTableCell>
                      <OpsTableCell numeric>{row.occupiedNights}</OpsTableCell>
                      <OpsTableCell numeric>
                        {row.sellableNights == null ? '—' : row.sellableNights}
                      </OpsTableCell>
                      <OpsTableCell numeric>{pct(row.occupancyRate)}</OpsTableCell>
                      <OpsTableCell numeric>{money(row.grossBookedRevenueCents)}</OpsTableCell>
                      <OpsTableCell numeric>{money(row.adrCents)}</OpsTableCell>
                      <OpsTableCell>{row.dataConfidence}</OpsTableCell>
                    </OpsTableRow>
                  ))}
                </OpsTableBody>
              </OpsTable>
            )}
          </section>

          <section className="ops-insights__surface" data-testid="performance-entities">
            <h3 className="ops-insights__surface-title">Entity comparison</h3>
            {(data?.entities || []).length === 0 ? (
              <p className="ops-insights__empty">No data for this period.</p>
            ) : (
              <OpsTable caption="Entity comparison">
                <OpsTableHead>
                  <OpsTableRow>
                    <OpsTableHeader>Entity</OpsTableHeader>
                    <OpsTableHeader numeric>Bookings</OpsTableHeader>
                    <OpsTableHeader numeric>Occupied</OpsTableHeader>
                    <OpsTableHeader numeric>Sellable</OpsTableHeader>
                    <OpsTableHeader numeric>Occupancy</OpsTableHeader>
                    <OpsTableHeader numeric>Revenue</OpsTableHeader>
                    <OpsTableHeader numeric>ADR</OpsTableHeader>
                    <OpsTableHeader>Issues</OpsTableHeader>
                  </OpsTableRow>
                </OpsTableHead>
                <OpsTableBody>
                  {(data?.entities || []).map((row) => (
                    <OpsTableRow key={`${row.entityType}:${row.entityId}`}>
                      <OpsTableCell>
                        <div>{row.displayName}</div>
                        <p className="ops-insights__row-meta">
                          {row.entityType} · {row.dataConfidence}
                        </p>
                      </OpsTableCell>
                      <OpsTableCell numeric>{row.bookingCount}</OpsTableCell>
                      <OpsTableCell numeric>{row.occupiedNights}</OpsTableCell>
                      <OpsTableCell numeric>
                        {row.sellableNights == null ? '—' : row.sellableNights}
                      </OpsTableCell>
                      <OpsTableCell numeric>{pct(row.occupancyRate)}</OpsTableCell>
                      <OpsTableCell numeric>{money(row.grossBookedRevenueCents)}</OpsTableCell>
                      <OpsTableCell numeric>{money(row.adrCents)}</OpsTableCell>
                      <OpsTableCell>{(row.issues || []).join(', ') || '—'}</OpsTableCell>
                    </OpsTableRow>
                  ))}
                </OpsTableBody>
              </OpsTable>
            )}
          </section>

          <section className="ops-insights__surface" data-testid="performance-confidence">
            <h3 className="ops-insights__surface-title">Historical data confidence</h3>
            <p className="ops-insights__note">
              Earliest reliable revenue: {quality?.earliestReliableRevenueDate || '—'} · Earliest
              reliable occupancy: {quality?.earliestReliableOccupancyDate || 'not configured'}
            </p>
            <ul className="ops-insights__issue-list">
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
              <p className="ops-insights__confidence">
                Monthly confidence:{' '}
                {quality.confidenceByMonth
                  .slice(-12)
                  .map((m) => `${m.month}=${m.dataConfidence}`)
                  .join(' · ')}
              </p>
            ) : null}
          </section>
        </>
      )}
      </div>
    </OpsPage>
  );
}
