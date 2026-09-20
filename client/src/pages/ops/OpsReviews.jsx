import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsTextarea from '../../ops/primitives/OpsTextarea';
import OpsCheckbox from '../../ops/primitives/OpsCheckbox';
import OpsBadge from '../../ops/primitives/OpsBadge';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsInlineError from '../../ops/primitives/OpsInlineError';
import OpsFilterBar from '../../ops/primitives/OpsFilterBar';
import OpsModal from '../../ops/primitives/OpsModal';
import OpsConfirmDialog from '../../ops/primitives/OpsConfirmDialog';
import OpsMetric, { OpsMetricGroup } from '../../ops/primitives/OpsMetric';
import './OpsReviews.css';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'hidden', label: 'Hidden' }
];

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'manual', label: 'Manual' },
  { value: 'import', label: 'Import' }
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'rating', label: 'Highest rating' },
  { value: 'pinned', label: 'Pinned first' }
];

const EDIT_STATUS_OPTIONS = [
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'hidden', label: 'Hidden' }
];

function emptyCreateForm(cabinId = '') {
  return {
    cabinId,
    rating: 5,
    text: '',
    reviewerName: 'Guest',
    language: 'en',
    status: 'approved',
    pinned: false,
    locked: false
  };
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch {
    return '—';
  }
}

function emptyEditForm() {
  return {
    rating: 5,
    text: '',
    reviewerName: 'Guest',
    language: 'en',
    status: 'approved',
    pinned: false,
    locked: false,
    moderationNotes: '',
    ownerResponse: { text: '', respondedBy: 'Jose' }
  };
}

function sourceLabel(source) {
  if (!source) return '—';
  const match = SOURCE_OPTIONS.find((option) => option.value === source);
  return match?.label || source;
}

