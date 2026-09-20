import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import { exportToCSV } from '../../utils/csvExport';
import {
  MANUAL_RESERVATION_PURPOSE_OPTIONS,
  defaultSendGuestConfirmationForPurpose,
  manualReservationPurposeLabel
} from '../../utils/manualReservationPurpose';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsTextarea from '../../ops/primitives/OpsTextarea';
import OpsCheckbox from '../../ops/primitives/OpsCheckbox';
import OpsBadge from '../../ops/primitives/OpsBadge';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsInlineError from '../../ops/primitives/OpsInlineError';
import OpsPagination from '../../ops/primitives/OpsPagination';
import OpsModal from '../../ops/primitives/OpsModal';
import OpsFilterBar from '../../ops/primitives/OpsFilterBar';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../ops/primitives/OpsTable';
import { resolveOpsStatus } from '../../ops/status/opsStatusRegistry';
import './OpsReservations.css';

const EMPTY_CREATE_FORM = {
  cabinId: '',
  checkIn: '',
  checkOut: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  adults: '2',
  children: '0',
  initialStatus: 'pending',
  note: '',
  paymentPlaceholder: '',
  acceptExternalHoldWarnings: false,
  manualReservationPurpose: 'paid_guest',
  sendGuestConfirmationEmail: true
};

function copyEmptyCreateForm() {
  return { ...EMPTY_CREATE_FORM };
}

function paymentOpsValue(status) {
  if (!status) return 'unknown';
  if (status === 'unlinked_payment') return 'unlinked';
  return status;
}

function formatReservationAmount(amount) {
  if (amount == null || amount === '') return '—';
  const num = Number(amount);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2
  }).format(num);
}

function guestCountLabel(row) {
  const adults = row.adults ?? 0;
  const children = row.children ?? 0;
  return children > 0 ? `${adults}A ${children}C` : `${adults}A`;
}

function last8Id(reservationId) {
  return `#${String(reservationId || '').slice(-8)}`;
}

function guestName(row) {
  return `${row.guestSummary?.firstName || ''} ${row.guestSummary?.lastName || ''}`.trim() || '—';
}

function cabinLabel(row) {
  return row.cabinSummary?.displayName || row.cabinSummary?.name || 'Unknown';
}

function stayLabel(row) {
  return `${row.dateRange?.startDateOnly || '—'} - ${row.dateRange?.endDateOnly || '—'}`;
}

function operationalItems(row) {
  const items = [];
  const timing = row.operational?.stayTiming || {};
  const daysUntilCheckIn = Number.isFinite(timing.daysUntilCheckIn) ? timing.daysUntilCheckIn : null;
  if (row.reservationStatus !== 'cancelled') {
    if (timing.currentlyStaying) {
      items.push({ key: 'currently_staying' });
    } else if (timing.arrivingToday) {
      items.push({ key: 'arriving_today' });
    } else if (timing.arrivingTomorrow) {
      items.push({ key: 'arriving_tomorrow' });
    } else if (daysUntilCheckIn !== null && daysUntilCheckIn > 1) {
      items.push({ key: 'arriving_later', days: daysUntilCheckIn });
    } else if (timing.checkedOut) {
      items.push({ key: 'checked_out' });
    }
  }
  if (timing.checkingOutToday && row.reservationStatus !== 'cancelled') {
    items.push({ key: 'checking_out_today' });
  }
  if (row.operational?.cancelledPaid) items.push({ key: 'cancelled_paid' });
  if (row.operational?.refundPending) items.push({ key: 'refund_pending' });
  if (row.operational?.paymentAttention) items.push({ key: 'payment_attention' });
  if (row.conflict?.hasConflict) items.push({ key: 'conflict' });
  return items;
}

function ArrivingLaterStatus({ days }) {
  const entry = resolveOpsStatus('reservation', 'arriving_later');
  return (
    <span
      className={`ops-status ops-status--${entry.family || 'info'} ops-status--${entry.loudness || 'quiet'}`}
      data-ops-status-key={entry.key}
    >
      Arriving in {days} days
    </span>
  );
}

