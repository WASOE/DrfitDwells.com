import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import { listHref, listRowId, normalizeMediaSrc, thumbInitials } from './cabins/cabinOpsUtils.js';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsTextarea from '../../ops/primitives/OpsTextarea';
import OpsBadge from '../../ops/primitives/OpsBadge';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsInlineError from '../../ops/primitives/OpsInlineError';
import OpsPagination from '../../ops/primitives/OpsPagination';
import OpsModal from '../../ops/primitives/OpsModal';
import OpsRecord from '../../ops/primitives/OpsRecord';
import OpsFilterBar from '../../ops/primitives/OpsFilterBar';
import './OpsCabinsList.css';

const EMPTY_CREATE_FORM = {
  name: '',
  description: '',
  location: '',
  capacity: '',
  pricePerNight: '',
  minNights: '1',
  hostName: ''
};

function CabinThumb({ cabin }) {
  const img = cabin.content?.imageUrl;
  if (img) {
    return <img src={normalizeMediaSrc(img)} alt="" />;
  }
  return <span className="ops-cabins-list__thumb-fallback">{thumbInitials(cabin.name)}</span>;
}

function CabinRow({ cabin }) {
  const isMulti = cabin.kind === 'multi_unit_type';
  const op = cabin.operational || {};
  const blockedUnits = Number(op.blockedUnitsCount) || 0;

  return (
    <OpsRecord as={Link} className="ops-cabins-list__row" to={listHref(cabin)}>
      <div className="ops-cabins-list__thumb">
        <CabinThumb cabin={cabin} />
      </div>
      <div className="ops-cabins-list__identity">
        <div className="ops-cabins-list__title-row">
          <span className="ops-cabins-list__name">{cabin.name}</span>
          <OpsBadge>{isMulti ? 'Multi-unit type' : 'Single cabin'}</OpsBadge>
          {cabin.isActive === false ? <OpsStatus domain="cabin" value="inactive" /> : null}
        </div>
        <p className="ops-cabins-list__location">{cabin.location || '—'}</p>
        {isMulti && cabin.slug ? <p className="ops-cabins-list__slug">Slug: {cabin.slug}</p> : null}
      </div>
      <div className="ops-cabins-list__meta">
        {isMulti ? (
          <p className="ops-cabins-list__fact">
            {op.totalUnits ?? 0} units ({op.activeUnits ?? 0} active)
          </p>
        ) : null}
        {isMulti && blockedUnits > 0 ? (
          <span className="ops-cabins-list__blocked">
            <OpsStatus domain="cabin" value="blocked" />
            <span className="ops-cabins-list__fact">{blockedUnits} blocked</span>
          </span>
        ) : null}
        <p className="ops-cabins-list__fact">{op.capacity ?? '—'} guests</p>
        <p className="ops-cabins-list__fact">{op.minNights ?? '—'} min nights</p>
        {!isMulti ? <p className="ops-cabins-list__fact">{op.blockedDatesCount ?? 0} blocked nights</p> : null}
        {isMulti && op.pricePerNight != null ? (
          <p className="ops-cabins-list__fact">{op.pricePerNight} / night</p>
        ) : null}
      </div>
    </OpsRecord>
  );
}

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
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE_FORM });

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

  const resetCreateForm = () => {
    setCreateForm({ ...EMPTY_CREATE_FORM });
    setCreateError('');
  };

  const openCreate = () => {
    resetCreateForm();
    setCreateOpen(true);
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

  const items = data?.items || [];
  const pg = data?.pagination || {};
  const totalPages = pg.totalPages || 1;
  const firstLoad = loading && !data;
  const hasRows = items.length > 0;
  const emptyCatalog = Boolean(data) && items.length === 0 && !searchQuery.trim();
  const emptySearch = Boolean(data) && items.length === 0 && Boolean(searchQuery.trim());
  const nullData = !loading && !error && data == null;

  return (
    <OpsPage width="wide">
      <div className="ops-cabins-list">
        <OpsPageHeader
          title="Cabins & unit types"
          description="Single cabins and multi-unit types (e.g. A-Frame). Use Create cabin for new single listings only."
          actions={<OpsButton onClick={openCreate}>Create cabin</OpsButton>}
        />

        {error ? <OpsBanner tone="danger" body={error} /> : null}

        <OpsFilterBar
          as="form"
          aria-label="Cabin search"
          onSubmit={onSearchSubmit}
          footer={
            <OpsButton type="submit" variant="secondary">
              Search
            </OpsButton>
          }
        >
          <OpsTextField
            className="ops-filter-bar__search"
            label="Search"
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search name, location, slug…"
          />
        </OpsFilterBar>

        {firstLoad ? <OpsLoadingState label="Loading cabins" /> : null}

        {nullData ? <OpsEmptyState title="No listings found." /> : null}

        {emptyCatalog && !error ? (
          <OpsEmptyState
            title="No cabins yet."
            body="Create a single cabin to start this inventory."
            action={
              <OpsButton variant="secondary" onClick={openCreate}>
                Create cabin
              </OpsButton>
            }
          />
        ) : null}

        {emptySearch && !error ? (
          <OpsEmptyState
            variant="filtered"
            title="No cabins match this search."
            body="Try a different name, location, or slug."
          />
        ) : null}

        {hasRows ? (
          <div className="ops-cabins-list__rows" aria-busy={loading || undefined}>
            {items.map((cabin) => (
              <CabinRow key={listRowId(cabin)} cabin={cabin} />
            ))}
          </div>
        ) : null}

        {data && totalPages > 1 ? (
          <div className="ops-cabins-list__pager">
            <OpsPagination page={page} totalPages={totalPages} onPageChange={setPage} loading={loading} />
            <p className="ops-cabins-list__total">{pg.total ?? '—'} total</p>
          </div>
        ) : null}
      </div>

      <OpsModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create single cabin"
        description="Creates a single cabin only. Multi-unit provisioning remains separate."
        footer={
          <>
            <OpsButton variant="secondary" onClick={() => setCreateOpen(false)} disabled={createBusy}>
              Cancel
            </OpsButton>
            <OpsButton type="submit" form="ops-cabins-create-form" loading={createBusy} loadingLabel="Creating…">
              Create cabin
            </OpsButton>
          </>
        }
      >
        <form id="ops-cabins-create-form" className="ops-cabins-list__form" onSubmit={handleCreateSubmit}>
          {createError ? <OpsInlineError>{createError}</OpsInlineError> : null}
          <OpsTextField
            label="Name"
            required
            value={createForm.name}
            onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
            disabled={createBusy}
          />
          <OpsTextarea
            label="Description"
            required
            rows={4}
            value={createForm.description}
            onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
            disabled={createBusy}
          />
          <OpsTextField
            label="Location"
            required
            value={createForm.location}
            onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))}
            disabled={createBusy}
          />
          <div className="ops-cabins-list__form-split">
            <OpsTextField
              label="Capacity (guests)"
              required
              type="number"
              min={1}
              step={1}
              value={createForm.capacity}
              onChange={(e) => setCreateForm((f) => ({ ...f, capacity: e.target.value }))}
              disabled={createBusy}
            />
            <OpsTextField
              label="Price per night"
              required
              type="number"
              min={0}
              step={0.01}
              value={createForm.pricePerNight}
              onChange={(e) => setCreateForm((f) => ({ ...f, pricePerNight: e.target.value }))}
              disabled={createBusy}
            />
          </div>
          <OpsTextField
            label="Minimum nights"
            required
            type="number"
            min={1}
            step={1}
            value={createForm.minNights}
            onChange={(e) => setCreateForm((f) => ({ ...f, minNights: e.target.value }))}
            disabled={createBusy}
          />
          <OpsTextField
            label="Host name"
            optional
            value={createForm.hostName}
            onChange={(e) => setCreateForm((f) => ({ ...f, hostName: e.target.value }))}
            disabled={createBusy}
          />
        </form>
      </OpsModal>
    </OpsPage>
  );
}
