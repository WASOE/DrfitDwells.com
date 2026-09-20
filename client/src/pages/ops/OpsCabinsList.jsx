import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import { listHref, listRowId, normalizeMediaSrc, thumbInitials } from './cabins/cabinOpsUtils.js';
import CreateCabinModal from './cabins/CreateCabinModal.jsx';

export default function OpsCabinsList() {
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

  const handleCreateSubmit = async (e) => {
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
        setCreateError(errs.map((x) => (x.field ? `${x.field}: ${x.message}` : x.message)).join('; '));
      } else {
        setCreateError(msg || err.message || 'Failed to create cabin');
      }
    } finally {
      setCreateBusy(false);
    }
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

      <CreateCabinModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        createForm={createForm}
        setCreateForm={setCreateForm}
        createError={createError}
        createBusy={createBusy}
        onSubmit={handleCreateSubmit}
      />

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
