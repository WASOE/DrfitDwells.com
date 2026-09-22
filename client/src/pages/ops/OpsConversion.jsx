import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import {
  PROPERTY_KIND_OPTIONS,
  currentMonthDateRange,
  formatPercent,
  humanizeEventType,
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
import OpsSurface, { OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../ops/primitives/OpsTable';
import './OpsConversion.css';

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

  const searchResults = summary?.supplementary?.searchResults;
  const quoteFailed = summary?.supplementary?.quoteFailed;
  const savedQuotes = summary?.supplementary?.savedQuotes;
  const provenance = summary?.provenance || {};

  return (
    <OpsPage width="wide" className="ops-conversion">
      <div data-testid="ops-conversion-page">
        <OpsPageHeader
          title="Conversion funnel"
          description={`Zone-specific funnel for ${
            filters.propertyKind === 'valley' ? 'The Valley' : 'The Cabin'
          }.`}
          actions={
            <Link
              to={`/ops/conversion/recovery?propertyKind=${filters.propertyKind}&from=${filters.from}&to=${filters.to}`}
              className="ops-conversion__link"
            >
              Quote recovery
            </Link>
          }
        />

        {error ? <OpsBanner tone="danger" body={error} /> : null}

        <OpsSurface className="ops-conversion__surface">
          <div className="ops-conversion__kind-row" data-testid="conversion-property-kind">
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
          <OpsFilterBar className="ops-conversion__filters">
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
          </OpsFilterBar>
          <p className="ops-conversion__note">
            Default range is the current month. Maximum range is {MAX_CONVERSION_RANGE_DAYS} days.
            Unit filtering is not supported on conversion.
          </p>
        </OpsSurface>

        {loading ? (
          <OpsLoadingState label="Loading conversion summary..." data-testid="conversion-loading" />
        ) : error && !summary ? null : (
          <>
            <OpsSurface className="ops-conversion__surface" data-testid="conversion-funnel-steps">
              <OpsSurfaceTitle as="h3" className="ops-conversion__surface-title">Zone funnel steps</OpsSurfaceTitle>
              <OpsTable>
                <OpsTableHead>
                  <OpsTableRow>
                    <OpsTableHeader>Step</OpsTableHeader>
                    <OpsTableHeader>Sessions</OpsTableHeader>
                    <OpsTableHeader>Events</OpsTableHeader>
                    <OpsTableHeader>Orphan events</OpsTableHeader>
                  </OpsTableRow>
                </OpsTableHead>
                <OpsTableBody>
                  {(summary?.steps || []).map((step) => (
                    <OpsTableRow key={step.eventType}>
                      <OpsTableCell>
                        {step.label || humanizeEventType(step.eventType)}
                      </OpsTableCell>
                      <OpsTableCell>{step.sessionCount ?? 0}</OpsTableCell>
                      <OpsTableCell>{step.eventCount ?? 0}</OpsTableCell>
                      <OpsTableCell>{step.orphanEventCount ?? '—'}</OpsTableCell>
                    </OpsTableRow>
                  ))}
                </OpsTableBody>
              </OpsTable>
            </OpsSurface>

            <OpsSurface className="ops-conversion__surface" data-testid="conversion-dropoff">
              <OpsSurfaceTitle as="h3" className="ops-conversion__surface-title">
                Drop-off (session-sequential)
              </OpsSurfaceTitle>
              <OpsTable>
                <OpsTableHead>
                  <OpsTableRow>
                    <OpsTableHeader>From → To</OpsTableHeader>
                    <OpsTableHeader>Sessions at from</OpsTableHeader>
                    <OpsTableHeader>Continued</OpsTableHeader>
                    <OpsTableHeader>Drop-off</OpsTableHeader>
                  </OpsTableRow>
                </OpsTableHead>
                <OpsTableBody>
                  {(summary?.dropOff || []).map((row) => (
                    <OpsTableRow key={`${row.from}-${row.to}`}>
                      <OpsTableCell>
                        {humanizeEventType(row.from)} → {humanizeEventType(row.to)}
                      </OpsTableCell>
                      <OpsTableCell>{row.fromSessionCount ?? 0}</OpsTableCell>
                      <OpsTableCell>{row.continuedSessionCount ?? 0}</OpsTableCell>
                      <OpsTableCell>{formatPercent(row.dropOffRate)}</OpsTableCell>
                    </OpsTableRow>
                  ))}
                </OpsTableBody>
              </OpsTable>
            </OpsSurface>

            <OpsSurface className="ops-conversion__surface" data-testid="conversion-search-results">
              <OpsSurfaceTitle as="h3" className="ops-conversion__surface-title">
                Supplementary: search results (site-wide)
              </OpsSurfaceTitle>
              <p className="ops-conversion__body">
                Site-wide sessions: {searchResults?.sessionCount ?? 0} · Events:{' '}
                {searchResults?.eventCount ?? 0}
              </p>
              {searchResults?.note ? (
                <p className="ops-conversion__note">{searchResults.note}</p>
              ) : null}
            </OpsSurface>

            <OpsSurface className="ops-conversion__surface" data-testid="conversion-quote-failed">
              <OpsSurfaceTitle as="h3" className="ops-conversion__surface-title">
                Supplementary: quote failures
              </OpsSurfaceTitle>
              <p className="ops-conversion__body">
                Failed quotes: {quoteFailed?.eventCount ?? 0} · Orphan failures:{' '}
                {quoteFailed?.orphanEventCount ?? 0}
              </p>
              {quoteFailed?.byClass ? (
                <ul className="ops-conversion__list">
                  {Object.entries(quoteFailed.byClass).map(([cls, count]) => (
                    <li key={cls}>
                      {cls}: {count}
                    </li>
                  ))}
                </ul>
              ) : null}
            </OpsSurface>

            <OpsSurface className="ops-conversion__surface" data-testid="conversion-saved-quotes">
              <OpsSurfaceTitle as="h3" className="ops-conversion__surface-title">
                Supplementary: saved quotes
              </OpsSurfaceTitle>
              <p className="ops-conversion__body">
                Valid: {savedQuotes?.savedValidQuotes ?? 0} · Checkout started:{' '}
                {savedQuotes?.checkoutStartedSavedQuotes ?? 0} · Converted:{' '}
                {savedQuotes?.convertedSavedQuotes ?? 0} · Abandoned:{' '}
                {savedQuotes?.abandonedSavedQuotes ?? 0} · Recovery-eligible:{' '}
                {savedQuotes?.recoveryEligibleJourneys ?? 0}
              </p>
              {savedQuotes?.note ? (
                <p className="ops-conversion__note">{savedQuotes.note}</p>
              ) : null}
            </OpsSurface>

            <section className="ops-conversion__provenance" data-testid="conversion-provenance">
              {provenance.funnelModelNote ? <p>{provenance.funnelModelNote}</p> : null}
              {provenance.propertyKindFilterNote ? (
                <p>{provenance.propertyKindFilterNote}</p>
              ) : null}
              {provenance.entityFilterNote ? <p>{provenance.entityFilterNote}</p> : null}
              {provenance.consentNote ? <p>{provenance.consentNote}</p> : null}
              {provenance.checkoutStartedNote ? <p>{provenance.checkoutStartedNote}</p> : null}
              {provenance.searchResultsNote ? <p>{provenance.searchResultsNote}</p> : null}
            </section>
          </>
        )}
      </div>
    </OpsPage>
  );
}
