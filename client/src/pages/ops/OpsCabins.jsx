import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import {
  buildExperienceKey,
  formatDateOnlyForOps,
  listHref,
  listRowId,
  normalizeMediaSrc,
  thumbInitials
} from './cabins/cabinOpsUtils.js';
import CabinMediaManager from './cabins/CabinMediaManager.jsx';
import OpsReadOnlyDetailSection from './cabins/OpsReadOnlyDetailSection.jsx';
import CreateCabinModal from './cabins/CreateCabinModal.jsx';
import ArchiveCabinModal from './cabins/ArchiveCabinModal.jsx';
import CabinUnitsEditor from './cabins/CabinUnitsEditor.jsx';
import CabinContentEditor from './cabins/CabinContentEditor.jsx';
import CabinArrivalEditor from './cabins/CabinArrivalEditor.jsx';
import CabinTransportEditor from './cabins/CabinTransportEditor.jsx';
import CabinOccupancyPricingEditor from './cabins/CabinOccupancyPricingEditor.jsx';

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
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveConfirmName, setArchiveConfirmName] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState('');
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

  useEffect(() => {
    if (!archiveModalOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setArchiveModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [archiveModalOpen]);

  const handleArchiveSubmit = async (e) => {
    e.preventDefault();
    setArchiveError('');
    const r = archiveReason.trim();
    if (r.length < 8) {
      setArchiveError('Reason must be at least 8 characters.');
      return;
    }
    setArchiveBusy(true);
    try {
      await opsWriteAPI.archiveCabin(id, {
        reason: r,
        confirmName: archiveConfirmName.trim()
      });
      setArchiveModalOpen(false);
      navigateDetail('/ops/cabins');
    } catch (err) {
      setArchiveError(err?.response?.data?.message || err.message || 'Archive failed');
    } finally {
      setArchiveBusy(false);
    }
  };

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

      <CabinContentEditor
        contentEditOpen={contentEditOpen}
        contentForm={contentEditForm}
        setContentForm={setContentEditForm}
        contentBusy={contentEditBusy}
        contentMessage={contentEditSuccess}
        contentError={contentEditError}
        onOpen={openContentEdit}
        onCancel={() => {
          setContentEditOpen(false);
          setContentEditError('');
        }}
        onSave={saveContentEdit}
      />

      <CabinArrivalEditor
        arrivalEditOpen={arrivalEditOpen}
        arrivalForm={arrivalEditForm}
        setArrivalForm={setArrivalEditForm}
        arrivalBusy={arrivalEditBusy}
        arrivalError={arrivalEditError}
        onCancel={() => {
          setArrivalEditOpen(false);
          setArrivalEditError('');
        }}
        onSave={saveArrivalEdit}
      />

      <CabinOccupancyPricingEditor
        occupancyEditOpen={occupancyEditOpen}
        occupancyForm={occupancyEditForm}
        setOccupancyForm={setOccupancyEditForm}
        occupancyBusy={occupancyEditBusy}
        occupancyError={occupancyEditError}
        onCancelOccupancy={() => {
          setOccupancyEditOpen(false);
          setOccupancyEditError('');
        }}
        onSaveOccupancy={saveOccupancyEdit}
        pricingEditOpen={pricingEditOpen}
        pricingForm={pricingEditForm}
        setPricingForm={setPricingEditForm}
        pricingBusy={pricingEditBusy}
        pricingError={pricingEditError}
        onCancelPricing={() => {
          setPricingEditOpen(false);
          setPricingEditError('');
        }}
        onSavePricing={savePricingEdit}
      />

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

      <CabinTransportEditor
        transportOptionsEditOpen={transportOptionsEditOpen}
        transportOptionsForm={transportOptionsEditRows}
        setTransportOptionsForm={setTransportOptionsEditRows}
        transportOptionsBusy={transportOptionsEditBusy}
        transportOptionsError={transportOptionsEditError}
        onCancelTransportOptions={() => {
          setTransportOptionsEditOpen(false);
          setTransportOptionsEditError('');
        }}
        onSaveTransportOptions={saveTransportOptionsEdit}
        onAddTransportOptionRow={addTransportOptionRow}
        onRemoveTransportOptionRow={removeTransportOptionRow}
        onUpdateTransportOptionRow={updateTransportOptionRow}
        transportCutoffsEditOpen={cutoffsEditOpen}
        transportCutoffsForm={cutoffsEditRows}
        setTransportCutoffsForm={setCutoffsEditRows}
        transportCutoffsBusy={cutoffsEditBusy}
        transportCutoffsError={cutoffsEditError}
        onCancelTransportCutoffs={() => {
          setCutoffsEditOpen(false);
          setCutoffsEditError('');
        }}
        onSaveTransportCutoffs={saveCutoffsEdit}
        onAddTransportCutoffRow={addCutoffRow}
        onRemoveTransportCutoffRow={removeCutoffRow}
        onUpdateTransportCutoffRow={updateCutoffRow}
      />

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

      <CabinMediaManager titleId={titleId} isMulti={isMulti} content={content} onReload={loadDetail} />

      {isMulti && Array.isArray(data.units) ? (
        <CabinUnitsEditor units={data.units} onReload={loadDetail} />
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

      {!isMulti ? (
        <section className="bg-white border border-red-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
          <h3 className="text-sm font-semibold text-red-900">Danger zone</h3>
          <p className="text-xs text-gray-600 mt-2 max-w-2xl">
            Archiving hides this cabin from public listings, search, quotes, and booking. This does not delete data.
          </p>
          <button
            type="button"
            onClick={() => {
              setArchiveReason('');
              setArchiveConfirmName('');
              setArchiveError('');
              setArchiveModalOpen(true);
            }}
            className="mt-3 text-sm px-4 py-2 rounded-lg border border-red-300 text-red-900 bg-red-50 hover:bg-red-100"
          >
            Archive cabin
          </button>
        </section>
      ) : null}

      <ArchiveCabinModal
        open={archiveModalOpen && !isMulti}
        onClose={() => setArchiveModalOpen(false)}
        cabinDisplayName={content.name || ''}
        archiveConfirmName={archiveConfirmName}
        setArchiveConfirmName={setArchiveConfirmName}
        archiveReason={archiveReason}
        setArchiveReason={setArchiveReason}
        archiveError={archiveError}
        archiveBusy={archiveBusy}
        onSubmit={handleArchiveSubmit}
      />
    </div>
  );
}
