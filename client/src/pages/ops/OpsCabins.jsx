import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import OpsGalleryLightbox from '../../components/ops/OpsGalleryLightbox';

function listRowId(item) {
  if (item.kind === 'multi_unit_type') return `multi-${item.cabinTypeId}`;
  return `single-${item.cabinId}`;
}

function listHref(item) {
  if (item.kind === 'multi_unit_type') return `/ops/cabins/${item.cabinTypeId}`;
  return `/ops/cabins/${item.cabinId}`;
}

function thumbInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '—';
  const parts = s.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '';
  const out = `${a}${b}`.toUpperCase();
  return out || '—';
}

function normalizeMediaSrc(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return url;
  return `/uploads/cabins/${url}`;
}

const MEDIA_TAG_OPTIONS = [
  'bedroom',
  'living_room',
  'kitchen',
  'dining',
  'bathroom',
  'outdoor',
  'view',
  'hot_tub_sauna',
  'amenities',
  'floorplan',
  'map',
  'other'
];

function formatDateOnlyForOps(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return m ? m[1] : value.slice(0, 10);
  }
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return String(value);
  }
}

function normalizeExperienceKeySeed(name) {
  const source = String(name || '').trim().toLowerCase();
  if (!source) return '';
  const normalized = source.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized.slice(0, 40);
}

function buildExperienceKey(name, usedKeys) {
  const timestamp = Date.now();
  const seed = normalizeExperienceKeySeed(name);
  const base = seed ? `exp_${seed}_${timestamp}` : `exp_${timestamp}`;
  let key = base;
  let suffix = 1;
  while (usedKeys.has(key)) {
    key = `${base}_${suffix++}`;
  }
  usedKeys.add(key);
  return key;
}

function OpsReadOnlyDetailSection({ title, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-3 text-xs text-gray-700 space-y-2">{children}</div>
    </section>
  );
}

