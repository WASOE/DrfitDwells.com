import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

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
  const [form, setForm] = useState({
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
    acceptExternalHoldWarnings: false
  });

  const filters = useMemo(
    () => ({
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 20,
      status: searchParams.get('status') || '',
      cabinId: searchParams.get('cabinId') || '',
      source: searchParams.get('source') || '',
      paymentStatus: searchParams.get('paymentStatus') || '',
      arrivalStatus: searchParams.get('arrivalStatus') || '',
      dateFrom: searchParams.get('dateFrom') || '',
      dateTo: searchParams.get('dateTo') || '',
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
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
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
        acceptExternalHoldWarnings: form.acceptExternalHoldWarnings
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

  if (loading) return <div className="text-sm text-gray-500">Loading reservations...</div>;

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 max-w-4xl">
          <h2 className="text-lg font-semibold text-gray-900">Reservations workspace</h2>
          <button
            type="button"
            onClick={() => {
              setCreateError('');
              setCreateOpen(true);
            }}
            className="w-full sm:w-auto shrink-0 px-4 py-2 text-sm font-medium rounded-lg bg-[#81887A] text-white hover:bg-[#707668]"
          >
            Create reservation
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 max-w-7xl">
          <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} className="px-3 py-2 text-sm border rounded-lg">
            <option value="">All status</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="in_house">In house</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={filters.cabinId} onChange={(e) => updateFilter('cabinId', e.target.value)} className="px-3 py-2 text-sm border rounded-lg">
            <option value="">All cabins</option>
            {cabins.map((c) => (
              <option key={c.cabinId} value={c.cabinId}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={filters.paymentStatus}
            onChange={(e) => updateFilter('paymentStatus', e.target.value)}
            className="px-3 py-2 text-sm border rounded-lg"
          >
            <option value="">All payment status</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="failed">Failed</option>
            <option value="disputed">Disputed</option>
            <option value="refunded">Refunded</option>
          </select>
          <input
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            placeholder="Search guest/email"
            className="px-3 py-2 text-sm border rounded-lg"
          />
        </div>
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </div>

      {createOpen ? (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center sm:p-4 bg-black/40">
          <div
            className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-200"
            role="dialog"
            aria-labelledby="create-res-title"
          >
            <div className="p-4 sm:p-6 border-b border-gray-100 flex justify-between items-center gap-2">
              <h3 id="create-res-title" className="text-base font-semibold text-gray-900">
                Manual reservation
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-800 px-2 py-1"
              >
                Close
              </button>
            </div>
            <form onSubmit={submitCreate} className="p-4 sm:p-6 space-y-3 max-w-2xl mx-auto">
              <p className="text-xs text-gray-500">
                Single-cabin stays only. Dates use the property calendar (check-out is exclusive). Overlaps are rejected
                unless you acknowledge external channel holds.
              </p>
              {createError ? <div className="text-sm text-red-600">{createError}</div> : null}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Cabin</label>
                <select
                  required
                  value={form.cabinId}
                  onChange={(e) => setForm((f) => ({ ...f, cabinId: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                >
                  <option value="">Select cabin</option>
                  {singleCabins.map((c) => (
                    <option key={c.cabinId} value={c.cabinId}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {singleCabins.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">No bookable single cabins in ops list (multi-unit types need another flow).</p>
                ) : null}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Check-in</label>
                  <input
                    required
                    type="date"
                    value={form.checkIn}
                    onChange={(e) => setForm((f) => ({ ...f, checkIn: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Check-out</label>
                  <input
                    required
                    type="date"
                    value={form.checkOut}
                    onChange={(e) => setForm((f) => ({ ...f, checkOut: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Adults</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={form.adults}
                    onChange={(e) => setForm((f) => ({ ...f, adults: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Children</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={form.children}
                    onChange={(e) => setForm((f) => ({ ...f, children: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">First name</label>
                  <input
                    required
                    value={form.firstName}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Last name</label>
                  <input
                    required
                    value={form.lastName}
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
                <input
                  required
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Initial status</label>
                <select
                  value={form.initialStatus}
                  onChange={(e) => setForm((f) => ({ ...f, initialStatus: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                >
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Note (optional)</label>
                <textarea
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Payment placeholder (optional)</label>
                <input
                  value={form.paymentPlaceholder}
                  onChange={(e) => setForm((f) => ({ ...f, paymentPlaceholder: e.target.value }))}
                  placeholder="e.g. Pay on arrival, invoice sent"
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                />
              </div>
              <label className="flex items-start gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={form.acceptExternalHoldWarnings}
                  onChange={(e) => setForm((f) => ({ ...f, acceptExternalHoldWarnings: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>I understand this range overlaps external channel holds and still want to create the reservation.</span>
              </label>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="w-full sm:w-auto px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createBusy || singleCabins.length === 0}
                  className="w-full sm:w-auto px-4 py-2 text-sm font-medium rounded-lg bg-[#81887A] text-white hover:bg-[#707668] disabled:opacity-50"
                >
                  {createBusy ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {(data?.items || []).map((row) => (
          <Link key={row.reservationId} to={`/ops/reservations/${row.reservationId}`} className="block bg-white border border-gray-200 rounded-xl p-4 hover:bg-gray-50">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {row.guestSummary?.firstName} {row.guestSummary?.lastName}
                </p>
                <p className="text-xs text-gray-500 truncate">{row.guestSummary?.email}</p>
              </div>
              <div className="text-xs text-gray-600">
                {String(row.dateRange?.startDate || '').slice(0, 10)} - {String(row.dateRange?.endDate || '').slice(0, 10)}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{row.reservationStatus || 'unknown'}</span>
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{row.paymentStatus || 'payment unknown'}</span>
                {row.conflict?.hasConflict ? (
                  <span className="text-xs px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700">Conflict</span>
                ) : null}
              </div>
            </div>
          </Link>
        ))}
        {data?.items?.length === 0 ? <div className="text-sm text-gray-500">No reservations for current filters.</div> : null}
      </div>
    </div>
  );
}
