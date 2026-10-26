import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsFilterBar from '../../ops/primitives/OpsFilterBar';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsPagination from '../../ops/primitives/OpsPagination';
import OpsCollectionRow from '../../ops/primitives/OpsCollectionRow';
import OpsBadge from '../../ops/primitives/OpsBadge';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../ops/primitives/OpsTable';
import './OpsBuildEnquiries.css';

const STATUS_LABELS = {
  new: 'New',
  in_progress: 'In progress',
  closed: 'Closed'
};

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

function emailAlertLabel(attention) {
  if (!attention) return null;
  if (attention.hasNeedsManual) return 'Needs manual email';
  if (attention.hasFailed) return 'Email failed';
  return null;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '—';
}

export default function OpsBuildEnquiries() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchDraft, setSearchDraft] = useState(searchParams.get('q') || '');

  const filters = useMemo(
    () => ({
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '20',
      status: searchParams.get('status') || '',
      q: searchParams.get('q') || '',
      emailAttention: searchParams.get('emailAttention') || ''
    }),
    [searchParams]
  );

  useEffect(() => {
    setSearchDraft(filters.q);
  }, [filters.q]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v !== '' && v != null)
        );
        const resp = await opsReadAPI.buildEnquiries(params);
        if (cancelled) return;
        setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || 'Failed to load build enquiries');
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
  }, [filters]);

  const updateFilter = (key, value, { resetPage = true } = {}) => {
    const next = new URLSearchParams(searchParams);
    if (value == null || value === '') next.delete(key);
    else next.set(key, String(value));
    if (resetPage && key !== 'page') next.set('page', '1');
    setSearchParams(next);
  };

  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 };
  const hasFilters = Boolean(filters.status || filters.q || filters.emailAttention);

  return (
    <OpsPage width="wide" className="ops-be-page" data-testid="ops-build-enquiries">
      <OpsPageHeader
        title="Build enquiries"
        description="Cabin project leads from /build. Review configuration and email delivery state."
      />

      <OpsFilterBar>
        <OpsTextField
          label="Search"
          value={searchDraft}
          placeholder="Reference, name, email, location"
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') updateFilter('q', searchDraft.trim());
          }}
        />
        <OpsSelect
          label="Status"
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="in_progress">In progress</option>
          <option value="closed">Closed</option>
        </OpsSelect>
        <OpsSelect
          label="Email"
          value={filters.emailAttention}
          onChange={(e) => updateFilter('emailAttention', e.target.value)}
        >
          <option value="">All email states</option>
          <option value="alert">Failed or needs manual</option>
          <option value="failed">Failed delivery</option>
          <option value="needs_manual">Needs manual</option>
        </OpsSelect>
        <OpsButton type="button" onClick={() => updateFilter('q', searchDraft.trim())}>
          Apply
        </OpsButton>
      </OpsFilterBar>

      {error ? <OpsBanner tone="danger" body={error} /> : null}

      {loading ? <OpsLoadingState label="Loading build enquiries…" /> : null}

      {!loading && !error && items.length === 0 ? (
        <OpsEmptyState
          variant={hasFilters ? 'filtered' : 'empty'}
          title={hasFilters ? 'No matching enquiries' : 'No build enquiries yet'}
          body={
            hasFilters
              ? 'Try clearing filters or widening your search.'
              : 'New /build submissions will appear here.'
          }
        />
      ) : null}

      {!loading && items.length > 0 ? (
        <>
          <div className="ops-be-mobile" data-testid="ops-build-enquiries-mobile">
            {items.map((row) => {
              const alert = emailAlertLabel(row.emailAttention);
              return (
                <OpsCollectionRow
                  key={row.id}
                  to={`/ops/build-enquiries/${row.id}`}
                  title={<span className="ops-be-ref">{row.projectReference || '—'}</span>}
                  meta={`${row.customerName || '—'} · ${row.modelLabel || '—'}`}
                  status={
                    <span className="ops-be-stack">
                      <OpsBadge>{statusLabel(row.status)}</OpsBadge>
                      <span className="ops-be-muted">{formatDate(row.createdAt)}</span>
                      <span>{row.estimateDisplayLabel || 'Estimate —'}</span>
                      {alert ? <span className="ops-be-alert">{alert}</span> : null}
                    </span>
                  }
                />
              );
            })}
          </div>

          <div className="ops-be-table-wrap" data-testid="ops-build-enquiries-table">
            <OpsTable caption="Build enquiries">
              <OpsTableHead>
                <OpsTableRow>
                  <OpsTableHeader>Reference</OpsTableHeader>
                  <OpsTableHeader>Customer</OpsTableHeader>
                  <OpsTableHeader>Model</OpsTableHeader>
                  <OpsTableHeader>Estimate</OpsTableHeader>
                  <OpsTableHeader>Date</OpsTableHeader>
                  <OpsTableHeader>Status</OpsTableHeader>
                  <OpsTableHeader>Email</OpsTableHeader>
                </OpsTableRow>
              </OpsTableHead>
              <OpsTableBody>
                {items.map((row) => {
                  const alert = emailAlertLabel(row.emailAttention);
                  return (
                    <OpsTableRow key={row.id}>
                      <OpsTableCell>
                        <Link to={`/ops/build-enquiries/${row.id}`} className="ops-be-ref">
                          {row.projectReference}
                        </Link>
                      </OpsTableCell>
                      <OpsTableCell>
                        <div className="ops-be-stack">
                          <span>{row.customerName || '—'}</span>
                          <span className="ops-be-muted">{row.customerEmail || ''}</span>
                        </div>
                      </OpsTableCell>
                      <OpsTableCell>{row.modelLabel || '—'}</OpsTableCell>
                      <OpsTableCell>{row.estimateDisplayLabel || '—'}</OpsTableCell>
                      <OpsTableCell>{formatDate(row.createdAt)}</OpsTableCell>
                      <OpsTableCell>
                        <OpsBadge>{statusLabel(row.status)}</OpsBadge>
                      </OpsTableCell>
                      <OpsTableCell>
                        {alert ? (
                          <span className="ops-be-alert">{alert}</span>
                        ) : (
                          <span className="ops-be-muted">OK</span>
                        )}
                      </OpsTableCell>
                    </OpsTableRow>
                  );
                })}
              </OpsTableBody>
            </OpsTable>
          </div>

          <OpsPagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={(page) => updateFilter('page', String(page), { resetPage: false })}
          />
        </>
      ) : null}
    </OpsPage>
  );
}
