import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { opsWriteAPI, opsReadAPI } from '../../services/opsApi';
import api from '../../services/api';
import { useOpsSession } from '../../context/OpsSessionContext';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import { OpsEmailPreviewModal } from './components/OpsEmailPreviewModal';
import { OpsWhatsappPreviewModal } from './components/OpsWhatsappPreviewModal';
import MoveUnitDialog from './components/MoveUnitDialog';
import { buildGmaPreviewRuleOptions } from '../../../../shared/messaging/gmaPreviewRules.js';
import {
  canCancelReservation,
  canMarkCashRefunded,
  canShowLegacyReassign,
  canMoveUnit,
  canResolveCancellationSettlement,
  showCompletedNotCancellableMessage
} from './utils/opsReservationPermissions';
import {
  manualReservationPurposeLabel,
  guestConfirmationEmailPolicyLabel
} from '../../utils/manualReservationPurpose';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsTextarea from '../../ops/primitives/OpsTextarea';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsInlineError from '../../ops/primitives/OpsInlineError';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBadge from '../../ops/primitives/OpsBadge';
import OpsModal from '../../ops/primitives/OpsModal';
import OpsConfirmDialog from '../../ops/primitives/OpsConfirmDialog';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import { resolveOpsStatus } from '../../ops/status/opsStatusRegistry';
import './OpsReservationDetail.css';

const MIN_STAY_CREDIT_CENTS = 10000;
const BACK = { to: '/ops/reservations', label: 'Reservations' };

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

function paymentOpsValue(status) {
  if (!status) return 'unknown';
  if (status === 'unlinked_payment') return 'unlinked';
  return status;
}

function resolveEffectiveRecipient(overrideInput, guestEmail) {
  const trimmed = (overrideInput || '').trim();
  if (trimmed) return trimmed;
  return (guestEmail || '').trim() || '';
}

