import { useCallback, useEffect, useMemo, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsTextarea from '../../ops/primitives/OpsTextarea';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsCheckbox from '../../ops/primitives/OpsCheckbox';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsInlineError from '../../ops/primitives/OpsInlineError';
import OpsFilterBar from '../../ops/primitives/OpsFilterBar';
import OpsModal from '../../ops/primitives/OpsModal';
import OpsMetric, { OpsMetricGroup } from '../../ops/primitives/OpsMetric';
import OpsSurface, { OpsSurfaceHeader, OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import OpsRecord from '../../ops/primitives/OpsRecord';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../ops/primitives/OpsTable';
import './OpsCreatorPartners.css';

/** Mirrors server/models/CreatorPartner.js — slug only (no dots). */
const PARTNER_KEY_RE = /^[a-z0-9_-]{1,80}$/;
/** Instagram-style referral codes; mirrors server REFERRAL_CODE_RE */
const REFERRAL_CODE_RE = /^[a-z0-9_.-]{1,80}$/;

const SLUG_MSG =
  'Slug must be 1–80 characters: lowercase letters, digits, hyphen, or underscore.';
const REFERRAL_MSG =
  'Referral code must be 1–80 characters: lowercase letters, digits, dot, hyphen, or underscore. Optional leading @ is removed.';
const COMMISSION_MSG = 'Commission rate must be between 0 and 100 percent.';

const DETAIL_TABS = [
  ['overview', 'Overview'],
  ['bookings', 'Bookings'],
  ['commissions', 'Commissions'],
  ['profile', 'Profile']
];

/** Trim, lowercase, strip common invisible chars (ZWSP/BOM/ZWNJ/ZWJ) before key validation. */
function normalizePartnerKeyInput(raw) {
  return String(raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();
}

/** Referral: invisible chars stripped, trim, lowercase, strip leading @ (Instagram). */
function normalizeReferralCodeInput(raw) {
  return String(raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .trim()
    .toLowerCase();
}

function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function createEmptyCreatorForm() {
  return {
    name: '',
    slug: '',
    status: 'draft',
    contactEmail: '',
    contactPhone: '',
    instagram: '',
    tiktok: '',
    youtube: '',
    website: '',
    referralCode: '',
    cookieDays: '60',
    promoCode: '',
    commissionPercent: '10',
    commissionBasis: 'accommodation_net',
    eligibleAfter: 'stay_completed',
    compStayOffered: false,
    deliverables: '',
    usageRights: '',
    agreedAt: '',
    notes: ''
  };
}

function rowToForm(partner) {
  const c = partner.commission || {};
  const rateBps = typeof c.rateBps === 'number' ? c.rateBps : 0;
  const percent = rateBps / 100;
  const pctStr =
    percent === Math.round(percent) ? String(Math.round(percent)) : String(Number(percent.toFixed(2)));
  return {
    name: partner.name || '',
    slug: partner.slug || '',
    status: partner.status || 'draft',
    contactEmail: partner.contact?.email || '',
    contactPhone: partner.contact?.phone || '',
    instagram: partner.profiles?.instagram || '',
    tiktok: partner.profiles?.tiktok || '',
    youtube: partner.profiles?.youtube || '',
    website: partner.profiles?.website || '',
    referralCode: partner.referral?.code || '',
    cookieDays: String(partner.referral?.cookieDays ?? 60),
    promoCode: partner.promo?.code || '',
    commissionPercent: pctStr,
    commissionBasis: c.basis || 'accommodation_net',
    eligibleAfter: c.eligibleAfter || 'stay_completed',
    compStayOffered: !!partner.contentAgreement?.compStayOffered,
    deliverables: partner.contentAgreement?.deliverables || '',
    usageRights: partner.contentAgreement?.usageRights || '',
    agreedAt: toDatetimeLocalValue(partner.contentAgreement?.agreedAt),
    notes: partner.notes || ''
  };
}

function mainProfileHref(partner) {
  const p = partner.profiles || {};
  return p.website || p.instagram || p.tiktok || p.youtube || '';
}

function formatAxiosMessage(err) {
  const data = err?.response?.data;
  if (Array.isArray(data?.errors)) {
    return data.errors.map((e) => e.msg || e.message || JSON.stringify(e)).join(' ');
  }
  return data?.message || err?.message || 'Request failed';
}

function buildPayload(form) {
  const slug = normalizePartnerKeyInput(form.slug);
  const referralCode = normalizeReferralCodeInput(form.referralCode);
  const promoTrim = (form.promoCode || '').trim();
  const pct = Number(form.commissionPercent);
  const rateBps = Number.isFinite(pct) ? Math.min(10000, Math.max(0, Math.round(pct * 100))) : 0;
  const rawCd = parseInt(String(form.cookieDays), 10);
  const cookieDays = Number.isFinite(rawCd) && rawCd >= 1 && rawCd <= 365 ? rawCd : 60;

  const payload = {
    name: (form.name || '').trim(),
    slug,
    status: form.status,
    contact: {
      email: (form.contactEmail || '').trim() || undefined,
      phone: (form.contactPhone || '').trim() || undefined
    },
    profiles: {
      instagram: (form.instagram || '').trim() || undefined,
      tiktok: (form.tiktok || '').trim() || undefined,
      youtube: (form.youtube || '').trim() || undefined,
      website: (form.website || '').trim() || undefined
    },
    referral: {
      code: referralCode,
      cookieDays
    },
    commission: {
      rateBps,
      basis: 'accommodation_net',
      eligibleAfter: form.eligibleAfter
    },
    contentAgreement: {
      compStayOffered: !!form.compStayOffered,
      deliverables: (form.deliverables || '').trim() || null,
      usageRights: (form.usageRights || '').trim() || null,
      agreedAt: form.agreedAt ? new Date(form.agreedAt).toISOString() : null
    },
    notes: (form.notes || '').trim() || null
  };

  if (promoTrim) {
    payload.promo = { code: promoTrim };
  } else {
    payload.promo = { code: '' };
  }

  return payload;
}

function validateCreatorForm(form) {
  const slug = normalizePartnerKeyInput(form.slug);
  const referral = normalizeReferralCodeInput(form.referralCode);
  const errors = { slug: '', referral: '', commission: '' };
  if (!PARTNER_KEY_RE.test(slug)) errors.slug = SLUG_MSG;
  if (!REFERRAL_CODE_RE.test(referral)) errors.referral = REFERRAL_MSG;
  const pct = Number(form.commissionPercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) errors.commission = COMMISSION_MSG;
  const hasErrors = !!(errors.slug || errors.referral || errors.commission);
  return { errors, hasErrors };
}

function referralUrl(code) {
  if (typeof window === 'undefined' || !code) return '';
  return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function normalizeDisplayCurrency(currency) {
  const raw = String(currency || 'EUR').trim().toUpperCase();
  if (!raw || raw === 'BGN') return 'EUR';
  return raw;
}

function formatMoney(amount, currency = 'EUR') {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: normalizeDisplayCurrency(currency),
      maximumFractionDigits: 2
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${normalizeDisplayCurrency(currency)}`;
  }
}

function formatMoneyFromCents(cents, currency = 'EUR') {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '—';
  return formatMoney(n / 100, currency);
}

function formatPercentRatio(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${(num * 100).toFixed(2)}%`;
}

function bannerTone(type) {
  if (type === 'success') return 'success';
  if (type === 'warning') return 'warning';
  return 'danger';
}

function partnerListStats(row, statsById) {
  const stats = statsById[row._id] || {};
  const visits = Number(stats.visits || 0);
  const uniqueVisitors = Number(stats.uniqueVisitors || 0);
  const attributedBookings = Number(stats.attributedBookings || 0);
  const paidBookings = Number(stats.paidConfirmedBookings || 0);
  const paidRevenue = Number(
    Number.isFinite(Number(stats.paidStayRevenue))
      ? Number(stats.paidStayRevenue)
      : Number(stats.stayBookingRevenueCents || 0) / 100
  );
  const attributedBookingValue = Number(stats.attributedBookingValue ?? stats.grossBookingRevenue ?? 0);
  const commissionEstimate = Number(stats.commissionableRevenueEstimate || 0);
  const gvPurchases = Number(stats.giftVoucherPurchases || 0);
  const gvRevCents = Number(stats.giftVoucherRevenueCents || 0);
  const gvCommCents = Number(stats.giftVoucherCommissionCents || 0);
  const lastActivity = stats.lastVisitAt || stats.lastBookingAt || null;
  const projectedCommission = formatMoney(commissionEstimate * ((row.commission?.rateBps || 0) / 10000));
  return {
    visits,
    uniqueVisitors,
    attributedBookings,
    paidBookings,
    paidRevenue,
    attributedBookingValue,
    gvPurchases,
    gvRevCents,
    gvCommCents,
    lastActivity,
    projectedCommission
  };
}

function PartnerRowActions({
  row,
  portalLinkBusyId,
  onDetails,
  onPortalLink,
  onEdit,
  onCopy,
  onPatchStatus
}) {
  const portalEligible = row?.status === 'active' || row?.status === 'paused';
  const portalBusy = portalLinkBusyId === String(row._id);
  return (
    <div className="ops-creator-partners-actions">
      <OpsButton size="compact" onClick={() => onDetails(row)}>
        Details
      </OpsButton>
      {portalEligible ? (
        <OpsButton
          variant="secondary"
          size="compact"
          onClick={() => onPortalLink(row)}
          disabled={portalBusy}
          loading={portalBusy}
          loadingLabel="Generating…"
        >
          Portal link
        </OpsButton>
      ) : (
        <OpsButton
          variant="secondary"
          size="compact"
          disabled
          title={
            row.status === 'draft'
              ? 'Portal links are available after the partner leaves draft (backend rejects draft).'
              : 'Portal link is only available for active or paused partners.'
          }
        >
          Portal link
        </OpsButton>
      )}
      <OpsButton variant="secondary" size="compact" onClick={() => onEdit(row)}>
        Edit
      </OpsButton>
      {row.referral?.code ? (
        <OpsButton variant="secondary" size="compact" onClick={() => onCopy(row.referral.code)}>
          Copy
        </OpsButton>
      ) : null}
      {row.status === 'paused' ? (
        <OpsButton variant="secondary" size="compact" onClick={() => onPatchStatus(row, 'active')}>
          Reactivate
        </OpsButton>
      ) : row.status !== 'archived' ? (
        <OpsButton variant="secondary" size="compact" onClick={() => onPatchStatus(row, 'paused')}>
          Pause
        </OpsButton>
      ) : null}
      {row.status !== 'archived' ? (
        <OpsButton variant="secondary" size="compact" onClick={() => onPatchStatus(row, 'archived')}>
          Archive
        </OpsButton>
      ) : null}
    </div>
  );
}

export default function OpsCreatorPartners() {
  const [rows, setRows] = useState([]);
  const [statsById, setStatsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState({ type: '', message: '' });
  const [statusFilter, setStatusFilter] = useState('all');
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  /** Lazy init so state is always a plain object (never the factory function reference). */
  const [form, setForm] = useState(() => createEmptyCreatorForm());
  const [saving, setSaving] = useState(false);
  const [drawerFieldErrors, setDrawerFieldErrors] = useState({ slug: '', referral: '', commission: '' });
  const [drawerSubmitError, setDrawerSubmitError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailStats, setDetailStats] = useState(null);
  const [detailBookings, setDetailBookings] = useState([]);
  const [detailCommission, setDetailCommission] = useState([]);
  const [commissionActionBusyId, setCommissionActionBusyId] = useState('');
  const [voidDrafts, setVoidDrafts] = useState({});
  const [detailTab, setDetailTab] = useState('overview');
  /** Creator portal magic link (11C): in-memory only; cleared when modal closes. */
  const [portalLinkOpen, setPortalLinkOpen] = useState(false);
  const [portalLinkBusyId, setPortalLinkBusyId] = useState('');
  const [portalLinkPayload, setPortalLinkPayload] = useState(null);
  const [portalLinkError, setPortalLinkError] = useState('');
  const [portalLinkCopyHint, setPortalLinkCopyHint] = useState('');

  function clearPortalLinkModal() {
    setPortalLinkOpen(false);
    setPortalLinkBusyId('');
    setPortalLinkPayload(null);
    setPortalLinkError('');
    setPortalLinkCopyHint('');
  }

  function isCreatorPortalLinkEligible(row) {
    return row?.status === 'active' || row?.status === 'paused';
  }

  async function generateCreatorPortalLink(row) {
    if (!row?._id || !isCreatorPortalLinkEligible(row)) return;
    setPortalLinkOpen(true);
    setPortalLinkBusyId(String(row._id));
    setPortalLinkPayload(null);
    setPortalLinkError('');
    setPortalLinkCopyHint('');
    try {
      const res = await opsWriteAPI.createCreatorPartnerPortalLink(row._id, {});
      const data = res?.data?.data;
      const verifyUrl = data?.verifyUrl;
      const expiresAt = data?.expiresAt;
      if (!verifyUrl || !expiresAt) {
        setPortalLinkError('Invalid response from server (missing link or expiry).');
        return;
      }
      setPortalLinkPayload({
        verifyUrl,
        expiresAt,
        partnerName: row.name || 'Creator'
      });
    } catch (err) {
      setPortalLinkError(formatAxiosMessage(err));
    } finally {
      setPortalLinkBusyId('');
    }
  }

  async function copyPortalVerifyUrl() {
    const url = portalLinkPayload?.verifyUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setPortalLinkCopyHint('Copied to clipboard.');
      setTimeout(() => setPortalLinkCopyHint(''), 3000);
    } catch {
      setPortalLinkCopyHint('Copy failed — select the link and copy manually.');
      setTimeout(() => setPortalLinkCopyHint(''), 5000);
    }
  }

  function clearDrawerValidation() {
    setDrawerFieldErrors({ slug: '', referral: '', commission: '' });
    setDrawerSubmitError('');
  }

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      const [partnersRes, statsRes] = await Promise.all([
        opsReadAPI.creatorPartners(params),
        opsReadAPI.creatorPartnerStats()
      ]);
      const partners = partnersRes.data?.data?.creatorPartners || [];
      const statsRows = statsRes.data?.data?.creatorPartnerStats || [];
      const nextStatsById = {};
      for (const row of statsRows) {
        if (row?.creatorPartnerId) nextStatsById[row.creatorPartnerId] = row.stats || {};
      }
      setRows(partners);
      setStatsById(nextStatsById);
    } catch (e) {
      setBanner({ type: 'error', message: e?.response?.data?.message || 'Failed to load creator partners' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  const refreshSelectedCreatorDetails = useCallback(async (creatorId) => {
    const [statsRes, bookingsRes, commissionRes] = await Promise.all([
      opsReadAPI.creatorPartnerStatsById(creatorId),
      opsReadAPI.creatorPartnerBookings(creatorId, { limit: 100 }),
      opsReadAPI.creatorPartnerCommission(creatorId, { limit: 100 })
    ]);
    setDetailStats(statsRes.data?.data?.stats || null);
    setDetailBookings(bookingsRes.data?.data?.bookings || []);
    setDetailCommission(commissionRes.data?.data?.entries || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters() {
    setSearch(draftSearch);
  }

  function openCreate() {
    setEditingId(null);
    setForm(createEmptyCreatorForm());
    clearDrawerValidation();
    setBanner({ type: '', message: '' });
    setDrawerOpen(true);
  }

  function openEdit(row) {
    setEditingId(row._id);
    setForm(rowToForm(row));
    clearDrawerValidation();
    setBanner({ type: '', message: '' });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    clearDrawerValidation();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    clearDrawerValidation();
    const { errors, hasErrors } = validateCreatorForm(form);
    if (hasErrors) {
      setDrawerFieldErrors(errors);
      setSaving(false);
      return;
    }
    try {
      const payload = buildPayload(form);
      let res;
      const baseMsg = editingId ? 'Creator partner updated.' : 'Creator partner created.';
      if (editingId) {
        res = await opsWriteAPI.updateCreatorPartner(editingId, payload);
      } else {
        res = await opsWriteAPI.createCreatorPartner(payload);
      }
      const warnings = res?.data?.data?.warnings;
      const wText =
        Array.isArray(warnings) && warnings.length
          ? warnings.map((w) => w.message || w.code || JSON.stringify(w)).join(' ')
          : '';
      setBanner({
        type: wText ? 'warning' : 'success',
        message: wText ? `${baseMsg} ${wText}` : baseMsg
      });
      closeDrawer();
      await load();
    } catch (err) {
      setDrawerSubmitError(formatAxiosMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function patchStatus(row, status) {
    setBanner({ type: '', message: '' });
    try {
      await opsWriteAPI.updateCreatorPartner(row._id, { status });
      setBanner({ type: 'success', message: `Status set to ${status}.` });
      await load();
    } catch (err) {
      setBanner({ type: 'error', message: formatAxiosMessage(err) });
    }
  }

  async function openDetails(row) {
    setDetailRow(row);
    setDetailOpen(true);
    setDetailTab('overview');
    setDetailError('');
    setDetailLoading(true);
    try {
      await refreshSelectedCreatorDetails(row._id);
    } catch (err) {
      setDetailError(formatAxiosMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetails() {
    setDetailOpen(false);
    setDetailRow(null);
    setDetailError('');
    setDetailStats(null);
    setDetailBookings([]);
    setDetailCommission([]);
    setCommissionActionBusyId('');
    setVoidDrafts({});
    setDetailTab('overview');
  }

  async function recalculateCommission() {
    if (!detailRow?._id) return;
    setCommissionActionBusyId('recalculate');
    setDetailError('');
    try {
      await opsWriteAPI.recalculateCreatorPartnerCommission(detailRow._id);
      await Promise.all([load(), refreshSelectedCreatorDetails(detailRow._id)]);
      setBanner({ type: 'success', message: 'Commission ledger recalculated.' });
    } catch (err) {
      setDetailError(formatAxiosMessage(err));
    } finally {
      setCommissionActionBusyId('');
    }
  }

  async function approveCommission(entryId) {
    setCommissionActionBusyId(entryId);
    setDetailError('');
    try {
      await opsWriteAPI.approveCreatorCommission(entryId);
      await Promise.all([load(), refreshSelectedCreatorDetails(detailRow._id)]);
      setBanner({ type: 'success', message: 'Commission row approved.' });
    } catch (err) {
      setDetailError(formatAxiosMessage(err));
    } finally {
      setCommissionActionBusyId('');
    }
  }

  async function markCommissionPaid(entryId) {
    setCommissionActionBusyId(entryId);
    setDetailError('');
    try {
      await opsWriteAPI.markCreatorCommissionPaid(entryId);
      await Promise.all([load(), refreshSelectedCreatorDetails(detailRow._id)]);
      setBanner({ type: 'success', message: 'Commission row marked as paid.' });
    } catch (err) {
      setDetailError(formatAxiosMessage(err));
    } finally {
      setCommissionActionBusyId('');
    }
  }

  async function voidCommission(entryId) {
    const reason = String(voidDrafts[entryId] || '').trim();
    if (!reason) {
      setDetailError('Void reason is required before voiding a commission row.');
      return;
    }
    setCommissionActionBusyId(entryId);
    setDetailError('');
    try {
      await opsWriteAPI.voidCreatorCommission(entryId, { voidReason: reason });
      await Promise.all([load(), refreshSelectedCreatorDetails(detailRow._id)]);
      setVoidDrafts((prev) => ({ ...prev, [entryId]: '' }));
      setBanner({ type: 'success', message: 'Commission row voided.' });
    } catch (err) {
      setDetailError(formatAxiosMessage(err));
    } finally {
      setCommissionActionBusyId('');
    }
  }

  async function copyReferralLink(code) {
    const url = referralUrl(code);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setBanner({ type: 'success', message: 'Referral link copied to clipboard.' });
    } catch {
      setBanner({ type: 'error', message: 'Could not copy link. Copy manually from the referral URL.' });
    }
  }

  const commissionPaidTotal = useMemo(
    () =>
      detailCommission
        .filter((entry) => entry.status === 'paid')
        .reduce((sum, entry) => sum + (Number(entry.amountSnapshot) || 0), 0),
    [detailCommission]
  );

  const commissionDueTotal = useMemo(
    () =>
      detailCommission
        .filter(
          (entry) =>
            entry.status === 'approved' || (entry.status === 'pending' && entry.eligibilityStatus === 'eligible')
        )
        .reduce((sum, entry) => sum + (Number(entry.amountSnapshot) || 0), 0),
    [detailCommission]
  );

  const commissionPendingEligibleTotal = useMemo(
    () =>
      detailCommission
        .filter((entry) => entry.status === 'pending' && entry.eligibilityStatus === 'eligible')
        .reduce((sum, entry) => sum + (Number(entry.amountSnapshot) || 0), 0),
    [detailCommission]
  );

  const commissionApprovedTotal = useMemo(
    () =>
      detailCommission
        .filter((entry) => entry.status === 'approved')
        .reduce((sum, entry) => sum + (Number(entry.amountSnapshot) || 0), 0),
    [detailCommission]
  );

  const commissionVoidTotal = useMemo(
    () =>
      detailCommission
        .filter((entry) => entry.status === 'void')
        .reduce((sum, entry) => sum + (Number(entry.amountSnapshot) || 0), 0),
    [detailCommission]
  );

  const filtersActive = Boolean(search.trim()) || (statusFilter && statusFilter !== 'all');

  return (
    <OpsPage width="wide">
      <div className="ops-creator-partners-page">
        <OpsPageHeader
          title="Creator partners"
          description="Manage influencer and creator partnerships: referral codes, linked promos, and commission settings. Unknown promo codes save with a warning — create the promo under Promo codes when ready."
          actions={<OpsButton onClick={openCreate}>Add creator</OpsButton>}
        />

        {banner.message ? <OpsBanner tone={bannerTone(banner.type)} title={banner.message} /> : null}

        <OpsFilterBar
          footer={
            <OpsButton variant="secondary" onClick={applyFilters}>
              Apply search
            </OpsButton>
          }
        >
          <OpsTextField
            className="ops-filter-bar__search"
            label="Search"
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            placeholder="Name, slug, referral, email…"
          />
          <OpsSelect
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </OpsSelect>
        </OpsFilterBar>

        {loading ? <OpsLoadingState label="Loading…" /> : null}

        {!loading && rows.length === 0 ? (
          <OpsEmptyState
            variant={filtersActive ? 'filtered' : 'empty'}
            title="No creator partners match your filters."
          />
        ) : null}

        {!loading && rows.length > 0 ? (
          <div className="ops-creator-partners-list">
            {rows.map((r) => {
              const s = partnerListStats(r, statsById);
              return (
                <OpsRecord key={r._id} density="roomy" className="ops-creator-partners-row">
                  <div className="ops-creator-partners-row__top">
                    <h2 className="ops-creator-partners-row__name">{r.name}</h2>
                    <OpsStatus domain="partner" value={r.status} />
                    <p className="ops-creator-partners-row__code">{r.referral?.code || '—'}</p>
                  </div>
                  <p className="ops-creator-partners-row__activity">
                    Last activity · <strong>{formatDateTime(s.lastActivity)}</strong>
                  </p>
                  <OpsMetricGroup className="ops-creator-partners-metrics">
                    <OpsMetric label="Visits / unique visitors" value={`${s.visits} / ${s.uniqueVisitors}`} />
                    <OpsMetric
                      label="Bookings / paid bookings"
                      value={`${s.attributedBookings} / ${s.paidBookings}`}
                    />
                    <OpsMetric label="Paid stay revenue" value={formatMoney(s.paidRevenue)} />
                    <OpsMetric label="Attributed booking value" value={formatMoney(s.attributedBookingValue)} />
                    <OpsMetric
                      label="Gift vouchers"
                      value={`${s.gvPurchases} sales · ${formatMoneyFromCents(s.gvRevCents)}`}
                      meta={`Commission · ${formatMoneyFromCents(s.gvCommCents)}`}
                    />
                    <OpsMetric label="Projected commission (not payable)" value={s.projectedCommission} />
                  </OpsMetricGroup>
                  <PartnerRowActions
                    row={r}
                    portalLinkBusyId={portalLinkBusyId}
                    onDetails={openDetails}
                    onPortalLink={generateCreatorPortalLink}
                    onEdit={openEdit}
                    onCopy={copyReferralLink}
                    onPatchStatus={patchStatus}
                  />
                </OpsRecord>
              );
            })}
          </div>
        ) : null}
      </div>

      <OpsModal
        open={detailOpen}
        onClose={closeDetails}
        title={`Creator performance: ${detailRow?.name || 'Details'}`}
        footer={
          <>
            {detailRow && isCreatorPortalLinkEligible(detailRow) ? (
              <OpsButton
                variant="secondary"
                onClick={() => generateCreatorPortalLink(detailRow)}
                disabled={portalLinkBusyId === String(detailRow._id)}
                loading={portalLinkBusyId === String(detailRow._id)}
                loadingLabel="Generating…"
              >
                Portal link
              </OpsButton>
            ) : null}
            {detailRow ? (
              <OpsButton
                variant="secondary"
                onClick={() => {
                  closeDetails();
                  openEdit(detailRow);
                }}
              >
                Edit creator
              </OpsButton>
            ) : null}
            <OpsButton variant="secondary" onClick={closeDetails}>
              Close
            </OpsButton>
          </>
        }
      >
        <div className="ops-creator-partners-detail">
          {detailError ? <OpsInlineError>{detailError}</OpsInlineError> : null}
          {detailLoading ? <OpsLoadingState label="Loading details…" /> : null}
          {!detailLoading && detailRow ? (
            <>
              <div className="ops-creator-partners-tabs" role="tablist" aria-label="Creator detail sections">
                {DETAIL_TABS.map(([id, label]) => (
                  <OpsButton
                    key={id}
                    variant={detailTab === id ? 'primary' : 'secondary'}
                    size="compact"
                    onClick={() => setDetailTab(id)}
                    aria-pressed={detailTab === id}
                  >
                    {label}
                  </OpsButton>
                ))}
              </div>

              {detailTab === 'overview' ? (
                <>
                  <OpsSurface className="ops-creator-partners-section">
                    <OpsSurfaceTitle as="h3" className="ops-creator-partners-section__title">Performance summary</OpsSurfaceTitle>
                    <OpsMetricGroup className="ops-creator-partners-overview-metrics">
                      <OpsMetric label="Visits" value={detailStats?.visits ?? 0} />
                      <OpsMetric label="Unique visitors" value={detailStats?.uniqueVisitors ?? 0} />
                      <OpsMetric label="Bookings" value={detailStats?.attributedBookings ?? 0} />
                      <OpsMetric label="Paid bookings" value={detailStats?.paidConfirmedBookings ?? 0} />
                      <OpsMetric
                        label="Paid stay revenue"
                        value={formatMoney(
                          Number.isFinite(Number(detailStats?.paidStayRevenue))
                            ? Number(detailStats?.paidStayRevenue)
                            : Number(detailStats?.stayBookingRevenueCents || 0) / 100
                        )}
                      />
                      <OpsMetric
                        label="Attributed booking value"
                        value={formatMoney(
                          detailStats?.attributedBookingValue ?? detailStats?.grossBookingRevenue ?? 0
                        )}
                      />
                      <OpsMetric
                        label="Stay cash revenue"
                        value={formatMoneyFromCents(detailStats?.stayBookingRevenueCents ?? 0)}
                      />
                      <OpsMetric label="Gift vouchers sold" value={detailStats?.giftVoucherPurchases ?? 0} />
                      <OpsMetric
                        label="Gift voucher revenue"
                        value={formatMoneyFromCents(detailStats?.giftVoucherRevenueCents ?? 0)}
                      />
                      <OpsMetric
                        label="Stay projected commission (not payable)"
                        value={formatMoneyFromCents(detailStats?.stayBookingCommissionCents ?? 0)}
                      />
                      <OpsMetric
                        label="Voucher commission total (mixed status)"
                        value={formatMoneyFromCents(detailStats?.giftVoucherCommissionCents ?? 0)}
                      />
                      <OpsMetric
                        label="Total projected commission (not payable)"
                        value={formatMoneyFromCents(detailStats?.totalCommissionCents ?? 0)}
                      />
                      <OpsMetric
                        label="Projected commission (not payable)"
                        value={formatMoney(
                          (detailStats?.commissionableRevenueEstimate || 0) *
                            ((detailRow.commission?.rateBps || 0) / 10000)
                        )}
                      />
                    </OpsMetricGroup>
                  </OpsSurface>

                  <div className="ops-creator-partners-split">
                    <OpsSurface className="ops-creator-partners-section">
                      <OpsSurfaceTitle as="h3" className="ops-creator-partners-section__title">Tracking details</OpsSurfaceTitle>
                      <dl className="ops-creator-partners-kv">
                        <div className="ops-creator-partners-kv__row">
                          <dt className="ops-creator-partners-kv__label">Referral code:</dt>
                          <dd className="ops-creator-partners-kv__mono">{detailRow.referral?.code || '—'}</dd>
                        </div>
                        <div className="ops-creator-partners-kv__row">
                          <dt className="ops-creator-partners-kv__label">Promo code:</dt>
                          <dd className="ops-creator-partners-kv__mono">{detailRow.promo?.code || '—'}</dd>
                        </div>
                        <div className="ops-creator-partners-kv__row">
                          <dt className="ops-creator-partners-kv__label">Cookie days:</dt>
                          <dd>{detailRow.referral?.cookieDays ?? '—'}</dd>
                        </div>
                        <div className="ops-creator-partners-kv__row">
                          <dt className="ops-creator-partners-kv__label">Conversion:</dt>
                          <dd>{formatPercentRatio(detailStats?.conversionRate ?? 0)}</dd>
                        </div>
                      </dl>
                    </OpsSurface>
                    <OpsSurface className="ops-creator-partners-section">
                      <OpsSurfaceTitle as="h3" className="ops-creator-partners-section__title">Recent activity</OpsSurfaceTitle>
                      <dl className="ops-creator-partners-kv">
                        <div className="ops-creator-partners-kv__row">
                          <dt className="ops-creator-partners-kv__label">Last visit:</dt>
                          <dd>{formatDateTime(detailStats?.lastVisitAt)}</dd>
                        </div>
                        <div className="ops-creator-partners-kv__row">
                          <dt className="ops-creator-partners-kv__label">Last booking:</dt>
                          <dd>{formatDateTime(detailStats?.lastBookingAt)}</dd>
                        </div>
                        <div className="ops-creator-partners-kv__row">
                          <dt className="ops-creator-partners-kv__label">Cancelled/refunded/void:</dt>
                          <dd>{detailStats?.cancelledRefundedVoidBookings ?? 0}</dd>
                        </div>
                      </dl>
                    </OpsSurface>
                  </div>

                  <OpsSurface className="ops-creator-partners-section">
                    <OpsSurfaceTitle as="h3" className="ops-creator-partners-section__title">Content agreement / notes</OpsSurfaceTitle>
                    <div className="ops-creator-partners-kv-grid">
                      <div>
                        <span className="ops-creator-partners-kv__label">Comp stay offered:</span>{' '}
                        {detailRow.contentAgreement?.compStayOffered ? 'Yes' : 'No'}
                      </div>
                      <div>
                        <span className="ops-creator-partners-kv__label">Agreed at:</span>{' '}
                        {formatDateTime(detailRow.contentAgreement?.agreedAt)}
                      </div>
                      <div className="ops-creator-partners-kv-grid__span-2">
                        <span className="ops-creator-partners-kv__label">Deliverables:</span>{' '}
                        {detailRow.contentAgreement?.deliverables || '—'}
                      </div>
                      <div className="ops-creator-partners-kv-grid__span-2">
                        <span className="ops-creator-partners-kv__label">Usage rights:</span>{' '}
                        {detailRow.contentAgreement?.usageRights || '—'}
                      </div>
                      <div className="ops-creator-partners-kv-grid__span-2">
                        <span className="ops-creator-partners-kv__label">Notes:</span> {detailRow.notes || '—'}
                      </div>
                    </div>
                  </OpsSurface>
                </>
              ) : null}

              {detailTab === 'bookings' ? (
                <OpsSurface className="ops-creator-partners-section">
                  <OpsSurfaceTitle as="h3" className="ops-creator-partners-section__title">Bookings</OpsSurfaceTitle>
                  <div className="ops-creator-partners-table-wrap">
                    <OpsTable caption="Attributed bookings">
                      <OpsTableHead>
                        <OpsTableRow>
                          <OpsTableHeader>Booking</OpsTableHeader>
                          <OpsTableHeader>Guest</OpsTableHeader>
                          <OpsTableHeader>Cabin/entity</OpsTableHeader>
                          <OpsTableHeader>Check-in/out</OpsTableHeader>
                          <OpsTableHeader>Status</OpsTableHeader>
                          <OpsTableHeader>Source</OpsTableHeader>
                          <OpsTableHeader>Referral</OpsTableHeader>
                          <OpsTableHeader>Promo</OpsTableHeader>
                          <OpsTableHeader align="end" numeric>
                            Subtotal
                          </OpsTableHeader>
                          <OpsTableHeader align="end" numeric>
                            Discount
                          </OpsTableHeader>
                          <OpsTableHeader align="end" numeric>
                            Total
                          </OpsTableHeader>
                          <OpsTableHeader>Created</OpsTableHeader>
                        </OpsTableRow>
                      </OpsTableHead>
                      <OpsTableBody>
                        {detailBookings.length === 0 ? (
                          <OpsTableRow>
                            <OpsTableCell colSpan={12}>No attributed bookings.</OpsTableCell>
                          </OpsTableRow>
                        ) : (
                          detailBookings.map((b) => (
                            <OpsTableRow key={b.bookingId}>
                              <OpsTableCell>
                                <span className="ops-creator-partners-mono">{b.bookingId}</span>
                              </OpsTableCell>
                              <OpsTableCell>
                                <div className="ops-creator-partners-guest">
                                  <p className="ops-creator-partners-guest__name">{b.guestName || '—'}</p>
                                  <p className="ops-creator-partners-guest__email">{b.guestEmail || '—'}</p>
                                </div>
                              </OpsTableCell>
                              <OpsTableCell>{b.cabinLabel || '—'}</OpsTableCell>
                              <OpsTableCell>
                                <span className="ops-creator-partners-nowrap">
                                  {formatDateTime(b.checkIn)} / {formatDateTime(b.checkOut)}
                                </span>
                              </OpsTableCell>
                              <OpsTableCell>
                                {b.status ? (
                                  <OpsStatus domain="reservation" value={b.status} />
                                ) : (
                                  '—'
                                )}
                              </OpsTableCell>
                              <OpsTableCell>{b.attributionSource || '—'}</OpsTableCell>
                              <OpsTableCell>
                                <span className="ops-creator-partners-mono">{b.referralCode || '—'}</span>
                              </OpsTableCell>
                              <OpsTableCell>
                                <span className="ops-creator-partners-mono">{b.promoCode || '—'}</span>
                              </OpsTableCell>
                              <OpsTableCell align="end" numeric>
                                {formatMoney(b.subtotalPrice)}
                              </OpsTableCell>
                              <OpsTableCell align="end" numeric>
                                {formatMoney(b.discountAmount)}
                              </OpsTableCell>
                              <OpsTableCell align="end" numeric>
                                {formatMoney(b.totalPrice)}
                              </OpsTableCell>
                              <OpsTableCell>
                                <span className="ops-creator-partners-nowrap">
                                  {formatDateTime(b.createdAt)}
                                </span>
                              </OpsTableCell>
                            </OpsTableRow>
                          ))
                        )}
                      </OpsTableBody>
                    </OpsTable>
                  </div>
                </OpsSurface>
              ) : null}

              {detailTab === 'commissions' ? (
                <OpsSurface className="ops-creator-partners-section">
                  <OpsSurfaceHeader className="ops-creator-partners-section__head">
                    <OpsSurfaceTitle as="h3" className="ops-creator-partners-section__title">Commission ledger</OpsSurfaceTitle>
                    <div className="ops-creator-partners-commission-totals">
                      <span>
                        Pending eligible:{' '}
                        <strong>{formatMoney(commissionPendingEligibleTotal)}</strong>
                      </span>
                      <span>
                        Approved: <strong>{formatMoney(commissionApprovedTotal)}</strong>
                      </span>
                      <span>
                        Due total: <strong>{formatMoney(commissionDueTotal)}</strong>
                      </span>
                      <span>
                        Paid: <strong>{formatMoney(commissionPaidTotal)}</strong>
                      </span>
                      <span>
                        Voided: <strong>{formatMoney(commissionVoidTotal)}</strong>
                      </span>
                      <OpsButton
                        variant="secondary"
                        size="compact"
                        onClick={recalculateCommission}
                        disabled={commissionActionBusyId === 'recalculate'}
                        loading={commissionActionBusyId === 'recalculate'}
                        loadingLabel="Recalculating…"
                      >
                        Recalculate
                      </OpsButton>
                    </div>
                  </OpsSurfaceHeader>
                  <OpsBanner
                    tone="warning"
                    body="Manual workflow only. These actions do not trigger Stripe or real payouts."
                  />
                  <div className="ops-creator-partners-table-wrap">
                    <OpsTable caption="Commission ledger">
                      <OpsTableHead>
                        <OpsTableRow>
                          <OpsTableHeader>Booking</OpsTableHeader>
                          <OpsTableHeader>Guest</OpsTableHeader>
                          <OpsTableHeader>Source</OpsTableHeader>
                          <OpsTableHeader align="end" numeric>
                            Commissionable revenue
                          </OpsTableHeader>
                          <OpsTableHeader align="end" numeric>
                            Rate
                          </OpsTableHeader>
                          <OpsTableHeader align="end" numeric>
                            Amount
                          </OpsTableHeader>
                          <OpsTableHeader>Eligibility</OpsTableHeader>
                          <OpsTableHeader>Status</OpsTableHeader>
                          <OpsTableHeader>Void reason</OpsTableHeader>
                          <OpsTableHeader>Calculated</OpsTableHeader>
                          <OpsTableHeader>Approved</OpsTableHeader>
                          <OpsTableHeader>Paid</OpsTableHeader>
                          <OpsTableHeader>Actions</OpsTableHeader>
                        </OpsTableRow>
                      </OpsTableHead>
                      <OpsTableBody>
                        {detailCommission.length === 0 ? (
                          <OpsTableRow>
                            <OpsTableCell colSpan={13}>No commission rows yet.</OpsTableCell>
                          </OpsTableRow>
                        ) : (
                          detailCommission.map((entry) => {
                            const canApprove =
                              entry.status === 'pending' && entry.eligibilityStatus === 'eligible';
                            const canMarkPaid = entry.status === 'approved';
                            const canVoid = entry.status === 'pending' || entry.status === 'approved';
                            const busy = commissionActionBusyId === entry._id;
                            return (
                              <OpsTableRow key={entry._id}>
                                <OpsTableCell>
                                  <span className="ops-creator-partners-mono">{entry.bookingId || '—'}</span>
                                </OpsTableCell>
                                <OpsTableCell>—</OpsTableCell>
                                <OpsTableCell>{entry.source || '—'}</OpsTableCell>
                                <OpsTableCell align="end" numeric>
                                  {formatMoney(
                                    entry.commissionableRevenueSnapshot,
                                    entry.currency || 'EUR'
                                  )}
                                </OpsTableCell>
                                <OpsTableCell align="end" numeric>
                                  {((entry.rateBpsSnapshot || 0) / 100).toFixed(2)}%
                                </OpsTableCell>
                                <OpsTableCell align="end" numeric>
                                  {formatMoney(entry.amountSnapshot, entry.currency || 'EUR')}
                                </OpsTableCell>
                                <OpsTableCell>
                                  {entry.eligibilityStatus ? (
                                    <OpsStatus domain="commission" value={entry.eligibilityStatus} />
                                  ) : (
                                    '—'
                                  )}
                                </OpsTableCell>
                                <OpsTableCell>
                                  {entry.status ? (
                                    <OpsStatus domain="commission" value={entry.status} />
                                  ) : (
                                    '—'
                                  )}
                                </OpsTableCell>
                                <OpsTableCell>{entry.voidReason || '—'}</OpsTableCell>
                                <OpsTableCell>
                                  <span className="ops-creator-partners-nowrap">
                                    {formatDateTime(entry.calculatedAt)}
                                  </span>
                                </OpsTableCell>
                                <OpsTableCell>
                                  <span className="ops-creator-partners-nowrap">
                                    {formatDateTime(entry.approvedAt)}
                                  </span>
                                </OpsTableCell>
                                <OpsTableCell>
                                  <span className="ops-creator-partners-nowrap">
                                    {formatDateTime(entry.paidAt)}
                                  </span>
                                </OpsTableCell>
                                <OpsTableCell>
                                  <div className="ops-creator-partners-commission-actions">
                                    <div className="ops-creator-partners-commission-actions__row">
                                      <OpsButton
                                        variant="secondary"
                                        size="compact"
                                        disabled={!canApprove || busy}
                                        onClick={() => approveCommission(entry._id)}
                                      >
                                        Approve
                                      </OpsButton>
                                      <OpsButton
                                        variant="secondary"
                                        size="compact"
                                        disabled={!canMarkPaid || busy}
                                        onClick={() => markCommissionPaid(entry._id)}
                                      >
                                        Mark paid
                                      </OpsButton>
                                    </div>
                                    <div className="ops-creator-partners-commission-actions__void">
                                      <OpsTextField
                                        label="Void reason"
                                        placeholder="Void reason"
                                        value={voidDrafts[entry._id] || ''}
                                        onChange={(e) =>
                                          setVoidDrafts((prev) => ({
                                            ...prev,
                                            [entry._id]: e.target.value
                                          }))
                                        }
                                        disabled={!canVoid || busy}
                                      />
                                      <OpsButton
                                        variant="destructive"
                                        size="compact"
                                        disabled={!canVoid || busy}
                                        onClick={() => voidCommission(entry._id)}
                                      >
                                        Void
                                      </OpsButton>
                                    </div>
                                  </div>
                                </OpsTableCell>
                              </OpsTableRow>
                            );
                          })
                        )}
                      </OpsTableBody>
                    </OpsTable>
                  </div>
                </OpsSurface>
              ) : null}

              {detailTab === 'profile' ? (
                <OpsSurface className="ops-creator-partners-section">
                  <OpsSurfaceHeader className="ops-creator-partners-section__head">
                    <OpsSurfaceTitle as="h3" className="ops-creator-partners-section__title">Creator profile</OpsSurfaceTitle>
                    <OpsButton
                      variant="secondary"
                      size="compact"
                      onClick={() => {
                        closeDetails();
                        openEdit(detailRow);
                      }}
                    >
                      Edit creator
                    </OpsButton>
                  </OpsSurfaceHeader>
                  <div className="ops-creator-partners-profile-grid">
                    <div>
                      <span className="ops-creator-partners-kv__label">Name:</span> {detailRow.name}
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">Status:</span>{' '}
                      <OpsStatus domain="partner" value={detailRow.status} />
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">Slug:</span>{' '}
                      <span className="ops-creator-partners-mono">{detailRow.slug || '—'}</span>
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">Promo code:</span>{' '}
                      <span className="ops-creator-partners-mono">{detailRow.promo?.code || '—'}</span>
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">Contact email:</span>{' '}
                      {detailRow.contact?.email || '—'}
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">Contact phone:</span>{' '}
                      {detailRow.contact?.phone || '—'}
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">Instagram:</span>{' '}
                      {detailRow.profiles?.instagram || '—'}
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">TikTok:</span>{' '}
                      {detailRow.profiles?.tiktok || '—'}
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">YouTube:</span>{' '}
                      {detailRow.profiles?.youtube || '—'}
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">Website:</span>{' '}
                      {detailRow.profiles?.website || '—'}
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">Commission rate:</span>{' '}
                      {((detailRow.commission?.rateBps || 0) / 100).toFixed(2)}%
                    </div>
                    <div>
                      <span className="ops-creator-partners-kv__label">Eligible after:</span>{' '}
                      {detailRow.commission?.eligibleAfter || '—'}
                    </div>
                  </div>
                  {mainProfileHref(detailRow) ? (
                    <div>
                      <a
                        className="ops-button ops-button--secondary ops-button--compact"
                        href={mainProfileHref(detailRow)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open profile link
                      </a>
                    </div>
                  ) : null}
                </OpsSurface>
              ) : null}
            </>
          ) : null}
        </div>
      </OpsModal>

      <OpsModal
        open={drawerOpen}
        onClose={closeDrawer}
        title={editingId ? 'Edit creator partner' : 'New creator partner'}
        footer={
          <>
            <OpsButton variant="secondary" onClick={closeDrawer}>
              Cancel
            </OpsButton>
            <OpsButton type="submit" form="ops-creator-form" loading={saving} loadingLabel="Saving…">
              Save
            </OpsButton>
          </>
        }
      >
        <form
          id="ops-creator-form"
          className="ops-creator-partners-form"
          onSubmit={handleSubmit}
          autoComplete="off"
        >
          {drawerSubmitError ? <OpsInlineError>{drawerSubmitError}</OpsInlineError> : null}
          <div className="ops-creator-partners-form__grid">
            <OpsTextField
              className="ops-creator-partners-form__span-2"
              label="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <OpsTextField
              className="ops-creator-partners-form__mono"
              label="Slug"
              value={form.slug}
              onChange={(e) => {
                setForm((f) => ({ ...f, slug: e.target.value }));
                setDrawerFieldErrors((er) => ({ ...er, slug: '' }));
                setDrawerSubmitError('');
              }}
              required
              error={drawerFieldErrors.slug || undefined}
            />
            <OpsSelect
              label="Status"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </OpsSelect>
            <OpsTextField
              label="Contact email"
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
            />
            <OpsTextField
              label="Contact phone"
              value={form.contactPhone}
              onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
            />
            <OpsTextField
              label="Instagram"
              value={form.instagram}
              onChange={(e) => setForm((f) => ({ ...f, instagram: e.target.value }))}
              placeholder="URL or handle"
            />
            <OpsTextField
              label="TikTok"
              value={form.tiktok}
              onChange={(e) => setForm((f) => ({ ...f, tiktok: e.target.value }))}
            />
            <OpsTextField
              label="YouTube"
              value={form.youtube}
              onChange={(e) => setForm((f) => ({ ...f, youtube: e.target.value }))}
            />
            <OpsTextField
              label="Website"
              value={form.website}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            />
            <OpsTextField
              className="ops-creator-partners-form__mono"
              label="Referral code"
              value={form.referralCode}
              onChange={(e) => {
                setForm((f) => ({ ...f, referralCode: e.target.value }));
                setDrawerFieldErrors((er) => ({ ...er, referral: '' }));
                setDrawerSubmitError('');
              }}
              required
              error={drawerFieldErrors.referral || undefined}
            />
            <OpsTextField
              label="Cookie days"
              type="number"
              min={0}
              value={form.cookieDays}
              onChange={(e) => setForm((f) => ({ ...f, cookieDays: e.target.value }))}
            />
            <div className="ops-creator-partners-form__span-2">
              <OpsTextField
                className="ops-creator-partners-form__promo"
                label="Promo code (optional)"
                value={form.promoCode}
                onChange={(e) => setForm((f) => ({ ...f, promoCode: e.target.value }))}
                placeholder="Must exist in Ops promo codes; unknown codes save with a warning"
              />
              <p className="ops-creator-partners-form__hint">
                If the code is missing, save anyway and add it later under{' '}
                <a href="/ops/promo-codes">Promo codes</a>.
              </p>
            </div>
            <OpsTextField
              label="Commission rate (%)"
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={form.commissionPercent}
              onChange={(e) => {
                setForm((f) => ({ ...f, commissionPercent: e.target.value }));
                setDrawerFieldErrors((er) => ({ ...er, commission: '' }));
                setDrawerSubmitError('');
              }}
              error={drawerFieldErrors.commission || undefined}
            />
            <div>
              <OpsTextField
                className="ops-creator-partners-form__readonly"
                label="Commission basis"
                readOnly
                value={form.commissionBasis}
              />
              <p className="ops-creator-partners-form__hint">Only accommodation net is supported today.</p>
            </div>
            <OpsSelect
              className="ops-creator-partners-form__span-2"
              label="Eligible after"
              value={form.eligibleAfter}
              onChange={(e) => setForm((f) => ({ ...f, eligibleAfter: e.target.value }))}
            >
              <option value="stay_completed">Stay completed</option>
              <option value="manual_approval">Manual approval</option>
            </OpsSelect>
            <div className="ops-creator-partners-form__span-2">
              <OpsCheckbox
                label="Comp stay offered"
                checked={form.compStayOffered}
                onChange={(e) => setForm((f) => ({ ...f, compStayOffered: e.target.checked }))}
              />
            </div>
            <OpsTextarea
              className="ops-creator-partners-form__span-2"
              label="Deliverables"
              rows={3}
              value={form.deliverables}
              onChange={(e) => setForm((f) => ({ ...f, deliverables: e.target.value }))}
            />
            <OpsTextarea
              className="ops-creator-partners-form__span-2"
              label="Usage rights"
              rows={3}
              value={form.usageRights}
              onChange={(e) => setForm((f) => ({ ...f, usageRights: e.target.value }))}
            />
            <OpsTextField
              className="ops-creator-partners-form__span-2"
              label="Agreed at"
              type="datetime-local"
              value={form.agreedAt}
              onChange={(e) => setForm((f) => ({ ...f, agreedAt: e.target.value }))}
            />
            <OpsTextarea
              className="ops-creator-partners-form__span-2"
              label="Notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </form>
      </OpsModal>

      <OpsModal open={portalLinkOpen} onClose={clearPortalLinkModal} title="Creator portal link">
        <div className="ops-creator-partners-portal">
          {portalLinkBusyId && !portalLinkPayload && !portalLinkError ? (
            <OpsLoadingState label="Generating link…" />
          ) : null}
          {portalLinkError ? <OpsInlineError>{portalLinkError}</OpsInlineError> : null}
          {portalLinkPayload ? (
            <>
              <p className="ops-creator-partners-portal__copy">
                <strong>{portalLinkPayload.partnerName}</strong> — one-time login URL. Issuing a new link
                revokes earlier active links for this partner.
              </p>
              <OpsBanner
                tone="warning"
                body="This link gives read-only access to this creator's portal. Share only with the creator."
              />
              <OpsTextField
                className="ops-creator-partners-portal__url"
                label="Portal link"
                readOnly
                value={portalLinkPayload.verifyUrl}
                onFocus={(e) => e.target.select()}
              />
              <p className="ops-creator-partners-portal__expiry">
                <span>Expires:</span> <strong>{formatDateTime(portalLinkPayload.expiresAt)}</strong>
              </p>
              <div className="ops-creator-partners-portal__actions">
                <OpsButton onClick={copyPortalVerifyUrl}>Copy link</OpsButton>
                {portalLinkCopyHint ? (
                  <p className="ops-creator-partners-portal__hint">{portalLinkCopyHint}</p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </OpsModal>
    </OpsPage>
  );
}
