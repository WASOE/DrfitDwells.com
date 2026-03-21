import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { decodeRoleFromToken, opsWriteAPI, opsReadAPI } from '../../services/opsApi';

export default function OpsReservationDetail() {
  const { id } = useParams();
  const role = useMemo(() => decodeRoleFromToken(), []);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [guestDraft, setGuestDraft] = useState(null);

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
      await fn(...args);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Action failed');
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

      {error ? <div className="fixed bottom-16 sm:bottom-4 right-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div> : null}
    </div>
  );
}