function operationalItems(detail) {
  const items = [];
  const timing = detail?.operational?.stayTiming || {};
  const daysUntilCheckIn = Number.isFinite(timing.daysUntilCheckIn) ? timing.daysUntilCheckIn : null;
  const reservationStatus = detail?.reservation?.reservationStatus || '';
  if (reservationStatus !== 'cancelled') {
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
  if (timing.checkingOutToday && reservationStatus !== 'cancelled') {
    items.push({ key: 'checking_out_today' });
  }
  if (detail?.operational?.cancelledPaid) items.push({ key: 'cancelled_paid' });
  if (detail?.operational?.refundPending) items.push({ key: 'refund_pending' });
  if (detail?.operational?.paymentAttention) items.push({ key: 'payment_attention' });
  if (detail?.conflictContext?.hasHardConflict || detail?.conflict?.hasConflict) {
    items.push({ key: 'conflict' });
  }
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

function DetailHeader({ title, description, meta, actions }) {
  return (
    <OpsPageHeader back={BACK} title={title} description={description} meta={meta} actions={actions} />
  );
}

function Fact({ label, children, wide = false, numeric = false }) {
  return (
    <div className={`ops-rd-fact${wide ? ' ops-rd-fact--wide' : ''}`}>
      <dt className="ops-rd-fact__label">{label}</dt>
      <dd className={`ops-rd-fact__value${numeric ? ' ops-rd-fact__value--numeric' : ''}`}>{children}</dd>
    </div>
  );
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
  const [moveUnitOpen, setMoveUnitOpen] = useState(false);

  const [lifecycleConfirm, setLifecycleConfirm] = useState(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignCabinId, setReassignCabinId] = useState('');
  const [blockModal, setBlockModal] = useState(null);


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
    setLifecycleConfirm({
      kind: 'resend',
      templateKey,
      label,
      effective,
      usingOverride: Boolean((overrideRecipient || '').trim()),
      subjectLine,
      bodyText: `Send "${label}" now?\n\nTo: ${effective}${(overrideRecipient || '').trim() ? '\n(using override address)' : '\n(guest email on file)'}${subjectLine}\n\nUses template defaults (not the edit-before-send path).`
    });
  };

  const executeResendTemplate = async (templateKey) => {
    const guestEmail = (guestDraft?.email || data?.reservation?.guest?.email || '').trim();
    const effective = resolveEffectiveRecipient(overrideRecipient, guestEmail);
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
    setLifecycleConfirm({
      kind: 'editResend',
      templateKey: editResendModal.templateKey,
      label,
      effective,
      usingOverride: Boolean((overrideRecipient || '').trim()),
      subjectTrim,
      bodyText: `Send edited "${label}"?\n\nTo: ${effective}${(overrideRecipient || '').trim() ? '\n(using override address)' : '\n(guest email on file)'}\n\nSubject: ${subjectTrim}`
    });
  };

  const executeEditedResend = async () => {
    const guestEmail = (guestDraft?.email || data?.reservation?.guest?.email || '').trim();
    const effective = resolveEffectiveRecipient(overrideRecipient, guestEmail);
    const subjectTrim = (editResendModal.subject || '').trim();
    const htmlRaw = editResendModal.html || '';
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


  const confirmLifecycleSend = async () => {
    const pending = lifecycleConfirm;
    setLifecycleConfirm(null);
    if (!pending) return;
    if (pending.kind === 'resend') {
      await executeResendTemplate(pending.templateKey);
      return;
    }
    if (pending.kind === 'editResend') {
      await executeEditedResend();
    }
  };

  const submitReassign = async () => {
    const toCabinId = (reassignCabinId || '').trim();
    if (!toCabinId) return;
    setReassignOpen(false);
    setReassignCabinId('');
    await doAction(opsWriteAPI.reassignReservation, id, {
      toCabinId,
      acceptExternalHoldWarnings: true,
      reason: 'ops_reassign'
    });
  };

  const submitBlockModal = async () => {
    if (!blockModal) return;
    const startDate = (blockModal.startDate || '').trim();
    const endDate = (blockModal.endDate || '').trim();
    if (!startDate || !endDate) return;
    const cabinId = data?.reservation?.cabinId;
    const payload = {
      cabinId,
      startDate,
      endDate,
      reason: 'reservation_detail'
    };
    const kind = blockModal.kind;
    setBlockModal(null);
    if (kind === 'manual') {
      await doAction(opsWriteAPI.createManualBlock, payload);
      return;
    }
    await doAction(opsWriteAPI.createMaintenanceBlock, payload);
  };

  const headerTitle = data?.reservation?.reservationId
    ? `Reservation ${data.reservation.reservationId}`
    : 'Reservation';

  const renderStatusCluster = (detail) => {
    if (!detail) return null;
    const reservation = detail.reservation || {};
    const paymentStatus =
      reservation.paymentStatus ||
      detail.paymentStatus ||
      detail.paymentTrail?.[0]?.status ||
      null;
    const source = reservation.source || detail.source || null;
    const purpose = reservation.manualReservationPurpose || detail.manualReservationPurpose || null;
    const sendGuestConfirmationEmail =
      reservation.sendGuestConfirmationEmail === true || reservation.sendGuestConfirmationEmail === false
        ? reservation.sendGuestConfirmationEmail
        : detail.sendGuestConfirmationEmail === true || detail.sendGuestConfirmationEmail === false
          ? detail.sendGuestConfirmationEmail
          : null;
    const items = operationalItems(detail);

    return (
      <div className="ops-rd-status" data-testid="ops-rd-status-cluster">
        <OpsStatus domain="reservation" value={reservation.reservationStatus || 'unknown'} />
        {paymentStatus ? <OpsStatus domain="payment" value={paymentOpsValue(paymentStatus)} /> : null}
        {items.map((item) =>
          item.key === 'arriving_later' ? (
            <ArrivingLaterStatus key={item.key} days={item.days} />
          ) : (
            <OpsStatus key={item.key} domain="reservation" value={item.key} />
          )
        )}
        {source ? <OpsBadge>{source}</OpsBadge> : null}
        {purpose ? <OpsBadge>{manualReservationPurposeLabel(purpose)}</OpsBadge> : null}
        {sendGuestConfirmationEmail != null ? (
          <OpsBadge tone={sendGuestConfirmationEmail ? 'info' : 'neutral'}>
            {guestConfirmationEmailPolicyLabel(sendGuestConfirmationEmail)}
          </OpsBadge>
        ) : null}
      </div>
    );
  };

  if (loading) {
    return (
      <OpsPage width="wide">
        <div className="ops-rd">
          <DetailHeader title="Reservation" />
          <OpsLoadingState label="Loading reservation…" />
        </div>
      </OpsPage>
    );
  }

  if (error && !data) {
    return (
      <OpsPage width="wide">
        <div className="ops-rd">
          <DetailHeader title="Reservation" />
          <OpsBanner tone="danger" title={error} />
        </div>
      </OpsPage>
    );
  }

  if (!data) {
    return (
      <OpsPage width="wide">
        <div className="ops-rd">
          <DetailHeader title="Reservation" />
          <OpsEmptyState title="Reservation not found." />
        </div>
      </OpsPage>
    );
  }

  const reservation = data.reservation || {};
  const cancellationSettlement = data.cancellationSettlement || null;
  const reservationStatus = reservation.reservationStatus || '';
  const cabinSummary = data.cabinSummary || null;
  const canCancel = canCancelReservation(session, reservationStatus);
  const canShowReassign = canShowLegacyReassign(session, cabinSummary, reservation);
  const canShowMoveUnit = canMoveUnit(session, reservationStatus, cabinSummary, reservation);
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

  const guestName = `${guestDraft?.firstName || reservation.guest?.firstName || ''} ${
    guestDraft?.lastName || reservation.guest?.lastName || ''
  }`.trim();
  const cabinLabel =
    cabinSummary?.displayName ||
    [cabinSummary?.name, cabinSummary?.unitLabel].filter(Boolean).join(' · ') ||
    null;
  const datesLabel = `${reservation.checkInDateOnly || '—'} - ${reservation.checkOutDateOnly || '—'}`;

  const headerMeta = (
    <div className="ops-rd-header-meta">
      <p className="ops-rd-header-meta__line">{datesLabel}</p>
      {cabinLabel ? <p className="ops-rd-header-meta__cabin">{cabinLabel}</p> : null}
      {guestName ? <p className="ops-rd-header-meta__guest">{guestName}</p> : null}
      {renderStatusCluster(data)}
    </div>
  );

  return (
    <OpsPage width="wide">
      <div className="ops-rd">
        <DetailHeader title={headerTitle} meta={headerMeta} />

        <div className="ops-rd-banners">
          {error ? <OpsBanner tone="danger" title={error} /> : null}
          {successMessage ? <OpsBanner tone="success" title={successMessage} /> : null}
          {data.conflictContext?.hasHardConflict || data.conflict?.hasConflict ? (
            <OpsBanner tone="danger" title="Hard availability conflict on this reservation." />
          ) : null}
          {data.operational?.paymentAttention ? (
            <OpsBanner tone="warning" title="Payment attention required for this reservation." />
          ) : null}
          {data.operational?.refundPending && !showSettlementCard ? (
            <OpsBanner tone="warning" title="Refund pending for this reservation." />
          ) : null}
          {data.operational?.cancelledPaid && !showSettlementCard ? (
            <OpsBanner tone="warning" title="Cancelled reservation still shows as paid." />
          ) : null}
        </div>

        {showSettlementCard ? (
          <section className="ops-rd-surface ops-rd-surface--warn">
            <div className="ops-rd-surface__head">
              <h2 className="ops-rd-surface__title">Cancellation settlement</h2>
              <div className="ops-rd-actions">
                {canResolveSettlement ? (
                  <OpsButton variant="secondary" onClick={openResolveModal}>
                    Resolve settlement
                  </OpsButton>
                ) : null}
                {canMarkCashRefundedSettlement ? (
                  <OpsButton variant="secondary" onClick={openMarkRefundedModal}>
                    Mark as refunded
                  </OpsButton>
                ) : null}
              </div>
            </div>
            {canResolveSettlement ? (
              <OpsBanner
                tone="warning"
                title="Refund follow-up stays active until this settlement is resolved."
              />
            ) : null}
            {canMarkCashRefundedSettlement ? (
              <OpsBanner
                tone="warning"
                title="Manual cash refund is still required. Mark as refunded once completed."
              />
            ) : null}
            <dl className="ops-rd-facts">
              <Fact label="Outcome">{displayedSettlementOutcome}</Fact>
              {cancellationSettlement?.creditAmountCents != null ? (
                <Fact label="Stay credit amount" numeric>
                  {formatMoneyFromCents(cancellationSettlement.creditAmountCents, 'EUR')}
                </Fact>
              ) : null}
              {cancellationSettlement?.cashRefundAmountCents != null ? (
                <Fact label="Cash refund amount" numeric>
                  {formatMoneyFromCents(cancellationSettlement.cashRefundAmountCents, 'EUR')}
                </Fact>
              ) : null}
              {cancellationSettlement?.cashRefundEvidence?.method ? (
                <Fact label="Refund method">
                  {cashRefundMethodLabel(cancellationSettlement.cashRefundEvidence.method)}
                </Fact>
              ) : null}
              {cancellationSettlement?.cashRefundEvidence?.reference ? (
                <Fact label="Refund reference">{cancellationSettlement.cashRefundEvidence.reference}</Fact>
              ) : null}
              {cancellationSettlement?.cashRefundEvidence?.recordedAt ? (
                <Fact label="Refunded at">
                  {String(cancellationSettlement.cashRefundEvidence.recordedAt).slice(0, 19).replace('T', ' ')}
                </Fact>
              ) : null}
              {cancellationSettlement?.cashRefundNote ? (
                <Fact label="Cash refund note" wide>
                  {cancellationSettlement.cashRefundNote}
                </Fact>
              ) : null}
              {cancellationSettlement?.settlementRecordedAt ? (
                <Fact label="Recorded at">
                  {String(cancellationSettlement.settlementRecordedAt).slice(0, 19).replace('T', ' ')}
                </Fact>
              ) : null}
              {cancellationSettlement?.compensationGiftVoucherId ? (
                <Fact label="Compensation voucher" wide>
                  <Link
                    to={`/ops/gift-vouchers/${cancellationSettlement.compensationGiftVoucherId}`}
                    className="ops-rd-link"
                  >
                    View voucher {cancellationSettlement.compensationGiftVoucherId}
                  </Link>
                </Fact>
              ) : null}
              {cancellationSettlement?.reason ? (
                <Fact label="Reason" wide>
                  {cancellationSettlement.reason}
                </Fact>
              ) : null}
            </dl>
          </section>
        ) : null}

        {data.splitPayment ? (
          <section className="ops-rd-surface" data-testid="ops-split-payment-panel">
            <div className="ops-rd-surface__head">
              <h2 className="ops-rd-surface__title">Split payment</h2>
            </div>
            <dl className="ops-rd-facts">
              <Fact label="Settlement">{data.splitPayment.paymentSettlementStatus || '—'}</Fact>
              <Fact label="Choice">{data.splitPayment.paymentChoice || '—'}</Fact>
              <Fact label="Total" numeric>
                {formatMoneyFromCents(data.splitPayment.totalCents, 'EUR')}
              </Fact>
              <Fact label="Paid" numeric>
                {formatMoneyFromCents(data.splitPayment.paidCents, 'EUR')}
              </Fact>
              <Fact label="Remaining" numeric>
                {formatMoneyFromCents(data.splitPayment.remainingCents, 'EUR')}
              </Fact>
              <Fact label="Date transfers">
                {data.splitPayment.dateTransferCount || 0}
                {data.splitPayment.allowDateTransfer ? '' : ' (not permitted)'}
              </Fact>
            </dl>
            {data.splitPayment.cancellationReview ? (
              <div className="ops-rd-note" data-testid="ops-split-cancellation-review">
                <p>
                  Payment-failure review: {data.splitPayment.cancellationReview.status}
                  {data.splitPayment.cancellationReview.installmentSequence
                    ? ` (installment #${data.splitPayment.cancellationReview.installmentSequence})`
                    : ''}
                </p>
                {data.splitPayment.cancellationReview.status === 'open' ? (
                  <>
                    <p className="text-sm opacity-80">
                      Resolve review does not cancel the booking. Use authorized Cancel to settle.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <OpsButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          try {
                            await opsWriteAPI.resolveCancellationReview(id, {
                              note: 'Resolved from Ops split payment panel'
                            });
                            await load();
                          } catch (e) {
                            setError(e?.response?.data?.error?.message || e.message || 'Resolve failed');
                          }
                        }}
                      >
                        Resolve review
                      </OpsButton>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="ops-rd-table-wrap">
              <table className="ops-rd-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Amount</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th>Invoice</th>
                    <th>Retry</th>
                    <th>Grace</th>
                    <th>Recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.splitPayment.installments || []).map((row) => (
                    <tr key={row.sequence}>
                      <td>{row.sequence}</td>
                      <td>{formatMoneyFromCents(row.amountCents, row.currency || 'EUR')}</td>
                      <td>{row.dueAtDateOnly || '—'}</td>
                      <td>{row.status}</td>
                      <td>{row.stripeInvoiceStatus || '—'}</td>
                      <td>
                        {row.nextPaymentAttemptAt
                          ? String(row.nextPaymentAttemptAt).slice(0, 16).replace('T', ' ')
                          : '—'}
                      </td>
                      <td>
                        {row.graceEndsAt
                          ? String(row.graceEndsAt).slice(0, 16).replace('T', ' ')
                          : '—'}
                      </td>
                      <td>
                        {row.hostedInvoiceUrl ? (
                          <a
                            href={row.hostedInvoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ops-rd-link"
                          >
                            Hosted invoice
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(data.splitPayment.stayCreditsIssued || []).length ? (
              <div className="ops-rd-note">
                <p>Stay credits issued:</p>
                <ul>
                  {data.splitPayment.stayCreditsIssued.map((c) => (
                    <li key={c.code}>
                      {c.code} — {formatMoneyFromCents(c.issuedCents, 'EUR')} ({c.status})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="ops-rd-layout">
          <div className="ops-rd-main">
            <section className="ops-rd-surface">
              <h2 className="ops-rd-surface__title">Reservation actions</h2>
              <div className="ops-rd-actions">
                <OpsButton
                  variant="secondary"
                  onClick={() => doAction(opsWriteAPI.confirmReservation, id)}
                >
                  Confirm
                </OpsButton>
                <OpsButton
                  variant="secondary"
                  onClick={() => doAction(opsWriteAPI.checkInReservation, id)}
                >
                  Check-in
                </OpsButton>
                <OpsButton
                  variant="secondary"
                  onClick={() => doAction(opsWriteAPI.completeReservation, id)}
                >
                  Complete
                </OpsButton>
                <OpsButton variant="secondary" onClick={openEditDatesModal}>
                  Edit dates
                </OpsButton>
                {canCancel ? (
                  <OpsButton variant="destructive" onClick={openCancelModal}>
                    Cancel reservation
                  </OpsButton>
                ) : null}
                {canShowMoveUnit ? (
                  <OpsButton variant="secondary" onClick={() => setMoveUnitOpen(true)}>
                    Move Unit
                  </OpsButton>
                ) : null}
                {canShowReassign ? (
                  <OpsButton
                    variant="secondary"
                    onClick={() => {
                      setReassignCabinId('');
                      setReassignOpen(true);
                    }}
                  >
                    Reassign
                  </OpsButton>
                ) : null}
              </div>
              {showCompletedNotCancellableNote ? (
                <p className="ops-rd-note">Completed reservations cannot be cancelled from OPS.</p>
              ) : null}
            </section>

            <section className="ops-rd-surface">
              <h2 className="ops-rd-surface__title">Guest detail</h2>
              <div className="ops-rd-field-grid">
                <OpsTextField
                  label="First name"
                  value={guestDraft?.firstName || ''}
                  onChange={(e) => setGuestDraft((p) => ({ ...p, firstName: e.target.value }))}
                />
                <OpsTextField
                  label="Last name"
                  value={guestDraft?.lastName || ''}
                  onChange={(e) => setGuestDraft((p) => ({ ...p, lastName: e.target.value }))}
                />
                <OpsTextField
                  label="Email"
                  value={guestDraft?.email || ''}
                  onChange={(e) => setGuestDraft((p) => ({ ...p, email: e.target.value }))}
                />
                <OpsTextField
                  label="Phone"
                  value={guestDraft?.phone || ''}
                  onChange={(e) => setGuestDraft((p) => ({ ...p, phone: e.target.value }))}
                />
              </div>
              <div className="ops-rd-actions">
                <OpsButton
                  variant="secondary"
                  onClick={() =>
                    doAction(opsWriteAPI.editGuestContact, id, {
                      firstName: guestDraft?.firstName,
                      lastName: guestDraft?.lastName,
                      email: guestDraft?.email,
                      phone: guestDraft?.phone
                    })
                  }
                >
                  Save guest contact
                </OpsButton>
              </div>
            </section>

            <section className="ops-rd-surface">
              <h2 className="ops-rd-surface__title">Notes</h2>
              <div className="ops-rd-field-row">
                <OpsTextField
                  label="Add reservation note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add reservation note"
                />
                <OpsButton
                  variant="secondary"
                  onClick={async () => {
                    if (!note.trim()) return;
                    await doAction(opsWriteAPI.addReservationNote, id, note.trim());
                    setNote('');
                  }}
                >
                  Add
                </OpsButton>
              </div>
              <div className="ops-rd-notes">
                {(data.notes?.items || []).map((n) => (
                  <div key={n.noteId} className="ops-rd-note-item">
                    <p className="ops-rd-note-item__body">{n.content}</p>
                    <p className="ops-rd-note-item__meta">
                      {n.author?.actorId} - {String(n.createdAt).slice(0, 19)}
                    </p>
                  </div>
                ))}
                {(data.notes?.items || []).length === 0 ? (
                  <p className="ops-rd-note">No notes yet.</p>
                ) : null}
              </div>
            </section>

            <section className="ops-rd-surface">
              <div>
                <h2 className="ops-rd-surface__title">Cleaning Notes</h2>
                <p className="ops-rd-surface__subtitle">
                  Internal note for cleaning staff. Shown as a special request on the cleaning calendar.
                </p>
              </div>
              <OpsTextarea
                label="Cleaning notes"
                value={cleaningNotesDraft}
                onChange={(e) => setCleaningNotesDraft(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="e.g. Extra towels, late check-out cleaning, allergy note…"
              />
              <div className="ops-rd-actions">
                <OpsButton
                  variant="secondary"
                  loading={cleaningNotesBusy}
                  loadingLabel="Saving…"
                  onClick={saveCleaningNotes}
                >
                  Save cleaning notes
                </OpsButton>
                <p className="ops-rd-char-count">{(cleaningNotesDraft || '').length}/1000</p>
              </div>
              {cleaningNotesMsg ? <OpsBanner tone="success" title={cleaningNotesMsg} /> : null}
              {cleaningNotesError ? <OpsInlineError>{cleaningNotesError}</OpsInlineError> : null}
            </section>
          </div>

          <div className="ops-rd-aside">
            <section className="ops-rd-surface">
              <div className="ops-rd-surface__head">
                <div>
                  <h2 className="ops-rd-surface__title">Guest message automation</h2>
                  <p className="ops-rd-surface__subtitle">
                    Scheduled jobs can be cancelled from here. Dispatches and comms manual-review items are
                    listed below. Separate from legacy booking lifecycle email.
                  </p>
                </div>
                <Link to="/ops/messaging" className="ops-rd-link">
                  Global rules &amp; flags
                </Link>
              </div>
              {messagingLoading ? <OpsLoadingState label="Loading automation data…" /> : null}
              {messagingError ? <OpsInlineError>{messagingError}</OpsInlineError> : null}

              <div className="ops-rd-surface">
                <h3 className="ops-rd-section-title">Preview automation message</h3>
                <p className="ops-rd-note">
                  Compose-only preview using this booking&apos;s data and draft or approved templates. Nothing
                  is sent.
                </p>
                <OpsSelect
                  label="Automation rule"
                  value={gmaPreviewRuleKey}
                  onChange={(e) => setGmaPreviewRuleKey(e.target.value)}
                  disabled={Boolean(gmaPreviewLoading)}
                >
                  {gmaPreviewRuleOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </OpsSelect>
                <div className="ops-rd-actions">
                  <OpsButton
                    variant="secondary"
                    size="compact"
                    loading={gmaPreviewLoading === 'email'}
                    loadingLabel="Loading…"
                    disabled={Boolean(gmaPreviewLoading)}
                    onClick={() => void handleGmaPreview('email')}
                  >
                    Preview GMA email
                  </OpsButton>
                  <OpsButton
                    variant="secondary"
                    size="compact"
                    loading={gmaPreviewLoading === 'whatsapp'}
                    loadingLabel="Loading…"
                    disabled={Boolean(gmaPreviewLoading)}
                    onClick={() => void handleGmaPreview('whatsapp')}
                  >
                    Preview GMA WhatsApp
                  </OpsButton>
                </div>
                {gmaPreviewError ? <OpsInlineError>{gmaPreviewError}</OpsInlineError> : null}
              </div>

              {!messagingLoading && messagingSummary ? (
                <>
                  <div>
                    <h3 className="ops-rd-section-title">Scheduled / recent jobs</h3>
                    {(messagingSummary.jobs || []).length === 0 ? (
                      <p className="ops-rd-note">No jobs for this booking.</p>
                    ) : (
                      <ul className="ops-rd-scroll-list ops-rd-scroll-list--sm">
                        {(messagingSummary.jobs || []).map((j) => (
                          <li key={j.jobId} className="ops-rd-list-item">
                            <div className="ops-rd-list-item__row">
                              <div>
                                <p className="ops-rd-list-item__title">{j.ruleKey}</p>
                                <p className="ops-rd-list-item__meta">
                                  {j.status}
                                  {j.scheduledFor ? (
                                    <span> {String(j.scheduledFor).slice(0, 16)}</span>
                                  ) : null}
                                </p>
                                {j.lastError ? (
                                  <p className="ops-rd-list-item__danger">{j.lastError}</p>
                                ) : null}
                              </div>
                              {j.status === 'scheduled' ? (
                                <OpsButton
                                  variant="destructive"
                                  size="compact"
                                  onClick={() =>
                                    setMessagingCancelModal({
                                      open: true,
                                      jobId: j.jobId,
                                      ruleKey: j.ruleKey || ''
                                    })
                                  }
                                >
                                  Cancel job
                                </OpsButton>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className="ops-rd-section-title">Dispatch attempts</h3>
                    {(messagingSummary.dispatches || []).length === 0 ? (
                      <p className="ops-rd-note">No dispatches recorded.</p>
                    ) : (
                      <ul className="ops-rd-scroll-list ops-rd-scroll-list--md">
                        {(messagingSummary.dispatches || []).map((d) => (
                          <li key={d.dispatchId} className="ops-rd-list-item">
                            <p className="ops-rd-list-item__title">
                              {d.channel} · {d.status}
                            </p>
                            <p className="ops-rd-list-item__meta">
                              Rule {d.ruleKey || '—'} · provider {d.providerName}
                            </p>
                            <p className="ops-rd-list-item__muted">
                              Recipient: {d.recipientMasked || '—'}
                            </p>
                            <p className="ops-rd-list-item__muted">
                              Delivery events: {d.deliveryEventCount ?? 0}
                              {d.latestDeliveryEvent?.eventType ? (
                                <span>
                                  {' '}
                                  · latest {d.latestDeliveryEvent.eventType}{' '}
                                  {d.latestDeliveryEvent.occurredAt
                                    ? `(${String(d.latestDeliveryEvent.occurredAt).slice(0, 19)})`
                                    : ''}
                                </span>
                              ) : null}
                            </p>
                            {d.error?.code ? (
                              <p className="ops-rd-list-item__danger">{d.error.code}</p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className="ops-rd-section-title">Open comms manual review</h3>
                    {(messagingSummary.manualReviewItems || []).length === 0 ? (
                      <p className="ops-rd-note">No open comms-related items for this booking.</p>
                    ) : (
                      <ul className="ops-rd-scroll-list ops-rd-scroll-list--sm">
                        {(messagingSummary.manualReviewItems || []).map((m) => (
                          <li key={m.manualReviewItemId} className="ops-rd-list-item">
                            <p className="ops-rd-list-item__title">{m.title}</p>
                            <p className="ops-rd-list-item__meta">
                              {m.category} · {m.severity}
                            </p>
                            {m.details ? <p className="ops-rd-list-item__muted">{m.details}</p> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : null}
            </section>

            <section className="ops-rd-surface">
              <div className="ops-rd-actions">
                <OpsButton
                  variant="secondary"
                  size="compact"
                  onClick={() => doAction(opsWriteAPI.sendArrivalInstructions, id)}
                >
                  Send arrival
                </OpsButton>
                <OpsButton
                  variant="secondary"
                  size="compact"
                  onClick={() => doAction(opsWriteAPI.resendArrivalInstructions, id)}
                >
                  Resend
                </OpsButton>
                <OpsButton
                  variant="secondary"
                  size="compact"
                  onClick={() => doAction(opsWriteAPI.markArrivalCompleted, id)}
                >
                  Mark completed
                </OpsButton>
              </div>

              <hr className="ops-rd-divider" />

              <h3 className="ops-rd-section-title">Booking lifecycle email</h3>
              <p className="ops-rd-note">
                Preview is read-only. Resend sends only after you confirm. Leave override blank to use the guest
                email on file (
                <span className="ops-rd-note--strong">
                  {resolveEffectiveRecipient(
                    overrideRecipient,
                    guestDraft?.email || reservation?.guest?.email || ''
                  ) || '—'}
                </span>
                ).
              </p>
              <OpsTextField
                id="ops-lifecycle-override"
                label="Override recipient (optional)"
                type="email"
                value={overrideRecipient}
                onChange={(e) => setOverrideRecipient(e.target.value)}
                placeholder="Leave blank for guest email"
              />
              {lifecycleInlineError ? <OpsInlineError>{lifecycleInlineError}</OpsInlineError> : null}

              <div className="ops-rd-template-grid">
                {LIFECYCLE_TEMPLATE_KEYS.map((key) => (
                  <div key={key} className="ops-rd-template-card">
                    <p className="ops-rd-template-card__title">{TEMPLATE_LABELS[key]}</p>
                    <div className="ops-rd-template-card__actions">
                      <OpsButton
                        variant="secondary"
                        size="compact"
                        disabled={lifecycleActionsBusy}
                        loading={previewLoadingKey === key}
                        loadingLabel="Loading…"
                        onClick={() => handlePreviewTemplate(key)}
                      >
                        Preview
                      </OpsButton>
                      <OpsButton
                        variant="secondary"
                        size="compact"
                        disabled={lifecycleActionsBusy}
                        loading={resendLoadingKey === key}
                        loadingLabel="Sending…"
                        onClick={() => handleResendTemplate(key)}
                      >
                        Resend
                      </OpsButton>
                      <OpsButton
                        variant="secondary"
                        size="compact"
                        disabled={lifecycleActionsBusy}
                        loading={editResendLoadingKey === key}
                        loadingLabel="Loading…"
                        onClick={() => openEditResendModal(key)}
                      >
                        Edit & resend
                      </OpsButton>
                    </div>
                  </div>
                ))}
              </div>

              <hr className="ops-rd-divider" />
              <h3 className="ops-rd-section-title">Email event history</h3>
              {lifecycleEmailLoading ? (
                <p className="ops-rd-note">Loading email events…</p>
              ) : lifecycleEmailEvents.length === 0 ? (
                <p className="ops-rd-note">No email events for this booking.</p>
              ) : (
                <ul className="ops-rd-scroll-list">
                  {lifecycleEmailEvents.map((evt) => (
                    <li key={evt._id} className="ops-rd-list-item">
                      <p className="ops-rd-list-item__title">
                        {evt.type || '—'}
                        {evt.templateKey ? (
                          <span className="ops-rd-list-item__meta"> · {evt.templateKey}</span>
                        ) : null}
                      </p>
                      <p className="ops-rd-list-item__meta">
                        {evt.sendStatus ? <span>{evt.sendStatus}</span> : null}
                        {evt.lifecycleSource ? <span> Source: {evt.lifecycleSource}</span> : null}
                      </p>
                      <p className="ops-rd-list-item__muted">To: {evt.to || '—'}</p>
                      {evt.subject ? (
                        <p className="ops-rd-list-item__muted">{evt.subject}</p>
                      ) : null}
                      <p className="ops-rd-list-item__muted">
                        {evt.createdAt ? String(evt.createdAt).slice(0, 19) : ''}
                      </p>
                      {evt.errorMessage ? (
                        <p className="ops-rd-list-item__danger">{evt.errorMessage}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {lifecycleEmailPagination && lifecycleEmailPagination.pages > 1 ? (
                <div className="ops-rd-pager">
                  <OpsButton
                    variant="secondary"
                    size="compact"
                    disabled={lifecycleEmailPage <= 1 || lifecycleEmailLoading}
                    onClick={() => setLifecycleEmailPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </OpsButton>
                  <span className="ops-rd-note">
                    Page {lifecycleEmailPagination.page} of {lifecycleEmailPagination.pages}
                  </span>
                  <OpsButton
                    variant="secondary"
                    size="compact"
                    disabled={
                      lifecycleEmailPage >= lifecycleEmailPagination.pages || lifecycleEmailLoading
                    }
                    onClick={() => setLifecycleEmailPage((p) => p + 1)}
                  >
                    Next
                  </OpsButton>
                </div>
              ) : null}
            </section>

            <section className="ops-rd-surface">
              <h2 className="ops-rd-surface__title">Context</h2>
              <p className="ops-rd-note">Payment events: {(data.paymentTrail || []).length}</p>
              <p className="ops-rd-note">Payout relevance: {data.payoutRelevance?.payoutCount || 0}</p>
              <p className="ops-rd-note">
                Hard conflict: {data.conflictContext?.hasHardConflict ? 'yes' : 'no'}
              </p>
              <p className="ops-rd-note">Warning: {data.conflictContext?.hasWarning ? 'yes' : 'no'}</p>
            </section>

            <section className="ops-rd-surface">
              <h2 className="ops-rd-surface__title">Availability actions</h2>
              <div className="ops-rd-actions ops-rd-actions--stack">
                <OpsButton
                  variant="secondary"
                  onClick={() =>
                    setBlockModal({ kind: 'manual', startDate: '', endDate: '' })
                  }
                >
                  Add manual block
                </OpsButton>
                <OpsButton
                  variant="secondary"
                  onClick={() =>
                    setBlockModal({ kind: 'maintenance', startDate: '', endDate: '' })
                  }
                >
                  Add maintenance block
                </OpsButton>
              </div>
            </section>
          </div>
        </div>

        <OpsConfirmDialog
          open={messagingCancelModal.open}
          title="Cancel scheduled job?"
          body={`Rule: ${messagingCancelModal.ruleKey || '—'}\n\nThis stops this scheduled automation job. It does not unsend messages already accepted by a provider.`}
          confirmLabel="Confirm cancel"
          cancelLabel="Back"
          tone="destructive"
          loading={messagingCancelBusy}
          onConfirm={() => void confirmCancelMessagingJob()}
          onCancel={() => {
            if (!messagingCancelBusy) setMessagingCancelModal({ open: false, jobId: null, ruleKey: '' });
          }}
        />

        <OpsConfirmDialog
          open={Boolean(lifecycleConfirm)}
          title={
            lifecycleConfirm?.kind === 'editResend'
              ? `Send edited "${lifecycleConfirm?.label || ''}"?`
              : `Send "${lifecycleConfirm?.label || ''}" now?`
          }
          body={lifecycleConfirm?.bodyText || ''}
          confirmLabel="Send"
          cancelLabel="Cancel"
          onConfirm={() => void confirmLifecycleSend()}
          onCancel={() => setLifecycleConfirm(null)}
        />

        <OpsModal
          open={reassignOpen}
          onClose={() => setReassignOpen(false)}
          title="Reassign reservation"
          footer={
            <div className="ops-rd-modal-footer">
              <OpsButton variant="secondary" onClick={() => setReassignOpen(false)}>
                Cancel
              </OpsButton>
              <OpsButton
                disabled={!(reassignCabinId || '').trim()}
                onClick={() => void submitReassign()}
              >
                Reassign
              </OpsButton>
            </div>
          }
        >
          <OpsTextField
            label="Target cabinId"
            value={reassignCabinId}
            onChange={(e) => setReassignCabinId(e.target.value)}
            placeholder="cabinId"
          />
        </OpsModal>

        <OpsModal
          open={Boolean(blockModal)}
          onClose={() => setBlockModal(null)}
          title={blockModal?.kind === 'maintenance' ? 'Add maintenance block' : 'Add manual block'}
          footer={
            <div className="ops-rd-modal-footer">
              <OpsButton variant="secondary" onClick={() => setBlockModal(null)}>
                Cancel
              </OpsButton>
              <OpsButton
                disabled={!(blockModal?.startDate || '').trim() || !(blockModal?.endDate || '').trim()}
                onClick={() => void submitBlockModal()}
              >
                Confirm
              </OpsButton>
            </div>
          }
        >
          <div className="ops-rd-modal-stack">
            <OpsTextField
              label={
                blockModal?.kind === 'maintenance'
                  ? 'Maintenance start date (YYYY-MM-DD)'
                  : 'Manual block start date (YYYY-MM-DD)'
              }
              type="date"
              value={blockModal?.startDate || ''}
              onChange={(e) =>
                setBlockModal((prev) => (prev ? { ...prev, startDate: e.target.value } : prev))
              }
            />
            <OpsTextField
              label={
                blockModal?.kind === 'maintenance'
                  ? 'Maintenance end date (YYYY-MM-DD)'
                  : 'Manual block end date (YYYY-MM-DD)'
              }
              type="date"
              value={blockModal?.endDate || ''}
              onChange={(e) =>
                setBlockModal((prev) => (prev ? { ...prev, endDate: e.target.value } : prev))
              }
            />
          </div>
        </OpsModal>

        <OpsEmailPreviewModal
          open={gmaEmailPreviewModal.open}
          onClose={closeGmaEmailPreviewModal}
          titleId="ops-gma-email-preview-title"
          title="GMA email preview"
          metaLine={gmaEmailPreviewModal.ruleKey || ''}
          statusBadge={
            gmaEmailPreviewModal.templateStatus ? (
              <OpsBadge>{gmaEmailPreviewModal.templateStatus}</OpsBadge>
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
              <OpsBadge>{gmaWhatsappPreviewModal.templateStatus}</OpsBadge>
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
              <OpsButton
                size="compact"
                onClick={openEditFromPreview}
                disabled={lifecycleActionsBusy}
              >
                Edit &amp; resend
              </OpsButton>
              <OpsButton variant="secondary" size="compact" onClick={closePreviewModal}>
                Close
              </OpsButton>
            </>
          }
        />

        <OpsModal
          open={editResendModal.open}
          onClose={() => {
            if (!editResendSending) closeEditResendModal();
          }}
          title="Edit before resend"
          description={TEMPLATE_LABELS[editResendModal.templateKey] || editResendModal.templateKey || ''}
          closeOnBackdrop={!editResendSending}
          closeOnEscape={!editResendSending}
          footer={
            editResendModal.loading ? null : (
              <div className="ops-rd-modal-footer">
                <OpsButton
                  variant="secondary"
                  disabled={editResendSending}
                  onClick={closeEditResendModal}
                >
                  Cancel
                </OpsButton>
                <OpsButton
                  loading={editResendSending}
                  loadingLabel="Sending…"
                  onClick={submitEditedResend}
                >
                  Confirm send
                </OpsButton>
              </div>
            )
          }
        >
          {editResendModal.loading ? (
            <OpsLoadingState label="Loading template…" />
          ) : (
            <div className="ops-rd-modal-stack">
              <p className="ops-rd-note">
                Recipient for this send:{' '}
                <span className="ops-rd-note--strong">
                  {resolveEffectiveRecipient(
                    overrideRecipient,
                    guestDraft?.email || reservation?.guest?.email || ''
                  ) || '—'}
                </span>
                . Plain text is derived from HTML on the server; obvious script tags and{' '}
                <span className="ops-rd-mono">javascript:</span> URLs are stripped.
              </p>
              <OpsTextField
                id="ops-edit-resend-subject"
                label="Subject"
                value={editResendModal.subject}
                onChange={(e) => setEditResendModal((prev) => ({ ...prev, subject: e.target.value }))}
              />
              <OpsTextarea
                id="ops-edit-resend-html"
                label="HTML body"
                rows={14}
                value={editResendModal.html}
                onChange={(e) => setEditResendModal((prev) => ({ ...prev, html: e.target.value }))}
                className="ops-rd-mono"
              />
            </div>
          )}
        </OpsModal>

        <OpsModal
          open={cancelOpen}
          onClose={() => {
            if (!cancelBusy) setCancelOpen(false);
          }}
          title="Cancel reservation"
          closeOnBackdrop={!cancelBusy}
          closeOnEscape={!cancelBusy}
          footer={
            <div className="ops-rd-modal-footer">
              <OpsButton variant="secondary" disabled={cancelBusy} onClick={() => setCancelOpen(false)}>
                Close
              </OpsButton>
              <OpsButton
                variant="destructive"
                type="submit"
                form="ops-rd-cancel-form"
                loading={cancelBusy}
                loadingLabel="Cancelling…"
              >
                Confirm cancellation
              </OpsButton>
            </div>
          }
        >
          <form id="ops-rd-cancel-form" onSubmit={submitCancelReservation} className="ops-rd-modal-stack">
            <OpsTextarea
              id="cancelReason"
              label="Reason *"
              required
              maxLength={500}
              rows={3}
              value={cancelForm.reason}
              onChange={(e) => setCancelForm((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder="Why is this reservation being cancelled?"
            />
            <fieldset className="ops-rd-radio-group">
              <legend className="ops-rd-radio-group__legend">Settlement outcome</legend>
              {SETTLEMENT_OUTCOME_OPTIONS.map((option) => (
                <label key={option.value} className="ops-rd-radio">
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
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
            {cancelForm.outcome === 'credits_issued' ? (
              <div className="ops-rd-modal-stack">
                <OpsTextField
                  id="cancelCreditEuros"
                  label="Stay credit amount (EUR) *"
                  inputMode="decimal"
                  required
                  value={cancelForm.creditAmountEuros}
                  onChange={(e) =>
                    setCancelForm((prev) => ({ ...prev, creditAmountEuros: e.target.value }))
                  }
                  placeholder="e.g. 120"
                />
                <p className="ops-rd-note">Minimum €100. Amount is issued immediately.</p>
              </div>
            ) : null}
            {cancelForm.outcome === 'cash_refund_pending' ? (
              <div className="ops-rd-modal-stack">
                <OpsTextField
                  id="cancelCashRefundAmount"
                  label="Refund amount (EUR)"
                  inputMode="decimal"
                  value={cancelForm.cashRefund.amountEuros}
                  onChange={(e) =>
                    setCancelForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, amountEuros: e.target.value }
                    }))
                  }
                  placeholder="e.g. 300"
                />
                <p className="ops-rd-note">Required when the booking has a recorded cash payment.</p>
                <OpsTextField
                  id="cancelCashRefundNote"
                  label="Note (optional)"
                  value={cancelForm.cashRefund.note}
                  onChange={(e) =>
                    setCancelForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, note: e.target.value }
                    }))
                  }
                  placeholder="e.g. Refund via Stripe dashboard"
                />
              </div>
            ) : null}
            {cancelForm.outcome === 'cash_refunded' ? (
              <div className="ops-rd-modal-stack">
                <OpsTextField
                  id="cancelCashRefundedAmount"
                  label="Refund amount (EUR) *"
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
                />
                <OpsSelect
                  id="cancelCashRefundedMethod"
                  label="Refund method *"
                  required
                  value={cancelForm.cashRefund.method}
                  onChange={(e) =>
                    setCancelForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, method: e.target.value }
                    }))
                  }
                >
                  {CASH_REFUND_METHOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </OpsSelect>
                <OpsTextField
                  id="cancelCashRefundedReference"
                  label="Reference (optional)"
                  value={cancelForm.cashRefund.reference}
                  onChange={(e) =>
                    setCancelForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, reference: e.target.value }
                    }))
                  }
                  placeholder="e.g. Stripe refund ID"
                />
                <OpsTextField
                  id="cancelCashRefundedDate"
                  label="Refunded date"
                  type="date"
                  value={cancelForm.cashRefund.refundedDate}
                  onChange={(e) =>
                    setCancelForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, refundedDate: e.target.value }
                    }))
                  }
                />
                <OpsTextField
                  id="cancelCashRefundedNote"
                  label="Refund note *"
                  required
                  value={cancelForm.cashRefund.note}
                  onChange={(e) =>
                    setCancelForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, note: e.target.value }
                    }))
                  }
                  placeholder="How was the refund completed?"
                />
              </div>
            ) : null}
            <OpsBanner
              tone={
                cancelForm.outcome === 'credits_issued' ||
                cancelForm.outcome === 'cash_refund_pending' ||
                cancelForm.outcome === 'cash_refunded'
                  ? 'warning'
                  : 'info'
              }
              title={SETTLEMENT_WARNINGS[cancelForm.outcome]}
            />
            {cancelError ? <OpsInlineError>{cancelError}</OpsInlineError> : null}
          </form>
        </OpsModal>

        <OpsModal
          open={resolveOpen}
          onClose={() => {
            if (!resolveBusy) setResolveOpen(false);
          }}
          title={
            resolveModalMode === 'mark_refunded'
              ? 'Mark cash refund as paid'
              : 'Resolve cancellation settlement'
          }
          closeOnBackdrop={!resolveBusy}
          closeOnEscape={!resolveBusy}
          footer={
            <div className="ops-rd-modal-footer">
              <OpsButton variant="secondary" disabled={resolveBusy} onClick={() => setResolveOpen(false)}>
                Close
              </OpsButton>
              <OpsButton
                type="submit"
                form="ops-rd-resolve-form"
                loading={resolveBusy}
                loadingLabel="Saving…"
              >
                {resolveModalMode === 'mark_refunded' ? 'Mark as refunded' : 'Resolve settlement'}
              </OpsButton>
            </div>
          }
        >
          <form id="ops-rd-resolve-form" onSubmit={submitResolveSettlement} className="ops-rd-modal-stack">
            <OpsTextarea
              id="resolveReason"
              label="Reason *"
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
            />
            {resolveModalMode === 'settlement' ? (
              <fieldset className="ops-rd-radio-group">
                <legend className="ops-rd-radio-group__legend">Settlement outcome</legend>
                {RESOLVE_SETTLEMENT_OUTCOME_OPTIONS.map((option) => (
                  <label key={option.value} className="ops-rd-radio">
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
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {resolveModalMode === 'settlement' && resolveForm.outcome === 'credits_issued' ? (
              <div className="ops-rd-modal-stack">
                <OpsTextField
                  id="resolveCreditEuros"
                  label="Stay credit amount (EUR) *"
                  inputMode="decimal"
                  required
                  value={resolveForm.creditAmountEuros}
                  onChange={(e) =>
                    setResolveForm((prev) => ({ ...prev, creditAmountEuros: e.target.value }))
                  }
                  placeholder="e.g. 120"
                />
                <p className="ops-rd-note">Minimum €100. Amount is issued immediately.</p>
              </div>
            ) : null}
            {resolveModalMode === 'settlement' && resolveForm.outcome === 'cash_refund_pending' ? (
              <div className="ops-rd-modal-stack">
                <OpsTextField
                  id="resolveCashRefundAmount"
                  label="Refund amount (EUR)"
                  inputMode="decimal"
                  value={resolveForm.cashRefund.amountEuros}
                  onChange={(e) =>
                    setResolveForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, amountEuros: e.target.value }
                    }))
                  }
                  placeholder="e.g. 300"
                />
                <OpsTextField
                  id="resolveCashRefundNote"
                  label="Note (optional)"
                  value={resolveForm.cashRefund.note}
                  onChange={(e) =>
                    setResolveForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, note: e.target.value }
                    }))
                  }
                  placeholder="e.g. Refund via Stripe dashboard"
                />
              </div>
            ) : null}
            {(resolveModalMode === 'mark_refunded' ||
              (resolveModalMode === 'settlement' && resolveForm.outcome === 'cash_refunded')) ? (
              <div className="ops-rd-modal-stack">
                <OpsTextField
                  id="resolveCashRefundedAmount"
                  label="Refund amount (EUR) *"
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
                />
                <OpsSelect
                  id="resolveCashRefundedMethod"
                  label="Refund method *"
                  required
                  value={resolveForm.cashRefund.method}
                  onChange={(e) =>
                    setResolveForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, method: e.target.value }
                    }))
                  }
                >
                  {CASH_REFUND_METHOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </OpsSelect>
                <OpsTextField
                  id="resolveCashRefundedReference"
                  label="Reference (optional)"
                  value={resolveForm.cashRefund.reference}
                  onChange={(e) =>
                    setResolveForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, reference: e.target.value }
                    }))
                  }
                  placeholder="e.g. Stripe refund ID"
                />
                <OpsTextField
                  id="resolveCashRefundedDate"
                  label="Refunded date"
                  type="date"
                  value={resolveForm.cashRefund.refundedDate}
                  onChange={(e) =>
                    setResolveForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, refundedDate: e.target.value }
                    }))
                  }
                />
                <OpsTextField
                  id="resolveCashRefundedNote"
                  label="Refund note *"
                  required
                  value={resolveForm.cashRefund.note}
                  onChange={(e) =>
                    setResolveForm((prev) => ({
                      ...prev,
                      cashRefund: { ...prev.cashRefund, note: e.target.value }
                    }))
                  }
                  placeholder="How was the refund completed?"
                />
              </div>
            ) : null}
            <OpsBanner
              tone={
                resolveModalMode === 'mark_refunded' ||
                resolveForm.outcome === 'credits_issued' ||
                resolveForm.outcome === 'cash_refund_pending' ||
                resolveForm.outcome === 'cash_refunded'
                  ? 'warning'
                  : 'info'
              }
              title={
                resolveModalMode === 'mark_refunded'
                  ? SETTLEMENT_WARNINGS.cash_refunded
                  : SETTLEMENT_WARNINGS[resolveForm.outcome]
              }
            />
            {resolveError ? <OpsInlineError>{resolveError}</OpsInlineError> : null}
          </form>
        </OpsModal>

        <OpsModal
          open={editDatesOpen}
          onClose={() => {
            if (!editDatesBusy) setEditDatesOpen(false);
          }}
          title="Edit reservation dates"
          closeOnBackdrop={!editDatesBusy}
          closeOnEscape={!editDatesBusy}
          footer={
            <div className="ops-rd-modal-footer">
              <OpsButton
                variant="secondary"
                disabled={editDatesBusy}
                onClick={() => setEditDatesOpen(false)}
              >
                Cancel
              </OpsButton>
              <OpsButton
                type="submit"
                form="ops-rd-edit-dates-form"
                loading={editDatesBusy}
                loadingLabel="Saving..."
              >
                Save dates
              </OpsButton>
            </div>
          }
        >
          <form id="ops-rd-edit-dates-form" onSubmit={submitEditDates} className="ops-rd-modal-stack">
            <div className="ops-rd-modal-grid ops-rd-modal-grid--2">
              <OpsTextField
                id="checkInDate"
                label="Check-in"
                type="date"
                required
                value={editDatesForm.checkInDate}
                onChange={(e) => setEditDatesForm((prev) => ({ ...prev, checkInDate: e.target.value }))}
              />
              <OpsTextField
                id="checkOutDate"
                label="Check-out"
                type="date"
                required
                value={editDatesForm.checkOutDate}
                onChange={(e) => setEditDatesForm((prev) => ({ ...prev, checkOutDate: e.target.value }))}
              />
            </div>
            <OpsTextField
              id="editDatesReason"
              label="Reason (optional)"
              value={editDatesForm.reason}
              onChange={(e) => setEditDatesForm((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder="Why was this rescheduled?"
            />
            {editDatesError ? <OpsInlineError>{editDatesError}</OpsInlineError> : null}
          </form>
        </OpsModal>

        <MoveUnitDialog
          reservationId={id}
          sourceUnitLabel={cabinSummary?.unitLabel || cabinSummary?.displayName || null}
          open={moveUnitOpen}
          onClose={() => setMoveUnitOpen(false)}
          onSuccess={async (result) => {
            await load();
            if (result?.closeOnly && result?.refresh) {
              setError(
                result.code
                  ? `Move Unit is no longer available (${result.code}).`
                  : 'Move Unit is no longer available for this reservation.'
              );
              return;
            }
            if (result?.reconciliation) {
              setError(
                'Unit move needs inventory reconciliation. Refresh and verify the current unit.'
              );
              return;
            }
            if (result?.noop) {
              return;
            }
            if (result?.fromLabel && result?.toLabel) {
              setSuccessMessage(`Moved from ${result.fromLabel} to ${result.toLabel}`);
            }
          }}
        />
      </div>
    </OpsPage>
  );
}
