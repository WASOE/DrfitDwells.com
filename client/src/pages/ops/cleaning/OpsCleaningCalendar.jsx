import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Coins
} from 'lucide-react';
import {
  getCleaningSchedule,
  getCleaningPaymentSummary,
  getCleaningPayoutSummary,
  markCleaned,
  unmarkCleaned,
  markPaid,
  unmarkPaid
} from '../../../services/cleaningApi';
import { useOpsSession } from '../../../context/OpsSessionContext';
import { isCleanerOnlySession } from '../../../layouts/ops/opsNavConfig';
import OpsPage from '../../../ops/primitives/OpsPage';
import OpsPageHeader from '../../../ops/primitives/OpsPageHeader';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsStatus from '../../../ops/primitives/OpsStatus';
import OpsLoadingState from '../../../ops/primitives/OpsLoadingState';
import OpsCleaningPaymentPanel from './OpsCleaningPaymentPanel';
import OpsCleaningPayoutBreakdown from './OpsCleaningPayoutBreakdown';
import OpsCleaningDailyFeeCard from './OpsCleaningDailyFeeCard';
import './OpsCleaningCalendar.css';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const LOCATION_OPTIONS = [
  { value: null, label: 'All' },
  { value: 'cabin', label: 'The Cabin' },
  { value: 'valley', label: 'The Valley' }
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Local YYYY-MM-DD key (sent to the API, which normalizes to Sofia day start). */
function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatLongDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
}

function formatMoney(amount) {
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  return `€${n.toFixed(2)}`;
}