function ReservationStatuses({ row }) {
  const purposeLabel = row.manualReservationPurpose
    ? manualReservationPurposeLabel(row.manualReservationPurpose)
    : null;

  return (
    <div className="ops-reservations-status">
      <OpsStatus domain="reservation" value={row.reservationStatus || 'unknown'} />
      <OpsStatus domain="payment" value={paymentOpsValue(row.paymentStatus)} />
      {operationalItems(row).map((item) =>
        item.key === 'arriving_later' ? (
          <ArrivingLaterStatus key={item.key} days={item.days} />
        ) : (
          <OpsStatus key={item.key} domain="reservation" value={item.key} />
        )
      )}
      {purposeLabel ? <OpsBadge>{purposeLabel}</OpsBadge> : null}
      {row.sendGuestConfirmationEmail === false ? <OpsBadge>No auto confirmation email</OpsBadge> : null}
    </div>
  );
}

function ReservationStructuredRow({ row }) {
  const href = `/ops/reservations/${row.reservationId}`;
  return (
    <Link className="ops-reservations-row" to={href} data-testid="ops-reservation-row">
      <div className="ops-reservations-row__top">
        <div className="ops-reservations-guest">
          <p className="ops-reservations-guest__name">{guestName(row)}</p>
          <p className="ops-reservations-guest__email">{row.guestSummary?.email || '—'}</p>
        </div>
        <p className="ops-reservations-id">{last8Id(row.reservationId)}</p>
      </div>
      <div className="ops-reservations-facts">
        <div>
          <span className="ops-reservations-facts__label">Dates: </span>
          <span className="ops-reservations-facts__value">{stayLabel(row)}</span>
        </div>
        <div>
          <span className="ops-reservations-facts__label">Cabin: </span>
          <span className="ops-reservations-facts__value">{cabinLabel(row)}</span>
          {row.cabinSummary?.location ? (
            <span className="ops-reservations-facts__label"> · {row.cabinSummary.location}</span>
          ) : null}
        </div>
        <div>
          <span className="ops-reservations-facts__label">Guests: </span>
          <span className="ops-reservations-facts__value">{guestCountLabel(row)}</span>
        </div>
        <div>
          <span className="ops-reservations-facts__label">Amount: </span>
          <span className="ops-reservations-facts__value ops-reservations-amount">
            {formatReservationAmount(row.amount)}
          </span>
        </div>
      </div>
      <ReservationStatuses row={row} />
    </Link>
  );
}