export function OpsCabinsList() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    location: '',
    capacity: '',
    pricePerNight: '',
    minNights: '1',
    hostName: ''
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await opsReadAPI.cabins({
          page,
          limit: 20,
          ...(searchQuery.trim() ? { search: searchQuery.trim() } : {})
        });
        if (!cancelled) setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load cabins');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, searchQuery]);

  useEffect(() => {
    if (!createOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setCreateOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createOpen]);

  const resetCreateForm = () => {
    setCreateForm({
      name: '',
      description: '',
      location: '',
      capacity: '',
      pricePerNight: '',
      minNights: '1',
      hostName: ''
    });
    setCreateError('');
  };

  const onSearchSubmit = (e) => {
    e.preventDefault();
    setSearchQuery(searchDraft.trim());
    setPage(1);
  };

  if (loading && !data) return <div className="text-sm text-gray-500">Loading cabins...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">No listings found.</div>;

  const pg = data.pagination || {};
  const totalPages = pg.totalPages || 1;

  return (
    <div className="space-y-4 pb-16 sm:pb-0 w-full">
      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 lg:gap-8">
          <div className="min-w-0 flex-1 text-left">
            <h2 className="text-lg font-semibold text-gray-900">Cabins &amp; unit types</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-2xl">
              Single cabins and multi-unit types (e.g. A-Frame). Use Create cabin for new single listings only.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto lg:items-start lg:justify-end lg:max-w-xl shrink-0">
            <button
              type="button"
              onClick={() => {
                resetCreateForm();
                setCreateOpen(true);
              }}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 whitespace-nowrap shrink-0 order-2 sm:order-1"
            >
              Create cabin
            </button>
            <form
              onSubmit={onSearchSubmit}
              className="flex flex-col sm:flex-row gap-2 sm:items-center w-full lg:min-w-[280px] lg:max-w-md order-1 sm:order-2"
            >
              <input
                type="search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search name, location, slug…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="px-4 py-2 text-sm rounded-lg bg-[#81887A] text-white hover:opacity-90 whitespace-nowrap shrink-0"
              >
                Search
              </button>
            </form>
          </div>
        </div>
      </section>

      {createOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-xl shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-200"
            role="dialog"
            aria-labelledby="ops-create-cabin-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 md:px-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="ops-create-cabin-title" className="text-base font-semibold text-gray-900">
                  Create single cabin
                </h3>
                <p className="text-xs text-gray-500 mt-1 max-w-md">
                  Creates a single cabin only. Multi-unit provisioning remains separate.
                </p>
              </div>
              <button
                type="button"
                className="text-sm text-gray-500 hover:text-gray-800 shrink-0 px-2 py-1"
                onClick={() => setCreateOpen(false)}
              >
                Close
              </button>
            </div>

            <form
              className="p-4 md:p-5 space-y-3 max-w-lg mx-auto w-full"
              onSubmit={async (e) => {
                e.preventDefault();
                setCreateError('');
                const name = createForm.name.trim();
                const description = createForm.description.trim();
                const location = createForm.location.trim();
                const cap = parseInt(String(createForm.capacity).trim(), 10);
                const price = Number(String(createForm.pricePerNight).trim());
                const minN = parseInt(String(createForm.minNights).trim(), 10);
                if (!name || !description || !location) {
                  setCreateError('Name, description, and location are required.');
                  return;
                }
                if (!Number.isFinite(cap) || cap < 1) {
                  setCreateError('Capacity must be a positive integer.');
                  return;
                }
                if (!Number.isFinite(price) || price <= 0) {
                  setCreateError('Price per night must be a positive number.');
                  return;
                }
                if (!Number.isFinite(minN) || minN < 1) {
                  setCreateError('Minimum nights must be a positive integer.');
                  return;
                }

                const payload = {
                  name,
                  description,
                  location,
                  capacity: cap,
                  pricePerNight: price,
                  minNights: minN
                };
                const hn = createForm.hostName.trim();
                if (hn) payload.hostName = hn;

                setCreateBusy(true);
                try {
                  const resp = await opsWriteAPI.createCabin(payload);
                  const cabin = resp?.data?.data?.cabin;
                  const id = cabin?._id != null ? String(cabin._id) : '';
                  setCreateOpen(false);
                  resetCreateForm();
                  if (id) navigate(`/ops/cabins/${id}`, { state: { opsFlash: 'cabin-created' } });
                  else navigate('/ops/cabins');
                } catch (err) {
                  const msg = err?.response?.data?.message;
                  const errs = err?.response?.data?.errors;
                  if (Array.isArray(errs) && errs.length) {
                    setCreateError(
                      errs.map((x) => (x.field ? `${x.field}: ${x.message}` : x.message)).join('; ')
                    );
                  } else {
                    setCreateError(msg || err.message || 'Failed to create cabin');
                  }
                } finally {
                  setCreateBusy(false);
                }
              }}
            >
              {createError ? (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{createError}</p>
              ) : null}

              <label className="block">
                <span className="text-xs font-medium text-gray-700">Name</span>
                <input
                  required
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  disabled={createBusy}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Description</span>
                <textarea
                  required
                  rows={4}
                  value={createForm.description}
                  onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-y min-h-[96px]"
                  disabled={createBusy}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Location</span>
                <input
                  required
                  type="text"
                  value={createForm.location}
                  onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  disabled={createBusy}
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-gray-700">Capacity (guests)</span>
                  <input
                    required
                    type="number"
                    min={1}
                    step={1}
                    value={createForm.capacity}
                    onChange={(e) => setCreateForm((f) => ({ ...f, capacity: e.target.value }))}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    disabled={createBusy}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-700">Price per night</span>
                  <input
                    required
                    type="number"
                    min={0}
                    step={0.01}
                    value={createForm.pricePerNight}
                    onChange={(e) => setCreateForm((f) => ({ ...f, pricePerNight: e.target.value }))}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    disabled={createBusy}
                  />
                </label>
              </div>
              <label className="block max-w-xs">
                <span className="text-xs font-medium text-gray-700">Minimum nights</span>
                <input
                  required
                  type="number"
                  min={1}
                  step={1}
                  value={createForm.minNights}
                  onChange={(e) => setCreateForm((f) => ({ ...f, minNights: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  disabled={createBusy}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Host name (optional)</span>
                <input
                  type="text"
                  value={createForm.hostName}
                  onChange={(e) => setCreateForm((f) => ({ ...f, hostName: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  disabled={createBusy}
                />
              </label>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="submit"
                  disabled={createBusy}
                  className="px-4 py-2 text-sm rounded-lg bg-[#81887A] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {createBusy ? 'Creating…' : 'Create cabin'}
                </button>
                <button
                  type="button"
                  disabled={createBusy}
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {data.items?.length === 0 ? (
          <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6 bg-white">No rows match your filters.</p>
        ) : null}
        {data.items?.map((c) => {
          const img = c.content?.imageUrl;
          return (
            <Link
              key={listRowId(c)}
              to={listHref(c)}
              className="block bg-white border border-gray-200 rounded-xl p-4 md:p-5 hover:bg-gray-50/80 hover:border-gray-300 transition-colors"
            >
              <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 lg:gap-6">
                <div className="shrink-0 flex lg:block">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 rounded-lg bg-gray-100 overflow-hidden border border-gray-100">
                    {img ? (
                      <img src={normalizeMediaSrc(img)} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-sm font-semibold text-gray-600 bg-gray-50">
                        {thumbInitials(c.name)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="min-w-0 flex-1 text-left space-y-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-base font-semibold text-gray-900">{c.name}</span>
                    {c.kind === 'multi_unit_type' ? (
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-100">
                        Multi-unit type
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200">
                        Single cabin
                      </span>
                    )}
                    {c.isActive === false ? (
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                        Inactive
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-gray-600">{c.location || '—'}</p>
                  {c.kind === 'multi_unit_type' && c.slug ? (
                    <p className="text-xs text-gray-400 font-mono">Slug: {c.slug}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap lg:flex-nowrap lg:content-start gap-2 lg:justify-end lg:max-w-xl lg:shrink-0 lg:pt-0.5">
                  {c.kind === 'multi_unit_type' ? (
                    <>
                      <span className="text-xs px-2.5 py-1 rounded border border-gray-200 bg-gray-50 whitespace-nowrap">
                        {c.operational.totalUnits ?? 0} units ({c.operational.activeUnits ?? 0} active)
                      </span>
                      {c.operational.blockedUnitsCount > 0 ? (
                        <span className="text-xs px-2.5 py-1 rounded border border-amber-200 bg-amber-50 text-amber-900 whitespace-nowrap">
                          {c.operational.blockedUnitsCount} w/ unit blocks
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  <span className="text-xs px-2.5 py-1 rounded border border-gray-200 bg-gray-50 whitespace-nowrap">
                    {c.operational.capacity ?? '—'} guests
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded border border-gray-200 bg-gray-50 whitespace-nowrap">
                    {c.operational.minNights ?? '—'} min nights
                  </span>
                  {c.kind === 'single_cabin' ? (
                    <span className="text-xs px-2.5 py-1 rounded border border-gray-200 bg-gray-50 whitespace-nowrap">
                      {c.operational.blockedDatesCount ?? 0} blocked nights
                    </span>
                  ) : null}
                  {c.kind === 'multi_unit_type' && c.operational.pricePerNight != null ? (
                    <span className="text-xs px-2.5 py-1 rounded border border-gray-200 bg-gray-50 whitespace-nowrap">
                      {c.operational.pricePerNight} / night
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500">
            Page {pg.page ?? page} of {totalPages} ({pg.total ?? '—'} total)
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function UnitAirbnbIcsRow({ unit: u, onReload }) {
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(u.displayName || '');
  const [adminNotes, setAdminNotes] = useState(u.adminNotes || '');
  const [isActive, setIsActive] = useState(u.isActive !== false);
  const [label, setLabel] = useState(u.airbnbListingLabel || '');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const hintTimeoutRef = useRef(null);

  useEffect(() => {
    setDisplayName(u.displayName || '');
    setAdminNotes(u.adminNotes || '');
    setIsActive(u.isActive !== false);
    setLabel(u.airbnbListingLabel || '');
  }, [u.unitId, u.displayName, u.adminNotes, u.isActive, u.airbnbListingLabel]);

  useEffect(
    () => () => {
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current);
        hintTimeoutRef.current = null;
      }
    },
    []
  );

  const fullUrl = useMemo(() => {
    if (u.icsExportUrl) return u.icsExportUrl;
    if (typeof window !== 'undefined' && u.icsExportPath) {
      return `${window.location.origin}${u.icsExportPath}`;
    }
    return u.icsExportPath || '';
  }, [u.icsExportPath, u.icsExportUrl]);

  const copy = async () => {
    if (!u.isActive || !fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setHint('Copied');
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = setTimeout(() => {
        setHint('');
        hintTimeoutRef.current = null;
      }, 2000);
    } catch {
      setHint('Copy failed');
    }
  };

  const saveUnit = async () => {
    setHint('');
    setBusy(true);
    try {
      await opsWriteAPI.patchUnitChannelLabel(u.unitId, {
        displayName,
        adminNotes,
        isActive,
        airbnbListingLabel: label
      });
      await onReload();
      setIsEditing(false);
      setHint('Saved');
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = setTimeout(() => {
        setHint('');
        hintTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      setHint(err?.response?.data?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setHint('');
    setDisplayName(u.displayName || '');
    setAdminNotes(u.adminNotes || '');
    setIsActive(u.isActive !== false);
    setLabel(u.airbnbListingLabel || '');
  };

  return (
    <tr className="border-b border-gray-100 align-top">
      <td className="py-2.5 pr-3 font-mono text-xs whitespace-nowrap">{u.unitNumber}</td>
      <td className="py-2.5 pr-3">
        {isEditing ? (
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={100}
            className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs"
            placeholder="Display name"
          />
        ) : (
          u.displayName || '—'
        )}
      </td>
      <td className="py-2.5 pr-3">
        {isEditing ? (
          <div className="space-y-1">
            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-gray-300"
              />
              Active
            </label>
            <p className="text-[11px] text-amber-700">
              Inactive units are excluded from assignment and availability.
            </p>
          </div>
        ) : (
          (u.isActive ? 'Yes' : 'No')
        )}
      </td>
      <td className="py-2.5 pr-3">{u.blockedDatesCount ?? 0}</td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-col gap-2 max-w-[260px]">
          {isEditing ? (
            <>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Airbnb listing name / id"
                className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                maxLength={200}
              />
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Internal notes for operators"
                className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveUnit}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-700 break-words">
                Label: {u.airbnbListingLabel || '—'}
              </p>
              <p className="text-xs text-gray-500 break-words">
                Notes: {u.adminNotes || '—'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(true);
                  setHint('');
                }}
                className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 w-fit"
              >
                Edit unit
              </button>
            </>
          )}
        </div>
      </td>
      <td className="py-2.5">
        {u.isActive ? (
          <div className="space-y-1.5 max-w-md">
            <p className="text-[11px] font-mono text-gray-700 break-all leading-snug">{fullUrl}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copy}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#81887A] text-white hover:opacity-90"
              >
                Copy ICS URL
              </button>
              {hint ? <span className="text-xs text-gray-500">{hint}</span> : null}
            </div>
          </div>
        ) : (
          <span className="text-xs text-gray-400">No export (inactive unit)</span>
        )}
      </td>
    </tr>
  );
}

function OpsCabinMediaManager({ titleId, isMulti, content, onReload }) {
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaMessage, setMediaMessage] = useState('');
  const [mediaError, setMediaError] = useState('');
  const uploadRef = useRef(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const mediaImages = useMemo(() => {
    const arr = Array.isArray(content?.images) ? [...content.images] : [];
    return arr.sort((a, b) => {
      if (Boolean(b?.isCover) !== Boolean(a?.isCover)) return Number(b?.isCover) - Number(a?.isCover);
      return (a?.sort ?? 0) - (b?.sort ?? 0);
    });
  }, [content?.images]);

  const lightboxImages = useMemo(
    () =>
      mediaImages.map((img) => ({
        _id: String(img._id),
        src: normalizeMediaSrc(img.url),
        alt: img.alt || '',
        tags: Array.isArray(img.tags) ? img.tags : [],
        isCover: Boolean(img.isCover)
      })),
    [mediaImages]
  );

  useEffect(() => {
    if (!Array.isArray(lightboxImages) || lightboxImages.length === 0) {
      if (lightboxIndex !== null) setLightboxIndex(null);
      return;
    }
    if (lightboxIndex === null) return;
    if (lightboxIndex < 0 || lightboxIndex >= lightboxImages.length) {
      setLightboxIndex(lightboxImages.length - 1);
    }
  }, [lightboxImages, lightboxIndex]);

  const runMediaMutation = useCallback(
    async (work, successText) => {
      setMediaBusy(true);
      setMediaError('');
      setMediaMessage('');
      try {
        await work();
        await onReload();
        setMediaMessage(successText);
      } catch (err) {
        setMediaError(err?.response?.data?.message || 'Media update failed');
      } finally {
        setMediaBusy(false);
      }
    },
    [onReload]
  );

  const handleUpload = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await runMediaMutation(() => opsWriteAPI.uploadCabinImage(titleId, file), 'Image uploaded');
      event.target.value = '';
    },
    [runMediaMutation, titleId]
  );

  const handleSetCover = useCallback(
    async (imageId) => {
      await runMediaMutation(
        () => opsWriteAPI.updateCabinImage(titleId, imageId, { isCover: true }),
        'Cover image updated'
      );
    },
    [runMediaMutation, titleId]
  );

  const handleMove = useCallback(
    async (imageId, direction) => {
      const idx = mediaImages.findIndex((img) => String(img?._id) === String(imageId));
      if (idx < 0) return;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= mediaImages.length) return;
      const next = [...mediaImages];
      const swap = next[idx];
      next[idx] = next[target];
      next[target] = swap;
      const order = next.map((img, index) => ({
        imageId: String(img._id),
        sort: index,
        spaceOrder: typeof img.spaceOrder === 'number' ? img.spaceOrder : 0
      }));
      await runMediaMutation(
        () => opsWriteAPI.reorderCabinImages(titleId, order),
        'Image order updated'
      );
    },
    [mediaImages, runMediaMutation, titleId]
  );

  const handleDelete = useCallback(
    async (imageId) => {
      if (!window.confirm('Delete this image? This cannot be undone.')) return;
      await runMediaMutation(
        () => opsWriteAPI.deleteCabinImage(titleId, imageId),
        'Image deleted'
      );
    },
    [runMediaMutation, titleId]
  );

  const handleSaveAlt = useCallback(
    async (imageId, altValue) => {
      await runMediaMutation(
        () => opsWriteAPI.updateCabinImage(titleId, imageId, { alt: altValue }),
        'Alt text updated'
      );
    },
    [runMediaMutation, titleId]
  );

  const handleSetTag = useCallback(
    async (imageId, tag) => {
      const tags = tag ? [tag] : [];
      await runMediaMutation(
        () => opsWriteAPI.updateCabinImage(titleId, imageId, { tags }),
        'Image category updated'
      );
    },
    [runMediaMutation, titleId]
  );

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Media manager</h3>
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="hidden"
          disabled={mediaBusy || isMulti}
        />
        <button
          type="button"
          disabled={mediaBusy || isMulti}
          onClick={() => uploadRef.current?.click()}
          className="text-xs px-3 py-2 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
        >
          Upload image
        </button>
      </div>
      {isMulti ? (
        <p className="text-xs text-amber-700 mt-2">
          Media editing is currently available for single cabins only in this batch.
        </p>
      ) : null}
      {mediaError ? <p className="text-xs text-red-600 mt-2">{mediaError}</p> : null}
      {mediaMessage ? <p className="text-xs text-green-700 mt-2">{mediaMessage}</p> : null}

      {mediaImages.length === 0 ? (
        <p className="text-sm text-gray-500 mt-3">No images yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
          {mediaImages.map((img, index) => (
            <div key={String(img._id)} className="border border-gray-200 rounded-lg p-2">
              <div className="relative rounded-md overflow-hidden border border-gray-100 bg-gray-50">
                <img
                  src={normalizeMediaSrc(img.url)}
                  alt={img.alt || ''}
                  className="w-full h-28 object-cover"
                  loading="lazy"
                  onClick={() => setLightboxIndex(index)}
                />
                {img.isCover ? (
                  <span className="absolute top-1 right-1 text-[10px] px-2 py-0.5 rounded bg-[#81887A] text-white">
                    Cover
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-xs text-gray-500">Order: {index + 1}</div>
              <div className="mt-2 space-y-2">
                <label className="block">
                  <span className="block text-[11px] text-gray-500 mb-1">Alt text</span>
                  <input
                    type="text"
                    defaultValue={img.alt || ''}
                    onBlur={(event) => {
                      const nextAlt = String(event.target.value || '');
                      if (nextAlt === String(img.alt || '')) return;
                      handleSaveAlt(String(img._id), nextAlt);
                    }}
                    disabled={mediaBusy || isMulti}
                    className="w-full text-xs px-2 py-1.5 rounded border border-gray-200 bg-white disabled:opacity-50"
                    placeholder="Short image description"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] text-gray-500 mb-1">Category</span>
                  <select
                    value={Array.isArray(img.tags) && img.tags[0] ? String(img.tags[0]) : ''}
                    onChange={(event) => handleSetTag(String(img._id), event.target.value)}
                    disabled={mediaBusy || isMulti}
                    className="w-full text-xs px-2 py-1.5 rounded border border-gray-200 bg-white disabled:opacity-50"
                  >
                    <option value="">Unassigned</option>
                    {MEDIA_TAG_OPTIONS.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={mediaBusy || isMulti || Boolean(img.isCover)}
                  onClick={() => handleSetCover(String(img._id))}
                  className="text-xs px-2 py-1 rounded border border-gray-200 bg-white disabled:opacity-50"
                >
                  Set cover
                </button>
                <button
                  type="button"
                  disabled={mediaBusy || isMulti || index === 0}
                  onClick={() => handleMove(String(img._id), 'up')}
                  className="text-xs px-2 py-1 rounded border border-gray-200 bg-white disabled:opacity-50"
                >
                  Move up
                </button>
                <button
                  type="button"
                  disabled={mediaBusy || isMulti || index === mediaImages.length - 1}
                  onClick={() => handleMove(String(img._id), 'down')}
                  className="text-xs px-2 py-1 rounded border border-gray-200 bg-white disabled:opacity-50"
                >
                  Move down
                </button>
                <button
                  type="button"
                  disabled={mediaBusy || isMulti}
                  onClick={() => handleDelete(String(img._id))}
                  className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 bg-white disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <OpsGalleryLightbox
        open={lightboxIndex !== null}
        images={lightboxImages}
        activeIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onPrev={() => setLightboxIndex((idx) => (idx === null ? idx : Math.max(0, idx - 1)))}
        onNext={() =>
          setLightboxIndex((idx) =>
            idx === null ? idx : Math.min(lightboxImages.length - 1, idx + 1)
          )
        }
      />
    </section>
  );
}

export default function OpsCabinDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigateDetail = useNavigate();
  const [showCreatedBanner, setShowCreatedBanner] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contentEditOpen, setContentEditOpen] = useState(false);
  const [contentEditBusy, setContentEditBusy] = useState(false);
  const [contentEditError, setContentEditError] = useState('');
  const [contentEditSuccess, setContentEditSuccess] = useState('');
  const [arrivalEditOpen, setArrivalEditOpen] = useState(false);
  const [arrivalEditBusy, setArrivalEditBusy] = useState(false);
  const [arrivalEditError, setArrivalEditError] = useState('');
  const [arrivalEditSuccess, setArrivalEditSuccess] = useState('');
  const [cutoffsEditOpen, setCutoffsEditOpen] = useState(false);
  const [cutoffsEditBusy, setCutoffsEditBusy] = useState(false);
  const [cutoffsEditError, setCutoffsEditError] = useState('');
  const [cutoffsEditSuccess, setCutoffsEditSuccess] = useState('');
  const [transportOptionsEditOpen, setTransportOptionsEditOpen] = useState(false);
  const [transportOptionsEditBusy, setTransportOptionsEditBusy] = useState(false);
  const [transportOptionsEditError, setTransportOptionsEditError] = useState('');
  const [transportOptionsEditSuccess, setTransportOptionsEditSuccess] = useState('');
  const [occupancyEditOpen, setOccupancyEditOpen] = useState(false);
  const [occupancyEditBusy, setOccupancyEditBusy] = useState(false);
  const [occupancyEditError, setOccupancyEditError] = useState('');
  const [occupancyEditSuccess, setOccupancyEditSuccess] = useState('');
  const [pricingEditOpen, setPricingEditOpen] = useState(false);
  const [pricingEditBusy, setPricingEditBusy] = useState(false);
  const [pricingEditError, setPricingEditError] = useState('');
  const [pricingEditSuccess, setPricingEditSuccess] = useState('');
  const [experiencesEditOpen, setExperiencesEditOpen] = useState(false);
  const [experiencesEditBusy, setExperiencesEditBusy] = useState(false);
  const [experiencesEditError, setExperiencesEditError] = useState('');
  const [experiencesEditSuccess, setExperiencesEditSuccess] = useState('');
  const [contentEditForm, setContentEditForm] = useState({
    name: '',
    description: '',
    hostName: '',
    avgResponseTimeHours: '',
    highlightsText: '',
    superhostEnabled: false,
    superhostLabel: 'Superhost',
    guestFavoriteEnabled: false,
    guestFavoriteLabel: 'Guest favorite'
  });
  const [arrivalEditForm, setArrivalEditForm] = useState({
    location: '',
    geoLatitude: '',
    geoLongitude: '',
    geoZoom: '11',
    meetingLabel: '',
    meetingGoogleMapsUrl: '',
    meetingWhat3words: '',
    meetingLat: '',
    meetingLng: '',
    arrivalWindowDefault: '',
    arrivalGuideUrl: '',
    safetyNotes: '',
    emergencyContact: '',
    packingListText: ''
  });
  const [cutoffsEditRows, setCutoffsEditRows] = useState([]);
  const [transportOptionsEditRows, setTransportOptionsEditRows] = useState([]);
  const [occupancyEditForm, setOccupancyEditForm] = useState({
    capacity: '',
    minNights: ''
  });
  const [pricingEditForm, setPricingEditForm] = useState({
    pricePerNight: ''
  });
  const [experiencesEditRows, setExperiencesEditRows] = useState([]);
  const detailRequestSeq = useRef(0);

  const loadDetail = useCallback(async () => {
    const requestSeq = detailRequestSeq.current + 1;
    detailRequestSeq.current = requestSeq;
    setLoading(true);
    setError('');
    try {
      const resp = await opsReadAPI.cabinDetail(id);
      if (detailRequestSeq.current !== requestSeq) return;
      setData(resp.data?.data || null);
    } catch (err) {
      if (detailRequestSeq.current !== requestSeq) return;
      setError(err?.response?.data?.message || 'Failed to load cabin');
    } finally {
      if (detailRequestSeq.current !== requestSeq) return;
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
    return () => {
      detailRequestSeq.current += 1;
    };
  }, [loadDetail]);

  useEffect(() => {
    if (location.state?.opsFlash !== 'cabin-created') return;
    setShowCreatedBanner(true);
    navigateDetail(
      { pathname: location.pathname, search: location.search || '' },
      { replace: true, state: {} }
    );
  }, [location.pathname, location.search, location.state?.opsFlash, navigateDetail]);

  const isMulti = data?.kind === 'multi_unit_type';
  const op = data?.operationalSettings || {};
  const content = data?.contentMedia || {};
  const pre = data?.preArrival || {};
  const degraded = data?.degraded || {};
  const titleId = isMulti ? data?.cabinTypeId : data?.cabinId;
  const cover = content.imageUrl;

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">Not found.</div>;

  const geo = content?.geoLocation;
  const meeting = op?.meetingPoint;
  const summary = op?.unitBlockedDatesSummary;
  const blockedList = !isMulti && Array.isArray(op.blockedDates) ? op.blockedDates : [];

  const openContentEdit = () => {
    setContentEditForm({
      name: content.name || '',
      description: content.description || '',
      hostName: content.hostName || '',
      avgResponseTimeHours:
        op?.avgResponseTimeHours != null
          ? String(op.avgResponseTimeHours)
          : content?.avgResponseTimeHours != null
            ? String(content.avgResponseTimeHours)
            : '',
      highlightsText: Array.isArray(content.highlights) ? content.highlights.join('\n') : '',
      superhostEnabled: Boolean(content.badges?.superhost?.enabled),
      superhostLabel: content.badges?.superhost?.label || 'Superhost',
      guestFavoriteEnabled: Boolean(content.badges?.guestFavorite?.enabled),
      guestFavoriteLabel: content.badges?.guestFavorite?.label || 'Guest favorite'
    });
    setContentEditError('');
    setContentEditSuccess('');
    setContentEditOpen(true);
  };

  const saveContentEdit = async () => {
    setContentEditBusy(true);
    setContentEditError('');
    setContentEditSuccess('');
    try {
      const highlights = contentEditForm.highlightsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);
      const payload = {
        name: contentEditForm.name.trim(),
        description: contentEditForm.description.trim(),
        hostName: contentEditForm.hostName.trim(),
        highlights,
        badges: {
          superhost: {
            enabled: contentEditForm.superhostEnabled,
            label: contentEditForm.superhostLabel.trim() || 'Superhost'
          },
          guestFavorite: {
            enabled: contentEditForm.guestFavoriteEnabled,
            label: contentEditForm.guestFavoriteLabel.trim() || 'Guest favorite'
          }
        }
      };
      const avgText = contentEditForm.avgResponseTimeHours.trim();
      if (avgText !== '') {
        payload.avgResponseTimeHours = Number(avgText);
      }
      await opsWriteAPI.updateCabinContent(id, payload);
      await loadDetail();
      setContentEditSuccess('Content updated.');
      setContentEditOpen(false);
    } catch (err) {
      setContentEditError(err?.response?.data?.message || 'Failed to update content');
    } finally {
      setContentEditBusy(false);
    }
  };

  const openArrivalEdit = () => {
    setArrivalEditForm({
      location: content.location || '',
      geoLatitude: geo?.latitude != null ? String(geo.latitude) : '',
      geoLongitude: geo?.longitude != null ? String(geo.longitude) : '',
      geoZoom: geo?.zoom != null ? String(geo.zoom) : '11',
      meetingLabel: meeting?.label || '',
      meetingGoogleMapsUrl: meeting?.googleMapsUrl || '',
      meetingWhat3words: meeting?.what3words || '',
      meetingLat: meeting?.lat != null ? String(meeting.lat) : '',
      meetingLng: meeting?.lng != null ? String(meeting.lng) : '',
      arrivalWindowDefault: pre.arrivalWindowDefault || '',
      arrivalGuideUrl: pre.arrivalGuideUrl || '',
      safetyNotes: pre.safetyNotes || '',
      emergencyContact: pre.emergencyContact || '',
      packingListText: Array.isArray(pre.packingList) ? pre.packingList.join('\n') : ''
    });
    setArrivalEditError('');
    setArrivalEditSuccess('');
    setArrivalEditOpen(true);
  };

  const saveArrivalEdit = async () => {
    setArrivalEditBusy(true);
    setArrivalEditError('');
    setArrivalEditSuccess('');
    try {
      const packingList = arrivalEditForm.packingListText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = {
        location: arrivalEditForm.location.trim(),
        meetingPoint: {
          label: arrivalEditForm.meetingLabel.trim(),
          googleMapsUrl: arrivalEditForm.meetingGoogleMapsUrl.trim(),
          what3words: arrivalEditForm.meetingWhat3words.trim()
        },
        arrivalWindowDefault: arrivalEditForm.arrivalWindowDefault.trim(),
        arrivalGuideUrl: arrivalEditForm.arrivalGuideUrl.trim(),
        safetyNotes: arrivalEditForm.safetyNotes.trim(),
        emergencyContact: arrivalEditForm.emergencyContact.trim(),
        packingList
      };

      const hasGeoLat = arrivalEditForm.geoLatitude.trim() !== '';
      const hasGeoLng = arrivalEditForm.geoLongitude.trim() !== '';
      if (hasGeoLat || hasGeoLng) {
        payload.geoLocation = {
          latitude: hasGeoLat ? Number(arrivalEditForm.geoLatitude.trim()) : undefined,
          longitude: hasGeoLng ? Number(arrivalEditForm.geoLongitude.trim()) : undefined,
          zoom: arrivalEditForm.geoZoom.trim() !== '' ? Number(arrivalEditForm.geoZoom.trim()) : 11
        };
      }
      if (arrivalEditForm.meetingLat.trim() !== '') {
        payload.meetingPoint.lat = Number(arrivalEditForm.meetingLat.trim());
      }
      if (arrivalEditForm.meetingLng.trim() !== '') {
        payload.meetingPoint.lng = Number(arrivalEditForm.meetingLng.trim());
      }

      await opsWriteAPI.updateCabinArrival(id, payload);
      await loadDetail();
      setArrivalEditSuccess('Arrival details updated.');
      setArrivalEditOpen(false);
    } catch (err) {
      setArrivalEditError(err?.response?.data?.message || 'Failed to update arrival details');
    } finally {
      setArrivalEditBusy(false);
    }
  };

  const openCutoffsEdit = () => {
    const rows = Array.isArray(op.transportCutoffs)
      ? op.transportCutoffs.map((item) => ({
          type: item?.type ? String(item.type) : 'Horse',
          lastDeparture: item?.lastDeparture ? String(item.lastDeparture) : '16:30'
        }))
      : [];
    setCutoffsEditRows(rows);
    setCutoffsEditError('');
    setCutoffsEditSuccess('');
    setCutoffsEditOpen(true);
  };

  const addCutoffRow = () => {
    setCutoffsEditRows((prev) => [...prev, { type: 'Horse', lastDeparture: '16:30' }]);
  };

  const removeCutoffRow = (index) => {
    setCutoffsEditRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateCutoffRow = (index, field, value) => {
    setCutoffsEditRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const saveCutoffsEdit = async () => {
    setCutoffsEditBusy(true);
    setCutoffsEditError('');
    setCutoffsEditSuccess('');
    try {
      const payload = {
        transportCutoffs: cutoffsEditRows.map((row) => ({
          type: String(row.type || '').trim(),
          lastDeparture: String(row.lastDeparture || '').trim()
        }))
      };
      await opsWriteAPI.updateCabinTransportCutoffs(id, payload);
      await loadDetail();
      setCutoffsEditSuccess('Transport cutoffs updated.');
      setCutoffsEditOpen(false);
    } catch (err) {
      setCutoffsEditError(err?.response?.data?.message || 'Failed to update transport cutoffs');
    } finally {
      setCutoffsEditBusy(false);
    }
  };

  const openTransportOptionsEdit = () => {
    const rows = Array.isArray(op.transportOptions)
      ? op.transportOptions.map((item) => ({
          type: item?.type ? String(item.type) : '',
          pricePerPerson: item?.pricePerPerson != null ? String(item.pricePerPerson) : '0',
          description: item?.description ? String(item.description) : '',
          duration: item?.duration ? String(item.duration) : '',
          isAvailable: item?.isAvailable !== false
        }))
      : [];
    setTransportOptionsEditRows(rows);
    setTransportOptionsEditError('');
    setTransportOptionsEditSuccess('');
    setTransportOptionsEditOpen(true);
  };

  const addTransportOptionRow = () => {
    setTransportOptionsEditRows((prev) => [
      ...prev,
      { type: '', pricePerPerson: '0', description: '', duration: '', isAvailable: true }
    ]);
  };

  const removeTransportOptionRow = (index) => {
    setTransportOptionsEditRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateTransportOptionRow = (index, field, value) => {
    setTransportOptionsEditRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const saveTransportOptionsEdit = async () => {
    setTransportOptionsEditBusy(true);
    setTransportOptionsEditError('');
    setTransportOptionsEditSuccess('');
    try {
      const payload = {
        transportOptions: transportOptionsEditRows.map((row) => ({
          type: String(row.type || '').trim(),
          pricePerPerson: Number(row.pricePerPerson),
          description: String(row.description || '').trim(),
          duration: String(row.duration || '').trim(),
          isAvailable: row.isAvailable !== false
        }))
      };
      await opsWriteAPI.updateCabinTransportOptions(id, payload);
      await loadDetail();
      setTransportOptionsEditSuccess('Transport options updated.');
      setTransportOptionsEditOpen(false);
    } catch (err) {
      setTransportOptionsEditError(err?.response?.data?.message || 'Failed to update transport options');
    } finally {
      setTransportOptionsEditBusy(false);
    }
  };

  const openOccupancyEdit = () => {
    setOccupancyEditForm({
      capacity: op.capacity != null ? String(op.capacity) : '',
      minNights: op.minNights != null ? String(op.minNights) : ''
    });
    setOccupancyEditError('');
    setOccupancyEditSuccess('');
    setOccupancyEditOpen(true);
  };

  const saveOccupancyEdit = async () => {
    setOccupancyEditBusy(true);
    setOccupancyEditError('');
    setOccupancyEditSuccess('');
    try {
      const payload = {
        capacity: Number(occupancyEditForm.capacity),
        minNights: Number(occupancyEditForm.minNights)
      };
      await opsWriteAPI.updateCabinOccupancy(id, payload);
      await loadDetail();
      setOccupancyEditSuccess('Occupancy settings updated.');
      setOccupancyEditOpen(false);
    } catch (err) {
      setOccupancyEditError(err?.response?.data?.message || 'Failed to update occupancy settings');
    } finally {
      setOccupancyEditBusy(false);
    }
  };

  const openPricingEdit = () => {
    setPricingEditForm({
      pricePerNight: op.pricePerNight != null ? String(op.pricePerNight) : ''
    });
    setPricingEditError('');
    setPricingEditSuccess('');
    setPricingEditOpen(true);
  };

  const savePricingEdit = async () => {
    setPricingEditBusy(true);
    setPricingEditError('');
    setPricingEditSuccess('');
    try {
      const payload = {
        pricePerNight: Number(pricingEditForm.pricePerNight)
      };
      await opsWriteAPI.updateCabinPricing(id, payload);
      await loadDetail();
      setPricingEditSuccess('Pricing updated.');
      setPricingEditOpen(false);
    } catch (err) {
      setPricingEditError(err?.response?.data?.message || 'Failed to update pricing');
    } finally {
      setPricingEditBusy(false);
    }
  };

  const openExperiencesEdit = () => {
    const rows = Array.isArray(content.experiences)
      ? content.experiences.map((item, index) => ({
          key: item?.key ? String(item.key) : '',
          name: item?.name ? String(item.name) : '',
          price: item?.price != null ? String(item.price) : '0',
          currency: item?.currency ? String(item.currency) : 'BGN',
          unit: item?.unit === 'per_guest' ? 'per_guest' : 'flat_per_stay',
          active: item?.active !== false,
          sortOrder: item?.sortOrder != null ? String(item.sortOrder) : String(index)
        }))
      : [];
    setExperiencesEditRows(rows);
    setExperiencesEditError('');
    setExperiencesEditSuccess('');
    setExperiencesEditOpen(true);
  };

  const addExperienceRow = () => {
    setExperiencesEditRows((prev) => [
      ...prev,
      {
        key: '',
        name: '',
        price: '0',
        currency: 'BGN',
        unit: 'flat_per_stay',
        active: true,
        sortOrder: String(prev.length)
      }
    ]);
  };

  const removeExperienceRow = (index) => {
    setExperiencesEditRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateExperienceRow = (index, field, value) => {
    setExperiencesEditRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const saveExperiencesEdit = async () => {
    setExperiencesEditBusy(true);
    setExperiencesEditError('');
    setExperiencesEditSuccess('');
    try {
      const usedKeys = new Set();
      const experiences = experiencesEditRows
        .map((row, index) => ({
          key: String(row.key || '').trim(),
          name: String(row.name || '').trim(),
          price: Number(row.price),
          currency: String(row.currency || 'BGN').trim() || 'BGN',
          unit: row.unit === 'per_guest' ? 'per_guest' : 'flat_per_stay',
          active: row.active !== false,
          sortOrder: Number(row.sortOrder ?? index)
        }))
        .filter((row) => row.name !== '')
        .map((row) => {
          const currentKey = row.key;
          if (currentKey && !usedKeys.has(currentKey)) {
            usedKeys.add(currentKey);
            return row;
          }
          return { ...row, key: buildExperienceKey(row.name, usedKeys) };
        });

      const payload = { experiences };
      await opsWriteAPI.updateCabinExperiences(id, payload);
      await loadDetail();
      setExperiencesEditSuccess('Experiences updated.');
      setExperiencesEditOpen(false);
    } catch (err) {
      setExperiencesEditError(err?.response?.data?.message || 'Failed to update experiences');
    } finally {
      setExperiencesEditBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-16 sm:pb-0 w-full max-w-4xl mx-auto">
      {showCreatedBanner ? (
        <div
          role="status"
          className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 max-w-4xl mx-auto w-full"
        >
          <p className="text-sm text-green-900">Cabin created successfully.</p>
          <button
            type="button"
            className="text-sm text-green-800 underline shrink-0 text-left sm:text-right"
            onClick={() => setShowCreatedBanner(false)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
        <Link to="/ops/cabins" className="text-sm text-[#81887A] hover:underline">
          Back to cabins
        </Link>
        <div className="mt-4 flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
          <div className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-gray-100 overflow-hidden border border-gray-100">
            {cover ? (
              <img src={normalizeMediaSrc(cover)} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm font-semibold text-gray-600 bg-gray-50">
                {thumbInitials(content.name)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{content.name || '—'}</h2>
              {isMulti ? (
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-100">
                  Multi-unit type
                </span>
              ) : (
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200">
                  Single cabin
                </span>
              )}
            </div>
            {content.hostName ? (
              <p className="text-xs text-gray-500 mt-1">Host: {content.hostName}</p>
            ) : null}
            <p className="text-xs text-gray-500 mt-1 font-mono break-all">{titleId}</p>
            {data.slug ? <p className="text-xs text-gray-400 mt-0.5 font-mono">Slug: {data.slug}</p> : null}
            <p className="text-sm text-gray-600 mt-2">{content.location || '—'}</p>
            {degraded.missingGeo ? (
              <p className="mt-2 text-sm text-amber-800">Degraded: missing geo coordinates.</p>
            ) : null}
            {degraded.emptyInventory ? (
              <p className="mt-2 text-sm text-amber-800">Degraded: no units linked to this cabin type.</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openContentEdit}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
              >
                Edit content
              </button>
              <button
                type="button"
                onClick={openArrivalEdit}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
              >
                Edit arrival
              </button>
              {contentEditSuccess ? <span className="text-xs text-green-700">{contentEditSuccess}</span> : null}
              {contentEditError ? <span className="text-xs text-red-700">{contentEditError}</span> : null}
              {arrivalEditSuccess ? <span className="text-xs text-green-700">{arrivalEditSuccess}</span> : null}
              {arrivalEditError ? <span className="text-xs text-red-700">{arrivalEditError}</span> : null}
              {occupancyEditSuccess ? <span className="text-xs text-green-700">{occupancyEditSuccess}</span> : null}
              {occupancyEditError ? <span className="text-xs text-red-700">{occupancyEditError}</span> : null}
              {pricingEditSuccess ? <span className="text-xs text-green-700">{pricingEditSuccess}</span> : null}
              {pricingEditError ? <span className="text-xs text-red-700">{pricingEditError}</span> : null}
              {experiencesEditSuccess ? <span className="text-xs text-green-700">{experiencesEditSuccess}</span> : null}
              {experiencesEditError ? <span className="text-xs text-red-700">{experiencesEditError}</span> : null}
            </div>
          </div>
        </div>
      </section>

      {contentEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
          <h3 className="text-sm font-semibold text-gray-900">Edit content</h3>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Name</span>
              <input
                type="text"
                value={contentEditForm.name}
                onChange={(e) => setContentEditForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                maxLength={100}
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Host name</span>
              <input
                type="text"
                value={contentEditForm.hostName}
                onChange={(e) => setContentEditForm((p) => ({ ...p, hostName: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                maxLength={120}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="block text-xs text-gray-600 mb-1">Description</span>
              <textarea
                rows={4}
                value={contentEditForm.description}
                onChange={(e) => setContentEditForm((p) => ({ ...p, description: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                maxLength={1000}
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Avg response time (hours)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={contentEditForm.avgResponseTimeHours}
                onChange={(e) => setContentEditForm((p) => ({ ...p, avgResponseTimeHours: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="block text-xs text-gray-600 mb-1">Highlights (up to 5, one per line)</span>
              <textarea
                rows={4}
                value={contentEditForm.highlightsText}
                onChange={(e) => setContentEditForm((p) => ({ ...p, highlightsText: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm font-mono"
              />
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-gray-100 rounded-md p-3">
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={contentEditForm.superhostEnabled}
                  onChange={(e) => setContentEditForm((p) => ({ ...p, superhostEnabled: e.target.checked }))}
                />
                Superhost enabled
              </label>
              <input
                type="text"
                value={contentEditForm.superhostLabel}
                onChange={(e) => setContentEditForm((p) => ({ ...p, superhostLabel: e.target.value }))}
                className="mt-2 w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                maxLength={100}
              />
            </div>
            <div className="border border-gray-100 rounded-md p-3">
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={contentEditForm.guestFavoriteEnabled}
                  onChange={(e) => setContentEditForm((p) => ({ ...p, guestFavoriteEnabled: e.target.checked }))}
                />
                Guest favorite enabled
              </label>
              <input
                type="text"
                value={contentEditForm.guestFavoriteLabel}
                onChange={(e) => setContentEditForm((p) => ({ ...p, guestFavoriteLabel: e.target.value }))}
                className="mt-2 w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                maxLength={100}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={saveContentEdit}
              disabled={contentEditBusy}
              className="text-xs px-3 py-2 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {contentEditBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setContentEditOpen(false);
                setContentEditError('');
              }}
              disabled={contentEditBusy}
              className="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {contentEditError ? <span className="text-xs text-red-700">{contentEditError}</span> : null}
          </div>
        </section>
      ) : null}

      {arrivalEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
          <h3 className="text-sm font-semibold text-gray-900">Edit location, arrival &amp; safety</h3>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block md:col-span-2">
              <span className="block text-xs text-gray-600 mb-1">Location</span>
              <input
                type="text"
                value={arrivalEditForm.location}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, location: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                maxLength={200}
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Geo latitude</span>
              <input
                type="number"
                step="0.000001"
                value={arrivalEditForm.geoLatitude}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, geoLatitude: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Geo longitude</span>
              <input
                type="number"
                step="0.000001"
                value={arrivalEditForm.geoLongitude}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, geoLongitude: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Geo zoom</span>
              <input
                type="number"
                step="1"
                min="1"
                max="20"
                value={arrivalEditForm.geoZoom}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, geoZoom: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block md:col-span-2">
              <span className="block text-xs text-gray-600 mb-1">Meeting point label</span>
              <input
                type="text"
                value={arrivalEditForm.meetingLabel}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, meetingLabel: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                maxLength={200}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="block text-xs text-gray-600 mb-1">Google Maps URL</span>
              <input
                type="url"
                value={arrivalEditForm.meetingGoogleMapsUrl}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, meetingGoogleMapsUrl: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">what3words</span>
              <input
                type="text"
                value={arrivalEditForm.meetingWhat3words}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, meetingWhat3words: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Meeting lat</span>
              <input
                type="number"
                step="0.000001"
                value={arrivalEditForm.meetingLat}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, meetingLat: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Meeting lng</span>
              <input
                type="number"
                step="0.000001"
                value={arrivalEditForm.meetingLng}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, meetingLng: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Arrival window default</span>
              <input
                type="text"
                value={arrivalEditForm.arrivalWindowDefault}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, arrivalWindowDefault: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                maxLength={50}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="block text-xs text-gray-600 mb-1">Arrival guide URL</span>
              <input
                type="url"
                value={arrivalEditForm.arrivalGuideUrl}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, arrivalGuideUrl: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm font-mono"
              />
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Emergency contact</span>
              <input
                type="text"
                value={arrivalEditForm.emergencyContact}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, emergencyContact: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                maxLength={200}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="block text-xs text-gray-600 mb-1">Safety notes</span>
              <textarea
                rows={3}
                value={arrivalEditForm.safetyNotes}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, safetyNotes: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                maxLength={1000}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="block text-xs text-gray-600 mb-1">Packing list (one item per line)</span>
              <textarea
                rows={4}
                value={arrivalEditForm.packingListText}
                onChange={(e) => setArrivalEditForm((p) => ({ ...p, packingListText: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm font-mono"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={saveArrivalEdit}
              disabled={arrivalEditBusy}
              className="text-xs px-3 py-2 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {arrivalEditBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setArrivalEditOpen(false);
                setArrivalEditError('');
              }}
              disabled={arrivalEditBusy}
              className="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {arrivalEditError ? <span className="text-xs text-red-700">{arrivalEditError}</span> : null}
          </div>
        </section>
      ) : null}

      {occupancyEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
          <h3 className="text-sm font-semibold text-gray-900">Edit occupancy settings</h3>
          <p className="mt-1 text-xs text-amber-700">These fields affect guest eligibility and minimum stay rules.</p>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Capacity</span>
              <input
                type="number"
                min="1"
                step="1"
                value={occupancyEditForm.capacity}
                onChange={(e) => setOccupancyEditForm((p) => ({ ...p, capacity: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Minimum nights</span>
              <input
                type="number"
                min="1"
                step="1"
                value={occupancyEditForm.minNights}
                onChange={(e) => setOccupancyEditForm((p) => ({ ...p, minNights: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={saveOccupancyEdit}
              disabled={occupancyEditBusy}
              className="text-xs px-3 py-2 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {occupancyEditBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOccupancyEditOpen(false);
                setOccupancyEditError('');
              }}
              disabled={occupancyEditBusy}
              className="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {occupancyEditError ? <span className="text-xs text-red-700">{occupancyEditError}</span> : null}
          </div>
        </section>
      ) : null}

      {pricingEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
          <h3 className="text-sm font-semibold text-gray-900">Edit pricing</h3>
          <p className="mt-1 text-xs text-amber-700">This changes guest quote totals and payment amounts.</p>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Price per night</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={pricingEditForm.pricePerNight}
                onChange={(e) => setPricingEditForm((p) => ({ ...p, pricePerNight: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={savePricingEdit}
              disabled={pricingEditBusy}
              className="text-xs px-3 py-2 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {pricingEditBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPricingEditOpen(false);
                setPricingEditError('');
              }}
              disabled={pricingEditBusy}
              className="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {pricingEditError ? <span className="text-xs text-red-700">{pricingEditError}</span> : null}
          </div>
        </section>
      ) : null}

      {experiencesEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
          <h3 className="text-sm font-semibold text-gray-900">Edit experiences</h3>
          <p className="mt-1 text-xs text-amber-700">Experiences can affect guest extras and quote totals.</p>
          <div className="mt-3 space-y-3">
            {experiencesEditRows.map((row, index) => (
              <div key={`experience-row-${index}`} className="border border-gray-100 rounded-md p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Name</span>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateExperienceRow(index, 'name', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Price</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.price}
                      onChange={(e) => updateExperienceRow(index, 'price', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Currency</span>
                    <input
                      type="text"
                      value={row.currency}
                      onChange={(e) => updateExperienceRow(index, 'currency', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Unit</span>
                    <select
                      value={row.unit}
                      onChange={(e) => updateExperienceRow(index, 'unit', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    >
                      <option value="flat_per_stay">flat_per_stay</option>
                      <option value="per_guest">per_guest</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Sort order</span>
                    <input
                      type="number"
                      step="1"
                      value={row.sortOrder}
                      onChange={(e) => updateExperienceRow(index, 'sortOrder', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Active</span>
                    <select
                      value={row.active ? 'true' : 'false'}
                      onChange={(e) => updateExperienceRow(index, 'active', e.target.value === 'true')}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-gray-500 font-mono break-all">Key: {row.key || '(generated on save)'}</span>
                  <button
                    type="button"
                    onClick={() => removeExperienceRow(index)}
                    className="ml-auto text-xs px-2.5 py-1.5 rounded border border-red-200 text-red-700 bg-white hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {experiencesEditRows.length === 0 ? (
              <p className="text-xs text-gray-500">No experiences configured.</p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addExperienceRow}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
              disabled={experiencesEditBusy}
            >
              Add row
            </button>
            <button
              type="button"
              onClick={saveExperiencesEdit}
              disabled={experiencesEditBusy}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {experiencesEditBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setExperiencesEditOpen(false);
                setExperiencesEditError('');
              }}
              disabled={experiencesEditBusy}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {experiencesEditError ? <span className="text-xs text-red-700">{experiencesEditError}</span> : null}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OpsReadOnlyDetailSection title="Location &amp; coordinates">
          <p>
            <span className="font-medium text-gray-800">Address / label:</span> {content.location || '—'}
          </p>
          {geo?.latitude != null && geo?.longitude != null ? (
            <p className="font-mono text-[11px] text-gray-600 break-all">
              {Number(geo.latitude).toFixed(5)}, {Number(geo.longitude).toFixed(5)}
              {geo.zoom != null ? ` · zoom ${geo.zoom}` : ''}
            </p>
          ) : (
            <p className="text-gray-500">No map coordinates stored.</p>
          )}
        </OpsReadOnlyDetailSection>

        <OpsReadOnlyDetailSection title="Meeting point &amp; arrival">
          {meeting?.label ? (
            <p>
              <span className="font-medium text-gray-800">Meeting point:</span> {meeting.label}
            </p>
          ) : (
            <p className="text-gray-500">No meeting point label.</p>
          )}
          {meeting?.googleMapsUrl ? (
            <p className="break-all">
              <span className="font-medium text-gray-800">Maps:</span>{' '}
              <span className="font-mono text-[11px]">{meeting.googleMapsUrl}</span>
            </p>
          ) : null}
          {meeting?.what3words ? (
            <p>
              <span className="font-medium text-gray-800">what3words:</span> {meeting.what3words}
            </p>
          ) : null}
          {meeting?.lat != null && meeting?.lng != null ? (
            <p className="font-mono text-[11px] text-gray-600">
              Meeting lat/lng: {meeting.lat}, {meeting.lng}
            </p>
          ) : null}
          <p>
            <span className="font-medium text-gray-800">Default arrival window:</span>{' '}
            {pre.arrivalWindowDefault?.trim() ? pre.arrivalWindowDefault : '—'}
          </p>
          <p className="break-all">
            <span className="font-medium text-gray-800">Arrival guide URL:</span>{' '}
            {pre.arrivalGuideUrl ? <span className="font-mono text-[11px]">{pre.arrivalGuideUrl}</span> : '—'}
          </p>
        </OpsReadOnlyDetailSection>
      </div>

      <OpsReadOnlyDetailSection title="Safety &amp; emergency">
        <p>
          <span className="font-medium text-gray-800">Emergency contact:</span>{' '}
          {pre.emergencyContact?.trim() ? pre.emergencyContact : '—'}
        </p>
        <div>
          <p className="font-medium text-gray-800 mb-1">Safety notes</p>
          {pre.safetyNotes?.trim() ? (
            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{pre.safetyNotes}</p>
          ) : (
            <p className="text-gray-500">—</p>
          )}
        </div>
      </OpsReadOnlyDetailSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Operational settings</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openOccupancyEdit}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
              >
                Edit occupancy
              </button>
              <button
                type="button"
                onClick={openPricingEdit}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
              >
                Edit price
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-2 text-sm text-gray-700">
            <p>Capacity: {op.capacity ?? '—'}</p>
            <p>Min guests: {op.minGuests ?? '—'}</p>
            <p>Min nights: {op.minNights ?? '—'}</p>
            <p>Price/night: {op.pricePerNight ?? '—'}</p>
            <p>Pricing model: {op.pricingModel ?? '—'}</p>
            {isMulti ? (
              <p>
                Unit legacy blocked dates: {summary?.totalBlockedDateEntries ?? 0} entries across{' '}
                {summary?.unitsWithBlockedDates ?? 0} unit(s)
              </p>
            ) : (
              <p>Legacy blocked dates (cabin): {op.blockedDatesCount ?? op.blockedDates?.length ?? 0}</p>
            )}
            <p>Transport options: {op.transportOptions?.length ?? 0}</p>
            <p>Transport cutoffs: {Array.isArray(op.transportCutoffs) ? op.transportCutoffs.length : 0}</p>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
          <h3 className="text-sm font-semibold text-gray-900">Content &amp; media</h3>
          <div className="mt-3 space-y-2">
            {cover ? (
              <img src={normalizeMediaSrc(cover)} alt="" className="w-full max-w-lg rounded-lg border border-gray-200" />
            ) : (
              <p className="text-sm text-gray-500">No cover image.</p>
            )}
            {content.description ? (
              <p className="text-sm text-gray-600 line-clamp-6">{content.description}</p>
            ) : null}
          </div>
        </section>
      </div>

      <OpsReadOnlyDetailSection title="Transport">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={openTransportOptionsEdit}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
          >
            Edit transport options
          </button>
          <button
            type="button"
            onClick={openCutoffsEdit}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
          >
            Edit cutoffs
          </button>
          {transportOptionsEditSuccess ? <span className="text-xs text-green-700">{transportOptionsEditSuccess}</span> : null}
          {transportOptionsEditError ? <span className="text-xs text-red-700">{transportOptionsEditError}</span> : null}
          {cutoffsEditSuccess ? <span className="text-xs text-green-700">{cutoffsEditSuccess}</span> : null}
          {cutoffsEditError ? <span className="text-xs text-red-700">{cutoffsEditError}</span> : null}
        </div>
        {Array.isArray(op.transportOptions) && op.transportOptions.length > 0 ? (
          <ul className="space-y-2 list-none pl-0">
            {op.transportOptions.map((t, i) => (
              <li key={i} className="border border-gray-100 rounded-md p-2 bg-gray-50/80">
                <p className="font-medium text-gray-900">{t.type || '—'}</p>
                <p className="text-gray-600 mt-0.5">{t.description || '—'}</p>
                <p className="text-gray-500 mt-0.5">
                  {t.duration || '—'} · {t.pricePerPerson != null ? `${t.pricePerPerson}/person` : '—'} ·{' '}
                  {t.isAvailable === false ? 'Unavailable' : 'Available'}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">No transport options configured.</p>
        )}
        {Array.isArray(op.transportCutoffs) && op.transportCutoffs.length > 0 ? (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="font-medium text-gray-800 mb-1">Last departure cutoffs</p>
            <ul className="space-y-1 font-mono text-[11px]">
              {op.transportCutoffs.map((c, i) => (
                <li key={i}>
                  {c.type || '—'} — {c.lastDeparture || '—'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </OpsReadOnlyDetailSection>

      {transportOptionsEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
          <h3 className="text-sm font-semibold text-gray-900">Edit transport options</h3>
          <p className="mt-1 text-xs text-amber-700">Transport prices affect guest quote totals.</p>
          <div className="mt-3 space-y-3">
            {transportOptionsEditRows.map((row, index) => (
              <div key={`transport-option-row-${index}`} className="border border-gray-100 rounded-md p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Type</span>
                    <input
                      type="text"
                      value={row.type}
                      onChange={(e) => updateTransportOptionRow(index, 'type', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                      placeholder="Horse, ATV, Jeep..."
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Price per person</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.pricePerPerson}
                      onChange={(e) => updateTransportOptionRow(index, 'pricePerPerson', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="block text-[11px] text-gray-600 mb-1">Description</span>
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) => updateTransportOptionRow(index, 'description', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Duration</span>
                    <input
                      type="text"
                      value={row.duration}
                      onChange={(e) => updateTransportOptionRow(index, 'duration', e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-600 mb-1">Available</span>
                    <select
                      value={row.isAvailable ? 'true' : 'false'}
                      onChange={(e) => updateTransportOptionRow(index, 'isAvailable', e.target.value === 'true')}
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </label>
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => removeTransportOptionRow(index)}
                    className="text-xs px-2.5 py-1.5 rounded border border-red-200 text-red-700 bg-white hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {transportOptionsEditRows.length === 0 ? (
              <p className="text-xs text-gray-500">No transport options configured.</p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addTransportOptionRow}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
              disabled={transportOptionsEditBusy}
            >
              Add row
            </button>
            <button
              type="button"
              onClick={saveTransportOptionsEdit}
              disabled={transportOptionsEditBusy}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {transportOptionsEditBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setTransportOptionsEditOpen(false);
                setTransportOptionsEditError('');
              }}
              disabled={transportOptionsEditBusy}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {transportOptionsEditError ? <span className="text-xs text-red-700">{transportOptionsEditError}</span> : null}
          </div>
        </section>
      ) : null}

      {cutoffsEditOpen ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
          <h3 className="text-sm font-semibold text-gray-900">Edit transport cutoffs</h3>
          <div className="mt-3 space-y-2">
            {cutoffsEditRows.map((row, index) => (
              <div key={`cutoff-row-${index}`} className="flex flex-col md:flex-row md:items-center gap-2 border border-gray-100 rounded-md p-2">
                <select
                  value={row.type}
                  onChange={(e) => updateCutoffRow(index, 'type', e.target.value)}
                  className="border border-gray-200 rounded-md px-2 py-1.5 text-sm w-full md:w-44"
                >
                  <option value="Horse">Horse</option>
                  <option value="ATV">ATV</option>
                  <option value="Jeep">Jeep</option>
                  <option value="Hike">Hike</option>
                  <option value="Boat">Boat</option>
                  <option value="Helicopter">Helicopter</option>
                </select>
                <input
                  type="time"
                  value={row.lastDeparture}
                  onChange={(e) => updateCutoffRow(index, 'lastDeparture', e.target.value)}
                  className="border border-gray-200 rounded-md px-2 py-1.5 text-sm w-full md:w-40"
                />
                <button
                  type="button"
                  onClick={() => removeCutoffRow(index)}
                  className="text-xs px-2.5 py-1.5 rounded border border-red-200 text-red-700 bg-white hover:bg-red-50 w-full md:w-auto"
                >
                  Remove
                </button>
              </div>
            ))}
            {cutoffsEditRows.length === 0 ? (
              <p className="text-xs text-gray-500">No cutoffs configured.</p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addCutoffRow}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
              disabled={cutoffsEditBusy}
            >
              Add row
            </button>
            <button
              type="button"
              onClick={saveCutoffsEdit}
              disabled={cutoffsEditBusy}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {cutoffsEditBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCutoffsEditOpen(false);
                setCutoffsEditError('');
              }}
              disabled={cutoffsEditBusy}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-50"
            >
              Cancel
            </button>
            {cutoffsEditError ? <span className="text-xs text-red-700">{cutoffsEditError}</span> : null}
          </div>
        </section>
      ) : null}

      <OpsReadOnlyDetailSection title="Highlights, badges &amp; experiences">
        <div>
          <p className="font-medium text-gray-800 mb-1">Highlights</p>
          {content.highlights?.length ? (
            <ul className="list-disc pl-4 space-y-0.5">
              {content.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">—</p>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="font-medium text-gray-800 mb-1">Badges</p>
          {content.badges?.superhost?.enabled || content.badges?.guestFavorite?.enabled ? (
            <ul className="space-y-1">
              {content.badges.superhost?.enabled ? (
                <li>
                  Superhost: <span className="text-gray-600">{content.badges.superhost.label || 'Superhost'}</span>
                </li>
              ) : null}
              {content.badges.guestFavorite?.enabled ? (
                <li>
                  Guest favorite:{' '}
                  <span className="text-gray-600">{content.badges.guestFavorite.label || 'Guest favorite'}</span>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-gray-500">None enabled.</p>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={openExperiencesEdit}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            >
              Edit experiences
            </button>
          </div>
          <p className="font-medium text-gray-800 mb-1">Experiences</p>
          {Array.isArray(content.experiences) && content.experiences.length > 0 ? (
            <ul className="space-y-2 list-none pl-0">
              {content.experiences.map((ex, i) => (
                <li key={ex.key ? String(ex.key) : `exp-${i}`} className="border border-gray-100 rounded-md p-2 bg-gray-50/80">
                  <p className="font-medium text-gray-900">{ex.name || '—'}</p>
                  <p className="text-gray-600 mt-0.5">
                    {ex.price != null ? `${ex.price} ${ex.currency || 'BGN'}` : '—'} · {ex.unit || 'flat_per_stay'} ·{' '}
                    {ex.active === false ? 'Inactive' : 'Active'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">—</p>
          )}
        </div>
      </OpsReadOnlyDetailSection>

      <OpsReadOnlyDetailSection title="Blocked dates (legacy cabin fields)">
        {isMulti ? (
          <p>
            Per-unit blocked date entries: <span className="font-mono">{summary?.totalBlockedDateEntries ?? 0}</span>{' '}
            across <span className="font-mono">{summary?.unitsWithBlockedDates ?? 0}</span> unit(s). See units table
            for per-unit counts.
          </p>
        ) : blockedList.length > 0 ? (
          <>
            <p className="text-gray-600 mb-2">
              Count: {op.blockedDatesCount ?? blockedList.length} · day-level blocks stored on the cabin document.
            </p>
            <p className="font-mono text-[11px] text-gray-800 break-all leading-relaxed">
              {blockedList.map((d) => formatDateOnlyForOps(d)).filter(Boolean).join(', ')}
            </p>
          </>
        ) : (
          <p className="text-gray-500">No legacy blocked dates on this cabin.</p>
        )}
      </OpsReadOnlyDetailSection>

      <OpsCabinMediaManager titleId={titleId} isMulti={isMulti} content={content} onReload={loadDetail} />

      {isMulti && Array.isArray(data.units) ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-900">Units &amp; Airbnb calendar export</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            One Airbnb listing imports one <span className="font-mono">.ics</span> URL per physical unit. Paste only the
            URL for the unit that matches that listing. Set <span className="font-medium">PUBLIC_SITE_ORIGIN</span> on the
            server for absolute URLs in copy; otherwise the app origin is used.
          </p>
          <p className="text-xs text-gray-500 mt-1">{data.units.length} unit(s) in database.</p>
          <table className="mt-3 w-full text-sm text-left min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase">
                <th className="py-2 pr-3 text-left">Unit</th>
                <th className="py-2 pr-3 text-left">Display</th>
                <th className="py-2 pr-3 text-left">Active</th>
                <th className="py-2 pr-3 text-left">Blocked</th>
                <th className="py-2 pr-3 text-left min-w-[140px]">Airbnb listing label</th>
                <th className="py-2 text-left min-w-[220px]">ICS URL for Airbnb</th>
              </tr>
            </thead>
            <tbody>
              {data.units.map((u) => (
                <UnitAirbnbIcsRow key={u.unitId} unit={u} onReload={loadDetail} />
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <OpsReadOnlyDetailSection title="Packing list (pre-arrival)">
        {pre.packingList?.length ? (
          <ul className="list-disc pl-4 space-y-0.5">
            {pre.packingList.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">No packing list items.</p>
        )}
      </OpsReadOnlyDetailSection>
    </div>
  );
}