export default function OpsReviews() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cabinIdFilter, setCabinIdFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [searchQ, setSearchQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [cabins, setCabins] = useState([]);
  const [loadingCabins, setLoadingCabins] = useState(false);
  const [rowAction, setRowAction] = useState(null);
  const [banner, setBanner] = useState({ type: '', message: '' });

  const [editOpen, setEditOpen] = useState(false);
  const [editReviewId, setEditReviewId] = useState(null);
  const [detailReview, setDetailReview] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editDeleting, setEditDeleting] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm());
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const deepLinkHandledRef = useRef(null);
  const createDeepLinkHandledRef = useRef(null);

  const buildCabinLabel = (item) => {
    const locationRaw = item?.location;
    const location =
      typeof locationRaw === 'string'
        ? locationRaw
        : locationRaw?.label || locationRaw?.city || locationRaw?.name || '';
    const name = item?.name || item?.label || 'Untitled cabin';
    return location ? `${name} - ${location}` : name;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setBanner({ type: '', message: '' });
    try {
      const params = { page: 1, limit: 50 };
      if (statusFilter) params.status = statusFilter;
      if (cabinIdFilter.trim()) params.cabinId = cabinIdFilter.trim();
      if (sourceFilter) params.source = sourceFilter;
      if (sortBy) params.sort = sortBy;
      if (searchQ.trim()) params.q = searchQ.trim();
      const resp = await opsReadAPI.reviews(params);
      setData(resp.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load reviews');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, cabinIdFilter, sourceFilter, sortBy, searchQ]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const loadCabins = async () => {
      setLoadingCabins(true);
      try {
        const resp = await opsReadAPI.cabins({ page: 1, limit: 200 });
        if (cancelled) return;
        const items = resp?.data?.data?.items || [];
        const options = items
          .filter((item) => item?.kind === 'single_cabin' && item?.cabinId)
          .map((item) => ({
            id: String(item.cabinId),
            name: buildCabinLabel(item)
          }));
        setCabins(options);
      } catch {
        if (!cancelled) setCabins([]);
      } finally {
        if (!cancelled) setLoadingCabins(false);
      }
    };
    loadCabins();
    return () => {
      cancelled = true;
    };
  }, []);

  const applySearch = () => {
    setSearchQ(searchInput);
  };

  const handleModeration = async (reviewId, status) => {
    const key = `${reviewId}:${status}`;
    setRowAction(key);
    setBanner({ type: '', message: '' });
    try {
      await opsWriteAPI.updateReviewStatus(reviewId, status);
      setBanner({
        type: 'success',
        message: `Review ${status === 'approved' ? 'approved' : 'hidden'}.`
      });
      await load();
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        (err?.response?.status === 403 ? 'Not allowed (cutover or permissions).' : null) ||
        'Update failed';
      setBanner({ type: 'error', message: msg });
    } finally {
      setRowAction(null);
    }
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditReviewId(null);
    setDetailReview(null);
    setEditForm(emptyEditForm());
    setEditError('');
    setEditLoading(false);
    setDeleteConfirmOpen(false);

    if (searchParams.get('reviewId')) {
      const next = new URLSearchParams(searchParams);
      next.delete('reviewId');
      setSearchParams(next, { replace: true });
    }
  };

  const openCreate = useCallback(
    (prefillCabinId = '') => {
      setCreateOpen(true);
      setCreateError('');
      setCreateForm(emptyCreateForm(prefillCabinId));
    },
    []
  );

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateSaving(false);
    setCreateError('');
    setCreateForm(emptyCreateForm(cabinIdFilter));

    if (searchParams.get('create')) {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, cabinIdFilter]);

  const openEdit = useCallback(async (reviewId) => {
    setEditReviewId(reviewId);
    setEditOpen(true);
    setEditError('');
    setDetailReview(null);
    setEditForm(emptyEditForm());
    setEditLoading(true);
    setDeleteConfirmOpen(false);
    try {
      const resp = await opsReadAPI.review(reviewId);
      const review = resp.data?.data?.review;
      if (!review) {
        setEditError('Review not found');
        return;
      }
      setDetailReview(review);
      setEditForm({
        rating: review.rating ?? 5,
        text: review.text || '',
        reviewerName: review.reviewerName?.trim() ? review.reviewerName : 'Guest',
        language: review.language || 'en',
        status: review.status || 'approved',
        pinned: Boolean(review.pinned),
        locked: Boolean(review.locked),
        moderationNotes: review.moderationNotes || '',
        ownerResponse: {
          text: review.ownerResponse?.text || '',
          respondedBy: review.ownerResponse?.respondedBy?.trim() || 'Jose'
        }
      });
    } catch (err) {
      setEditError(err?.response?.data?.message || 'Failed to load review');
    } finally {
      setEditLoading(false);
    }
  }, []);

  useEffect(() => {
    const reviewId = searchParams.get('reviewId');
    if (!reviewId) {
      deepLinkHandledRef.current = null;
      return;
    }
    if (deepLinkHandledRef.current === reviewId) return;
    deepLinkHandledRef.current = reviewId;
    openEdit(reviewId);
  }, [searchParams, openEdit]);

  useEffect(() => {
    const createFlag = searchParams.get('create');
    if (createFlag !== '1') {
      createDeepLinkHandledRef.current = null;
      return;
    }
    const prefillCabinId = searchParams.get('cabinId') || '';
    const key = `${createFlag}:${prefillCabinId}`;
    if (createDeepLinkHandledRef.current === key) return;
    createDeepLinkHandledRef.current = key;
    openCreate(prefillCabinId);
  }, [searchParams, openCreate]);

  const handleEditField = (field, value) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setEditForm((prev) => ({
        ...prev,
        [parent]: { ...prev[parent], [child]: value }
      }));
    } else {
      setEditForm((prev) => ({ ...prev, [field]: value }));
    }
  };

  const handleEditSave = async () => {
    if (!editReviewId || !detailReview) return;
    setEditError('');
    setEditSaving(true);
    try {
      if (!editForm.text.trim()) {
        setEditError('Review text is required');
        return;
      }
      if (detailReview.locked && editForm.text.trim() !== detailReview.text && editForm.locked) {
        setEditError('Cannot edit text while review is locked. Uncheck “Locked” to edit the text.');
        return;
      }

      const payload = {
        rating: Number(editForm.rating),
        text: editForm.text.trim(),
        reviewerName: editForm.reviewerName.trim(),
        language: editForm.language,
        status: String(editForm.status).toLowerCase(),
        pinned: editForm.pinned,
        locked: editForm.locked,
        moderationNotes: editForm.moderationNotes
      };
      if (editForm.ownerResponse.text.trim()) {
        payload.ownerResponse = {
          text: editForm.ownerResponse.text.trim(),
          respondedBy: editForm.ownerResponse.respondedBy.trim() || 'Jose'
        };
      }

      await opsWriteAPI.updateReview(editReviewId, payload);
      setBanner({ type: 'success', message: 'Review saved.' });
      closeEdit();
      await load();
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.code ||
        err?.response?.data?.errors?.[0]?.msg ||
        'Save failed';
      setEditError(msg);
    } finally {
      setEditSaving(false);
    }
  };

  const requestDelete = () => {
    if (!editReviewId || editLoading || editSaving || editDeleting) return;
    setDeleteConfirmOpen(true);
  };

  const handleEditDelete = async () => {
    if (!editReviewId || editLoading || editSaving || editDeleting) return;
    setEditDeleting(true);
    setEditError('');
    try {
      await opsWriteAPI.deleteReview(editReviewId);
      setBanner({ type: 'success', message: 'Review deleted.' });
      setDeleteConfirmOpen(false);
      closeEdit();
      await load();
    } catch (err) {
      const msg =
        err?.response?.status === 403
          ? 'Not allowed to delete this review (cutover or permissions).'
          : err?.response?.data?.message || 'Delete failed';
      setEditError(msg);
      setDeleteConfirmOpen(false);
    } finally {
      setEditDeleting(false);
    }
  };

  const handleCreateField = (field, value) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateSave = async () => {
    setCreateSaving(true);
    setCreateError('');
    try {
      if (!createForm.cabinId) {
        setCreateError('Please select a cabin');
        return;
      }
      if (!createForm.text.trim()) {
        setCreateError('Review text is required');
        return;
      }

      const payload = {
        cabinId: createForm.cabinId,
        rating: Number(createForm.rating),
        text: createForm.text.trim(),
        reviewerName: createForm.reviewerName.trim(),
        language: createForm.language.trim() || 'en',
        status: String(createForm.status || 'approved').toLowerCase(),
        pinned: createForm.pinned,
        locked: createForm.locked
      };

      await opsWriteAPI.createReview(payload);
      setBanner({ type: 'success', message: 'Review created successfully.' });
      closeCreate();
      await load();
    } catch (err) {
      setCreateError(
        err?.response?.data?.message ||
          err?.response?.data?.errors?.[0]?.msg ||
          err?.response?.data?.code ||
          'Unable to create review'
      );
    } finally {
      setCreateSaving(false);
    }
  };

  const textLocked = Boolean(detailReview?.locked) && Boolean(editForm.locked);
  const cabin =
    detailReview?.cabinId && typeof detailReview.cabinId === 'object' ? detailReview.cabinId : null;
  const createHasSelectedCabin = !createForm.cabinId || cabins.some((c) => c.id === createForm.cabinId);
  const items = data?.items || [];
  const showData = Boolean(data) && !error;
  const emptyCopy = `No reviews for this filter${searchQ ? ' / search' : ''}.`;

  return (
    <OpsPage width="wide">
      <div className="ops-reviews">
        <OpsPageHeader
          title="Reviews"
          description="Approve or hide guest reviews. Same rules as admin reviews (cabins stats refresh after status changes). Edit opens the full moderator form."
          actions={
            <div className="ops-reviews-toolbar__actions">
              <OpsButton
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set('create', '1');
                  if (cabinIdFilter) next.set('cabinId', cabinIdFilter);
                  setSearchParams(next, { replace: false });
                }}
              >
                Create review
              </OpsButton>
              <OpsButton variant="secondary" onClick={() => load()} disabled={loading} loading={loading && Boolean(data)}>
                Reload
              </OpsButton>
            </div>
          }
        />

        {error ? <OpsBanner tone="danger" body={error} /> : null}

        {banner.message ? (
          <OpsBanner
            tone={banner.type === 'success' ? 'success' : 'danger'}
            body={banner.message}
          />
        ) : null}

        {loading && !data ? <OpsLoadingState label="Loading reviews…" /> : null}

        {showData ? (
          <>
            <OpsMetricGroup>
              <OpsMetric label="Approved" value={data?.moderationSummary?.approved ?? 0} />
              <OpsMetric label="Pending" value={data?.moderationSummary?.pending ?? 0} />
              <OpsMetric label="Hidden" value={data?.moderationSummary?.hidden ?? 0} />
            </OpsMetricGroup>

            <OpsFilterBar
              footer={
                <div className="ops-reviews-toolbar">
                  <p className="ops-reviews-toolbar__meta">
                    {data?.pagination?.total != null ? `${data.pagination.total} review(s)` : null}
                    {loading ? ' · Refreshing…' : null}
                  </p>
                </div>
              }
            >
              <OpsSelect
                id="ops-review-status"
                label="Status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </OpsSelect>
              <OpsSelect
                id="ops-review-cabin"
                label="Cabin"
                value={cabinIdFilter}
                onChange={(e) => setCabinIdFilter(e.target.value)}
                hint={loadingCabins ? 'Loading cabins…' : undefined}
              >
                <option value="">All cabins</option>
                {cabins.map((cabinOption) => (
                  <option key={cabinOption.id} value={cabinOption.id}>
                    {cabinOption.name}
                  </option>
                ))}
              </OpsSelect>
              <OpsSelect
                id="ops-review-source"
                label="Source"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </OpsSelect>
              <OpsSelect
                id="ops-review-sort"
                label="Sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </OpsSelect>
              <div className="ops-reviews-search">
                <OpsTextField
                  id="ops-review-q"
                  label="Search text"
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                  placeholder="Matches review or reviewer name"
                />
                <OpsButton variant="secondary" onClick={applySearch}>
                  Search
                </OpsButton>
              </div>
            </OpsFilterBar>

            {items.length === 0 ? (
              <OpsEmptyState title={emptyCopy} />
            ) : (
              <div className="ops-reviews-list">
                {items.map((r) => (
                  <article key={r.reviewId} className="ops-reviews-row" data-testid={`review-row-${r.reviewId}`}>
                    <div className="ops-reviews-row__top">
                      <div className="ops-reviews-row__identity">
                        <h2 className="ops-reviews-row__name">{r.reviewerDisplay}</h2>
                        <div className="ops-reviews-row__meta">
                          {r.cabinName ? <strong>{r.cabinName}</strong> : null}
                          <span>Source: {sourceLabel(r.source)}</span>
                          <span>Date: {formatDate(r.createdAtSource)}</span>
                        </div>
                        <p className="ops-reviews-row__text">{r.textExcerpt || '—'}</p>
                      </div>
                      <div className="ops-reviews-row__badges">
                        <OpsBadge tone="neutral">
                          <span className="ops-reviews-row__rating">★ {r.rating ?? '—'}</span>
                        </OpsBadge>
                        <OpsStatus domain="review" value={r.status} />
                      </div>
                    </div>
                    <div className="ops-reviews-row__actions">
                      <OpsButton
                        variant="secondary"
                        size="compact"
                        onClick={() => {
                          const next = new URLSearchParams(searchParams);
                          next.set('reviewId', r.reviewId);
                          setSearchParams(next, { replace: false });
                        }}
                      >
                        Edit
                      </OpsButton>
                      <OpsButton
                        size="compact"
                        disabled={rowAction !== null || loading || r.status === 'approved'}
                        loading={rowAction === `${r.reviewId}:approved`}
                        loadingLabel="Approving…"
                        onClick={() => handleModeration(r.reviewId, 'approved')}
                      >
                        Approve
                      </OpsButton>
                      <OpsButton
                        variant="secondary"
                        size="compact"
                        disabled={rowAction !== null || loading || r.status === 'hidden'}
                        loading={rowAction === `${r.reviewId}:hidden`}
                        loadingLabel="Hiding…"
                        onClick={() => handleModeration(r.reviewId, 'hidden')}
                      >
                        Hide
                      </OpsButton>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : null}

        <OpsModal
          open={createOpen}
          onClose={closeCreate}
          title="Create review"
          footer={
            <div className="ops-reviews-modal-footer">
              <OpsButton variant="secondary" onClick={closeCreate}>
                Cancel
              </OpsButton>
              <OpsButton loading={createSaving} loadingLabel="Saving…" onClick={handleCreateSave}>
                Create
              </OpsButton>
            </div>
          }
        >
          {createError ? <OpsInlineError>{createError}</OpsInlineError> : null}
          <div className="ops-reviews-modal-grid">
            <div className="ops-reviews-modal-grid__full">
              <OpsSelect
                label="Cabin *"
                value={createForm.cabinId}
                onChange={(e) => handleCreateField('cabinId', e.target.value)}
                hint={loadingCabins ? 'Loading cabin options…' : undefined}
              >
                <option value="">Select a cabin</option>
                {!createHasSelectedCabin ? (
                  <option value={createForm.cabinId}>{`Selected (ID: ${createForm.cabinId})`}</option>
                ) : null}
                {cabins.map((cabinOption) => (
                  <option key={cabinOption.id} value={cabinOption.id}>
                    {cabinOption.name}
                  </option>
                ))}
              </OpsSelect>
            </div>
            <OpsSelect
              label="Rating *"
              value={createForm.rating}
              onChange={(e) => handleCreateField('rating', parseInt(e.target.value, 10))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} ★
                </option>
              ))}
            </OpsSelect>
            <OpsSelect
              label="Status"
              value={createForm.status}
              onChange={(e) => handleCreateField('status', e.target.value)}
            >
              {EDIT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </OpsSelect>
            <OpsTextField
              label="Reviewer name"
              value={createForm.reviewerName}
              onChange={(e) => handleCreateField('reviewerName', e.target.value)}
            />
            <OpsTextField
              label="Language"
              value={createForm.language}
              onChange={(e) => handleCreateField('language', e.target.value)}
            />
            <div className="ops-reviews-modal-grid__full ops-reviews-modal-checks">
              <OpsCheckbox
                label="Pinned"
                checked={createForm.pinned}
                onChange={(e) => handleCreateField('pinned', e.target.checked)}
              />
              <OpsCheckbox
                label="Locked"
                checked={createForm.locked}
                onChange={(e) => handleCreateField('locked', e.target.checked)}
              />
            </div>
            <div className="ops-reviews-modal-grid__full">
              <OpsTextarea
                label="Review text *"
                value={createForm.text}
                onChange={(e) => handleCreateField('text', e.target.value)}
                rows={6}
              />
            </div>
          </div>
        </OpsModal>

        <OpsModal
          open={editOpen}
          onClose={closeEdit}
          title="Edit review"
          description={editReviewId || undefined}
          footer={
            <div className="ops-reviews-modal-footer ops-reviews-modal-footer--split">
              <OpsButton
                variant="destructive"
                disabled={editDeleting || editSaving || editLoading || !detailReview}
                loading={editDeleting}
                loadingLabel="Deleting…"
                onClick={requestDelete}
              >
                Delete
              </OpsButton>
              <div className="ops-reviews-modal-footer__end">
                <OpsButton variant="secondary" onClick={closeEdit}>
                  Cancel
                </OpsButton>
                <OpsButton
                  disabled={editSaving || editLoading || editDeleting || !detailReview}
                  loading={editSaving}
                  loadingLabel="Saving…"
                  onClick={handleEditSave}
                >
                  Save
                </OpsButton>
              </div>
            </div>
          }
        >
          {editLoading ? <OpsLoadingState label="Loading review…" /> : null}
          {editError ? <OpsInlineError>{editError}</OpsInlineError> : null}

          {!editLoading && detailReview ? (
            <>
              {detailReview.locked && editForm.locked ? (
                <OpsBanner
                  tone="warning"
                  title="Review is locked"
                  body="Imported reviews may lock text to prevent accidental edits. Uncheck “Locked” below to edit the review text."
                  action={
                    <OpsButton variant="quiet" size="compact" onClick={() => handleEditField('locked', false)}>
                      Unlock to edit text
                    </OpsButton>
                  }
                />
              ) : null}

              <div className="ops-reviews-modal-grid">
                <div className="ops-reviews-modal-grid__full">
                  <p className="ops-reviews-hint">Cabin</p>
                  <p className="ops-reviews-cabin-readout">
                    {cabin?.name ?? '—'}
                    {cabin?.location ? (
                      <span>
                        {' '}
                        ·{' '}
                        {typeof cabin.location === 'string'
                          ? cabin.location
                          : cabin.location?.label || ''}
                      </span>
                    ) : null}
                  </p>
                </div>
                <OpsSelect
                  label="Rating"
                  value={editForm.rating}
                  onChange={(e) => handleEditField('rating', parseInt(e.target.value, 10))}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} ★
                    </option>
                  ))}
                </OpsSelect>
                <OpsSelect
                  label="Status"
                  value={editForm.status}
                  onChange={(e) => handleEditField('status', e.target.value)}
                >
                  {EDIT_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </OpsSelect>
                <OpsTextField
                  label="Reviewer name"
                  value={editForm.reviewerName}
                  onChange={(e) => handleEditField('reviewerName', e.target.value)}
                />
                <OpsTextField
                  label="Language"
                  value={editForm.language}
                  onChange={(e) => handleEditField('language', e.target.value)}
                />
                <div className="ops-reviews-modal-grid__full ops-reviews-modal-checks">
                  <OpsCheckbox
                    label="Pinned"
                    checked={editForm.pinned}
                    onChange={(e) => handleEditField('pinned', e.target.checked)}
                  />
                  <OpsCheckbox
                    label="Locked"
                    hint="Prevents editing review text until unchecked."
                    checked={editForm.locked}
                    onChange={(e) => handleEditField('locked', e.target.checked)}
                  />
                </div>
                <div className="ops-reviews-modal-grid__full">
                  <OpsTextarea
                    label="Review text"
                    value={editForm.text}
                    onChange={(e) => handleEditField('text', e.target.value)}
                    disabled={textLocked}
                    rows={6}
                  />
                  {detailReview.source === 'airbnb' ? (
                    <p className="ops-reviews-hint">Source: imported from {detailReview.source}</p>
                  ) : null}
                </div>
              </div>

              <div className="ops-reviews-modal-section">
                <h3 className="ops-reviews-modal-section__title">Owner response</h3>
                <OpsTextarea
                  label="Response text"
                  value={editForm.ownerResponse.text}
                  onChange={(e) => handleEditField('ownerResponse.text', e.target.value)}
                  rows={3}
                />
                <OpsTextField
                  label="Responded by"
                  value={editForm.ownerResponse.respondedBy}
                  onChange={(e) => handleEditField('ownerResponse.respondedBy', e.target.value)}
                />
              </div>

              <OpsTextarea
                label="Moderation notes (internal)"
                value={editForm.moderationNotes}
                onChange={(e) => handleEditField('moderationNotes', e.target.value)}
                rows={3}
              />

              <div className="ops-reviews-modal-meta">
                <div>
                  <div className="ops-reviews-modal-meta__label">Source</div>
                  <div className="ops-reviews-modal-meta__value">{sourceLabel(detailReview.source)}</div>
                </div>
                {detailReview.externalId ? (
                  <div>
                    <div className="ops-reviews-modal-meta__label">External ID</div>
                    <div className="ops-reviews-modal-meta__value ops-reviews-modal-meta__mono">
                      {detailReview.externalId}
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="ops-reviews-modal-meta__label">Original date</div>
                  <div className="ops-reviews-modal-meta__value">
                    {formatDate(detailReview.createdAtSource)}
                  </div>
                </div>
                {detailReview.editedAt ? (
                  <div>
                    <div className="ops-reviews-modal-meta__label">Last edited</div>
                    <div className="ops-reviews-modal-meta__value">
                      {formatDate(detailReview.editedAt)}
                      {detailReview.editedBy ? ` · ${detailReview.editedBy}` : ''}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </OpsModal>

        <OpsConfirmDialog
          open={deleteConfirmOpen}
          title="Delete this review?"
          body="This is a soft delete and can affect cabin stats."
          confirmLabel="Delete"
          tone="destructive"
          loading={editDeleting}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={handleEditDelete}
        />
      </div>
    </OpsPage>
  );
}