export default function OpsReservations() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [cabins, setCabins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [form, setForm] = useState(copyEmptyCreateForm);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');

  const filters = useMemo(
    () => ({
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 20,
      opsBucket: searchParams.get('opsBucket') || '',
      status: searchParams.get('status') || '',
      cabinId: searchParams.get('cabinId') || '',
      paymentStatus: searchParams.get('paymentStatus') || '',
      search: searchParams.get('search') || ''
    }),
    [searchParams]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [resp, cabinsResp] = await Promise.all([
          opsReadAPI.reservations(Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''))),
          opsReadAPI.cabins()
        ]);
        if (!cancelled) {
          setData(resp.data?.data || null);
          setCabins(cabinsResp.data?.data?.items || []);
        }
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load reservations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const singleCabins = useMemo(
    () => (cabins || []).filter((c) => c.kind === 'single_cabin'),
    [cabins]
  );

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, String(value));
    if (key === 'opsBucket') next.delete('stayScope');
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const resetFilters = () => {
    setSearchParams(new URLSearchParams());
  };

  const handleExportCSV = async () => {
    setExportError('');
    setExportBusy(true);
    try {
      const { page: _p, limit: _l, ...exportParams } = filters;
      const cleanParams = Object.fromEntries(
        Object.entries(exportParams).filter(([, v]) => v !== '' && v !== null && v !== undefined)
      );
      const resp = await opsReadAPI.reservationsExport(cleanParams);
      const rows = resp.data?.data?.rows || [];
      if (rows.length === 0) {
        setExportError('No reservations match the current filters.');
        return;
      }
      const filename = `ops-reservations-${new Date().toISOString().split('T')[0]}.csv`;
      exportToCSV(rows, filename);
    } catch (err) {
      const payload = err?.response?.data;
      if (payload?.errorType === 'export_too_large') {
        setExportError(payload.message || 'Export too large. Refine filters.');
      } else {
        setExportError(payload?.message || 'Failed to export reservations');
      }
    } finally {
      setExportBusy(false);
    }
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    setCreateBusy(true);
    setCreateError('');
    try {
      const res = await opsWriteAPI.createManualReservation({
        cabinId: form.cabinId,
        checkIn: form.checkIn,
        checkOut: form.checkOut,
        adults: parseInt(form.adults, 10) || 2,
        children: parseInt(form.children, 10) || 0,
        guestInfo: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim()
        },
        initialStatus: form.initialStatus,
        note: form.note.trim() || undefined,
        paymentPlaceholderNote: form.paymentPlaceholder.trim() || undefined,
        acceptExternalHoldWarnings: form.acceptExternalHoldWarnings,
        manualReservationPurpose: form.manualReservationPurpose,
        sendGuestConfirmationEmail: form.sendGuestConfirmationEmail
      });
      const id = res.data?.data?.reservationId;
      setCreateOpen(false);
      if (id) navigate(`/ops/reservations/${id}`);
    } catch (err) {
      const d = err?.response?.data;
      const msg =
        d?.message ||
        (Array.isArray(d?.details?.warnings) && d.details.warnings.length > 0
          ? 'Overlaps external holds — enable the acknowledgment below or pick different dates.'
          : 'Could not create reservation');
      setCreateError(typeof msg === 'string' ? msg : 'Could not create reservation');
    } finally {
      setCreateBusy(false);
    }
  };

  const items = data?.items || [];
  const pagination = data?.pagination || {};
  const totalPages = pagination.totalPages || 1;
  const queryHasFilters = [...searchParams.keys()].some((key) => key !== 'page' && key !== 'limit');
  const emptyCatalog = Boolean(data) && items.length === 0 && !queryHasFilters;
  const emptyFiltered = Boolean(data) && items.length === 0 && queryHasFilters;

  return (
    <OpsPage width="wide">
      <div className="ops-reservations">
        <OpsPageHeader
          title="Reservations"
          actions={
            <>
              <OpsButton
                variant="secondary"
                onClick={handleExportCSV}
                disabled={exportBusy}
                loading={exportBusy}
                loadingLabel="Exporting…"
                data-testid="ops-reservations-export-csv"
              >
                Export CSV
              </OpsButton>
              <OpsButton
                onClick={() => {
                  setCreateError('');
                  setCreateOpen(true);
                }}
              >
                Create reservation
              </OpsButton>
            </>
          }
        />

        {exportError ? (
          <div className="ops-reservations-header-errors">
            <OpsInlineError>{exportError}</OpsInlineError>
          </div>
        ) : null}

        {error ? <OpsBanner tone="danger" body={error} /> : null}

        <OpsFilterBar
          footer={
            <OpsButton variant="quiet" size="compact" onClick={resetFilters}>
              Reset filters
            </OpsButton>
          }
        >
          <OpsSelect
            label="Operational bucket"
            value={filters.opsBucket}
            onChange={(e) => updateFilter('opsBucket', e.target.value)}
            data-testid="ops-filter-ops-bucket"
          >
            <option value="">All operational buckets</option>
            <option value="arriving_today">Arriving today</option>
            <option value="in_house">In house</option>
            <option value="checking_out_today">Checking out today</option>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="cancelled">Cancelled</option>
            <option value="payment_attention">Payment attention</option>
          </OpsSelect>
          <OpsSelect
            label="Reservation status"
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            data-testid="ops-filter-status"
          >
            <option value="">All status</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="in_house">In house</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </OpsSelect>
          <OpsSelect
            label="Cabin"
            value={filters.cabinId}
            onChange={(e) => updateFilter('cabinId', e.target.value)}
            data-testid="ops-filter-cabin"
          >
            <option value="">All cabins</option>
            {cabins.map((c) => (
              <option key={c.cabinId || c.cabinTypeId || c.name} value={c.cabinId}>
                {c.name}
              </option>
            ))}
          </OpsSelect>
          <OpsSelect
            label="Payment status"
            value={filters.paymentStatus}
            onChange={(e) => updateFilter('paymentStatus', e.target.value)}
            data-testid="ops-filter-payment-status"
          >
            <option value="">All payment status</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
            <option value="pending_verification">Pending verification</option>
            <option value="manual_not_required">Manual / not required</option>
            <option value="unlinked_payment">Unlinked payment</option>
            <option value="failed">Failed</option>
            <option value="disputed">Disputed</option>
            <option value="refunded">Refunded</option>
            <option value="unknown">Unknown</option>
          </OpsSelect>
          <OpsTextField
            className="ops-filter-bar__search"
            label="Search"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            placeholder="Search guest/email"
            data-testid="ops-filter-search"
          />
        </OpsFilterBar>

        {loading ? <OpsLoadingState label="Loading reservations" /> : null}

        {!loading && emptyCatalog && !error ? <OpsEmptyState title="No reservations yet." /> : null}

        {!loading && emptyFiltered && !error ? (
          <OpsEmptyState
            variant="filtered"
            title="No reservations match the selected filters."
            action={
              <OpsButton variant="quiet" size="compact" onClick={resetFilters}>
                Reset filters
              </OpsButton>
            }
          />
        ) : null}

        {!loading && items.length > 0 ? (
          <>
            <div className="ops-reservations-table">
              <OpsTable caption="Reservations">
                <OpsTableHead>
                  <OpsTableRow>
                    <OpsTableHeader>Guest</OpsTableHeader>
                    <OpsTableHeader>Stay</OpsTableHeader>
                    <OpsTableHeader>Cabin</OpsTableHeader>
                    <OpsTableHeader>Guests</OpsTableHeader>
                    <OpsTableHeader>Lifecycle</OpsTableHeader>
                    <OpsTableHeader>Payment</OpsTableHeader>
                    <OpsTableHeader align="end" numeric>
                      Amount
                    </OpsTableHeader>
                  </OpsTableRow>
                </OpsTableHead>
                <OpsTableBody>
                  {items.map((row) => {
                    const href = `/ops/reservations/${row.reservationId}`;
                    return (
                      <OpsTableRow key={row.reservationId} className="ops-reservations-table__row">
                        <OpsTableCell>
                          <Link className="ops-reservations-table__nav" to={href} data-testid="ops-reservation-row">
                            {guestName(row)}
                          </Link>
                          <p className="ops-reservations-table__meta">{row.guestSummary?.email || '—'}</p>
                          <p className="ops-reservations-table__meta ops-reservations-id">{last8Id(row.reservationId)}</p>
                          <div className="ops-reservations-status">
                            {operationalItems(row).map((item) =>
                              item.key === 'arriving_later' ? (
                                <ArrivingLaterStatus key={item.key} days={item.days} />
                              ) : (
                                <OpsStatus key={item.key} domain="reservation" value={item.key} />
                              )
                            )}
                            {row.manualReservationPurpose ? (
                              <OpsBadge>{manualReservationPurposeLabel(row.manualReservationPurpose)}</OpsBadge>
                            ) : null}
                            {row.sendGuestConfirmationEmail === false ? (
                              <OpsBadge>No auto confirmation email</OpsBadge>
                            ) : null}
                          </div>
                        </OpsTableCell>
                        <OpsTableCell>{stayLabel(row)}</OpsTableCell>
                        <OpsTableCell>
                          {cabinLabel(row)}
                          {row.cabinSummary?.location ? (
                            <p className="ops-reservations-table__meta">{row.cabinSummary.location}</p>
                          ) : null}
                        </OpsTableCell>
                        <OpsTableCell>{guestCountLabel(row)}</OpsTableCell>
                        <OpsTableCell>
                          <OpsStatus domain="reservation" value={row.reservationStatus || 'unknown'} />
                        </OpsTableCell>
                        <OpsTableCell>
                          <OpsStatus domain="payment" value={paymentOpsValue(row.paymentStatus)} />
                        </OpsTableCell>
                        <OpsTableCell align="end" numeric>
                          <span className="ops-reservations-amount">{formatReservationAmount(row.amount)}</span>
                        </OpsTableCell>
                      </OpsTableRow>
                    );
                  })}
                </OpsTableBody>
              </OpsTable>
            </div>

            <div className="ops-reservations-rows">
              {items.map((row) => (
                <ReservationStructuredRow key={row.reservationId} row={row} />
              ))}
            </div>
          </>
        ) : null}

        {!loading && data && totalPages > 1 ? (
          <div className="ops-reservations-pager">
            <OpsPagination
              page={pagination.page}
              totalPages={totalPages}
              onPageChange={(nextPage) => updateFilter('page', nextPage)}
            />
            <p className="ops-reservations-total">{pagination.total ?? '—'} total</p>
          </div>
        ) : null}
      </div>

      <OpsModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Manual reservation"
        description="Single-cabin stays only. Dates use the property calendar (check-out is exclusive). Overlaps are rejected unless you acknowledge external channel holds."
        footer={
          <>
            <OpsButton variant="secondary" onClick={() => setCreateOpen(false)} disabled={createBusy}>
              Cancel
            </OpsButton>
            <OpsButton
              type="submit"
              form="ops-reservations-create-form"
              loading={createBusy}
              loadingLabel="Creating…"
              disabled={singleCabins.length === 0}
            >
              Create
            </OpsButton>
          </>
        }
      >
        <form id="ops-reservations-create-form" className="ops-reservations-form" onSubmit={submitCreate}>
          {createError ? <OpsInlineError>{createError}</OpsInlineError> : null}
          <OpsSelect
            label="Cabin"
            required
            value={form.cabinId}
            onChange={(e) => setForm((f) => ({ ...f, cabinId: e.target.value }))}
            disabled={createBusy}
          >
            <option value="">Select cabin</option>
            {singleCabins.map((c) => (
              <option key={c.cabinId} value={c.cabinId}>
                {c.name}
              </option>
            ))}
          </OpsSelect>
          {singleCabins.length === 0 ? (
            <p className="ops-reservations-form__note">
              No bookable single cabins in ops list (multi-unit types need another flow).
            </p>
          ) : null}
          <div className="ops-reservations-form__split">
            <OpsTextField
              label="Check-in"
              required
              type="date"
              value={form.checkIn}
              onChange={(e) => setForm((f) => ({ ...f, checkIn: e.target.value }))}
              disabled={createBusy}
            />
            <OpsTextField
              label="Check-out"
              required
              type="date"
              value={form.checkOut}
              onChange={(e) => setForm((f) => ({ ...f, checkOut: e.target.value }))}
              disabled={createBusy}
            />
          </div>
          <div className="ops-reservations-form__split">
            <OpsTextField
              label="Adults"
              type="number"
              min={1}
              max={10}
              value={form.adults}
              onChange={(e) => setForm((f) => ({ ...f, adults: e.target.value }))}
              disabled={createBusy}
            />
            <OpsTextField
              label="Children"
              type="number"
              min={0}
              max={10}
              value={form.children}
              onChange={(e) => setForm((f) => ({ ...f, children: e.target.value }))}
              disabled={createBusy}
            />
          </div>
          <div className="ops-reservations-form__split">
            <OpsTextField
              label="First name"
              required
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              disabled={createBusy}
            />
            <OpsTextField
              label="Last name"
              required
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              disabled={createBusy}
            />
          </div>
          <OpsTextField
            label="Email"
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            disabled={createBusy}
          />
          <OpsTextField
            label="Phone"
            required
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            disabled={createBusy}
          />
          <OpsSelect
            label="Reservation purpose"
            value={form.manualReservationPurpose}
            onChange={(e) => {
              const purpose = e.target.value;
              setForm((f) => ({
                ...f,
                manualReservationPurpose: purpose,
                sendGuestConfirmationEmail: defaultSendGuestConfirmationForPurpose(purpose)
              }));
            }}
            disabled={createBusy}
          >
            {MANUAL_RESERVATION_PURPOSE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </OpsSelect>
          <OpsCheckbox
            label="Send guest confirmation email when this reservation is confirmed"
            checked={form.sendGuestConfirmationEmail}
            onChange={(e) => setForm((f) => ({ ...f, sendGuestConfirmationEmail: e.target.checked }))}
            disabled={createBusy}
          />
          <OpsSelect
            label="Initial status"
            value={form.initialStatus}
            onChange={(e) => setForm((f) => ({ ...f, initialStatus: e.target.value }))}
            disabled={createBusy}
          >
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
          </OpsSelect>
          <OpsTextarea
            label="Note"
            optional
            rows={2}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            disabled={createBusy}
          />
          <OpsTextField
            label="Payment placeholder"
            optional
            value={form.paymentPlaceholder}
            onChange={(e) => setForm((f) => ({ ...f, paymentPlaceholder: e.target.value }))}
            placeholder="e.g. Pay on arrival, invoice sent"
            disabled={createBusy}
          />
          <OpsCheckbox
            label="I understand this range overlaps external channel holds and still want to create the reservation."
            checked={form.acceptExternalHoldWarnings}
            onChange={(e) => setForm((f) => ({ ...f, acceptExternalHoldWarnings: e.target.checked }))}
            disabled={createBusy}
          />
        </form>
      </OpsModal>
    </OpsPage>
  );
}
