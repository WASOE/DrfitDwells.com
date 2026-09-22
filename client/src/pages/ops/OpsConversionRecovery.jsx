import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsSurface, { OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../ops/primitives/OpsTable';
import './OpsConversionRecovery.css';

const MAX_RANGE_DAYS = 180;

/** Display-only: snake_case eligibility reasons → sentence case. Does not alter API values. */
function humanizeEligibilityReason(value) {
  const raw = String(value || '')
    .replace(/_/g, ' ')
    .trim();
  if (!raw) return '—';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

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
  { value: 'quote_delivery_requested', label: 'Quote delivery' },
  { value: 'booking_reminder_consent', label: 'Booking reminder' },
  { value: 'marketing_consent', label: 'Marketing' },
  { value: 'missing_email', label: 'Missing email' },
  { value: 'no_valid_consent', label: 'No valid consent' },
  { value: 'consent_withdrawn', label: 'Consent withdrawn' },
  { value: 'globally_suppressed', label: 'Globally suppressed' },
  { value: 'already_converted', label: 'Already converted' },
  { value: 'expired', label: 'Quote expired' },
  { value: 'checkout_still_active', label: 'Checkout still active' },
  { value: 'already_recovered', label: 'Already recovered' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'test_or_internal', label: 'Test / internal' }
];

const CONSENT_BASIS_OPTIONS = [
  { value: '', label: 'All consent basis' },
  { value: 'quote_delivery', label: 'Quote delivery snapshot' },
  { value: 'booking_reminder', label: 'Reminder snapshot' },
  { value: 'marketing', label: 'Marketing snapshot' },
  { value: 'none', label: 'No snapshot consent' }
];

function ageLabel(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function yn(value) {
  return value ? 'Yes' : 'No';
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
      consentBasis: searchParams.get('consentBasis') || '',
      suppressed: searchParams.get('suppressed') || '',
      hasEmail: searchParams.get('hasEmail') || '',
      entityType: searchParams.get('entityType') || '',
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
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewPurpose, setPreviewPurpose] = useState('booking_reminder');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [links, setLinks] = useState(null);

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
        if (filters.consentBasis) params.consentBasis = filters.consentBasis;
        if (filters.suppressed) params.suppressed = filters.suppressed;
        if (filters.hasEmail) params.hasEmail = filters.hasEmail;
        if (filters.entityType) params.entityType = filters.entityType;
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
    filters.consentBasis,
    filters.suppressed,
    filters.hasEmail,
    filters.entityType,
    filters.cabinId,
    filters.cabinTypeId,
    filters.page
  ]);

  const page = Number(data?.pagination?.page || 1);
  const hasMore = Boolean(data?.pagination?.hasMore);

  return (
    <OpsPage width="wide" className="ops-recovery">
      <OpsPageHeader
        title="Quote recovery foundation"
        description="Saved commercial quotes and checkout intent. No automated sending in this batch."
        back={{ to: '/ops/conversion', label: 'Back to conversion funnel' }}
      />

      <OpsBanner
        tone="warning"
        body="Recovery delivery is disabled. Previews do not send messages. Automated sending is not enabled. Snapshot consent and effective preference may differ after withdrawal or suppression."
      />

      {error ? <OpsBanner tone="danger" body={error} /> : null}

      <OpsSurface className="ops-recovery__surface" aria-label="Recovery filters">
        <div className="ops-recovery__kind-row" data-testid="recovery-property-kind">
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
        <OpsFilterBar className="ops-recovery__filters">
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
            label="Status"
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </OpsSelect>
          <OpsSelect
            label="Eligibility (derived)"
            value={filters.eligibility}
            onChange={(e) => updateFilter('eligibility', e.target.value)}
          >
            {ELIGIBILITY_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </OpsSelect>
          <OpsSelect
            label="Consent basis (snapshot)"
            value={filters.consentBasis}
            onChange={(e) => updateFilter('consentBasis', e.target.value)}
          >
            {CONSENT_BASIS_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </OpsSelect>
          <OpsSelect
            label="Suppressed"
            value={filters.suppressed}
            onChange={(e) => updateFilter('suppressed', e.target.value)}
          >
            <option value="">All</option>
            <option value="true">Suppressed</option>
            <option value="false">Not suppressed</option>
          </OpsSelect>
          <OpsSelect
            label="Has email"
            value={filters.hasEmail}
            onChange={(e) => updateFilter('hasEmail', e.target.value)}
          >
            <option value="">All</option>
            <option value="true">Has email</option>
            <option value="false">No email</option>
          </OpsSelect>
          <OpsSelect
            label="Entity type"
            value={filters.entityType}
            onChange={(e) => updateFilter('entityType', e.target.value)}
          >
            <option value="">All</option>
            <option value="cabin">Cabin</option>
            <option value="cabin_type">Cabin type</option>
            <option value="location">Location buyout</option>
          </OpsSelect>
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
          <OpsSelect
            label="Cabin type"
            value={filters.cabinTypeId}
            onChange={(e) => updateFilter('cabinTypeId', e.target.value)}
            disabled={Boolean(filters.cabinId)}
          >
            <option value="">All cabin types</option>
            {(filterOptions.cabinTypes || []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </OpsSelect>
        </OpsFilterBar>
      </OpsSurface>

      {loading ? (
        <OpsLoadingState label="Loading recovery journeys..." data-testid="recovery-loading" />
      ) : error && !data ? null : (
        <OpsSurface className="ops-recovery__surface" data-testid="recovery-table" aria-label="Recovery list">
          {(data?.rows || []).length === 0 ? (
            <OpsEmptyState title="No saved quotes for these filters." />
          ) : (
            <OpsTable caption="Quote recovery journeys">
              <OpsTableHead>
                <OpsTableRow>
                  <OpsTableHeader>Stage</OpsTableHeader>
                  <OpsTableHeader>Source</OpsTableHeader>
                  <OpsTableHeader>Stay</OpsTableHeader>
                  <OpsTableHeader>Quote</OpsTableHeader>
                  <OpsTableHeader>Quote exp</OpsTableHeader>
                  <OpsTableHeader>Checkout exp</OpsTableHeader>
                  <OpsTableHeader>Snapshot</OpsTableHeader>
                  <OpsTableHeader>Effective</OpsTableHeader>
                  <OpsTableHeader>Eligibility</OpsTableHeader>
                  <OpsTableHeader>Preview</OpsTableHeader>
                </OpsTableRow>
              </OpsTableHead>
              <OpsTableBody>
                {(data?.rows || []).map((row) => (
                  <OpsTableRow key={row.savedQuoteId}>
                    <OpsTableCell className="ops-recovery__stage">
                      {String(row.status).replaceAll('_', ' ')}
                    </OpsTableCell>
                    <OpsTableCell>
                      {row.propertyKind === 'valley' ? 'Valley' : 'Cabin'}
                      {row.entityType === 'location' ? ' buyout' : ''}
                    </OpsTableCell>
                    <OpsTableCell>
                      <div className="ops-recovery__cell-stack">
                        <div className="ops-recovery__mono">
                          {row.locationKey || String(row.entityId).slice(-6)}
                        </div>
                        <p className="ops-recovery__muted">
                          {row.checkIn} → {row.checkOut}
                        </p>
                      </div>
                    </OpsTableCell>
                    <OpsTableCell>
                      <div className="ops-recovery__cell-stack">
                        <div>{formatMoneyFromCents(row.quotedTotalCents)}</div>
                        <p className="ops-recovery__muted">{ageLabel(row.quotedAt)}</p>
                      </div>
                    </OpsTableCell>
                    <OpsTableCell>
                      {row.expiresAt ? new Date(row.expiresAt).toISOString().slice(0, 10) : '—'}
                      {row.quoteExpired ? ' · expired' : ''}
                    </OpsTableCell>
                    <OpsTableCell>
                      {row.checkoutExpiresAt
                        ? new Date(row.checkoutExpiresAt).toISOString().slice(0, 10)
                        : '—'}
                      {row.checkoutExpired ? ' · expired' : ''}
                    </OpsTableCell>
                    <OpsTableCell>
                      Q:{yn(row.consentSnapshot?.quoteDeliveryRequested)} · R:
                      {yn(row.consentSnapshot?.bookingReminderConsent)} · M:
                      {yn(row.consentSnapshot?.marketingConsent)}
                    </OpsTableCell>
                    <OpsTableCell>
                      <div className="ops-recovery__cell-stack">
                        <span>
                          Q:{yn(row.effectiveContactPreference?.quoteDeliveryAllowed)} · R:
                          {yn(row.effectiveContactPreference?.bookingReminderAllowed)} · M:
                          {yn(row.effectiveContactPreference?.marketingAllowed)}
                        </span>
                        {row.effectiveContactPreference?.globallySuppressed ? (
                          <p className="ops-recovery__suppressed">suppressed</p>
                        ) : null}
                      </div>
                    </OpsTableCell>
                    <OpsTableCell>{humanizeEligibilityReason(row.eligibilityReason)}</OpsTableCell>
                    <OpsTableCell>
                      <OpsButton
                        type="button"
                        variant="quiet"
                        size="compact"
                        onClick={async () => {
                          setSelectedId(row.savedQuoteId);
                          setPreview(null);
                          setLinks(null);
                          try {
                            const res = await opsReadAPI.conversionRecoveryDetail(row.savedQuoteId);
                            setDetail(res.data?.data || null);
                          } catch {
                            setDetail(null);
                          }
                        }}
                      >
                        Open
                      </OpsButton>
                    </OpsTableCell>
                  </OpsTableRow>
                ))}
              </OpsTableBody>
            </OpsTable>
          )}
          <div className="ops-recovery__pager">
            <p className="ops-recovery__pager-meta">
              Page {page} · returned {data?.pagination?.returned ?? data?.rows?.length ?? 0}
              {data?.pagination?.total != null ? ` · total ${data.pagination.total}` : ''}
              {data?.pagination?.totalBasis ? ` · ${data.pagination.totalBasis}` : ''}
            </p>
            <div className="ops-recovery__pager-actions">
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
        </OpsSurface>
      )}

      {selectedId && detail ? (
        <OpsSurface
          className="ops-recovery__surface"
          data-testid="recovery-detail"
          aria-labelledby="ops-recovery-detail-title"
        >
          <OpsSurfaceTitle id="ops-recovery-detail-title" className="ops-recovery__surface-title">
            Delivery safety panel
          </OpsSurfaceTitle>
          <OpsBanner tone="warning" body="Recovery delivery is disabled. Previews do not send messages." />
          <div className="ops-recovery__detail-lines">
            <p>Send gate quote_delivery: {detail.deliveryGates?.quote_delivery?.reason || '—'}</p>
            <p>
              Send gate booking_reminder: {detail.deliveryGates?.booking_reminder?.reason || '—'}
            </p>
            <p>
              Consent withdrawal / suppression:{' '}
              {detail.effectiveContactPreference?.globallySuppressed
                ? 'globally suppressed'
                : 'active preferences shown above'}
            </p>
          </div>
          {(detail.deliveries || []).length ? (
            <ul className="ops-recovery__delivery-list">
              {detail.deliveries.map((d) => (
                <li key={d.id}>
                  {d.messagePurpose} · {d.templateKey}@{d.templateVersion} · {d.status}
                  {d.blockedReason ? ` · ${d.blockedReason}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ops-recovery__muted">No prepared deliveries yet.</p>
          )}
          <div className="ops-recovery__actions">
            <OpsSelect
              label="Message purpose"
              value={previewPurpose}
              onChange={(e) => setPreviewPurpose(e.target.value)}
            >
              <option value="booking_reminder">booking_reminder</option>
              <option value="quote_delivery">quote_delivery</option>
            </OpsSelect>
            <OpsButton
              type="button"
              variant="secondary"
              size="compact"
              disabled={previewBusy}
              onClick={async () => {
                setPreviewBusy(true);
                try {
                  const res = await opsReadAPI.conversionRecoveryPreview(selectedId, {
                    messagePurpose: previewPurpose,
                    templateVersion: 'v1'
                  });
                  setPreview(res.data?.data || null);
                } catch (err) {
                  setPreview({ error: err?.response?.data?.message || 'Preview failed' });
                } finally {
                  setPreviewBusy(false);
                }
              }}
            >
              Message preview
            </OpsButton>
            <OpsButton
              type="button"
              variant="secondary"
              size="compact"
              disabled={previewBusy}
              onClick={async () => {
                setPreviewBusy(true);
                try {
                  const res = await opsReadAPI.conversionRecoveryLinks(selectedId);
                  setLinks(res.data?.data || null);
                } catch {
                  setLinks(null);
                } finally {
                  setPreviewBusy(false);
                }
              }}
            >
              Generate preference / continuation links
            </OpsButton>
          </div>
          {preview?.subject ? (
            <div className="ops-recovery__preview">
              <p className="ops-recovery__preview-subject">Subject: {preview.subject}</p>
              <p className="ops-recovery__preview-text">{preview.text}</p>
              <p className="ops-recovery__muted">
                Eligibility: {humanizeEligibilityReason(preview.eligibility?.reason)}
              </p>
            </div>
          ) : null}
          {preview?.error ? <OpsBanner tone="danger" body={preview.error} /> : null}
          {links ? (
            <div className="ops-recovery__links">
              <p>Preference link issued: {yn(links.preferenceIssued)}</p>
              <p>{links.preferenceUrl || '—'}</p>
              <p>Continuation link issued: {yn(links.continuationIssued)}</p>
              <p>{links.continuationUrl || '—'}</p>
            </div>
          ) : null}
        </OpsSurface>
      ) : null}
    </OpsPage>
  );
}
