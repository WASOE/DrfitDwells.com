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
import OpsCleaningPaymentPanel from './OpsCleaningPaymentPanel';
import OpsCleaningPayoutBreakdown from './OpsCleaningPayoutBreakdown';
import OpsCleaningDailyFeeCard from './OpsCleaningDailyFeeCard';

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
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-amber-800">
        <Bell className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">Request</span>
      </div>
      <p className="mt-1 text-sm text-amber-900 leading-snug">{text}</p>
    </div>
  );
}

export default function OpsCleaningCalendar() {
  const session = useOpsSession();
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
    <div className="w-full max-w-lg mx-auto pb-24 md:pb-10 lg:max-w-none lg:mx-0 lg:pb-8">
      <div className="lg:grid lg:grid-cols-12 lg:gap-6 lg:max-w-7xl lg:mx-auto">
        <div className="lg:col-span-5">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowLocationMenu((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:border-gray-400"
            data-testid="location-select"
          >
            <span>{selectedLocationLabel}</span>
            <ChevronDown className="w-4 h-4 text-gray-500" />
          </button>
          {showLocationMenu ? (
            <div className="absolute z-20 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
              {LOCATION_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => {
                    setSelectedPropertyKind(opt.value);
                    setShowLocationMenu(false);
                    setTogglePaidError('');
                  }}
                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                    opt.value === selectedPropertyKind ? 'font-semibold text-gray-900' : 'text-gray-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleToday}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:border-gray-400"
        >
          <CalendarIcon className="w-4 h-4 text-gray-500" />
          <span>Today</span>
        </button>
      </div>

      {/* Calendar strip */}
      <div className="mt-5">
        <div className="relative inline-block">
          <button
            type="button"
            onClick={() => setShowMonthPicker((v) => !v)}
            className="inline-flex items-center gap-1.5 text-2xl font-semibold text-gray-900"
          >
            <span style={{ fontFamily: 'Playfair Display, serif' }}>
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <ChevronDown className="w-5 h-5 text-gray-500" />
          </button>
          {showMonthPicker ? (
            <div className="absolute z-20 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setViewYear((y) => y - 1)}
                  className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                >
                  ‹
                </button>
                <span className="text-sm font-semibold text-gray-900">{viewYear}</span>
                <button
                  type="button"
                  onClick={() => setViewYear((y) => y + 1)}
                  className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                >
                  ›
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1">
                {MONTHS.map((m, idx) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setViewMonth(idx);
                      setShowMonthPicker(false);
                    }}
                    className={`rounded-md px-2 py-1.5 text-xs hover:bg-gray-100 ${
                      idx === viewMonth ? 'bg-gray-900 text-white hover:bg-gray-900' : 'text-gray-700'
                    }`}
                  >
                    {m.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-400">
          {WEEKDAYS.map((d, i) => (
            <div key={`${d}-${i}`}>{d}</div>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1">
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
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleSelectDay(day)}
                data-testid={`calendar-day-${key}`}
                className="flex flex-col items-center py-1"
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm ${
                    isSelected
                      ? 'bg-gray-900 text-white font-semibold'
                      : isToday
                        ? 'border border-gray-900 text-gray-900 font-semibold'
                        : 'text-gray-800'
                  }`}
                >
                  {day}
                </span>
                <span className="mt-1 flex h-1.5 flex-wrap items-center justify-center gap-0.5">
                  {Array.from({ length: dots.pending || 0 }).map((_, di) => (
                    <span key={`pending-${di}`} className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  ))}
                  {Array.from({ length: dots.cleaned || 0 }).map((_, di) => (
                    <span key={`cleaned-${di}`} className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  ))}
                  {Array.from({ length: dots.checkin || 0 }).map((_, di) => (
                    <span key={`checkin-${di}`} className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        {monthLoading ? (
          <p className="mt-1 text-center text-[11px] text-gray-400">Loading month…</p>
        ) : null}
      </div>

      {/* Global daily fee — mobile/tablet when All locations (original design: big total on day select) */}
      {showOperatorGlobalPayout ? (
      <div className="mt-5 lg:hidden">
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
      </div>
      ) : null}

      {/* Zone payment summary — mobile/tablet only; unchanged below lg */}
      {canReadPayment && selectedPropertyKind ? (
      <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:hidden">
        {paymentError ? (
          <p className="text-sm text-red-600">{paymentError}</p>
        ) : (
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
              <Coins className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Total Daily Cleaning Fee
                  </p>
                  <p className="mt-0.5 text-sm text-gray-600">
                    {formatLongDate(selectedDate)} · {cabinCount} {cabinCount === 1 ? 'cabin' : 'cabins'}
                  </p>
                </div>
                <p className="shrink-0 text-xl font-bold text-gray-900">{formatMoney(totalAmount)}</p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  PAID {formatMoney(paidAmount)}
                </span>
                <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                  PENDING {formatMoney(pendingAmount)}
                </span>
                <button
                  type="button"
                  onClick={handleTogglePaid}
                  disabled={paymentBusy || paymentLoading}
                  className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    isPaid
                      ? 'border border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                      : 'bg-gray-900 text-white hover:bg-gray-800'
                  }`}
                  data-testid="toggle-paid"
                >
                  {paymentBusy ? '…' : isPaid ? 'Unmark Paid' : 'Mark Paid'}
                </button>
              </div>
              {togglePaidError ? (
                <p className="mt-2 text-sm text-red-600">{togglePaidError}</p>
              ) : null}
            </div>
          </div>
        )}
      </div>
      ) : null}

      {/* Cleaner payout breakdown — mobile/tablet */}
      {showCleanerPayout ? (
        <div className="mt-5 lg:hidden">
          <OpsCleaningPayoutBreakdown
            selectedDate={selectedDate}
            payoutSummary={payoutSummary}
            loading={payoutLoading}
            error={payoutError}
            formatLongDate={formatLongDate}
            testId="global-payout-card"
          />
        </div>
      ) : null}

      {/* Event list */}
      <div className="mt-5 space-y-3" data-testid="cleaning-events">
        {dayError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {dayError}
          </div>
        ) : null}

        {toggleCleanedError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {toggleCleanedError}
          </div>
        ) : null}

        {dayLoading ? (
          <p className="py-6 text-center text-sm text-gray-400">Loading schedule…</p>
        ) : checkouts.length === 0 && checkins.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            No cleaning events for {formatLongDate(selectedDate)}.
          </div>
        ) : null}

        {checkouts.map((ev) => {
          const isCleaned = ev.status === 'cleaned';
          const busy = busyBookingId === ev.bookingId;
          return (
            <div
              key={`checkout-${ev.bookingId}`}
              data-testid="checkout-card"
              className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm border-l-4 ${
                isCleaned ? 'border-l-emerald-500' : 'border-l-red-500'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className={`text-base font-bold leading-snug ${isCleaned ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                  {ev.cabinName}
                  {ev.unitLabel ? <span className="ml-1 font-medium text-gray-500">· {ev.unitLabel}</span> : null}
                </h3>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    isCleaned ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                  }`}
                >
                  {isCleaned ? 'Done' : 'Pending'}
                </span>
              </div>

              <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600">
                <Clock className="h-3.5 w-3.5 text-gray-400" />
                Check-out: {formatTime(ev.checkoutTime)}
                {ev.sameDayTurn ? (
                  <span className="ml-2 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                    Same-day turn · next {formatTime(ev.nextCheckInTime)}
                  </span>
                ) : null}
              </p>

              {ev.cleaningNotes ? <NoteBox text={ev.cleaningNotes} /> : null}

              <button
                type="button"
                onClick={() => handleToggleCleaned(ev)}
                disabled={busy}
                data-testid="mark-cleaned"
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  isCleaned
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-gray-300 bg-white text-gray-800 hover:border-gray-400'
                }`}
              >
                {isCleaned ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
                {busy ? '…' : isCleaned ? 'Unmark' : 'Mark Cleaned'}
              </button>
            </div>
          );
        })}

        {checkins.map((ev) => (
          <div
            key={`checkin-${ev.bookingId}`}
            data-testid="checkin-card"
            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm border-l-4 border-l-gray-300"
          >
            <h3 className="text-base font-bold leading-snug text-gray-900">
              {ev.cabinName}
              {ev.unitLabel ? <span className="ml-1 font-medium text-gray-500">· {ev.unitLabel}</span> : null}
            </h3>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600">
              <Clock className="h-3.5 w-3.5 text-gray-400" />
              Check-in: {formatTime(ev.checkinTime)}
            </p>
            {ev.cleaningNotes ? <NoteBox text={ev.cleaningNotes} /> : null}
          </div>
        ))}
      </div>
        </div>

        {showOperatorGlobalPayout ? (
          <aside className="hidden lg:block lg:col-span-7">
            <OpsCleaningPayoutBreakdown
              selectedDate={selectedDate}
              payoutSummary={payoutSummary}
              loading={payoutLoading}
              error={payoutError}
              formatLongDate={formatLongDate}
              className="lg:sticky lg:top-6"
              headlineLabel="Total Daily Cleaning Fee"
              testId="operator-global-payout-desktop"
            />
          </aside>
        ) : null}

        {showCleanerPayout ? (
          <aside className="hidden lg:block lg:col-span-7">
            <OpsCleaningPayoutBreakdown
              selectedDate={selectedDate}
              payoutSummary={payoutSummary}
              loading={payoutLoading}
              error={payoutError}
              formatLongDate={formatLongDate}
              className="lg:sticky lg:top-6"
              testId="cleaner-payout-breakdown-desktop"
            />
          </aside>
        ) : null}

        {canReadPayment && selectedPropertyKind ? (
          <aside className="hidden lg:block lg:col-span-7">
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
          </aside>
        ) : null}
      </div>
    </div>
  );
}
