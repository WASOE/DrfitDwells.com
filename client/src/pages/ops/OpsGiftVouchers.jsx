import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsCollectionRow from '../../ops/primitives/OpsCollectionRow';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBadge from '../../ops/primitives/OpsBadge';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsPagination from '../../ops/primitives/OpsPagination';
import './OpsGiftVouchers.css';

const DELIVERY_LABELS = {
  email: 'Email',
  postal: 'Postal',
  manual: 'Manual'
};

function deliveryLabel(mode) {
  if (!mode) return '';
  return DELIVERY_LABELS[mode] || mode;
}

function voucherTitle(row) {
  return row.code || 'Code pending';
}

function voucherMeta(row) {
  return `${row.buyerName || 'Unknown buyer'} (${row.buyerEmail || '—'}) → ${row.recipientName || 'Unknown recipient'} (${row.recipientEmail || '—'})`;
}

function hasActiveGiftVoucherFilters(filters) {
  return Boolean(
    filters.search ||
      filters.status ||
      filters.deliveryMode ||
      filters.visibility ||
      filters.includeSmoke ||
      filters.includeAbandoned
  );
}

export default function OpsGiftVouchers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const filters = useMemo(
    () => ({
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 20,
      search: searchParams.get('search') || '',
      status: searchParams.get('status') || '',
      deliveryMode: searchParams.get('deliveryMode') || '',
      visibility: searchParams.get('visibility') || '',
      includeSmoke: searchParams.get('includeSmoke') || '',
      includeAbandoned: searchParams.get('includeAbandoned') || ''
    }),
    [searchParams]
  );

  const statusSelectValue = filters.status
    ? filters.status
    : filters.visibility === 'all'
      ? '__all__'
      : '';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
        const resp = await opsReadAPI.giftVouchers(params);
        if (cancelled) return;
        setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load gift vouchers');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, String(value));
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const updateStatusFilter = (value) => {
    const next = new URLSearchParams(searchParams);
    next.delete('page');
    next.delete('status');
    next.delete('visibility');
    next.delete('includeSmoke');
    next.delete('includeAbandoned');

    if (value === '__all__') {
      next.set('visibility', 'all');
    } else if (value) {
      next.set('status', value);
      if (value === 'pending_payment' || value === 'voided') {
        next.set('includeAbandoned', '1');
      }
    }

    setSearchParams(next);
  };

  const resetFilters = () => setSearchParams(new URLSearchParams());

  const items = data?.items || [];
  const pagination = data?.pagination;
  const filtered = hasActiveGiftVoucherFilters(filters);

  return (
    <OpsPage width="wide" className="ops-gv-page">
      <OpsPageHeader
        title="Gift vouchers"
        description="Operational vouchers shown by default (active, partially redeemed, redeemed, expired)."
      />

      {error ? <OpsBanner tone="danger" body={error} /> : null}

      <div className="ops-gv-toolbar">
        <div className="ops-gv-filters">
          <OpsTextField
            className="ops-gv-filters__search"
            label="Search"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            placeholder="Search code, buyer, recipient, email"
          />
          <OpsSelect
            className="ops-gv-filters__select"
            label="Status"
            value={statusSelectValue}
            onChange={(e) => updateStatusFilter(e.target.value)}
          >
            <option value="">Operational (default)</option>
            <option value="active">Active</option>
            <option value="partially_redeemed">Partially redeemed</option>
            <option value="redeemed">Redeemed</option>
            <option value="expired">Expired</option>
            <option value="pending_payment">Pending payment (abandoned checkout)</option>
            <option value="voided">Voided</option>
            <option value="refunded">Refunded</option>
            <option value="__all__">All statuses</option>
          </OpsSelect>
          <OpsSelect
            className="ops-gv-filters__select"
            label="Delivery"
            value={filters.deliveryMode}
            onChange={(e) => updateFilter('deliveryMode', e.target.value)}
          >
            <option value="">All delivery modes</option>
            <option value="email">Email</option>
            <option value="postal">Postal</option>
            <option value="manual">Manual</option>
          </OpsSelect>
        </div>
        <OpsButton className="ops-gv-toolbar__reset" variant="quiet" size="compact" onClick={resetFilters}>
          Reset filters
        </OpsButton>
      </div>

      {loading ? (
        <OpsLoadingState label="Loading gift vouchers" />
      ) : items.length === 0 ? (
        <OpsEmptyState
          variant={filtered ? 'filtered' : 'empty'}
          title={filtered ? 'No matching gift vouchers' : 'No gift vouchers'}
          body={
            filtered
              ? 'No gift vouchers match the current filters.'
              : 'Operational vouchers will appear here.'
          }
          action={
            filtered ? (
              <OpsButton variant="secondary" onClick={resetFilters}>
                Reset filters
              </OpsButton>
            ) : null
          }
        />
      ) : (
        <div className="ops-gv-collection" role="list">
          {items.map((row) => (
            <OpsCollectionRow
              key={row.giftVoucherId}
              role="listitem"
              to={`/ops/gift-vouchers/${row.giftVoucherId}`}
              title={voucherTitle(row)}
              meta={voucherMeta(row)}
              status={
                <span className="ops-gv-row__facts">
                  <OpsStatus domain="voucher" value={row.status} />
                  {row.deliveryMode ? <OpsBadge>{deliveryLabel(row.deliveryMode)}</OpsBadge> : null}
                  <span className="ops-gv-row__balance">
                    Balance {formatMoneyFromCents(row.balanceRemainingCents, row.currency)} /{' '}
                    {formatMoneyFromCents(row.amountOriginalCents, row.currency)}
                  </span>
                </span>
              }
            />
          ))}
        </div>
      )}

      {!loading && Number(pagination?.totalPages) > 1 ? (
        <OpsPagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={(nextPage) => updateFilter('page', nextPage)}
        />
      ) : null}
    </OpsPage>
  );
}
