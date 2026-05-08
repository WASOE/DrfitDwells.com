import { useCallback, useEffect, useMemo, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

/** Mirrors server/models/CreatorPartner.js — slug only (no dots). */
const PARTNER_KEY_RE = /^[a-z0-9_-]{1,80}$/;
/** Instagram-style referral codes; mirrors server REFERRAL_CODE_RE */
const REFERRAL_CODE_RE = /^[a-z0-9_.-]{1,80}$/;

const SLUG_MSG =
  'Slug must be 1–80 characters: lowercase letters, digits, hyphen, or underscore.';
const REFERRAL_MSG =
  'Referral code must be 1–80 characters: lowercase letters, digits, dot, hyphen, or underscore. Optional leading @ is removed.';
const COMMISSION_MSG = 'Commission rate must be between 0 and 100 percent.';

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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
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
  const cookieDays =
    Number.isFinite(rawCd) && rawCd >= 1 && rawCd <= 365 ? rawCd : 60;

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

  const refreshSelectedCreatorDetails = useCallback(
    async (creatorId) => {
      const [statsRes, bookingsRes, commissionRes] = await Promise.all([
        opsReadAPI.creatorPartnerStatsById(creatorId),
        opsReadAPI.creatorPartnerBookings(creatorId, { limit: 100 }),
        opsReadAPI.creatorPartnerCommission(creatorId, { limit: 100 })
      ]);
      setDetailStats(statsRes.data?.data?.stats || null);
      setDetailBookings(bookingsRes.data?.data?.bookings || []);
      setDetailCommission(commissionRes.data?.data?.entries || []);
    },
    []
  );

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
        .filter((entry) => entry.status === 'approved' || (entry.status === 'pending' && entry.eligibilityStatus === 'eligible'))
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

  return (
    <div className="space-y-4 pb-16 sm:pb-0 max-w-7xl mx-auto px-4 py-6 md:py-8">
      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-2xl md:text-3xl font-semibold text-gray-900 tracking-tight">Creator partners</h1>
            <p className="mt-2 text-sm md:text-base text-gray-600">
              Manage influencer and creator partnerships: referral codes, linked promos, and commission settings.
              Unknown promo codes save with a warning — create the promo under Promo codes when ready.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="shrink-0 px-4 py-2.5 text-sm font-medium text-white bg-[#81887A] rounded-lg hover:bg-[#707668] w-full sm:w-auto"
          >
            Add creator
          </button>
        </div>
      </section>

      {banner.message ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            banner.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-900'
              : banner.type === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {banner.message}
        </div>
      ) : null}

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Filters</h2>
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="w-full md:flex-1 md:min-w-[12rem] max-w-md">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="Name, slug, referral, email…"
            />
          </div>
          <div className="w-full sm:w-auto sm:min-w-[10rem]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <button
            type="button"
            onClick={applyFilters}
            className="px-4 py-2 text-sm font-medium text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 w-full sm:w-auto"
          >
            Apply search
          </button>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Partners</h2>
        {loading ? (
          <div className="py-8 text-sm text-gray-600">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
            No creator partners match your filters.
          </div>
        ) : (
          <ul className="space-y-4">
            {rows.map((r) => {
              const stats = statsById[r._id] || {};
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
              const projectedCommission = formatMoney(
                commissionEstimate * ((r.commission?.rateBps || 0) / 10000)
              );
              return (
                <li key={r._id}>
                  <article className="rounded-lg border border-gray-200 bg-white p-4 md:p-5 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <h3 className="text-base font-semibold text-gray-900">{r.name}</h3>
                          <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium capitalize text-gray-800">
                            {r.status}
                          </span>
                          <span className="font-mono text-sm text-gray-800">{r.referral?.code || '—'}</span>
                        </div>
                        <p className="text-xs text-gray-500">
                          Last activity · <span className="text-gray-700">{formatDateTime(lastActivity)}</span>
                        </p>
                      </div>
                    </div>

                    <dl className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 text-sm">
                      <div className="rounded-md border border-gray-100 bg-gray-50/90 px-3 py-2 min-w-0">
                        <dt className="text-xs text-gray-500 leading-snug">Visits / unique visitors</dt>
                        <dd className="mt-0.5 tabular-nums font-medium text-gray-900">
                          {visits} / {uniqueVisitors}
                        </dd>
                      </div>
                      <div className="rounded-md border border-gray-100 bg-gray-50/90 px-3 py-2 min-w-0">
                        <dt className="text-xs text-gray-500 leading-snug">Bookings / paid bookings</dt>
                        <dd className="mt-0.5 tabular-nums font-medium text-gray-900">
                          {attributedBookings} / {paidBookings}
                        </dd>
                      </div>
                      <div className="rounded-md border border-gray-100 bg-gray-50/90 px-3 py-2 min-w-0">
                        <dt className="text-xs text-gray-500 leading-snug">Paid stay revenue</dt>
                        <dd className="mt-0.5 tabular-nums font-medium text-gray-900">{formatMoney(paidRevenue)}</dd>
                      </div>
                      <div className="rounded-md border border-gray-100 bg-gray-50/90 px-3 py-2 min-w-0">
                        <dt className="text-xs text-gray-500 leading-snug">Attributed booking value</dt>
                        <dd className="mt-0.5 tabular-nums font-medium text-gray-900">
                          {formatMoney(attributedBookingValue)}
                        </dd>
                      </div>
                      <div className="rounded-md border border-gray-100 bg-gray-50/90 px-3 py-2 min-w-0">
                        <dt className="text-xs text-gray-500 leading-snug">Gift vouchers</dt>
                        <dd className="mt-0.5 text-gray-900">
                          <span className="tabular-nums font-medium">{gvPurchases}</span>
                          <span className="text-gray-500 font-normal"> sales · </span>
                          <span className="tabular-nums font-medium">{formatMoneyFromCents(gvRevCents)}</span>
                          <span className="block text-xs text-gray-500 mt-1">
                            Commission ·{' '}
                            <span className="tabular-nums text-gray-800">{formatMoneyFromCents(gvCommCents)}</span>
                          </span>
                        </dd>
                      </div>
                      <div className="rounded-md border border-gray-100 bg-gray-50/90 px-3 py-2 min-w-0">
                        <dt className="text-xs text-gray-500 leading-snug">Projected commission (not payable)</dt>
                        <dd className="mt-0.5 tabular-nums font-medium text-gray-900">{projectedCommission}</dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => openDetails(r)}
                        className="h-9 px-3 rounded-md bg-[#81887A] text-white text-xs font-medium hover:bg-[#707668]"
                      >
                        Details
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="h-9 px-3 rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      {r.referral?.code ? (
                        <button
                          type="button"
                          onClick={() => copyReferralLink(r.referral.code)}
                          className="h-9 px-3 rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Copy
                        </button>
                      ) : null}
                      {r.status === 'paused' ? (
                        <button
                          type="button"
                          onClick={() => patchStatus(r, 'active')}
                          className="h-9 px-3 rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Reactivate
                        </button>
                      ) : r.status !== 'archived' ? (
                        <button
                          type="button"
                          onClick={() => patchStatus(r, 'paused')}
                          className="h-9 px-3 rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Pause
                        </button>
                      ) : null}
                      {r.status !== 'archived' ? (
                        <button
                          type="button"
                          onClick={() => patchStatus(r, 'archived')}
                          className="h-9 px-3 rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Archive
                        </button>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {detailOpen ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-7xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 md:px-6 flex flex-wrap items-center justify-between gap-3 z-10">
              <h3 className="text-lg font-semibold text-gray-900">
                Creator performance: {detailRow?.name || 'Details'}
              </h3>
              <div className="flex items-center gap-2">
                {detailRow ? (
                  <button
                    type="button"
                    onClick={() => {
                      closeDetails();
                      openEdit(detailRow);
                    }}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50"
                  >
                    Edit creator
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={closeDetails}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="p-4 md:p-6 space-y-6">
              {detailError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{detailError}</div>
              ) : null}
              {detailLoading ? <div className="text-sm text-gray-600">Loading details…</div> : null}
              {!detailLoading && detailRow ? (
                <>
                  <section className="border border-gray-200 rounded-lg p-2">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {[
                        ['overview', 'Overview'],
                        ['bookings', 'Bookings'],
                        ['commissions', 'Commissions'],
                        ['profile', 'Profile']
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setDetailTab(id)}
                          className={`px-3 py-2 rounded-md text-sm font-medium ${
                            detailTab === id ? 'bg-[#81887A] text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </section>

                  {detailTab === 'overview' ? (
                    <>
                      <section className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-semibold text-gray-900 mb-3">Performance summary</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Visits</div><div className="font-semibold text-gray-900">{detailStats?.visits ?? 0}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Unique visitors</div><div className="font-semibold text-gray-900">{detailStats?.uniqueVisitors ?? 0}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Bookings</div><div className="font-semibold text-gray-900">{detailStats?.attributedBookings ?? 0}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Paid bookings</div><div className="font-semibold text-gray-900">{detailStats?.paidConfirmedBookings ?? 0}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Paid stay revenue</div><div className="font-semibold text-gray-900">{formatMoney(Number.isFinite(Number(detailStats?.paidStayRevenue)) ? Number(detailStats?.paidStayRevenue) : Number(detailStats?.stayBookingRevenueCents || 0) / 100)}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Attributed booking value</div><div className="font-semibold text-gray-900">{formatMoney(detailStats?.attributedBookingValue ?? detailStats?.grossBookingRevenue ?? 0)}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Stay cash revenue</div><div className="font-semibold text-gray-900">{formatMoneyFromCents(detailStats?.stayBookingRevenueCents ?? 0)}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Gift vouchers sold</div><div className="font-semibold text-gray-900">{detailStats?.giftVoucherPurchases ?? 0}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Gift voucher revenue</div><div className="font-semibold text-gray-900">{formatMoneyFromCents(detailStats?.giftVoucherRevenueCents ?? 0)}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Stay projected commission (not payable)</div><div className="font-semibold text-gray-900">{formatMoneyFromCents(detailStats?.stayBookingCommissionCents ?? 0)}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Voucher commission total (mixed status)</div><div className="font-semibold text-gray-900">{formatMoneyFromCents(detailStats?.giftVoucherCommissionCents ?? 0)}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Total projected commission (not payable)</div><div className="font-semibold text-gray-900">{formatMoneyFromCents(detailStats?.totalCommissionCents ?? 0)}</div></div>
                          <div className="rounded border border-gray-200 p-3"><div className="text-gray-500">Projected commission (not payable)</div><div className="font-semibold text-gray-900">{formatMoney((detailStats?.commissionableRevenueEstimate || 0) * ((detailRow.commission?.rateBps || 0) / 10000))}</div></div>
                        </div>
                      </section>

                      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="border border-gray-200 rounded-lg p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Tracking details</h4>
                          <div className="text-sm text-gray-700 space-y-1">
                            <div><span className="text-gray-500">Referral code:</span> <span className="font-mono">{detailRow.referral?.code || '—'}</span></div>
                            <div><span className="text-gray-500">Promo code:</span> <span className="font-mono">{detailRow.promo?.code || '—'}</span></div>
                            <div><span className="text-gray-500">Cookie days:</span> {detailRow.referral?.cookieDays ?? '—'}</div>
                            <div><span className="text-gray-500">Conversion:</span> {formatPercentRatio(detailStats?.conversionRate ?? 0)}</div>
                          </div>
                        </div>
                        <div className="border border-gray-200 rounded-lg p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Recent activity</h4>
                          <div className="text-sm text-gray-700 space-y-1">
                            <div><span className="text-gray-500">Last visit:</span> {formatDateTime(detailStats?.lastVisitAt)}</div>
                            <div><span className="text-gray-500">Last booking:</span> {formatDateTime(detailStats?.lastBookingAt)}</div>
                            <div><span className="text-gray-500">Cancelled/refunded/void:</span> {detailStats?.cancelledRefundedVoidBookings ?? 0}</div>
                          </div>
                        </div>
                      </section>

                      <section className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-semibold text-gray-900 mb-2">Content agreement / notes</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
                          <div><span className="text-gray-500">Comp stay offered:</span> {detailRow.contentAgreement?.compStayOffered ? 'Yes' : 'No'}</div>
                          <div><span className="text-gray-500">Agreed at:</span> {formatDateTime(detailRow.contentAgreement?.agreedAt)}</div>
                          <div className="md:col-span-2"><span className="text-gray-500">Deliverables:</span> {detailRow.contentAgreement?.deliverables || '—'}</div>
                          <div className="md:col-span-2"><span className="text-gray-500">Usage rights:</span> {detailRow.contentAgreement?.usageRights || '—'}</div>
                          <div className="md:col-span-2"><span className="text-gray-500">Notes:</span> {detailRow.notes || '—'}</div>
                        </div>
                      </section>
                    </>
                  ) : null}

                  {detailTab === 'bookings' ? (
                    <section className="border border-gray-200 rounded-lg p-4">
                    <h4 className="font-semibold text-gray-900 mb-3">Bookings</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                          <tr>
                            <th className="px-3 py-2">Booking</th>
                            <th className="px-3 py-2">Guest</th>
                            <th className="px-3 py-2">Cabin/entity</th>
                            <th className="px-3 py-2">Check-in/out</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Source</th>
                            <th className="px-3 py-2">Referral</th>
                            <th className="px-3 py-2">Promo</th>
                            <th className="px-3 py-2">Subtotal</th>
                            <th className="px-3 py-2">Discount</th>
                            <th className="px-3 py-2">Total</th>
                            <th className="px-3 py-2">Created</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {detailBookings.length === 0 ? (
                            <tr><td className="px-3 py-4 text-gray-500" colSpan={12}>No attributed bookings.</td></tr>
                          ) : detailBookings.map((b) => (
                            <tr key={b.bookingId}>
                              <td className="px-3 py-2 font-mono">{b.bookingId}</td>
                              <td className="px-3 py-2">
                                <div className="font-medium text-gray-900">{b.guestName || '—'}</div>
                                <div className="text-xs text-gray-500">{b.guestEmail || '—'}</div>
                              </td>
                              <td className="px-3 py-2">{b.cabinLabel || '—'}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(b.checkIn)} / {formatDateTime(b.checkOut)}</td>
                              <td className="px-3 py-2 capitalize">{b.status || '—'}</td>
                              <td className="px-3 py-2">{b.attributionSource || '—'}</td>
                              <td className="px-3 py-2 font-mono">{b.referralCode || '—'}</td>
                              <td className="px-3 py-2 font-mono">{b.promoCode || '—'}</td>
                              <td className="px-3 py-2">{formatMoney(b.subtotalPrice)}</td>
                              <td className="px-3 py-2">{formatMoney(b.discountAmount)}</td>
                              <td className="px-3 py-2">{formatMoney(b.totalPrice)}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(b.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </section>
                  ) : null}

                  {detailTab === 'commissions' ? (
                    <section className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h4 className="font-semibold text-gray-900">Commission ledger</h4>
                      <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm">
                        <span className="text-gray-600">Pending eligible: <span className="font-semibold text-gray-900">{formatMoney(commissionPendingEligibleTotal)}</span></span>
                        <span className="text-gray-600">Approved: <span className="font-semibold text-gray-900">{formatMoney(commissionApprovedTotal)}</span></span>
                        <span className="text-gray-600">Due total: <span className="font-semibold text-gray-900">{formatMoney(commissionDueTotal)}</span></span>
                        <span className="text-gray-600">Paid: <span className="font-semibold text-gray-900">{formatMoney(commissionPaidTotal)}</span></span>
                        <span className="text-gray-600">Voided: <span className="font-semibold text-gray-900">{formatMoney(commissionVoidTotal)}</span></span>
                        <button
                          type="button"
                          onClick={recalculateCommission}
                          disabled={commissionActionBusyId === 'recalculate'}
                          className="px-3 py-2 text-xs md:text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {commissionActionBusyId === 'recalculate' ? 'Recalculating…' : 'Recalculate'}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      Manual workflow only. These actions do not trigger Stripe or real payouts.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                          <tr>
                            <th className="px-3 py-2">Booking</th>
                            <th className="px-3 py-2">Guest</th>
                            <th className="px-3 py-2">Source</th>
                            <th className="px-3 py-2">Commissionable revenue</th>
                            <th className="px-3 py-2">Rate</th>
                            <th className="px-3 py-2">Amount</th>
                            <th className="px-3 py-2">Eligibility</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Void reason</th>
                            <th className="px-3 py-2">Calculated</th>
                            <th className="px-3 py-2">Approved</th>
                            <th className="px-3 py-2">Paid</th>
                            <th className="px-3 py-2">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {detailCommission.length === 0 ? (
                            <tr><td className="px-3 py-4 text-gray-500" colSpan={13}>No commission rows yet.</td></tr>
                          ) : detailCommission.map((entry) => {
                            const canApprove = entry.status === 'pending' && entry.eligibilityStatus === 'eligible';
                            const canMarkPaid = entry.status === 'approved';
                            const canVoid = entry.status === 'pending' || entry.status === 'approved';
                            const busy = commissionActionBusyId === entry._id;
                            return (
                              <tr key={entry._id}>
                                <td className="px-3 py-2 font-mono">{entry.bookingId || '—'}</td>
                                <td className="px-3 py-2 text-gray-500">—</td>
                                <td className="px-3 py-2">{entry.source || '—'}</td>
                                <td className="px-3 py-2">{formatMoney(entry.commissionableRevenueSnapshot, entry.currency || 'EUR')}</td>
                                <td className="px-3 py-2">{((entry.rateBpsSnapshot || 0) / 100).toFixed(2)}%</td>
                                <td className="px-3 py-2 font-semibold">{formatMoney(entry.amountSnapshot, entry.currency || 'EUR')}</td>
                                <td className="px-3 py-2">{entry.eligibilityStatus}</td>
                                <td className="px-3 py-2 capitalize">{entry.status}</td>
                                <td className="px-3 py-2">{entry.voidReason || '—'}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(entry.calculatedAt)}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(entry.approvedAt)}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(entry.paidAt)}</td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-col gap-2">
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        disabled={!canApprove || busy}
                                        onClick={() => approveCommission(entry._id)}
                                        className="px-2 py-1 rounded border border-gray-300 text-xs text-gray-800 disabled:opacity-50"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!canMarkPaid || busy}
                                        onClick={() => markCommissionPaid(entry._id)}
                                        className="px-2 py-1 rounded border border-gray-300 text-xs text-gray-800 disabled:opacity-50"
                                      >
                                        Mark paid
                                      </button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        placeholder="Void reason"
                                        value={voidDrafts[entry._id] || ''}
                                        onChange={(e) => setVoidDrafts((prev) => ({ ...prev, [entry._id]: e.target.value }))}
                                        className="w-full min-w-[10rem] rounded border border-gray-300 px-2 py-1 text-xs"
                                        disabled={!canVoid || busy}
                                      />
                                      <button
                                        type="button"
                                        disabled={!canVoid || busy}
                                        onClick={() => voidCommission(entry._id)}
                                        className="px-2 py-1 rounded border border-red-300 text-xs text-red-800 disabled:opacity-50"
                                      >
                                        Void
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    </section>
                  ) : null}

                  {detailTab === 'profile' ? (
                    <section className="border border-gray-200 rounded-lg p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <h4 className="font-semibold text-gray-900">Creator profile</h4>
                        <button
                          type="button"
                          onClick={() => {
                            closeDetails();
                            openEdit(detailRow);
                          }}
                          className="px-3 py-1.5 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Edit creator
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
                        <div><span className="text-gray-500">Name:</span> {detailRow.name}</div>
                        <div><span className="text-gray-500">Status:</span> <span className="capitalize">{detailRow.status}</span></div>
                        <div><span className="text-gray-500">Slug:</span> <span className="font-mono">{detailRow.slug || '—'}</span></div>
                        <div><span className="text-gray-500">Promo code:</span> <span className="font-mono">{detailRow.promo?.code || '—'}</span></div>
                        <div><span className="text-gray-500">Contact email:</span> {detailRow.contact?.email || '—'}</div>
                        <div><span className="text-gray-500">Contact phone:</span> {detailRow.contact?.phone || '—'}</div>
                        <div><span className="text-gray-500">Instagram:</span> {detailRow.profiles?.instagram || '—'}</div>
                        <div><span className="text-gray-500">TikTok:</span> {detailRow.profiles?.tiktok || '—'}</div>
                        <div><span className="text-gray-500">YouTube:</span> {detailRow.profiles?.youtube || '—'}</div>
                        <div><span className="text-gray-500">Website:</span> {detailRow.profiles?.website || '—'}</div>
                        <div><span className="text-gray-500">Commission rate:</span> {((detailRow.commission?.rateBps || 0) / 100).toFixed(2)}%</div>
                        <div><span className="text-gray-500">Eligible after:</span> {detailRow.commission?.eligibleAfter || '—'}</div>
                      </div>
                      {mainProfileHref(detailRow) ? (
                        <div className="mt-4">
                          <a
                            href={mainProfileHref(detailRow)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center px-3 py-2 rounded-md border border-gray-300 text-sm text-gray-800 hover:bg-gray-50"
                          >
                            Open profile link
                          </a>
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 md:px-6 flex flex-wrap items-center justify-between gap-3 z-10">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Edit creator partner' : 'New creator partner'}
              </h3>
              <button
                type="button"
                onClick={closeDrawer}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4" autoComplete="off">
              {drawerSubmitError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  {drawerSubmitError}
                </div>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Slug</label>
                  <input
                    className={`w-full rounded-lg border px-3 py-2 text-sm font-mono lowercase ${
                      drawerFieldErrors.slug ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'
                    }`}
                    value={form.slug}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, slug: e.target.value }));
                      setDrawerFieldErrors((er) => ({ ...er, slug: '' }));
                      setDrawerSubmitError('');
                    }}
                    required
                    aria-invalid={!!drawerFieldErrors.slug}
                  />
                  {drawerFieldErrors.slug ? (
                    <p className="mt-1 text-xs text-red-700">{drawerFieldErrors.slug}</p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                  <select
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contact email</label>
                  <input
                    type="email"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.contactEmail}
                    onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contact phone</label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.contactPhone}
                    onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Instagram</label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.instagram}
                    onChange={(e) => setForm((f) => ({ ...f, instagram: e.target.value }))}
                    placeholder="URL or handle"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">TikTok</label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.tiktok}
                    onChange={(e) => setForm((f) => ({ ...f, tiktok: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">YouTube</label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.youtube}
                    onChange={(e) => setForm((f) => ({ ...f, youtube: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Website</label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.website}
                    onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Referral code</label>
                  <input
                    className={`w-full rounded-lg border px-3 py-2 text-sm font-mono lowercase ${
                      drawerFieldErrors.referral ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'
                    }`}
                    value={form.referralCode}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, referralCode: e.target.value }));
                      setDrawerFieldErrors((er) => ({ ...er, referral: '' }));
                      setDrawerSubmitError('');
                    }}
                    required
                    aria-invalid={!!drawerFieldErrors.referral}
                  />
                  {drawerFieldErrors.referral ? (
                    <p className="mt-1 text-xs text-red-700">{drawerFieldErrors.referral}</p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cookie days</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums"
                    value={form.cookieDays}
                    onChange={(e) => setForm((f) => ({ ...f, cookieDays: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Promo code (optional)</label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase"
                    value={form.promoCode}
                    onChange={(e) => setForm((f) => ({ ...f, promoCode: e.target.value }))}
                    placeholder="Must exist in Ops promo codes; unknown codes save with a warning"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    If the code is missing, save anyway and add it later under{' '}
                    <a href="/ops/promo-codes" className="text-[#81887A] font-medium hover:underline">
                      Promo codes
                    </a>
                    .
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Commission rate (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    className={`w-full rounded-lg border px-3 py-2 text-sm tabular-nums ${
                      drawerFieldErrors.commission ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'
                    }`}
                    value={form.commissionPercent}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, commissionPercent: e.target.value }));
                      setDrawerFieldErrors((er) => ({ ...er, commission: '' }));
                      setDrawerSubmitError('');
                    }}
                    aria-invalid={!!drawerFieldErrors.commission}
                  />
                  {drawerFieldErrors.commission ? (
                    <p className="mt-1 text-xs text-red-700">{drawerFieldErrors.commission}</p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Commission basis</label>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 font-mono"
                    readOnly
                    value={form.commissionBasis}
                  />
                  <p className="mt-1 text-xs text-gray-500">Only accommodation net is supported today.</p>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Eligible after</label>
                  <select
                    className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.eligibleAfter}
                    onChange={(e) => setForm((f) => ({ ...f, eligibleAfter: e.target.value }))}
                  >
                    <option value="stay_completed">Stay completed</option>
                    <option value="manual_approval">Manual approval</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="flex items-center gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      checked={form.compStayOffered}
                      onChange={(e) => setForm((f) => ({ ...f, compStayOffered: e.target.checked }))}
                    />
                    Comp stay offered
                  </label>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Deliverables</label>
                  <textarea
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.deliverables}
                    onChange={(e) => setForm((f) => ({ ...f, deliverables: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Usage rights</label>
                  <textarea
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.usageRights}
                    onChange={(e) => setForm((f) => ({ ...f, usageRights: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Agreed at</label>
                  <input
                    type="datetime-local"
                    className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.agreedAt}
                    onChange={(e) => setForm((f) => ({ ...f, agreedAt: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <textarea
                    rows={2}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#81887A] rounded-lg hover:bg-[#707668] disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
