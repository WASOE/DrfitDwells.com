import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { decodeRoleFromToken, opsWriteAPI, opsReadAPI } from '../../services/opsApi';

export default function OpsReservationDetail() {
  const { id } = useParams();
  const role = useMemo(() => decodeRoleFromToken(), []);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [note, setNote] = useState('');
  const [guestDraft, setGuestDraft] = useState(null);
  const [editDatesOpen, setEditDatesOpen] = useState(false);
  const [editDatesBusy, setEditDatesBusy] = useState(false);
  const [editDatesError, setEditDatesError] = useState('');
  const [editDatesForm, setEditDatesForm] = useState({
    checkInDate: '',
    checkOutDate: '',
    reason: ''
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await opsReadAPI.reservationDetail(id);
      const payload = resp.data?.data || null;
      setData(payload);
      setGuestDraft(payload?.guestDetail || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load reservation');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const doAction = async (fn, ...args) => {
    try {
      setError('');
      setSuccessMessage('');
      await fn(...args);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Action failed');
    }
  };

  const openEditDatesModal = () => {
    setEditDatesForm({
      checkInDate: String(data?.reservation?.checkInDate || '').slice(0, 10),
      checkOutDate: String(data?.reservation?.checkOutDate || '').slice(0, 10),
      reason: ''
    });
    setEditDatesError('');
    setSuccessMessage('');
    setEditDatesOpen(true);
  };

  const submitEditDates = async (e) => {
    e.preventDefault();
    setEditDatesBusy(true);
    setEditDatesError('');
    setError('');
    setSuccessMessage('');
    try {
      await opsWriteAPI.editReservationDates(id, {
        checkInDate: editDatesForm.checkInDate,
        checkOutDate: editDatesForm.checkOutDate,
        reason: editDatesForm.reason.trim() || undefined
      });
      await load();
      setEditDatesOpen(false);
      setSuccessMessage('Reservation dates updated.');
    } catch (err) {
      const status = err?.response?.status;
      const backendMessage = err?.response?.data?.message;
      if (status === 409) {
        setEditDatesError(backendMessage || 'Date change conflicts with existing availability.');
      } else if (status === 400 || status === 422) {
        setEditDatesError(backendMessage || 'Please check the entered dates and try again.');
      } else {
        setEditDatesError(backendMessage || 'Failed to update reservation dates.');
      }
    } finally {
      setEditDatesBusy(false);
    }
  };

  if (loading) return <div className="text-sm text-gray-500">Loading reservation...</div>;
  if (error && !data) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">Reservation not found.</div>;

  const reservation = data.reservation || {};
  const isAdmin = role === 'admin';

  return (
    <div className="space-y-4 pb-20">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <Link to="/ops/reservations" className="text-sm text-[#81887A] hover:underline">
          Back to reservations
        </Link>
        <h2 className="mt-1 text-lg font-semibold text-gray-900">Reservation {reservation.reservationId}</h2>
        <p className="text-sm text-gray-500">
          {String(reservation.checkInDate || '').slice(0, 10)} - {String(reservation.checkOutDate || '').slice(0, 10)}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Reservation actions</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => doAction(opsWriteAPI.confirmReservation, id)} className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50">
                Confirm
              </button>
              <button onClick={() => doAction(opsWriteAPI.checkInReservation, id)} className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50">
                Check-in
              </button>
              <button onClick={() => doAction(opsWriteAPI.completeReservation, id)} className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50">
                Complete
              </button>
              <button onClick={openEditDatesModal} className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50">
                Edit dates
              </button>
              {isAdmin ? (
                <button
                  onClick={() => {
                    const reason = window.prompt('Cancel reason (required)');
                    if (!reason) return;
                    doAction(opsWriteAPI.cancelReservation, id, reason);
                  }}
                  className="px-3 py-2 text-sm rounded border border-red-200 text-red-700 hover:bg-red-50"
                >
                  Cancel
                </button>
              ) : null}
              {isAdmin ? (
                <button
                  onClick={() => {
                    const toCabinId = window.prompt('Target cabinId');
                    if (!toCabinId) return;
                    doAction(opsWriteAPI.reassignReservation, id, {
                      toCabinId,
                      acceptExternalHoldWarnings: true,
                      reason: 'ops_reassign'
                    });
                  }}
                  className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50"
                >
                  Reassign
                </button>
              ) : null}
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Guest detail</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                value={guestDraft?.firstName || ''}
                onChange={(e) => setGuestDraft((p) => ({ ...p, firstName: e.target.value }))}
                className="px-3 py-2 text-sm border rounded-lg"
                placeholder="First name"
              />
              <input
                value={guestDraft?.lastName || ''}
                onChange={(e) => setGuestDraft((p) => ({ ...p, lastName: e.target.value }))}
                className="px-3 py-2 text-sm border rounded-lg"
                placeholder="Last name"
              />
              <input
                value={guestDraft?.email || ''}
                onChange={(e) => setGuestDraft((p) => ({ ...p, email: e.target.value }))}
                className="px-3 py-2 text-sm border rounded-lg"
                placeholder="Email"
              />
              <input
                value={guestDraft?.phone || ''}
                onChange={(e) => setGuestDraft((p) => ({ ...p, phone: e.target.value }))}
                className="px-3 py-2 text-sm border rounded-lg"
                placeholder="Phone"
              />
            </div>
            <button
              onClick={() =>
                doAction(opsWriteAPI.editGuestContact, id, {
                  firstName: guestDraft?.firstName,
                  lastName: guestDraft?.lastName,
                  email: guestDraft?.email,
                  phone: guestDraft?.phone
                })
              }
              className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50"
            >
              Save guest contact
            </button>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Notes</h3>
            <div className="flex gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border rounded-lg"
                placeholder="Add reservation note"
              />
              <button
                onClick={async () => {
                  if (!note.trim()) return;
                  await doAction(opsWriteAPI.addReservationNote, id, note.trim());
                  setNote('');
                }}
                className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50"
              >
                Add
              </button>
            </div>
            <div className="space-y-2">
              {(data.notes?.items || []).map((n) => (
                <div key={n.noteId} className="text-sm bg-gray-50 border border-gray-200 rounded p-2">
                  <p className="text-gray-900">{n.content}</p>
                  <p className="text-xs text-gray-500 mt-1">{n.author?.actorId} - {String(n.createdAt).slice(0, 19)}</p>
                </div>
              ))}
              {(data.notes?.items || []).length === 0 ? <p className="text-sm text-gray-500">No notes yet.</p> : null}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Communication</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => doAction(opsWriteAPI.sendArrivalInstructions, id)} className="px-2.5 py-1.5 text-xs rounded border border-gray-300">
                Send arrival
              </button>
              <button onClick={() => doAction(opsWriteAPI.resendArrivalInstructions, id)} className="px-2.5 py-1.5 text-xs rounded border border-gray-300">
                Resend
              </button>
              <button onClick={() => doAction(opsWriteAPI.markArrivalCompleted, id)} className="px-2.5 py-1.5 text-xs rounded border border-gray-300">
                Mark completed
              </button>
            </div>
            <div className="space-y-1">
              {(data.communicationHistory || []).slice(0, 5).map((c) => (
                <p key={c.communicationEventId} className="text-xs text-gray-600">
                  {c.eventType} - {String(c.happenedAt).slice(0, 10)}
                </p>
              ))}
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Context</h3>
            <p className="text-xs text-gray-600">Payment events: {(data.paymentTrail || []).length}</p>
            <p className="text-xs text-gray-600">Payout relevance: {data.payoutRelevance?.payoutCount || 0}</p>
            <p className="text-xs text-gray-600">Hard conflict: {data.conflictContext?.hasHardConflict ? 'yes' : 'no'}</p>
            <p className="text-xs text-gray-600">Warning: {data.conflictContext?.hasWarning ? 'yes' : 'no'}</p>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Availability actions</h3>
            <button
              onClick={() => {
                const startDate = window.prompt('Manual block start date (YYYY-MM-DD)');
                const endDate = window.prompt('Manual block end date (YYYY-MM-DD)');
                if (!startDate || !endDate) return;
                doAction(opsWriteAPI.createManualBlock, {
                  cabinId: reservation.cabinId,
                  startDate,
                  endDate,
                  reason: 'reservation_detail'
                });
              }}
              className="w-full px-3 py-2 text-sm rounded border border-gray-300 text-left"
            >
              Add manual block
            </button>
            <button
              onClick={() => {
                const startDate = window.prompt('Maintenance start date (YYYY-MM-DD)');
                const endDate = window.prompt('Maintenance end date (YYYY-MM-DD)');
                if (!startDate || !endDate) return;
                doAction(opsWriteAPI.createMaintenanceBlock, {
                  cabinId: reservation.cabinId,
                  startDate,
                  endDate,
                  reason: 'reservation_detail'
                });
              }}
              className="w-full px-3 py-2 text-sm rounded border border-gray-300 text-left"
            >
              Add maintenance block
            </button>
          </section>
        </div>
      </div>

      {editDatesOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="edit-reservation-dates-title">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close edit dates modal"
            onClick={() => {
              if (!editDatesBusy) setEditDatesOpen(false);
            }}
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white border border-gray-200 shadow-xl p-5 space-y-4">
            <h3 id="edit-reservation-dates-title" className="text-base font-semibold text-gray-900">
              Edit reservation dates
            </h3>
            <form onSubmit={submitEditDates} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="checkInDate" className="block text-xs font-medium text-gray-500 mb-1">Check-in</label>
                  <input
                    id="checkInDate"
                    type="date"
                    required
                    value={editDatesForm.checkInDate}
                    onChange={(e) => setEditDatesForm((prev) => ({ ...prev, checkInDate: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                  />
                </div>
                <div>
                  <label htmlFor="checkOutDate" className="block text-xs font-medium text-gray-500 mb-1">Check-out</label>
                  <input
                    id="checkOutDate"
                    type="date"
                    required
                    value={editDatesForm.checkOutDate}
                    onChange={(e) => setEditDatesForm((prev) => ({ ...prev, checkOutDate: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="editDatesReason" className="block text-xs font-medium text-gray-500 mb-1">Reason (optional)</label>
                <input
                  id="editDatesReason"
                  type="text"
                  value={editDatesForm.reason}
                  onChange={(e) => setEditDatesForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="Why was this rescheduled?"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                />
              </div>
              {editDatesError ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {editDatesError}
                </div>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={editDatesBusy}
                  onClick={() => setEditDatesOpen(false)}
                  className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editDatesBusy}
                  className="px-3 py-2 text-sm rounded bg-[#81887A] text-white hover:bg-[#6d7366] disabled:opacity-50"
                >
                  {editDatesBusy ? 'Saving...' : 'Save dates'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {error ? <div className="fixed bottom-16 sm:bottom-4 right-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div> : null}
      {successMessage ? <div className="fixed bottom-16 sm:bottom-4 left-4 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded text-sm">{successMessage}</div> : null}
    </div>
  );
}
