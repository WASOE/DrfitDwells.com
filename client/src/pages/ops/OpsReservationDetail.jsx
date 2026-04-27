import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { decodeRoleFromToken, opsWriteAPI, opsReadAPI } from '../../services/opsApi';

const TEMPLATE_LABELS = {
  booking_received: 'Booking received email',
  booking_confirmed: 'Booking confirmation email',
  booking_cancelled: 'Booking cancellation email'
};

const LIFECYCLE_TEMPLATE_KEYS = ['booking_received', 'booking_confirmed', 'booking_cancelled'];

function resolveEffectiveRecipient(overrideInput, guestEmail) {
  const trimmed = (overrideInput || '').trim();
  if (trimmed) return trimmed;
  return (guestEmail || '').trim() || '';
}

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

  const [overrideRecipient, setOverrideRecipient] = useState('');
  const [lifecycleEmailEvents, setLifecycleEmailEvents] = useState([]);
  const [lifecycleEmailPagination, setLifecycleEmailPagination] = useState(null);
  const [lifecycleEmailLoading, setLifecycleEmailLoading] = useState(false);
  const [lifecycleEmailPage, setLifecycleEmailPage] = useState(1);
  const [lifecycleInlineError, setLifecycleInlineError] = useState('');
  const [previewLoadingKey, setPreviewLoadingKey] = useState(null);
  const [resendLoadingKey, setResendLoadingKey] = useState(null);
  const [editResendLoadingKey, setEditResendLoadingKey] = useState(null);
  const [editResendSending, setEditResendSending] = useState(false);
  const [previewModal, setPreviewModal] = useState({
    open: false,
    subject: '',
    html: '',
    templateKey: null
  });
  const [editResendModal, setEditResendModal] = useState({
    open: false,
    templateKey: null,
    subject: '',
    html: '',
    loading: false
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
      checkInDate: data?.reservation?.checkInDateOnly || '',
      checkOutDate: data?.reservation?.checkOutDateOnly || '',
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

  const fetchLifecycleEmailEvents = useCallback(
    async (page) => {
      if (!id) return;
      setLifecycleEmailLoading(true);
      setLifecycleInlineError('');
      try {
        const resp = await opsReadAPI.reservationEmailEvents(id, { page, limit: 50 });
        setLifecycleEmailEvents(resp.data?.data?.events || []);
        setLifecycleEmailPagination(resp.data?.data?.pagination || null);
      } catch (err) {
        setLifecycleInlineError(err?.response?.data?.message || 'Failed to load email history');
      } finally {
        setLifecycleEmailLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    fetchLifecycleEmailEvents(lifecycleEmailPage);
  }, [id, lifecycleEmailPage, fetchLifecycleEmailEvents]);

  const closePreviewModal = () => {
    setPreviewModal({ open: false, subject: '', html: '', templateKey: null });
  };

  const closeEditResendModal = () => {
    setEditResendModal({
      open: false,
      templateKey: null,
      subject: '',
      html: '',
      loading: false
    });
  };

  const openEditFromPreview = () => {
    if (!previewModal.templateKey) return;
    setEditResendModal({
      open: true,
      templateKey: previewModal.templateKey,
      subject: previewModal.subject || '',
      html: previewModal.html || '',
      loading: false
    });
    closePreviewModal();
  };

  const handlePreviewTemplate = async (templateKey) => {
    setPreviewLoadingKey(templateKey);
    setLifecycleInlineError('');
    try {
      const response = await opsWriteAPI.previewBookingLifecycleEmail(id, { templateKey });
      const payload = response.data;
      if (!payload?.success || !payload.data?.html) {
        setLifecycleInlineError(payload?.message || 'Preview failed');
        return;
      }
      setPreviewModal({
        open: true,
        subject: payload.data.subject || '',
        html: payload.data.html,
        templateKey: payload.data.templateKey || templateKey
      });
    } catch (err) {
      const d = err?.response?.data;
      setLifecycleInlineError(d?.message || 'Network error while loading preview');
    } finally {
      setPreviewLoadingKey(null);
    }
  };

  const handleResendTemplate = async (templateKey) => {
    const guestEmail = (guestDraft?.email || data?.reservation?.guest?.email || '').trim();
    const effective = resolveEffectiveRecipient(overrideRecipient, guestEmail);
    if (!effective) {
      setLifecycleInlineError(
        'No recipient: enter an override email or ensure this booking has a guest email on file.'
      );
      return;
    }
    const label = TEMPLATE_LABELS[templateKey] || templateKey;
    let composedSubject = '';
    try {
      const previewRes = await opsWriteAPI.previewBookingLifecycleEmail(id, { templateKey });
      const previewPayload = previewRes.data;
      if (previewPayload?.success && previewPayload.data?.subject) {
        composedSubject = previewPayload.data.subject;
      }
    } catch {
      /* confirm still works without subject line */
    }
    const subjectLine = composedSubject ? `\n\nSubject: ${composedSubject}` : '\n\nSubject: (composed from current booking data)';
    const ok = window.confirm(
      `Send "${label}" now?\n\nTo: ${effective}${(overrideRecipient || '').trim() ? '\n(using override address)' : '\n(guest email on file)'}${subjectLine}\n\nUses template defaults (not the edit-before-send path).`
    );
    if (!ok) return;

    setResendLoadingKey(templateKey);
    setLifecycleInlineError('');
    try {
      const body = { templateKey };
      const trimmedOverride = (overrideRecipient || '').trim();
      if (trimmedOverride) body.overrideRecipient = trimmedOverride;
      const response = await opsWriteAPI.resendBookingLifecycleEmail(id, body);
      const payload = response.data;
      if (payload?.success) {
        setSuccessMessage(
          `Email sent. Status: ${payload.data?.sendStatus || 'success'}. Recipient: ${payload.data?.recipient || effective}.`
        );
        setLifecycleEmailPage(1);
        await fetchLifecycleEmailEvents(1);
        await load();
      } else {
        setLifecycleInlineError(
          `Send completed with provider issue. Status: ${payload?.data?.sendStatus || 'unknown'}. ${payload?.data?.emailEvent?.errorMessage || ''}`.trim()
        );
        await fetchLifecycleEmailEvents(lifecycleEmailPage);
        await load();
      }
    } catch (err) {
      const d = err?.response?.data;
      setLifecycleInlineError(d?.message || 'Failed to send email');
    } finally {
      setResendLoadingKey(null);
    }
  };

  const openEditResendModal = async (templateKey) => {
    setEditResendLoadingKey(templateKey);
    setEditResendModal({
      open: true,
      templateKey,
      subject: '',
      html: '',
      loading: true
    });
    setLifecycleInlineError('');
    try {
      const response = await opsWriteAPI.previewBookingLifecycleEmail(id, { templateKey });
      const payload = response.data;
      if (!payload?.success || !payload?.data?.html) {
        setEditResendModal({ open: false, templateKey: null, subject: '', html: '', loading: false });
        setLifecycleInlineError(payload?.message || 'Could not load template for editing');
        return;
      }
      setEditResendModal({
        open: true,
        templateKey,
        subject: payload.data.subject || '',
        html: payload.data.html || '',
        loading: false
      });
    } catch (err) {
      setEditResendModal({ open: false, templateKey: null, subject: '', html: '', loading: false });
      setLifecycleInlineError(err?.response?.data?.message || 'Network error while loading template');
    } finally {
      setEditResendLoadingKey(null);
    }
  };

  const submitEditedResend = async () => {
    const guestEmail = (guestDraft?.email || data?.reservation?.guest?.email || '').trim();
    const effective = resolveEffectiveRecipient(overrideRecipient, guestEmail);
    if (!effective) {
      setLifecycleInlineError(
        'No recipient: enter an override email or ensure this booking has a guest email on file.'
      );
      return;
    }
    const subjectTrim = (editResendModal.subject || '').trim();
    const htmlRaw = editResendModal.html || '';
    if (!subjectTrim || !htmlRaw.trim()) {
      setLifecycleInlineError('Subject and HTML are required before sending.');
      return;
    }
    const label = TEMPLATE_LABELS[editResendModal.templateKey] || editResendModal.templateKey;
    const ok = window.confirm(
      `Send edited "${label}"?\n\nTo: ${effective}${(overrideRecipient || '').trim() ? '\n(using override address)' : '\n(guest email on file)'}\n\nSubject: ${subjectTrim}`
    );
    if (!ok) return;

    setEditResendSending(true);
    setLifecycleInlineError('');
    try {
      const body = {
        templateKey: editResendModal.templateKey,
        editedContent: { subject: subjectTrim, html: htmlRaw }
      };
      const trimmedOverride = (overrideRecipient || '').trim();
      if (trimmedOverride) body.overrideRecipient = trimmedOverride;
      const response = await opsWriteAPI.resendBookingLifecycleEmail(id, body);
      const payload = response.data;
      if (!payload?.success) {
        setLifecycleInlineError(
          `Send completed with provider issue. Status: ${payload?.data?.sendStatus || 'unknown'}. ${payload?.data?.emailEvent?.errorMessage || ''}`.trim()
        );
        await fetchLifecycleEmailEvents(lifecycleEmailPage);
        await load();
        return;
      }
      setSuccessMessage(
        `Sent (edited). Status: ${payload.data?.sendStatus || 'success'}. Recipient: ${payload.data?.recipient || effective}.`
      );
      closeEditResendModal();
      setLifecycleEmailPage(1);
      await fetchLifecycleEmailEvents(1);
      await load();
    } catch (err) {
      setLifecycleInlineError(err?.response?.data?.message || 'Network error while sending');
    } finally {
      setEditResendSending(false);
    }
  };

  const lifecycleActionsBusy =
    !!resendLoadingKey ||
    !!previewLoadingKey ||
    !!editResendLoadingKey ||
    editResendSending ||
    editResendModal.loading ||
    editResendModal.open;

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
          {reservation.checkInDateOnly || '—'} - {reservation.checkOutDateOnly || '—'}
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
          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-4 max-w-2xl lg:max-w-none">
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

            <div className="border-t border-gray-100 pt-4 space-y-4">
              <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Booking lifecycle email</h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                Preview is read-only. Resend sends only after you confirm. Leave override blank to use the guest email on file (
                <span className="font-medium text-gray-800">
                  {resolveEffectiveRecipient(overrideRecipient, guestDraft?.email || reservation?.guest?.email || '') || '—'}
                </span>
                ).
              </p>
              <div className="space-y-1.5">
                <label htmlFor="ops-lifecycle-override" className="block text-xs font-medium text-gray-600 mb-1">
                  Override recipient (optional)
                </label>
                <input
                  id="ops-lifecycle-override"
                  type="email"
                  value={overrideRecipient}
                  onChange={(e) => setOverrideRecipient(e.target.value)}
                  placeholder="Leave blank for guest email"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
              {lifecycleInlineError ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{lifecycleInlineError}</div>
              ) : null}
              <div className="space-y-2.5">
                {LIFECYCLE_TEMPLATE_KEYS.map((key) => (
                  <div
                    key={key}
                    className="rounded-lg border border-gray-200/80 bg-gray-50/40 px-3 py-2.5 space-y-2"
                  >
                    <div>
                      <span className="block text-sm text-gray-900 leading-tight">{TEMPLATE_LABELS[key]}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        disabled={lifecycleActionsBusy}
                        onClick={() => handlePreviewTemplate(key)}
                        className="w-full inline-flex justify-center items-center px-2.5 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        {previewLoadingKey === key ? 'Loading…' : 'Preview'}
                      </button>
                      <button
                        type="button"
                        disabled={lifecycleActionsBusy}
                        onClick={() => handleResendTemplate(key)}
                        className="w-full inline-flex justify-center items-center px-2.5 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        {resendLoadingKey === key ? 'Sending…' : 'Resend'}
                      </button>
                      <button
                        type="button"
                        disabled={lifecycleActionsBusy}
                        onClick={() => openEditResendModal(key)}
                        className="w-full inline-flex justify-center items-center px-2.5 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        {editResendLoadingKey === key ? 'Loading…' : 'Edit & resend'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-5 space-y-2.5">
              <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Email event history</h4>
              {lifecycleEmailLoading ? (
                <p className="text-xs text-gray-500">Loading email events…</p>
              ) : lifecycleEmailEvents.length === 0 ? (
                <p className="text-xs text-gray-500">No email events for this booking.</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto text-xs text-gray-700">
                  {lifecycleEmailEvents.map((evt) => (
                    <li key={evt._id} className="border border-gray-100 rounded-md p-2 bg-white">
                      <div className="font-medium text-gray-900">
                        {evt.type || '—'}
                        {evt.templateKey ? <span className="text-gray-500 font-normal"> · {evt.templateKey}</span> : null}
                      </div>
                      <div className="text-gray-600 mt-0.5">
                        {evt.sendStatus ? <span>{evt.sendStatus}</span> : null}
                        {evt.lifecycleSource ? <span className="ml-2">Source: {evt.lifecycleSource}</span> : null}
                      </div>
                      <div className="text-gray-500 mt-0.5 truncate" title={evt.to || ''}>
                        To: {evt.to || '—'}
                      </div>
                      {evt.subject ? (
                        <div className="text-gray-500 mt-0.5 truncate" title={evt.subject}>
                          {evt.subject}
                        </div>
                      ) : null}
                      <div className="text-gray-400 mt-0.5">{evt.createdAt ? String(evt.createdAt).slice(0, 19) : ''}</div>
                      {evt.errorMessage ? <div className="text-red-600 mt-1">{evt.errorMessage}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
              {lifecycleEmailPagination && lifecycleEmailPagination.pages > 1 ? (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={lifecycleEmailPage <= 1 || lifecycleEmailLoading}
                    onClick={() => setLifecycleEmailPage((p) => Math.max(1, p - 1))}
                    className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-gray-500">
                    Page {lifecycleEmailPagination.page} of {lifecycleEmailPagination.pages}
                  </span>
                  <button
                    type="button"
                    disabled={lifecycleEmailPage >= lifecycleEmailPagination.pages || lifecycleEmailLoading}
                    onClick={() => setLifecycleEmailPage((p) => p + 1)}
                    className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              ) : null}
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

      {previewModal.open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ops-email-preview-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close preview"
            onClick={closePreviewModal}
          />
          <div className="relative w-full max-w-4xl max-h-[min(92vh,900px)] flex flex-col rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <h2 id="ops-email-preview-title" className="text-sm font-semibold text-gray-900">
                  Email preview
                </h2>
                <p className="mt-1 text-xs text-gray-500 truncate" title={previewModal.subject || ''}>
                  {TEMPLATE_LABELS[previewModal.templateKey] || previewModal.templateKey || ''}
                </p>
                <p className="mt-0.5 text-xs text-gray-600 break-words">{previewModal.subject}</p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={openEditFromPreview}
                  disabled={lifecycleActionsBusy}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-white bg-[#81887A] hover:bg-[#6d7366] border border-transparent disabled:opacity-50"
                >
                  Edit &amp; resend
                </button>
                <button
                  type="button"
                  onClick={closePreviewModal}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-200"
                >
                  Close
                </button>
              </div>
            </div>
            <p className="px-4 py-2 text-xs text-amber-900 bg-amber-50 border-b border-amber-100/80">
              Preview only — nothing is sent. Sandbox blocks scripts; images may load for preview (same-origin).
            </p>
            <iframe
              title="Email HTML preview"
              sandbox="allow-same-origin"
              srcDoc={previewModal.html}
              className="w-full flex-1 min-h-[50vh] sm:min-h-[60vh] border-0 bg-zinc-100"
            />
          </div>
        </div>
      ) : null}

      {editResendModal.open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ops-email-edit-resend-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close editor"
            onClick={() => {
              if (!editResendSending) closeEditResendModal();
            }}
          />
          <div className="relative w-full max-w-4xl max-h-[min(92vh,900px)] flex flex-col rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <h2 id="ops-email-edit-resend-title" className="text-sm font-semibold text-gray-900">
                  Edit before resend
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  {TEMPLATE_LABELS[editResendModal.templateKey] || editResendModal.templateKey || ''}
                </p>
              </div>
              <button
                type="button"
                disabled={editResendSending}
                onClick={closeEditResendModal}
                className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {editResendModal.loading ? (
              <div className="px-4 py-10 text-center text-sm text-gray-500">Loading template…</div>
            ) : (
              <>
                <p className="px-4 py-2 text-xs text-gray-600 bg-gray-50 border-b border-gray-100 sm:px-5">
                  Recipient for this send:{' '}
                  <span className="font-medium text-gray-900">
                    {resolveEffectiveRecipient(overrideRecipient, guestDraft?.email || reservation?.guest?.email || '') || '—'}
                  </span>
                  . Plain text is derived from HTML on the server; obvious script tags and{' '}
                  <span className="font-mono">javascript:</span> URLs are stripped.
                </p>
                <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5 space-y-3">
                  <div>
                    <label htmlFor="ops-edit-resend-subject" className="block text-xs font-medium text-gray-500 mb-1">
                      Subject
                    </label>
                    <input
                      id="ops-edit-resend-subject"
                      type="text"
                      value={editResendModal.subject}
                      onChange={(e) => setEditResendModal((prev) => ({ ...prev, subject: e.target.value }))}
                      className="w-full max-w-2xl px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                  <div>
                    <label htmlFor="ops-edit-resend-html" className="block text-xs font-medium text-gray-500 mb-1">
                      HTML body
                    </label>
                    <textarea
                      id="ops-edit-resend-html"
                      rows={14}
                      value={editResendModal.html}
                      onChange={(e) => setEditResendModal((prev) => ({ ...prev, html: e.target.value }))}
                      className="w-full font-mono text-xs sm:text-sm px-3 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A] min-h-[200px] lg:min-h-[280px]"
                    />
                  </div>
                </div>
                <div className="border-t border-gray-100 px-4 py-3 sm:px-5 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={editResendSending}
                    onClick={closeEditResendModal}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={editResendSending}
                    onClick={submitEditedResend}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-[#81887A] hover:bg-[#6d7366] disabled:opacity-50"
                  >
                    {editResendSending ? 'Sending…' : 'Confirm send'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

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
