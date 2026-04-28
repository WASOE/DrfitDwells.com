import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

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

export function OpsCabinsList() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

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
              Single cabins and multi-unit types (e.g. A-Frame) from source data. Read-only.
            </p>
          </div>
          <form
            onSubmit={onSearchSubmit}
            className="flex flex-col sm:flex-row gap-2 sm:items-center w-full lg:w-auto lg:min-w-[280px] lg:max-w-md shrink-0"
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
      </section>

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
                      <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
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

function UnitAirbnbIcsRow({ unit: u }) {
  const [label, setLabel] = useState(u.airbnbListingLabel || '');
  const [hint, setHint] = useState('');

  useEffect(() => {
    setLabel(u.airbnbListingLabel || '');
  }, [u.unitId, u.airbnbListingLabel]);

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
      setTimeout(() => setHint(''), 2000);
    } catch {
      setHint('Copy failed');
    }
  };

  const saveLabel = async () => {
    setHint('');
    try {
      await opsWriteAPI.patchUnitChannelLabel(u.unitId, label);
      setHint('Saved');
      setTimeout(() => setHint(''), 2000);
    } catch (err) {
      setHint(err?.response?.data?.message || 'Save failed');
    }
  };

  return (
    <tr className="border-b border-gray-100 align-top">
      <td className="py-2.5 pr-3 font-mono text-xs whitespace-nowrap">{u.unitNumber}</td>
      <td className="py-2.5 pr-3">{u.displayName || '—'}</td>
      <td className="py-2.5 pr-3">{u.isActive ? 'Yes' : 'No'}</td>
      <td className="py-2.5 pr-3">{u.blockedDatesCount ?? 0}</td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-col gap-1 max-w-[200px]">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Airbnb listing name / id"
            className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs"
            maxLength={200}
          />
          <button
            type="button"
            onClick={saveLabel}
            className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 w-fit"
          >
            Save label
          </button>
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

export default function OpsCabinDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaMessage, setMediaMessage] = useState('');
  const [mediaError, setMediaError] = useState('');
  const uploadRef = useRef(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await opsReadAPI.cabinDetail(id);
      setData(resp.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load cabin');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const resp = await opsReadAPI.cabinDetail(id);
        if (cancelled) return;
        setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load cabin');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const isMulti = data?.kind === 'multi_unit_type';
  const op = data?.operationalSettings || {};
  const content = data?.contentMedia || {};
  const pre = data?.preArrival || {};
  const degraded = data?.degraded || {};
  const titleId = isMulti ? data?.cabinTypeId : data?.cabinId;
  const cover = content.imageUrl;
  const mediaImages = useMemo(() => {
    const arr = Array.isArray(content.images) ? [...content.images] : [];
    return arr.sort((a, b) => {
      if (Boolean(b?.isCover) !== Boolean(a?.isCover)) return Number(b?.isCover) - Number(a?.isCover);
      return (a?.sort ?? 0) - (b?.sort ?? 0);
    });
  }, [content.images]);

  const runMediaMutation = useCallback(
    async (work, successText) => {
      setMediaBusy(true);
      setMediaError('');
      setMediaMessage('');
      try {
        await work();
        await loadDetail();
        setMediaMessage(successText);
      } catch (err) {
        setMediaError(err?.response?.data?.message || 'Media update failed');
      } finally {
        setMediaBusy(false);
      }
    },
    [loadDetail]
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

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">Not found.</div>;

  return (
    <div className="space-y-4 pb-16 sm:pb-0 w-full">
      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
        <Link to="/ops/cabins" className="text-sm text-[#81887A] hover:underline">
          Back to cabins
        </Link>
        <div className="mt-4 flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
          <div className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-gray-100 overflow-hidden border border-gray-100">
            {cover ? (
              <img src={cover} alt="" className="w-full h-full object-cover" />
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
            <p className="text-xs text-gray-500 mt-1 font-mono break-all">{titleId}</p>
            {data.slug ? <p className="text-xs text-gray-400 mt-0.5 font-mono">Slug: {data.slug}</p> : null}
            <p className="text-sm text-gray-600 mt-2">{content.location || '—'}</p>
            {degraded.missingGeo ? (
              <p className="mt-2 text-sm text-amber-800">Degraded: missing geo coordinates.</p>
            ) : null}
            {degraded.emptyInventory ? (
              <p className="mt-2 text-sm text-amber-800">Degraded: no units linked to this cabin type.</p>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
          <h3 className="text-sm font-semibold text-gray-900">Operational settings</h3>
          <div className="mt-3 space-y-2 text-sm text-gray-700">
            <p>Capacity: {op.capacity ?? '—'}</p>
            <p>Min nights: {op.minNights ?? '—'}</p>
            <p>Price/night: {op.pricePerNight ?? '—'}</p>
            {isMulti ? <p>Pricing model: {op.pricingModel ?? '—'}</p> : null}
            {isMulti ? (
              <p>Transport options: {op.transportOptions?.length ?? 0}</p>
            ) : (
              <>
                <p>Blocked dates count: {op.blockedDates?.length ?? 0}</p>
                <p>Transport options: {op.transportOptions?.length ?? 0}</p>
              </>
            )}
            {isMulti && Array.isArray(op.transportCutoffs) && op.transportCutoffs.length > 0 ? (
              <p className="text-xs text-gray-500">Transport cutoffs: {op.transportCutoffs.length} configured</p>
            ) : null}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
          <h3 className="text-sm font-semibold text-gray-900">Content &amp; media</h3>
          <div className="mt-3 space-y-2">
            {cover ? (
              <img src={cover} alt="" className="w-full max-w-lg rounded-lg border border-gray-200" />
            ) : (
              <p className="text-sm text-gray-500">No cover image.</p>
            )}
            {content.description ? (
              <p className="text-sm text-gray-600 line-clamp-6">{content.description}</p>
            ) : null}
            <p className="text-sm text-gray-600">Highlights: {content.highlights?.length ? content.highlights.join(', ') : '—'}</p>
            {isMulti && content.experiences?.length ? (
              <p className="text-sm text-gray-600">Experiences: {content.experiences.length} configured</p>
            ) : null}
          </div>
        </section>
      </div>

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
                  />
                  {img.isCover ? (
                    <span className="absolute top-1 right-1 text-[10px] px-2 py-0.5 rounded bg-[#81887A] text-white">
                      Cover
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-xs text-gray-500">Order: {index + 1}</div>
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
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
                <UnitAirbnbIcsRow key={u.unitId} unit={u} />
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
        <h3 className="text-sm font-semibold text-gray-900">Pre-arrival configuration</h3>
        <div className="mt-3 space-y-2 text-sm text-gray-700">
          <p>Packing list items: {pre.packingList?.length ?? 0}</p>
          <p>Arrival guide URL: {pre.arrivalGuideUrl ? pre.arrivalGuideUrl : '—'}</p>
          <p>Emergency contact: {pre.emergencyContact ? pre.emergencyContact : '—'}</p>
          {!isMulti ? <p>Safety notes: {pre.safetyNotes ? 'Present' : '—'}</p> : null}
        </div>
      </section>
    </div>
  );
}