/** 12:00–style label from 'HH:MM' (e.g. '11:00' -> '11:00 AM'). */
function formatTime(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return '';
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = mStr || '00';
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

/** Monday-based leading blank count for the 1st of a month. */
function leadingBlanks(year, month) {
  const firstDow = new Date(year, month, 1).getDay(); // 0 Sun .. 6 Sat
  return (firstDow + 6) % 7; // Monday = 0
}

function NoteBox({ text }) {
  return (
    <div className="ops-cleaning-cal__note">
      <div className="ops-cleaning-cal__note-label">
        <Bell className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Request</span>
      </div>
      <p className="ops-cleaning-cal__note-body">{text}</p>
    </div>
  );
}

export default function OpsCleaningCalendar() {
  const session = useOpsSession();
  const cleanerOnly = isCleanerOnlySession(session);
  const canReadPayment = (session?.actions || []).includes('ops.cleaning.payment_read');
  const canReadPayout = (session?.actions || []).includes('ops.cleaning.payout_read');
  const canWritePayment = (session?.actions || []).includes('ops.cleaning.payment_write');
  const today = useMemo(() => new Date(), []);

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [selectedPropertyKind, setSelectedPropertyKind] = useState(null);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  const [monthCache, setMonthCache] = useState({});
  const [monthLoading, setMonthLoading] = useState(false);

  const [daySchedule, setDaySchedule] = useState({ checkouts: [], checkins: [] });
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState('');

  const [paymentSummary, setPaymentSummary] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [payoutSummary, setPayoutSummary] = useState(null);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutError, setPayoutError] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [toggleCleanedError, setToggleCleanedError] = useState('');
  const [togglePaidError, setTogglePaidError] = useState('');

  const [busyBookingId, setBusyBookingId] = useState(null);

  const [showLocationMenu, setShowLocationMenu] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const monthKey = `${viewYear}-${pad2(viewMonth + 1)}-${selectedPropertyKind || 'all'}`;

  const selectedLocationLabel =
    LOCATION_OPTIONS.find((o) => o.value === selectedPropertyKind)?.label || 'All';

  // --- Month dots prefetch (once per month + propertyKind) ---
  const loadMonth = useCallback(async () => {
    if (monthCache[monthKey]) return;
    setMonthLoading(true);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const days = [];
    for (let d = 1; d <= daysInMonth; d += 1) {
      days.push(new Date(viewYear, viewMonth, d));
    }
    try {
      const results = await Promise.all(
        days.map((d) =>
          getCleaningSchedule({ date: dateKey(d), propertyKind: selectedPropertyKind })
            .then((res) => ({ key: dateKey(d), data: res.data?.data }))
            .catch(() => ({ key: dateKey(d), data: null }))
        )
      );
      const map = {};
      results.forEach(({ key, data }) => {
        const checkouts = data?.checkouts || [];
        const checkins = data?.checkins || [];
        // One dot per event: count pending/cleaned checkouts and check-ins separately.
        map[key] = {
          pending: checkouts.filter((c) => c.status !== 'cleaned').length,
          cleaned: checkouts.filter((c) => c.status === 'cleaned').length,
          checkin: checkins.length
        };
      });
      setMonthCache((prev) => ({ ...prev, [monthKey]: map }));
    } finally {
      setMonthLoading(false);
    }
  }, [monthCache, monthKey, viewYear, viewMonth, selectedPropertyKind]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  // --- Day schedule + payment summary ---
  const loadDay = useCallback(async () => {
    setDayLoading(true);
    setDayError('');
    try {
      const res = await getCleaningSchedule({
        date: dateKey(selectedDate),
        propertyKind: selectedPropertyKind
      });
      setDaySchedule(res.data?.data || { checkouts: [], checkins: [] });
    } catch (err) {
      setDayError(err?.response?.data?.message || 'Failed to load cleaning schedule.');
      setDaySchedule({ checkouts: [], checkins: [] });
    } finally {
      setDayLoading(false);
    }
  }, [selectedDate, selectedPropertyKind]);

  const loadPayment = useCallback(async () => {
    if (!canReadPayment || !selectedPropertyKind) {
      setPaymentSummary(null);
      setPaymentError('');
      setPaymentLoading(false);
      return;
    }
    setPaymentLoading(true);
    setPaymentError('');
    try {
      const res = await getCleaningPaymentSummary({
        date: dateKey(selectedDate),
        propertyKind: selectedPropertyKind
      });
      setPaymentSummary(res.data?.data || null);
    } catch (err) {
      setPaymentError(err?.response?.data?.message || 'Failed to load payment summary.');
      setPaymentSummary(null);
    } finally {
      setPaymentLoading(false);
    }
  }, [selectedDate, selectedPropertyKind, canReadPayment]);

  const loadGlobalPayout = useCallback(async () => {
    const wantsGlobal = (canReadPayout || canReadPayment) && !selectedPropertyKind;
    if (!wantsGlobal) {
      setPayoutSummary(null);
      setPayoutError('');
      setPayoutLoading(false);
      return;
    }
    setPayoutLoading(true);
    setPayoutError('');
    try {
      const res = await getCleaningPayoutSummary({ date: dateKey(selectedDate) });
      setPayoutSummary(res.data?.data || null);
    } catch (err) {
      setPayoutError(err?.response?.data?.message || 'Failed to load payout summary.');
      setPayoutSummary(null);
    } finally {
      setPayoutLoading(false);
    }
  }, [selectedDate, selectedPropertyKind, canReadPayout, canReadPayment]);

  useEffect(() => {
    loadDay();
    loadPayment();
    loadGlobalPayout();
  }, [loadDay, loadPayment, loadGlobalPayout]);

  // Invalidate the cached dots for the current month so they re-fetch.
  const invalidateMonth = useCallback(() => {
    setMonthCache((prev) => {
      const next = { ...prev };
      delete next[monthKey];
      return next;
    });
  }, [monthKey]);

  const handleSelectDay = (day) => {
    setSelectedDate(new Date(viewYear, viewMonth, day));
  };

  const handleToday = () => {
    const now = new Date();
    setSelectedDate(now);
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  };

  const handleToggleCleaned = async (ev) => {
    setBusyBookingId(ev.bookingId);
    setToggleCleanedError('');
    try {
      if (ev.status === 'cleaned') {
        await unmarkCleaned(ev.bookingId, ev.cleaningDate);
      } else {
        await markCleaned(ev.bookingId, ev.cleaningDate);
      }
      invalidateMonth();
      await Promise.all([loadDay(), loadPayment(), loadGlobalPayout()]);
    } catch (err) {
      setToggleCleanedError(
        err?.response?.data?.message || 'Failed to update cleaning status. Please try again.'
      );
    } finally {
      setBusyBookingId(null);
    }
  };

  const handleTogglePaid = async () => {
    if (!paymentSummary || !selectedPropertyKind) return;
    setPaymentBusy(true);
    setTogglePaidError('');
    try {
      const args = { date: dateKey(selectedDate), propertyKind: selectedPropertyKind };
      if (paymentSummary.status === 'paid') {
        await unmarkPaid(args);
      } else {
        await markPaid(args);
      }
      await loadPayment();
    } catch (err) {
      setTogglePaidError(
        err?.response?.data?.message || 'Failed to update payment status. Please try again.'
      );
    } finally {
      setPaymentBusy(false);
    }
  };

  const monthDots = monthCache[monthKey] || {};
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const blanks = leadingBlanks(viewYear, viewMonth);

  const checkouts = daySchedule.checkouts || [];
  const checkins = daySchedule.checkins || [];
  const cabinCount = paymentSummary?.cabinCount ?? checkouts.length;
  const totalAmount = paymentSummary?.totalAmount ?? 0;
  const paidAmount = paymentSummary?.paidAmount ?? 0;
  const pendingAmount = Math.max(0, totalAmount - paidAmount);
  const isPaid = paymentSummary?.status === 'paid';

  const showGlobalPayout = (canReadPayout || canReadPayment) && !selectedPropertyKind;
  const globalTotal = payoutSummary?.totalAmount ?? 0;
  const globalCheckoutCount = payoutSummary?.checkoutCount ?? checkouts.length;
  const globalPaidAmount = payoutSummary?.paidAmount ?? 0;
  const globalNoPolicyZones = payoutSummary?.noPolicyZones || [];
  const showCleanerPayout = showGlobalPayout && !canReadPayment;
  const showOperatorGlobalPayout = showGlobalPayout && canReadPayment;

  return (
    <OpsPage width="full" className="ops-cleaning-cal">
      {!cleanerOnly ? <OpsPageHeader title="Cleaning" /> : null}

      <div className="ops-cleaning-cal__layout" data-testid="ops-cleaning-calendar">
        <div className="ops-cleaning-cal__primary">
          <div className="ops-cleaning-cal__toolbar">
            <div className="ops-cleaning-cal__menu">
              <button
                type="button"
                onClick={() => setShowLocationMenu((v) => !v)}
                className="ops-cleaning-cal__menu-trigger"
                data-testid="location-select"
              >
                <span>{selectedLocationLabel}</span>
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
              </button>
              {showLocationMenu ? (
                <div className="ops-cleaning-cal__menu-panel">
                  {LOCATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => {
                        setSelectedPropertyKind(opt.value);
                        setShowLocationMenu(false);
                        setTogglePaidError('');
                      }}
                      className={`ops-cleaning-cal__menu-item${
                        opt.value === selectedPropertyKind ? ' ops-cleaning-cal__menu-item--active' : ''
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <OpsButton
              variant="secondary"
              onClick={handleToday}
              className="ops-cleaning-cal__today"
              data-testid="cleaning-today"
            >
              <CalendarIcon className="w-4 h-4" aria-hidden="true" />
              <span>Today</span>
            </OpsButton>
          </div>

          <div className="ops-cleaning-cal__month">
            <div className="ops-cleaning-cal__menu">
              <button
                type="button"
                onClick={() => setShowMonthPicker((v) => !v)}
                className="ops-cleaning-cal__month-title"
                data-testid="month-title"
              >
                <span>
                  {MONTHS[viewMonth]} {viewYear}
                </span>
                <ChevronDown className="w-5 h-5" aria-hidden="true" />
              </button>
              {showMonthPicker ? (
                <div className="ops-cleaning-cal__month-picker">
                  <div className="ops-cleaning-cal__month-picker-nav">
                    <button
                      type="button"
                      onClick={() => setViewYear((y) => y - 1)}
                      className="ops-cleaning-cal__month-picker-btn"
                    >
                      ‹
                    </button>
                    <span className="ops-cleaning-cal__month-picker-year">{viewYear}</span>
                    <button
                      type="button"
                      onClick={() => setViewYear((y) => y + 1)}
                      className="ops-cleaning-cal__month-picker-btn"
                    >
                      ›
                    </button>
                  </div>
                  <div className="ops-cleaning-cal__month-grid">
                    {MONTHS.map((m, idx) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setViewMonth(idx);
                          setShowMonthPicker(false);
                        }}
                        className={`ops-cleaning-cal__month-cell${
                          idx === viewMonth ? ' ops-cleaning-cal__month-cell--active' : ''
                        }`}
                      >
                        {m.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="ops-cleaning-cal__weekday-row">
              {WEEKDAYS.map((d, i) => (
                <div key={`${d}-${i}`} className="ops-cleaning-cal__weekday">
                  {d}
                </div>
              ))}
            </div>

            <div className="ops-cleaning-cal__day-grid">
              {Array.from({ length: blanks }).map((_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const cellDate = new Date(viewYear, viewMonth, day);
                const key = dateKey(cellDate);
                const dots = monthDots[key] || {};
                const isSelected = sameDay(cellDate, selectedDate);
                const isToday = sameDay(cellDate, today);
                const dayClass = [
                  'ops-cleaning-cal__day',
                  isSelected ? 'ops-cleaning-cal__day--selected' : '',
                  isToday ? 'ops-cleaning-cal__day--today' : ''
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSelectDay(day)}
                    data-testid={`calendar-day-${key}`}
                    className={dayClass}
                  >
                    <span className="ops-cleaning-cal__day-num">{day}</span>
                    <span className="ops-cleaning-cal__day-dots">
                      {Array.from({ length: dots.pending || 0 }).map((__, di) => (
                        <span key={`pending-${di}`} className="ops-cleaning-cal__dot ops-cleaning-cal__dot--pending" />
                      ))}
                      {Array.from({ length: dots.cleaned || 0 }).map((__, di) => (
                        <span key={`cleaned-${di}`} className="ops-cleaning-cal__dot ops-cleaning-cal__dot--cleaned" />
                      ))}
                      {Array.from({ length: dots.checkin || 0 }).map((__, di) => (
                        <span key={`checkin-${di}`} className="ops-cleaning-cal__dot ops-cleaning-cal__dot--checkin" />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            {monthLoading ? <p className="ops-cleaning-cal__month-loading">Loading month…</p> : null}
            <ul className="ops-cleaning-cal__legend" aria-label="Schedule legend">
              <li className="ops-cleaning-cal__legend-item">
                <span className="ops-cleaning-cal__dot ops-cleaning-cal__dot--pending" />
                Pending
              </li>
              <li className="ops-cleaning-cal__legend-item">
                <span className="ops-cleaning-cal__dot ops-cleaning-cal__dot--cleaned" />
                Done
              </li>
              <li className="ops-cleaning-cal__legend-item">
                <span className="ops-cleaning-cal__dot ops-cleaning-cal__dot--checkin" />
                Check-in
              </li>
            </ul>
          </div>

          <div className="ops-cleaning-cal__mobile-panels">
            {showOperatorGlobalPayout ? (
              <OpsCleaningDailyFeeCard
                selectedDate={selectedDate}
                totalAmount={globalTotal}
                checkoutCount={globalCheckoutCount}
                paidAmount={globalPaidAmount}
                loading={payoutLoading}
                error={payoutError}
                noPolicyZones={globalNoPolicyZones}
                hasCheckouts={checkouts.length > 0}
                formatLongDate={formatLongDate}
                showPaidPending
                testId="global-daily-fee-card"
              />
            ) : null}

            {canReadPayment && selectedPropertyKind ? (
              <div className="ops-cleaning-pay" data-testid="cleaning-payment-card-mobile">
                {paymentError ? (
                  <OpsBanner tone="danger" body={paymentError} />
                ) : (
                  <div className="ops-cleaning-pay__row">
                    <div className="ops-cleaning-pay__icon" aria-hidden="true">
                      <Coins className="h-4 w-4" />
                    </div>
                    <div className="ops-cleaning-pay__body">
                      <div className="ops-cleaning-pay__head">
                        <div>
                          <p className="ops-cleaning-pay__eyebrow">Total Daily Cleaning Fee</p>
                          <p className="ops-cleaning-pay__sub">
                            {formatLongDate(selectedDate)} · {cabinCount}{' '}
                            {cabinCount === 1 ? 'cabin' : 'cabins'}
                          </p>
                        </div>
                        <p className="ops-cleaning-pay__amount">{formatMoney(totalAmount)}</p>
                      </div>
                      <div className="ops-cleaning-pay__chips">
                        <span className="ops-cleaning-pay__chip ops-cleaning-pay__chip--paid">
                          PAID {formatMoney(paidAmount)}
                        </span>
                        <span className="ops-cleaning-pay__chip ops-cleaning-pay__chip--pending">
                          PENDING {formatMoney(pendingAmount)}
                        </span>
                        <OpsButton
                          variant={isPaid ? 'secondary' : 'primary'}
                          size="compact"
                          onClick={handleTogglePaid}
                          disabled={paymentBusy || paymentLoading}
                          loading={paymentBusy}
                          loadingLabel="…"
                          data-testid="toggle-paid"
                        >
                          {isPaid ? 'Unmark Paid' : 'Mark Paid'}
                        </OpsButton>
                      </div>
                      {togglePaidError ? <OpsBanner tone="danger" body={togglePaidError} /> : null}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {showCleanerPayout ? (
              <OpsCleaningPayoutBreakdown
                selectedDate={selectedDate}
                payoutSummary={payoutSummary}
                loading={payoutLoading}
                error={payoutError}
                formatLongDate={formatLongDate}
                testId="global-payout-card"
              />
            ) : null}
          </div>

          <div className="ops-cleaning-cal__schedule" data-testid="cleaning-events">
            {dayError ? <OpsBanner tone="danger" body={dayError} /> : null}
            {toggleCleanedError ? <OpsBanner tone="danger" body={toggleCleanedError} /> : null}

            {dayLoading ? (
              <OpsLoadingState label="Loading schedule…" className="ops-cleaning-cal__schedule-loading" />
            ) : checkouts.length === 0 && checkins.length === 0 && !dayError ? (
              <p className="ops-cleaning-cal__empty">
                No cleaning events for {formatLongDate(selectedDate)}.
              </p>
            ) : null}

            {checkouts.map((ev) => {
              const isCleaned = ev.status === 'cleaned';
              const busy = busyBookingId === ev.bookingId;
              const sameDayTurn = Boolean(ev.sameDayTurn);
              const taskClass = [
                'ops-cleaning-cal__task',
                isCleaned ? 'ops-cleaning-cal__task--done' : '',
                sameDayTurn ? 'ops-cleaning-cal__task--same-day' : ''
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={`checkout-${ev.bookingId}`}
                  data-testid="checkout-card"
                  data-same-day={sameDayTurn ? 'true' : undefined}
                  data-unit-label={ev.unitLabel || undefined}
                  className={taskClass}
                >
                  <div className="ops-cleaning-cal__task-head">
                    <h3
                      className={`ops-cleaning-cal__task-title${
                        isCleaned ? ' ops-cleaning-cal__task-title--done' : ''
                      }`}
                    >
                      {ev.cabinName}
                      {ev.unitLabel ? (
                        <span className="ops-cleaning-cal__task-unit"> · {ev.unitLabel}</span>
                      ) : null}
                    </h3>
                    <OpsStatus name={isCleaned ? 'cleaning.done' : 'cleaning.pending'} />
                  </div>

                  <p className="ops-cleaning-cal__task-meta">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Check-out: {formatTime(ev.checkoutTime)}</span>
                    {sameDayTurn ? (
                      <span className="ops-cleaning-cal__same-day" data-testid="same-day-turn">
                        <OpsStatus name="cleaning.same_day_turn" />
                        {ev.nextCheckInTime ? (
                          <span className="ops-cleaning-cal__same-day-next">
                            · next {formatTime(ev.nextCheckInTime)}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </p>

                  {ev.cleaningNotes ? <NoteBox text={ev.cleaningNotes} /> : null}

                  <div className="ops-cleaning-cal__task-action">
                    <OpsButton
                      variant={isCleaned ? 'secondary' : 'secondary'}
                      onClick={() => handleToggleCleaned(ev)}
                      disabled={busy}
                      loading={busy}
                      loadingLabel="…"
                      data-testid="mark-cleaned"
                    >
                      {isCleaned ? (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Circle className="h-4 w-4" aria-hidden="true" />
                      )}
                      {isCleaned ? 'Unmark' : 'Mark Cleaned'}
                    </OpsButton>
                  </div>
                </div>
              );
            })}

            {checkins.map((ev) => (
              <div
                key={`checkin-${ev.bookingId}`}
                data-testid="checkin-card"
                data-unit-label={ev.unitLabel || undefined}
                className="ops-cleaning-cal__task ops-cleaning-cal__task--checkin"
              >
                <h3 className="ops-cleaning-cal__task-title">
                  {ev.cabinName}
                  {ev.unitLabel ? (
                    <span className="ops-cleaning-cal__task-unit"> · {ev.unitLabel}</span>
                  ) : null}
                </h3>
                <p className="ops-cleaning-cal__task-meta">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Check-in: {formatTime(ev.checkinTime)}</span>
                </p>
                {ev.cleaningNotes ? <NoteBox text={ev.cleaningNotes} /> : null}
              </div>
            ))}
          </div>
        </div>

        <aside className="ops-cleaning-cal__aside">
          {showOperatorGlobalPayout ? (
            <OpsCleaningPayoutBreakdown
              selectedDate={selectedDate}
              payoutSummary={payoutSummary}
              loading={payoutLoading}
              error={payoutError}
              formatLongDate={formatLongDate}
              headlineLabel="Total Daily Cleaning Fee"
              testId="operator-global-payout-desktop"
            />
          ) : null}

          {showCleanerPayout ? (
            <OpsCleaningPayoutBreakdown
              selectedDate={selectedDate}
              payoutSummary={payoutSummary}
              loading={payoutLoading}
              error={payoutError}
              formatLongDate={formatLongDate}
              testId="cleaner-payout-breakdown-desktop"
            />
          ) : null}

          {canReadPayment && selectedPropertyKind ? (
            <OpsCleaningPaymentPanel
              selectedDate={selectedDate}
              paymentSummary={paymentSummary}
              paymentLoading={paymentLoading}
              paymentError={paymentError}
              paymentBusy={paymentBusy}
              togglePaidError={togglePaidError}
              canWritePayment={canWritePayment}
              formatLongDate={formatLongDate}
              onTogglePaid={handleTogglePaid}
            />
          ) : null}
        </aside>
      </div>
    </OpsPage>
  );
}
