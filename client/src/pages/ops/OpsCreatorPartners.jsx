import { useCallback, useEffect, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

/** Mirrors server/models/CreatorPartner.js PARTNER_KEY_RE */
const PARTNER_KEY_RE = /^[a-z0-9_-]{1,80}$/;

function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function emptyForm() {
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
  const slug = (form.slug || '').trim().toLowerCase();
  const referralCode = (form.referralCode || '').trim().toLowerCase();
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

function validateFormLocal(form) {
  const slug = (form.slug || '').trim().toLowerCase();
  const referralCode = (form.referralCode || '').trim().toLowerCase();
  if (!PARTNER_KEY_RE.test(slug)) {
    return 'Slug must be 1–80 characters: lowercase letters, digits, hyphen, or underscore.';
  }
  if (!PARTNER_KEY_RE.test(referralCode)) {
    return 'Referral code must be 1–80 characters: lowercase letters, digits, hyphen, or underscore.';
  }
  const pct = Number(form.commissionPercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return 'Commission rate must be between 0 and 100 percent.';
  }
  return '';
}

function referralUrl(code) {
  if (typeof window === 'undefined' || !code) return '';
  return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
}

export default function OpsCreatorPartners() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState({ type: '', message: '' });
  const [statusFilter, setStatusFilter] = useState('all');
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      const res = await opsReadAPI.creatorPartners(params);
      setRows(res.data?.data?.creatorPartners || []);
    } catch (e) {
      setBanner({ type: 'error', message: e?.response?.data?.message || 'Failed to load creator partners' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters() {
    setSearch(draftSearch);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setBanner({ type: '', message: '' });
    setDrawerOpen(true);
  }

  function openEdit(row) {
    setEditingId(row._id);
    setForm(rowToForm(row));
    setBanner({ type: '', message: '' });
    setDrawerOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setBanner({ type: '', message: '' });
    const localErr = validateFormLocal(form);
    if (localErr) {
      setBanner({ type: 'error', message: localErr });
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
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setBanner({ type: 'error', message: formatAxiosMessage(err) });
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

  async function copyReferralLink(code) {
    const url = referralUrl(code);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setBanner({ type: 'success', message: 'Referral link copied to clipboard.' });
    } catch {
      setBanner({ type: 'error', message: 'Could not copy link. Copy manually from the table.' });
    }
  }

  function formatUpdated(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '—';
    }
  }

  function commissionPercentDisplay(partner) {
    const bps = partner.commission?.rateBps;
    if (typeof bps !== 'number') return '—';
    return `${bps / 100}%`;
  }

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

      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-600">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 font-mono">Referral</th>
                  <th className="px-4 py-3 font-mono">Promo</th>
                  <th className="px-4 py-3">Commission</th>
                  <th className="px-4 py-3">Profile link</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      No creator partners match your filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const href = mainProfileHref(r);
                    return (
                      <tr key={r._id} className="hover:bg-gray-50/80">
                        <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                        <td className="px-4 py-3 text-gray-700 capitalize">{r.status}</td>
                        <td className="px-4 py-3 font-mono text-gray-800">{r.referral?.code || '—'}</td>
                        <td className="px-4 py-3 font-mono text-gray-700">{r.promo?.code || '—'}</td>
                        <td className="px-4 py-3 tabular-nums text-gray-800">{commissionPercentDisplay(r)}</td>
                        <td className="px-4 py-3 max-w-[10rem] md:max-w-xs truncate">
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#81887A] font-medium hover:underline truncate inline-block max-w-full"
                            >
                              {href}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatUpdated(r.updatedAt)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex flex-wrap justify-end gap-x-2 gap-y-1">
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              className="text-[#81887A] font-medium hover:underline"
                            >
                              Edit
                            </button>
                            {r.status !== 'paused' && r.status !== 'archived' ? (
                              <button
                                type="button"
                                onClick={() => patchStatus(r, 'paused')}
                                className="text-gray-600 font-medium hover:underline"
                              >
                                Pause
                              </button>
                            ) : null}
                            {r.status !== 'archived' ? (
                              <button
                                type="button"
                                onClick={() => patchStatus(r, 'archived')}
                                className="text-gray-600 font-medium hover:underline"
                              >
                                Archive
                              </button>
                            ) : null}
                            {r.referral?.code ? (
                              <button
                                type="button"
                                onClick={() => copyReferralLink(r.referral.code)}
                                className="text-gray-600 font-medium hover:underline"
                              >
                                Copy link
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 md:px-6 flex flex-wrap items-center justify-between gap-3 z-10">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Edit creator partner' : 'New creator partner'}
              </h3>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4">
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono lowercase"
                    value={form.slug}
                    onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                    required
                  />
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono lowercase"
                    value={form.referralCode}
                    onChange={(e) => setForm((f) => ({ ...f, referralCode: e.target.value }))}
                    required
                  />
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums"
                    value={form.commissionPercent}
                    onChange={(e) => setForm((f) => ({ ...f, commissionPercent: e.target.value }))}
                  />
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
                  onClick={() => setDrawerOpen(false)}
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
