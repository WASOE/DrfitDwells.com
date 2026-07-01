import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { opsWriteAPI, opsReadAPI } from '../../services/opsApi';
import api from '../../services/api';
import { useOpsSession } from '../../context/OpsSessionContext';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import { OpsEmailPreviewModal } from './components/OpsEmailPreviewModal';
import { OpsWhatsappPreviewModal } from './components/OpsWhatsappPreviewModal';
import { buildGmaPreviewRuleOptions } from '../../../../shared/messaging/gmaPreviewRules.js';
import {
  canCancelReservation,
  canMarkCashRefunded,
  canReassignReservation,
  canResolveCancellationSettlement,
  showCompletedNotCancellableMessage
} from './utils/opsReservationPermissions';
import {
  manualReservationPurposeLabel,
  guestConfirmationEmailPolicyLabel
} from '../../utils/manualReservationPurpose';

const MIN_STAY_CREDIT_CENTS = 10000;

const CASH_REFUND_METHOD_OPTIONS = [
  { value: 'stripe_manual', label: 'Stripe (manual)' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' }
];

const SETTLEMENT_OUTCOME_OPTIONS = [
  { value: 'resolution_pending', label: 'Decide later' },
  { value: 'payment_retained', label: 'Payment retained' },
  { value: 'credits_issued', label: 'Issue stay credit now' },
  { value: 'cash_refund_pending', label: 'Cash refund pending' },
  { value: 'cash_refunded', label: 'Cash refund already paid' }
];

const RESOLVE_SETTLEMENT_OUTCOME_OPTIONS = [
  { value: 'payment_retained', label: 'Payment retained' },
  { value: 'credits_issued', label: 'Issue stay credit now' },
  { value: 'cash_refund_pending', label: 'Cash refund pending' },
  { value: 'cash_refunded', label: 'Cash refund already paid' }
];

const SETTLEMENT_WARNINGS = {
  resolution_pending: 'Refund follow-up stays active until this is resolved later.',
  payment_retained: 'No refund follow-up will be shown. Payment is retained.',
  credits_issued:
    'Creates an active stay credit immediately. Minimum €100. Guest receives only the standard cancellation email for now.',
  cash_refund_pending:
    'Manual cash refund still required. Refund follow-up stays active until marked refunded.',
  cash_refunded:
    'Records that cash was refunded manually. No Stripe automation. Refund follow-up will clear.'
};

function settlementOutcomeLabel(outcome) {
  const labels = {
    resolution_pending: 'Settlement pending',
    payment_retained: 'Payment retained',
    credits_issued: 'Stay credit issued',
    cash_refund_pending: 'Cash refund pending',
    cash_refunded: 'Cash refunded'
  };
  return labels[outcome] || outcome || '—';
}

function cashRefundMethodLabel(method) {
  const match = CASH_REFUND_METHOD_OPTIONS.find((option) => option.value === method);
  return match?.label || method || '—';
}

const EMPTY_CASH_REFUND_FORM = {
  amountEuros: '',
  note: '',
  reference: '',
  method: 'stripe_manual',
  refundedDate: ''
};

function eurosToCreditCents(eurosInput) {
  const trimmed = String(eurosInput || '').trim().replace(',', '.');
  if (!trimmed) return null;
  const euros = Number(trimmed);
  if (!Number.isFinite(euros)) return null;
  return Math.round(euros * 100);
}

const TEMPLATE_LABELS = {
  booking_received: 'Booking received email',
  booking_confirmed: 'Booking confirmation email',
  booking_cancelled: 'Booking cancellation email'
};

const LIFECYCLE_TEMPLATE_KEYS = ['booking_received', 'booking_confirmed', 'booking_cancelled'];

function gmaTemplateStatusBadge(status) {
  const base = 'text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide';
  if (status === 'approved') return `${base} bg-emerald-50 text-emerald-900 border-emerald-200`;
  if (status === 'draft') return `${base} bg-amber-50 text-amber-900 border-amber-200`;
  return `${base} bg-gray-100 text-gray-700 border-gray-200`;
}

function resolveEffectiveRecipient(overrideInput, guestEmail) {
  const trimmed = (overrideInput || '').trim();
  if (trimmed) return trimmed;
  return (guestEmail || '').trim() || '';
}

export default function OpsReservationDetail() {
  const { id } = useParams();
  const session = useOpsSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [note, setNote] = useState('');
  const [guestDraft, setGuestDraft] = useState(null);
  const [cleaningNotesDraft, setCleaningNotesDraft] = useState('');
  const [cleaningNotesBusy, setCleaningNotesBusy] = useState(false);
  const [cleaningNotesMsg, setCleaningNotesMsg] = useState('');
  const [cleaningNotesError, setCleaningNotesError] = useState('');
  const [editDatesOpen, setEditDatesOpen] = useState(false);
  const [editDatesBusy, setEditDatesBusy] = useState(false);
  const [editDatesError, setEditDatesError] = useState('');
  const [editDatesForm, setEditDatesForm] = useState({
    checkInDate: '',
    checkOutDate: '',
    reason: ''
  });

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [cancelForm, setCancelForm] = useState({
    reason: '',
    outcome: 'resolution_pending',
    creditAmountEuros: '',
    cashRefund: { ...EMPTY_CASH_REFUND_FORM }
  });

  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveModalMode, setResolveModalMode] = useState('settlement');
  const [resolveBusy, setResolveBusy] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [resolveForm, setResolveForm] = useState({
    reason: '',
    outcome: 'payment_retained',
    creditAmountEuros: '',
    cashRefund: { ...EMPTY_CASH_REFUND_FORM }
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
    templateKey: null,
    previewKey: ''
  });
  const [editResendModal, setEditResendModal] = useState({
    open: false,
    templateKey: null,
    subject: '',
    html: '',
    loading: false
  });

  const [messagingSummary, setMessagingSummary] = useState(null);
  const [messagingLoading, setMessagingLoading] = useState(false);
  const [messagingError, setMessagingError] = useState('');
  const [messagingCancelModal, setMessagingCancelModal] = useState({ open: false, jobId: null, ruleKey: '' });
  const [messagingCancelBusy, setMessagingCancelBusy] = useState(false);
  const [gmaPreviewRuleKey, setGmaPreviewRuleKey] = useState('arrival_instructions_pre_arrival_cabin');
  const gmaPreviewRuleOptions = useMemo(
    () => buildGmaPreviewRuleOptions(data?.stayPropertyKind),
    [data?.stayPropertyKind]
  );

  useEffect(() => {
    if (gmaPreviewRuleOptions.length === 0) return;
    const allowed = new Set(gmaPreviewRuleOptions.map((opt) => opt.value));
    if (!allowed.has(gmaPreviewRuleKey)) {
      setGmaPreviewRuleKey(gmaPreviewRuleOptions[0].value);
    }
  }, [gmaPreviewRuleOptions, gmaPreviewRuleKey]);
  const [gmaPreviewLoading, setGmaPreviewLoading] = useState(null);
  const [gmaPreviewError, setGmaPreviewError] = useState('');
  const [gmaEmailPreviewModal, setGmaEmailPreviewModal] = useState({
    open: false,
    subject: '',
    html: '',
    templateStatus: null,
    ruleKey: null,
    previewKey: ''
  });
  const [gmaWhatsappPreviewModal, setGmaWhatsappPreviewModal] = useState({
    open: false,
    templateName: '',
    locale: '',
    body: '',
    variables: null,
    note: '',
    templateStatus: null,
    ruleKey: null
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await opsReadAPI.reservationDetail(id);
      const payload = resp.data?.data || null;
      setData(payload);
      setGuestDraft(payload?.guestDetail || null);
      setCleaningNotesDraft(payload?.cleaningNotes || '');
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

  const saveCleaningNotes = async () => {
    setCleaningNotesBusy(true);
    setCleaningNotesMsg('');
    setCleaningNotesError('');
    try {
      const trimmed = (cleaningNotesDraft || '').trim();
      const resp = await api.patch(`/ops/reservations/${id}/cleaning-notes`, {
        cleaningNotes: trimmed ? trimmed : null
      });
      const saved = resp.data?.data?.cleaningNotes ?? null;
      setCleaningNotesDraft(saved || '');
      setCleaningNotesMsg('Cleaning notes saved.');
    } catch (err) {
      setCleaningNotesError(err?.response?.data?.message || 'Failed to save cleaning notes.');
    } finally {
      setCleaningNotesBusy(false);
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

  const buildCashRefundSettlementPayload = (outcome, cashRefund) => {
    if (outcome === 'cash_refund_pending') {
      const amountCents = eurosToCreditCents(cashRefund.amountEuros);
      const note = cashRefund.note.trim();
      const settlement = { outcome: 'cash_refund_pending' };
      if (amountCents != null) {
        settlement.cashRefundAmountCents = amountCents;
      }
      if (note) {
        settlement.cashRefundNote = note;
      }
      return { settlement };
    }

    if (outcome === 'cash_refunded') {
      const amountCents = eurosToCreditCents(cashRefund.amountEuros);
      if (amountCents == null || amountCents <= 0) {
        return { error: 'Enter a valid refund amount in euros' };
      }
      const method = cashRefund.method;
      if (!method) {
        return { error: 'Choose a refund method' };
      }
      const note = cashRefund.note.trim();
      if (!note) {
        return { error: 'Refund note is required when marking cash refunded' };
      }
      const evidence = {
        amountCents,
        method,
        note
      };
      if (cashRefund.reference.trim()) {
        evidence.reference = cashRefund.reference.trim();
      }
      if (cashRefund.refundedDate) {
        evidence.recordedAt = cashRefund.refundedDate;
      }
      return {
        settlement: {
          outcome: 'cash_refunded',
          cashRefundAmountCents: amountCents,
          cashRefundEvidence: evidence
        }
      };
    }

    return { error: 'Choose a valid settlement outcome' };
  };

  const openCancelModal = () => {
    setCancelForm({
      reason: '',
      outcome: 'resolution_pending',
      creditAmountEuros: '',
      cashRefund: { ...EMPTY_CASH_REFUND_FORM }
    });
    setCancelError('');
    setError('');
    setSuccessMessage('');
    setCancelOpen(true);
  };

  const buildCancelRequestBody = () => {
    const reason = cancelForm.reason.trim();
    if (!reason) {
      return { error: 'Cancel reason is required' };
    }
    if (reason.length > 500) {
      return { error: 'Cancel reason must be at most 500 characters' };
    }

    if (cancelForm.outcome === 'resolution_pending') {
      return { body: { reason } };
    }

    if (cancelForm.outcome === 'payment_retained') {
      return {
        body: {
          reason,
          settlement: { outcome: 'payment_retained' }
        }
      };
    }

    if (cancelForm.outcome === 'credits_issued') {
      const creditAmountCents = eurosToCreditCents(cancelForm.creditAmountEuros);
      if (creditAmountCents == null) {
        return { error: 'Enter a valid stay credit amount in euros' };
      }
      if (creditAmountCents < MIN_STAY_CREDIT_CENTS) {
        return { error: 'Stay credit must be at least €100' };
      }
      return {
        body: {
          reason,
          settlement: {
            outcome: 'credits_issued',
            creditAmountCents
          }
        }
      };
    }

    if (cancelForm.outcome === 'cash_refund_pending' || cancelForm.outcome === 'cash_refunded') {
      const cashBuilt = buildCashRefundSettlementPayload(cancelForm.outcome, cancelForm.cashRefund);
      if (cashBuilt.error) return cashBuilt;
      return { body: { reason, settlement: cashBuilt.settlement } };
    }

    return { error: 'Choose a valid settlement outcome' };
  };

  const submitCancelReservation = async (e) => {
    e.preventDefault();
    const built = buildCancelRequestBody();
    if (built.error) {
      setCancelError(built.error);
      return;
    }

    setCancelBusy(true);
    setCancelError('');
    setError('');
    setSuccessMessage('');
    try {
      const resp = await opsWriteAPI.cancelReservation(id, built.body);
      const payload = resp.data?.data;
      if (payload?.compensationVoucher?.code) {
        setSuccessMessage(`Stay credit issued. Voucher code: ${payload.compensationVoucher.code}`);
      }
      setCancelOpen(false);
      await load();
    } catch (err) {
      setCancelError(err?.response?.data?.message || 'Failed to cancel reservation');
    } finally {
      setCancelBusy(false);
    }
  };

  const centsToEurosInput = (cents) => {
    if (!Number.isFinite(cents)) return '';
    return String((cents / 100).toFixed(2)).replace(/\.00$/, '');
  };

  const openResolveModal = () => {
    setResolveModalMode('settlement');
    setResolveForm({
      reason: '',
      outcome: 'payment_retained',
      creditAmountEuros: '',
      cashRefund: { ...EMPTY_CASH_REFUND_FORM }
    });
    setResolveError('');
    setError('');
    setSuccessMessage('');
    setResolveOpen(true);
  };

  const openMarkRefundedModal = () => {
    const pendingAmountEuros = centsToEurosInput(data?.cancellationSettlement?.cashRefundAmountCents);
    setResolveModalMode('mark_refunded');
    setResolveForm({
      reason: '',
      outcome: 'cash_refunded',
      creditAmountEuros: '',
      cashRefund: {
        ...EMPTY_CASH_REFUND_FORM,
        amountEuros: pendingAmountEuros,
        note: data?.cancellationSettlement?.cashRefundNote || ''
      }
    });
    setResolveError('');
    setError('');
    setSuccessMessage('');
    setResolveOpen(true);
  };

  const buildResolveRequestBody = () => {
    const reason = resolveForm.reason.trim();
    if (!reason) {
      return { error: 'Resolve reason is required' };
    }
    if (reason.length > 500) {
      return { error: 'Resolve reason must be at most 500 characters' };
    }

    const effectiveOutcome =
      resolveModalMode === 'mark_refunded' ? 'cash_refunded' : resolveForm.outcome;

    if (effectiveOutcome === 'payment_retained') {
      return {
        body: {
          reason,
          settlement: { outcome: 'payment_retained' }
        }
      };
    }

    if (effectiveOutcome === 'credits_issued') {
      const creditAmountCents = eurosToCreditCents(resolveForm.creditAmountEuros);
      if (creditAmountCents == null) {
        return { error: 'Enter a valid stay credit amount in euros' };
      }
      if (creditAmountCents < MIN_STAY_CREDIT_CENTS) {
        return { error: 'Stay credit must be at least €100' };
      }
      return {
        body: {
          reason,
          settlement: {
            outcome: 'credits_issued',
            creditAmountCents
          }
        }
      };
    }

    if (effectiveOutcome === 'cash_refund_pending' || effectiveOutcome === 'cash_refunded') {
      const cashBuilt = buildCashRefundSettlementPayload(effectiveOutcome, resolveForm.cashRefund);
      if (cashBuilt.error) return cashBuilt;
      return { body: { reason, settlement: cashBuilt.settlement } };
    }

    return { error: 'Choose a valid settlement outcome' };
  };

  const submitResolveSettlement = async (e) => {
    e.preventDefault();
    const built = buildResolveRequestBody();
    if (built.error) {
      setResolveError(built.error);
      return;
    }

    setResolveBusy(true);
    setResolveError('');
    setError('');
    setSuccessMessage('');
    try {
      const resp = await opsWriteAPI.resolveCancellationSettlement(id, built.body);
      const payload = resp.data?.data;
      if (payload?.compensationVoucher?.code) {
        setSuccessMessage(`Stay credit issued. Voucher code: ${payload.compensationVoucher.code}`);
      } else {
        setSuccessMessage('Cancellation settlement resolved.');
      }
      setResolveOpen(false);
      await load();
    } catch (err) {
      setResolveError(err?.response?.data?.message || 'Failed to resolve cancellation settlement');
    } finally {
      setResolveBusy(false);
    }
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

  const fetchMessagingSummary = useCallback(async () => {
    if (!id) return;
    setMessagingLoading(true);
    setMessagingError('');
    try {
      const resp = await opsReadAPI.reservationMessagingSummary(id);
      setMessagingSummary(resp.data?.data || null);
    } catch (err) {
      setMessagingError(err?.response?.data?.message || 'Failed to load guest message automation');
    } finally {
      setMessagingLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchMessagingSummary();
  }, [fetchMessagingSummary]);

  const confirmCancelMessagingJob = async () => {
    if (!messagingCancelModal.jobId || !id) return;
    setMessagingCancelBusy(true);
    setMessagingError('');
    try {
      await opsWriteAPI.cancelMessagingJob(messagingCancelModal.jobId, { bookingId: id });
      setMessagingCancelModal({ open: false, jobId: null, ruleKey: '' });
      await fetchMessagingSummary();
    } catch (err) {
      setMessagingError(err?.response?.data?.message || 'Failed to cancel job');
    } finally {
      setMessagingCancelBusy(false);
    }
  };

  const closeGmaEmailPreviewModal = () => {
    setGmaEmailPreviewModal({
      open: false,
      subject: '',
      html: '',
      templateStatus: null,
      ruleKey: null,
      previewKey: ''
    });
  };

  const closeGmaWhatsappPreviewModal = () => {
    setGmaWhatsappPreviewModal({
      open: false,
      templateName: '',
      locale: '',
      body: '',
      variables: null,
      note: '',
      templateStatus: null,
      ruleKey: null
    });
  };

  const handleGmaPreview = async (channel) => {
    if (!id) return;
    setGmaPreviewLoading(channel);
    setGmaPreviewError('');
    try {
      const response = await opsReadAPI.previewGmaMessage(id, {
        ruleKey: gmaPreviewRuleKey,
        channel
      });
      const payload = response.data;
      if (!payload?.success || !payload.data) {
        setGmaPreviewError(payload?.message || 'Preview failed');
        return;
      }
      const d = payload.data;
      if (channel === 'email') {
        setGmaEmailPreviewModal({
          open: true,
          subject: d.email?.subject || '',
          html: d.email?.html || '',
          templateStatus: d.template?.status || null,
          ruleKey: d.ruleKey || gmaPreviewRuleKey,
          previewKey: `gma-email:${d.ruleKey || gmaPreviewRuleKey}:${Date.now()}`
        });
      } else {
        setGmaWhatsappPreviewModal({
          open: true,
          templateName: d.whatsapp?.templateName || '',
          locale: d.whatsapp?.locale || '',
          body: d.whatsapp?.body || '',
          variables: d.whatsapp?.variables || d.variables || null,
          note: d.whatsapp?.note || '',
          templateStatus: d.template?.status || null,
          ruleKey: d.ruleKey || gmaPreviewRuleKey
        });
      }
    } catch (err) {
      const d = err?.response?.data;
      const missing = d?.details?.missing;
      const extra =
        Array.isArray(missing) && missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : '';
      setGmaPreviewError((d?.message || 'Network error while loading GMA preview') + extra);
    } finally {
      setGmaPreviewLoading(null);
    }
  };

  const closePreviewModal = () => {
    setPreviewModal({ open: false, subject: '', html: '', templateKey: null, previewKey: '' });
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
        templateKey: payload.data.templateKey || templateKey,
        previewKey: `lifecycle:${templateKey}:${Date.now()}`
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
  const manualPurpose = reservation.manualReservationPurpose || data.manualReservationPurpose || null;
  const sendGuestConfirmationEmail =
    reservation.sendGuestConfirmationEmail === true || reservation.sendGuestConfirmationEmail === false
      ? reservation.sendGuestConfirmationEmail
      : data.sendGuestConfirmationEmail === true || data.sendGuestConfirmationEmail === false
        ? data.sendGuestConfirmationEmail
        : null;
  const cancellationSettlement = data.cancellationSettlement || null;
  const reservationStatus = reservation.reservationStatus || '';
  const canCancel = canCancelReservation(session, reservationStatus);
  const canReassign = canReassignReservation(session);
  const canResolveSettlement = canResolveCancellationSettlement(
    session,
    reservationStatus,
    cancellationSettlement
  );
  const canMarkCashRefundedSettlement = canMarkCashRefunded(
    session,
    reservationStatus,
    cancellationSettlement
  );
  const showCompletedNotCancellableNote = showCompletedNotCancellableMessage(session, reservationStatus);
  const showSettlementCard =
    Boolean(cancellationSettlement) || canResolveSettlement || canMarkCashRefundedSettlement;
  const displayedSettlementOutcome = !cancellationSettlement
    ? 'Not recorded yet'
    : !cancellationSettlement.outcome || cancellationSettlement.outcome === 'resolution_pending'
      ? settlementOutcomeLabel(cancellationSettlement.outcome || 'resolution_pending')
      : settlementOutcomeLabel(cancellationSettlement.outcome);

  return (
    <div className="space-y-4 pb-20 max-w-7xl mx-auto">
      <div className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
        <Link to="/ops/reservations" className="text-sm text-[#81887A] hover:underline">
          Back to reservations
        </Link>
        <h2 className="mt-1 text-lg md:text-xl font-semibold text-gray-900">Reservation {reservation.reservationId}</h2>
        <p className="text-sm text-gray-500 max-w-2xl">
          {reservation.checkInDateOnly || '—'} - {reservation.checkOutDateOnly || '—'}
        </p>
        {manualPurpose || sendGuestConfirmationEmail != null ? (
          <div className="mt-3 flex flex-wrap gap-2 max-w-2xl">
            {manualPurpose ? (
              <span className="text-xs px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-800">
                {manualReservationPurposeLabel(manualPurpose)}
              </span>
            ) : null}
            {sendGuestConfirmationEmail != null ? (
              <span
                className={`text-xs px-2 py-1 rounded border ${
                  sendGuestConfirmationEmail
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                {guestConfirmationEmailPolicyLabel(sendGuestConfirmationEmail)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {showSettlementCard ? (
        <section className="bg-white border border-amber-200 rounded-xl p-4 md:p-5 max-w-3xl">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900">Cancellation settlement</h3>
            {canResolveSettlement ? (
              <button
                type="button"
                onClick={openResolveModal}
                className="shrink-0 px-3 py-2 text-sm rounded border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
              >
                Resolve settlement
              </button>
            ) : null}
            {canMarkCashRefundedSettlement ? (
              <button
                type="button"
                onClick={openMarkRefundedModal}
                className="shrink-0 px-3 py-2 text-sm rounded border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
              >
                Mark as refunded
              </button>
            ) : null}
          </div>
          {canResolveSettlement ? (
            <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Refund follow-up stays active until this settlement is resolved.
            </p>
          ) : null}
          {canMarkCashRefundedSettlement ? (
            <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Manual cash refund is still required. Mark as refunded once completed.
            </p>
          ) : null}
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-gray-500">Outcome</dt>
              <dd className="font-medium text-gray-900">{displayedSettlementOutcome}</dd>
            </div>
            {cancellationSettlement?.creditAmountCents != null ? (
              <div>
                <dt className="text-gray-500">Stay credit amount</dt>
                <dd className="font-medium text-gray-900 tabular-nums">
                  {formatMoneyFromCents(cancellationSettlement.creditAmountCents, 'EUR')}
                </dd>
              </div>
            ) : null}
            {cancellationSettlement?.cashRefundAmountCents != null ? (
              <div>
                <dt className="text-gray-500">Cash refund amount</dt>
                <dd className="font-medium text-gray-900 tabular-nums">
                  {formatMoneyFromCents(cancellationSettlement.cashRefundAmountCents, 'EUR')}
                </dd>
              </div>
            ) : null}
            {cancellationSettlement?.cashRefundEvidence?.method ? (
              <div>
                <dt className="text-gray-500">Refund method</dt>
                <dd className="text-gray-900">
                  {cashRefundMethodLabel(cancellationSettlement.cashRefundEvidence.method)}
                </dd>
              </div>
            ) : null}
            {cancellationSettlement?.cashRefundEvidence?.reference ? (
              <div>
                <dt className="text-gray-500">Refund reference</dt>
                <dd className="text-gray-900 break-all">{cancellationSettlement.cashRefundEvidence.reference}</dd>
              </div>
            ) : null}
            {cancellationSettlement?.cashRefundEvidence?.recordedAt ? (
              <div>
                <dt className="text-gray-500">Refunded at</dt>
                <dd className="text-gray-900">
                  {String(cancellationSettlement.cashRefundEvidence.recordedAt).slice(0, 19).replace('T', ' ')}
                </dd>
              </div>
            ) : null}
            {cancellationSettlement?.cashRefundNote ? (
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Cash refund note</dt>
                <dd className="text-gray-900 whitespace-pre-wrap">{cancellationSettlement.cashRefundNote}</dd>
              </div>
            ) : null}
            {cancellationSettlement?.settlementRecordedAt ? (
              <div>
                <dt className="text-gray-500">Recorded at</dt>
                <dd className="text-gray-900">
                  {String(cancellationSettlement.settlementRecordedAt).slice(0, 19).replace('T', ' ')}
                </dd>
              </div>
            ) : null}
            {cancellationSettlement?.compensationGiftVoucherId ? (
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Compensation voucher</dt>
                <dd>
                  <Link
                    to={`/ops/gift-vouchers/${cancellationSettlement.compensationGiftVoucherId}`}
                    className="text-[#81887A] font-medium hover:underline"
                  >
                    View voucher {cancellationSettlement.compensationGiftVoucherId}
                  </Link>
                </dd>
              </div>
            ) : null}
            {cancellationSettlement?.reason ? (
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Reason</dt>
                <dd className="text-gray-900 whitespace-pre-wrap">{cancellationSettlement.reason}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

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
              {canCancel ? (
                <button
                  type="button"
                  onClick={openCancelModal}
                  className="px-3 py-2 text-sm rounded border border-red-200 text-red-700 hover:bg-red-50"
                >
                  Cancel reservation
                </button>
              ) : null}
              {showCompletedNotCancellableNote ? (
                <p className="w-full text-xs text-gray-500 mt-1">
                  Completed reservations cannot be cancelled from OPS.
                </p>
              ) : null}
              {canReassign ? (
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

          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Cleaning Notes</h3>
              <p className="mt-1 text-xs text-gray-500">
                Internal note for cleaning staff. Shown as a special request on the cleaning calendar.
              </p>
            </div>
            <textarea
              value={cleaningNotesDraft}
              onChange={(e) => setCleaningNotesDraft(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="e.g. Extra towels, late check-out cleaning, allergy note…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveCleaningNotes}
                disabled={cleaningNotesBusy}
                className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              >
                {cleaningNotesBusy ? 'Saving…' : 'Save cleaning notes'}
              </button>
              <span className="text-xs text-gray-400">{(cleaningNotesDraft || '').length}/1000</span>
              {cleaningNotesMsg ? <span className="text-xs text-emerald-700">{cleaningNotesMsg}</span> : null}
              {cleaningNotesError ? <span className="text-xs text-red-700">{cleaningNotesError}</span> : null}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="bg-white border border-violet-200 border-l-4 border-l-violet-500 rounded-xl p-4 space-y-4 max-w-2xl lg:max-w-none">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-violet-900">Guest message automation</h3>
                <p className="text-xs text-violet-800/90 mt-1 max-w-2xl">
                  Scheduled jobs can be cancelled from here. Dispatches and comms manual-review items are listed below.
                  Separate from legacy booking lifecycle email.
                </p>
              </div>
              <Link
                to="/ops/messaging"
                className="text-xs text-violet-800 underline underline-offset-2 shrink-0 self-start"
              >
                Global rules &amp; flags
              </Link>
            </div>
            {messagingLoading ? <p className="text-xs text-gray-500">Loading automation data…</p> : null}
            {messagingError ? <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">{messagingError}</div> : null}
            <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3 space-y-3 max-w-2xl">
              <h4 className="text-xs font-semibold text-violet-900 uppercase tracking-wide">Preview automation message</h4>
              <p className="text-xs text-violet-900/80 leading-relaxed">
                Compose-only preview using this booking&apos;s data and draft or approved templates. Nothing is sent.
              </p>
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-gray-700 min-w-0 flex-1 sm:max-w-xs">
                  <span className="font-medium">Automation rule</span>
                  <select
                    value={gmaPreviewRuleKey}
                    onChange={(e) => setGmaPreviewRuleKey(e.target.value)}
                    disabled={Boolean(gmaPreviewLoading)}
                    className="px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white"
                  >
                    {gmaPreviewRuleOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={Boolean(gmaPreviewLoading)}
                  onClick={() => void handleGmaPreview('email')}
                  className="text-xs px-3 py-1.5 rounded-md border border-violet-300 text-violet-900 bg-white hover:bg-violet-50 disabled:opacity-50"
                >
                  {gmaPreviewLoading === 'email' ? 'Loading…' : 'Preview GMA email'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(gmaPreviewLoading)}
                  onClick={() => void handleGmaPreview('whatsapp')}
                  className="text-xs px-3 py-1.5 rounded-md border border-violet-300 text-violet-900 bg-white hover:bg-violet-50 disabled:opacity-50"
                >
                  {gmaPreviewLoading === 'whatsapp' ? 'Loading…' : 'Preview GMA WhatsApp'}
                </button>
              </div>
              {gmaPreviewError ? (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">{gmaPreviewError}</div>
              ) : null}
            </div>
            {!messagingLoading && messagingSummary ? (
              <div className="space-y-4 text-xs text-gray-800">
                <div>
                  <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-2">Scheduled / recent jobs</h4>
                  {(messagingSummary.jobs || []).length === 0 ? (
                    <p className="text-gray-500">No jobs for this booking.</p>
                  ) : (
                    <ul className="space-y-2 max-h-48 overflow-y-auto">
                      {(messagingSummary.jobs || []).map((j) => (
                        <li
                          key={j.jobId}
                          className="border border-gray-100 rounded-md p-2 bg-gray-50/80 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900">{j.ruleKey}</div>
                            <div className="text-gray-600 mt-0.5">
                              {j.status}
                              {j.scheduledFor ? <span className="ml-2">{String(j.scheduledFor).slice(0, 16)}</span> : null}
                            </div>
                            {j.lastError ? <div className="text-red-700 mt-1">{j.lastError}</div> : null}
                          </div>
                          {j.status === 'scheduled' ? (
                            <button
                              type="button"
                              onClick={() =>
                                setMessagingCancelModal({ open: true, jobId: j.jobId, ruleKey: j.ruleKey || '' })
                              }
                              className="text-xs px-2 py-1 rounded border border-red-200 text-red-800 hover:bg-red-50 shrink-0 self-start"
                            >
                              Cancel job
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-2">Dispatch attempts</h4>
                  {(messagingSummary.dispatches || []).length === 0 ? (
                    <p className="text-gray-500">No dispatches recorded.</p>
                  ) : (
                    <ul className="space-y-2 max-h-56 overflow-y-auto">
                      {(messagingSummary.dispatches || []).map((d) => (
                        <li key={d.dispatchId} className="border border-gray-100 rounded-md p-2 bg-white">
                          <div className="font-medium text-gray-900">
                            {d.channel} · {d.status}
                          </div>
                          <div className="text-gray-600 mt-0.5">
                            Rule {d.ruleKey || '—'} · provider {d.providerName}
                          </div>
                          <div className="text-gray-500 mt-0.5">Recipient: {d.recipientMasked || '—'}</div>
                          <div className="text-gray-500 mt-0.5">
                            Delivery events: {d.deliveryEventCount ?? 0}
                            {d.latestDeliveryEvent?.eventType ? (
                              <span className="ml-1">
                                · latest {d.latestDeliveryEvent.eventType}{' '}
                                {d.latestDeliveryEvent.occurredAt
                                  ? `(${String(d.latestDeliveryEvent.occurredAt).slice(0, 19)})`
                                  : ''}
                              </span>
                            ) : null}
                          </div>
                          {d.error?.code ? (
                            <div className="text-red-700 mt-1 text-[11px]">{d.error.code}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-2">Open comms manual review</h4>
                  {(messagingSummary.manualReviewItems || []).length === 0 ? (
                    <p className="text-gray-500">No open comms-related items for this booking.</p>
                  ) : (
                    <ul className="space-y-2 max-h-40 overflow-y-auto">
                      {(messagingSummary.manualReviewItems || []).map((m) => (
                        <li key={m.manualReviewItemId} className="border border-amber-100 rounded-md p-2 bg-amber-50/50">
                          <div className="font-medium text-gray-900">{m.title}</div>
                          <div className="text-gray-600 mt-0.5">
                            {m.category} · {m.severity}
                          </div>
                          {m.details ? <div className="text-gray-700 mt-1 line-clamp-3">{m.details}</div> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-4 max-w-2xl lg:max-w-none">
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

      {messagingCancelModal.open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ops-messaging-cancel-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close cancel dialog"
            disabled={messagingCancelBusy}
            onClick={() => {
              if (!messagingCancelBusy) setMessagingCancelModal({ open: false, jobId: null, ruleKey: '' });
            }}
          />
          <div className="relative w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl p-5 space-y-4">
            <h2 id="ops-messaging-cancel-title" className="text-sm font-semibold text-gray-900">
              Cancel scheduled job?
            </h2>
            <p className="text-xs text-gray-600">
              Rule: <span className="font-medium text-gray-800">{messagingCancelModal.ruleKey || '—'}</span>
            </p>
            <p className="text-sm text-gray-700">
              This stops this scheduled automation job. It does not unsend messages already accepted by a provider.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={messagingCancelBusy}
                onClick={() => setMessagingCancelModal({ open: false, jobId: null, ruleKey: '' })}
                className="px-3 py-1.5 text-sm rounded border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={messagingCancelBusy}
                onClick={() => void confirmCancelMessagingJob()}
                className="px-3 py-1.5 text-sm rounded border border-red-300 bg-red-50 text-red-900 hover:bg-red-100 disabled:opacity-50"
              >
                {messagingCancelBusy ? 'Cancelling…' : 'Confirm cancel'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <OpsEmailPreviewModal
        open={gmaEmailPreviewModal.open}
        onClose={closeGmaEmailPreviewModal}
        titleId="ops-gma-email-preview-title"
        title="GMA email preview"
        metaLine={gmaEmailPreviewModal.ruleKey || ''}
        statusBadge={
          gmaEmailPreviewModal.templateStatus ? (
            <span className={`ml-2 ${gmaTemplateStatusBadge(gmaEmailPreviewModal.templateStatus)}`}>
              {gmaEmailPreviewModal.templateStatus}
            </span>
          ) : null
        }
        subject={gmaEmailPreviewModal.subject}
        html={gmaEmailPreviewModal.html}
        bannerText="GMA preview only. Nothing is sent."
        iframeTitle="GMA email HTML preview"
        previewKey={gmaEmailPreviewModal.previewKey}
      />

      <OpsWhatsappPreviewModal
        open={gmaWhatsappPreviewModal.open}
        onClose={closeGmaWhatsappPreviewModal}
        titleId="ops-gma-wa-preview-title"
        title="GMA WhatsApp preview"
        ruleKey={gmaWhatsappPreviewModal.ruleKey || ''}
        statusBadge={
          gmaWhatsappPreviewModal.templateStatus ? (
            <span className={`ml-2 ${gmaTemplateStatusBadge(gmaWhatsappPreviewModal.templateStatus)}`}>
              {gmaWhatsappPreviewModal.templateStatus}
            </span>
          ) : null
        }
        templateName={gmaWhatsappPreviewModal.templateName}
        locale={gmaWhatsappPreviewModal.locale}
        body={gmaWhatsappPreviewModal.body}
        variables={gmaWhatsappPreviewModal.variables}
      />

      <OpsEmailPreviewModal
        open={previewModal.open}
        onClose={closePreviewModal}
        titleId="ops-email-preview-title"
        title="Email preview"
        metaLine={TEMPLATE_LABELS[previewModal.templateKey] || previewModal.templateKey || ''}
        subject={previewModal.subject}
        html={previewModal.html}
        iframeTitle="Email HTML preview"
        previewKey={previewModal.previewKey}
        headerActions={
          <>
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
          </>
        }
      />

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

      {cancelOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-reservation-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close cancel reservation modal"
            onClick={() => {
              if (!cancelBusy) setCancelOpen(false);
            }}
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white border border-gray-200 shadow-xl p-5 space-y-4">
            <h3 id="cancel-reservation-title" className="text-base font-semibold text-gray-900">
              Cancel reservation
            </h3>
            <form onSubmit={submitCancelReservation} className="space-y-4">
              <div>
                <label htmlFor="cancelReason" className="block text-xs font-medium text-gray-500 mb-1">
                  Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="cancelReason"
                  required
                  maxLength={500}
                  rows={3}
                  value={cancelForm.reason}
                  onChange={(e) => setCancelForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="Why is this reservation being cancelled?"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                />
              </div>
              <fieldset>
                <legend className="block text-xs font-medium text-gray-500 mb-2">Settlement outcome</legend>
                <div className="space-y-2">
                  {SETTLEMENT_OUTCOME_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-start gap-2 text-sm text-gray-900 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="cancelSettlementOutcome"
                        value={option.value}
                        checked={cancelForm.outcome === option.value}
                        onChange={() =>
                          setCancelForm((prev) => ({
                            ...prev,
                            outcome: option.value,
                            creditAmountEuros:
                              option.value === 'credits_issued' ? prev.creditAmountEuros : '',
                            cashRefund:
                              option.value === 'cash_refund_pending' || option.value === 'cash_refunded'
                                ? prev.cashRefund
                                : { ...EMPTY_CASH_REFUND_FORM }
                          }))
                        }
                        className="mt-0.5"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {cancelForm.outcome === 'credits_issued' ? (
                <div>
                  <label htmlFor="cancelCreditEuros" className="block text-xs font-medium text-gray-500 mb-1">
                    Stay credit amount (EUR) <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="cancelCreditEuros"
                    type="text"
                    inputMode="decimal"
                    required
                    value={cancelForm.creditAmountEuros}
                    onChange={(e) =>
                      setCancelForm((prev) => ({ ...prev, creditAmountEuros: e.target.value }))
                    }
                    placeholder="e.g. 120"
                    className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                  />
                  <p className="mt-1 text-xs text-gray-500">Minimum €100. Amount is issued immediately.</p>
                </div>
              ) : null}
              {cancelForm.outcome === 'cash_refund_pending' ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="cancelCashRefundAmount" className="block text-xs font-medium text-gray-500 mb-1">
                      Refund amount (EUR)
                    </label>
                    <input
                      id="cancelCashRefundAmount"
                      type="text"
                      inputMode="decimal"
                      value={cancelForm.cashRefund.amountEuros}
                      onChange={(e) =>
                        setCancelForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, amountEuros: e.target.value }
                        }))
                      }
                      placeholder="e.g. 300"
                      className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                    <p className="mt-1 text-xs text-gray-500">Required when the booking has a recorded cash payment.</p>
                  </div>
                  <div>
                    <label htmlFor="cancelCashRefundNote" className="block text-xs font-medium text-gray-500 mb-1">
                      Note (optional)
                    </label>
                    <input
                      id="cancelCashRefundNote"
                      type="text"
                      value={cancelForm.cashRefund.note}
                      onChange={(e) =>
                        setCancelForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, note: e.target.value }
                        }))
                      }
                      placeholder="e.g. Refund via Stripe dashboard"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                </div>
              ) : null}
              {cancelForm.outcome === 'cash_refunded' ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="cancelCashRefundedAmount" className="block text-xs font-medium text-gray-500 mb-1">
                      Refund amount (EUR) <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="cancelCashRefundedAmount"
                      type="text"
                      inputMode="decimal"
                      required
                      value={cancelForm.cashRefund.amountEuros}
                      onChange={(e) =>
                        setCancelForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, amountEuros: e.target.value }
                        }))
                      }
                      placeholder="e.g. 300"
                      className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                  <div>
                    <label htmlFor="cancelCashRefundedMethod" className="block text-xs font-medium text-gray-500 mb-1">
                      Refund method <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="cancelCashRefundedMethod"
                      required
                      value={cancelForm.cashRefund.method}
                      onChange={(e) =>
                        setCancelForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, method: e.target.value }
                        }))
                      }
                      className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    >
                      {CASH_REFUND_METHOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cancelCashRefundedReference" className="block text-xs font-medium text-gray-500 mb-1">
                      Reference (optional)
                    </label>
                    <input
                      id="cancelCashRefundedReference"
                      type="text"
                      value={cancelForm.cashRefund.reference}
                      onChange={(e) =>
                        setCancelForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, reference: e.target.value }
                        }))
                      }
                      placeholder="e.g. Stripe refund ID"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                  <div>
                    <label htmlFor="cancelCashRefundedDate" className="block text-xs font-medium text-gray-500 mb-1">
                      Refunded date
                    </label>
                    <input
                      id="cancelCashRefundedDate"
                      type="date"
                      value={cancelForm.cashRefund.refundedDate}
                      onChange={(e) =>
                        setCancelForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, refundedDate: e.target.value }
                        }))
                      }
                      className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                  <div>
                    <label htmlFor="cancelCashRefundedNote" className="block text-xs font-medium text-gray-500 mb-1">
                      Refund note <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="cancelCashRefundedNote"
                      type="text"
                      required
                      value={cancelForm.cashRefund.note}
                      onChange={(e) =>
                        setCancelForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, note: e.target.value }
                        }))
                      }
                      placeholder="How was the refund completed?"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                </div>
              ) : null}
              <div
                className={`text-sm rounded-md px-3 py-2 border ${
                  cancelForm.outcome === 'credits_issued' ||
                  cancelForm.outcome === 'cash_refund_pending' ||
                  cancelForm.outcome === 'cash_refunded'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-gray-50 border-gray-200 text-gray-700'
                }`}
                role="note"
              >
                {SETTLEMENT_WARNINGS[cancelForm.outcome]}
              </div>
              {cancelError ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {cancelError}
                </div>
              ) : null}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={cancelBusy}
                  onClick={() => setCancelOpen(false)}
                  className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={cancelBusy}
                  className="px-3 py-2 text-sm rounded bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {cancelBusy ? 'Cancelling…' : 'Confirm cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {resolveOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resolve-settlement-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close resolve settlement modal"
            onClick={() => {
              if (!resolveBusy) setResolveOpen(false);
            }}
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white border border-gray-200 shadow-xl p-5 space-y-4">
            <h3 id="resolve-settlement-title" className="text-base font-semibold text-gray-900">
              {resolveModalMode === 'mark_refunded'
                ? 'Mark cash refund as paid'
                : 'Resolve cancellation settlement'}
            </h3>
            <form onSubmit={submitResolveSettlement} className="space-y-4">
              <div>
                <label htmlFor="resolveReason" className="block text-xs font-medium text-gray-500 mb-1">
                  Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="resolveReason"
                  required
                  maxLength={500}
                  rows={3}
                  value={resolveForm.reason}
                  onChange={(e) => setResolveForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder={
                    resolveModalMode === 'mark_refunded'
                      ? 'Why is this refund being recorded as completed?'
                      : 'Why is this settlement being resolved?'
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                />
              </div>
              {resolveModalMode === 'settlement' ? (
              <fieldset>
                <legend className="block text-xs font-medium text-gray-500 mb-2">Settlement outcome</legend>
                <div className="space-y-2">
                  {RESOLVE_SETTLEMENT_OUTCOME_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-start gap-2 text-sm text-gray-900 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="resolveSettlementOutcome"
                        value={option.value}
                        checked={resolveForm.outcome === option.value}
                        onChange={() =>
                          setResolveForm((prev) => ({
                            ...prev,
                            outcome: option.value,
                            creditAmountEuros:
                              option.value === 'credits_issued' ? prev.creditAmountEuros : '',
                            cashRefund:
                              option.value === 'cash_refund_pending' || option.value === 'cash_refunded'
                                ? prev.cashRefund
                                : { ...EMPTY_CASH_REFUND_FORM }
                          }))
                        }
                        className="mt-0.5"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              ) : null}
              {resolveModalMode === 'settlement' && resolveForm.outcome === 'credits_issued' ? (
                <div>
                  <label htmlFor="resolveCreditEuros" className="block text-xs font-medium text-gray-500 mb-1">
                    Stay credit amount (EUR) <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="resolveCreditEuros"
                    type="text"
                    inputMode="decimal"
                    required
                    value={resolveForm.creditAmountEuros}
                    onChange={(e) =>
                      setResolveForm((prev) => ({ ...prev, creditAmountEuros: e.target.value }))
                    }
                    placeholder="e.g. 120"
                    className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                  />
                  <p className="mt-1 text-xs text-gray-500">Minimum €100. Amount is issued immediately.</p>
                </div>
              ) : null}
              {resolveModalMode === 'settlement' && resolveForm.outcome === 'cash_refund_pending' ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="resolveCashRefundAmount" className="block text-xs font-medium text-gray-500 mb-1">
                      Refund amount (EUR)
                    </label>
                    <input
                      id="resolveCashRefundAmount"
                      type="text"
                      inputMode="decimal"
                      value={resolveForm.cashRefund.amountEuros}
                      onChange={(e) =>
                        setResolveForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, amountEuros: e.target.value }
                        }))
                      }
                      placeholder="e.g. 300"
                      className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                  <div>
                    <label htmlFor="resolveCashRefundNote" className="block text-xs font-medium text-gray-500 mb-1">
                      Note (optional)
                    </label>
                    <input
                      id="resolveCashRefundNote"
                      type="text"
                      value={resolveForm.cashRefund.note}
                      onChange={(e) =>
                        setResolveForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, note: e.target.value }
                        }))
                      }
                      placeholder="e.g. Refund via Stripe dashboard"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                </div>
              ) : null}
              {(resolveModalMode === 'mark_refunded' ||
                (resolveModalMode === 'settlement' && resolveForm.outcome === 'cash_refunded')) ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="resolveCashRefundedAmount" className="block text-xs font-medium text-gray-500 mb-1">
                      Refund amount (EUR) <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="resolveCashRefundedAmount"
                      type="text"
                      inputMode="decimal"
                      required
                      value={resolveForm.cashRefund.amountEuros}
                      onChange={(e) =>
                        setResolveForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, amountEuros: e.target.value }
                        }))
                      }
                      placeholder="e.g. 300"
                      className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                  <div>
                    <label htmlFor="resolveCashRefundedMethod" className="block text-xs font-medium text-gray-500 mb-1">
                      Refund method <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="resolveCashRefundedMethod"
                      required
                      value={resolveForm.cashRefund.method}
                      onChange={(e) =>
                        setResolveForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, method: e.target.value }
                        }))
                      }
                      className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    >
                      {CASH_REFUND_METHOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="resolveCashRefundedReference" className="block text-xs font-medium text-gray-500 mb-1">
                      Reference (optional)
                    </label>
                    <input
                      id="resolveCashRefundedReference"
                      type="text"
                      value={resolveForm.cashRefund.reference}
                      onChange={(e) =>
                        setResolveForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, reference: e.target.value }
                        }))
                      }
                      placeholder="e.g. Stripe refund ID"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                  <div>
                    <label htmlFor="resolveCashRefundedDate" className="block text-xs font-medium text-gray-500 mb-1">
                      Refunded date
                    </label>
                    <input
                      id="resolveCashRefundedDate"
                      type="date"
                      value={resolveForm.cashRefund.refundedDate}
                      onChange={(e) =>
                        setResolveForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, refundedDate: e.target.value }
                        }))
                      }
                      className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                  <div>
                    <label htmlFor="resolveCashRefundedNote" className="block text-xs font-medium text-gray-500 mb-1">
                      Refund note <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="resolveCashRefundedNote"
                      type="text"
                      required
                      value={resolveForm.cashRefund.note}
                      onChange={(e) =>
                        setResolveForm((prev) => ({
                          ...prev,
                          cashRefund: { ...prev.cashRefund, note: e.target.value }
                        }))
                      }
                      placeholder="How was the refund completed?"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
                    />
                  </div>
                </div>
              ) : null}
              <div
                className={`text-sm rounded-md px-3 py-2 border ${
                  resolveModalMode === 'mark_refunded' ||
                  resolveForm.outcome === 'credits_issued' ||
                  resolveForm.outcome === 'cash_refund_pending' ||
                  resolveForm.outcome === 'cash_refunded'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-gray-50 border-gray-200 text-gray-700'
                }`}
                role="note"
              >
                {resolveModalMode === 'mark_refunded'
                  ? SETTLEMENT_WARNINGS.cash_refunded
                  : SETTLEMENT_WARNINGS[resolveForm.outcome]}
              </div>
              {resolveError ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {resolveError}
                </div>
              ) : null}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={resolveBusy}
                  onClick={() => setResolveOpen(false)}
                  className="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={resolveBusy}
                  className="px-3 py-2 text-sm rounded bg-[#81887A] text-white hover:bg-[#6d7366] disabled:opacity-50"
                >
                  {resolveBusy
                    ? 'Saving…'
                    : resolveModalMode === 'mark_refunded'
                      ? 'Mark as refunded'
                      : 'Resolve settlement'}
                </button>
              </div>
            </form>
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
