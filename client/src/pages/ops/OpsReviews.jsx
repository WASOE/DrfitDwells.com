import { useCallback, useEffect, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'hidden', label: 'Hidden' }
];

const EDIT_STATUS_OPTIONS = [
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'hidden', label: 'Hidden' }
];

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

export default function OpsReviews() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [rowAction, setRowAction] = useState(null);
  const [banner, setBanner] = useState({ type: '', message: '' });

  const [editOpen, setEditOpen] = useState(false);
  const [editReviewId, setEditReviewId] = useState(null);
  const [detailReview, setDetailReview] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setBanner({ type: '', message: '' });
    try {
      const params = { page: 1, limit: 50 };
      if (statusFilter) params.status = statusFilter;
      if (searchQ.trim()) params.q = searchQ.trim();
      const resp = await opsReadAPI.reviews(params);
      setData(resp.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load reviews');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQ]);

  useEffect(() => {
    load();
  }, [load]);

  const applySearch = () => {
    setSearchQ(searchInput);
  };

  const handleModeration = async (reviewId, status) => {
    const key = `${reviewId}:${status}`;
    setRowAction(key);
    setBanner({ type: '', message: '' });
    try {
      await opsWriteAPI.updateReviewStatus(reviewId, status);
      setBanner({ type: 'success', message: `Review ${status === 'approved' ? 'approved' : 'hidden'}.` });
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
  };

  const openEdit = async (reviewId) => {
    setEditReviewId(reviewId);
    setEditOpen(true);
    setEditError('');
    setDetailReview(null);
    setEditForm(emptyEditForm());
    setEditLoading(true);
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
  };

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

  const textLocked =
    Boolean(detailReview?.locked) && Boolean(editForm.locked);

  const cabin = detailReview?.cabinId && typeof detailReview.cabinId === 'object' ? detailReview.cabinId : null;

  if (loading && !data) {
    return <div className="text-sm text-gray-500 max-w-5xl mx-auto px-4 py-6">Loading reviews...</div>;
  }

  return (
    <div className="space-y-4 pb-16 sm:pb-0 max-w-5xl mx-auto px-4 py-6 md:py-8">
      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6">
        <h2 className="text-lg md:text-xl font-semibold text-gray-900">Reviews moderation</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Approve or hide guest reviews. Same rules as admin reviews (cabins stats refresh after status
          changes). Edit opens the full moderator form.
        </p>
      </section>

      {error ? (
        <div className="text-sm text-red-600 rounded-xl border border-red-200 bg-red-50 p-3">{error}</div>
      ) : null}

      {banner.message ? (
        <div
          className={`text-sm rounded-xl border p-3 ${
            banner.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {banner.message}
        </div>
      ) : null}

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Moderation summary</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">Approved</div>
            <div className="text-xl font-semibold text-gray-900">{data?.moderationSummary?.approved ?? 0}</div>
          </div>
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">Pending</div>
            <div className="text-xl font-semibold text-gray-900">{data?.moderationSummary?.pending ?? 0}</div>
          </div>
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">Hidden</div>
            <div className="text-xl font-semibold text-gray-900">{data?.moderationSummary?.hidden ?? 0}</div>
          </div>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1 w-full md:max-w-xs">
            <label htmlFor="ops-review-status" className="text-xs font-medium text-gray-600">
              Status
            </label>
            <select
              id="ops-review-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full md:max-w-xl">
            <div className="space-y-1 flex-1 min-w-0">
              <label htmlFor="ops-review-q" className="text-xs font-medium text-gray-600">
                Search text
              </label>
              <input
                id="ops-review-q"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                placeholder="Matches review or reviewer name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={applySearch}
              className="shrink-0 h-[42px] px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-800 bg-gray-50 hover:bg-gray-100"
            >
              Search
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {data?.pagination?.total != null ? `${data.pagination.total} review(s)` : null}
            {loading ? ' · Refreshing…' : null}
          </span>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="text-blue-700 hover:underline disabled:opacity-50"
          >
            Reload
          </button>
        </div>

        <h3 className="text-sm font-semibold text-gray-900">Reviews</h3>
        <div className="mt-3 space-y-3">
          {(data?.items || []).map((r) => (
            <div key={r.reviewId} className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-semibold text-gray-900">{r.reviewerDisplay}</div>
                  <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                    {r.cabinName ? <span className="font-medium text-gray-700">{r.cabinName}</span> : null}
                    <span>Source: {r.source ?? '—'}</span>
                    <span>Date: {formatDate(r.createdAtSource)}</span>
                  </div>
                  <p className="text-sm text-gray-800 mt-2 whitespace-pre-wrap break-words max-w-3xl">
                    {r.textExcerpt || '—'}
                  </p>
                </div>
                <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 shrink-0">
                  <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">
                    ★ {r.rating ?? '—'}
                  </span>
                  <span className="text-xs px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-900 capitalize">
                    {r.status}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => openEdit(r.reviewId)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-[#81887A] text-gray-900 hover:bg-gray-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={rowAction !== null || loading || r.status === 'approved'}
                  onClick={() => handleModeration(r.reviewId, 'approved')}
                  className="px-3 py-1.5 text-sm rounded-lg bg-green-700 text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {rowAction === `${r.reviewId}:approved` ? 'Approving…' : 'Approve'}
                </button>
                <button
                  type="button"
                  disabled={rowAction !== null || loading || r.status === 'hidden'}
                  onClick={() => handleModeration(r.reviewId, 'hidden')}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-400 text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {rowAction === `${r.reviewId}:hidden` ? 'Hiding…' : 'Hide'}
                </button>
              </div>
            </div>
          ))}
          {(data?.items || []).length === 0 ? (
            <div className="text-sm text-gray-500">No reviews for this filter{searchQ ? ' / search' : ''}.</div>
          ) : null}
        </div>
      </section>

      {editOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ops-review-edit-title"
        >
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 md:px-6 flex flex-wrap items-center justify-between gap-3 z-10">
              <div>
                <h3 id="ops-review-edit-title" className="text-lg font-semibold text-gray-900">
                  Edit review
                </h3>
                {editReviewId ? (
                  <p className="text-xs text-gray-500 font-mono mt-0.5">{editReviewId}</p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={editSaving || editLoading || !detailReview}
                  onClick={handleEditSave}
                  className="px-3 py-2 text-sm rounded-lg bg-[#81887A] text-white hover:bg-[#707668] disabled:opacity-50"
                >
                  {editSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <div className="p-4 md:p-6 space-y-4">
              {editLoading ? (
                <div className="text-sm text-gray-600 py-8 text-center">Loading review…</div>
              ) : null}

              {editError ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{editError}</div>
              ) : null}

              {!editLoading && detailReview ? (
                <>
                  {detailReview.locked && editForm.locked ? (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
                      <p className="font-medium">Review is locked</p>
                      <p className="mt-1">
                        Imported reviews may lock text to prevent accidental edits. Uncheck “Locked” below to
                        edit the review text.
                      </p>
                      <button
                        type="button"
                        className="mt-2 text-sm font-medium underline text-yellow-950"
                        onClick={() => handleEditField('locked', false)}
                      >
                        Unlock to edit text →
                      </button>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Cabin</div>
                      <p className="text-sm text-gray-900 mt-1">
                        {cabin?.name ?? '—'}
                        {cabin?.location ? (
                          <span className="text-gray-600">
                            {' '}
                            · {typeof cabin.location === 'string' ? cabin.location : cabin.location?.label || ''}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Rating</label>
                      <select
                        value={editForm.rating}
                        onChange={(e) => handleEditField('rating', parseInt(e.target.value, 10))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n} ★
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                      <select
                        value={editForm.status}
                        onChange={(e) => handleEditField('status', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      >
                        {EDIT_STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Reviewer name</label>
                      <input
                        type="text"
                        value={editForm.reviewerName}
                        onChange={(e) => handleEditField('reviewerName', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Language</label>
                      <input
                        type="text"
                        value={editForm.language}
                        onChange={(e) => handleEditField('language', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="md:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-800">
                        <input
                          type="checkbox"
                          checked={editForm.pinned}
                          onChange={(e) => handleEditField('pinned', e.target.checked)}
                          className="rounded border-gray-300"
                        />
                        Pinned
                      </label>
                      <label className="inline-flex items-start gap-2 text-sm text-gray-800">
                        <input
                          type="checkbox"
                          checked={editForm.locked}
                          onChange={(e) => handleEditField('locked', e.target.checked)}
                          className="rounded border-gray-300 mt-0.5"
                        />
                        <span>
                          Locked
                          <span className="block text-xs text-gray-500 font-normal">
                            Prevents editing review text until unchecked.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Review text</label>
                    <textarea
                      value={editForm.text}
                      onChange={(e) => handleEditField('text', e.target.value)}
                      disabled={textLocked}
                      rows={6}
                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm ${
                        textLocked ? 'bg-gray-100 cursor-not-allowed' : ''
                      }`}
                    />
                    {detailReview.source === 'airbnb' ? (
                      <p className="text-xs text-gray-500 mt-1">Source: imported from {detailReview.source}</p>
                    ) : null}
                  </div>

                  <div className="border-t border-gray-100 pt-4 space-y-3">
                    <h4 className="text-sm font-semibold text-gray-900">Owner response</h4>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Response text</label>
                      <textarea
                        value={editForm.ownerResponse.text}
                        onChange={(e) => handleEditField('ownerResponse.text', e.target.value)}
                        rows={3}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Responded by</label>
                      <input
                        type="text"
                        value={editForm.ownerResponse.respondedBy}
                        onChange={(e) => handleEditField('ownerResponse.respondedBy', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm max-w-md"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Moderation notes (internal)
                    </label>
                    <textarea
                      value={editForm.moderationNotes}
                      onChange={(e) => handleEditField('moderationNotes', e.target.value)}
                      rows={3}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="border-t border-gray-100 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Source</span>
                      <div className="text-gray-900">{detailReview.source ?? '—'}</div>
                    </div>
                    {detailReview.externalId ? (
                      <div>
                        <span className="text-gray-500">External ID</span>
                        <div className="text-gray-900 font-mono text-xs break-all">{detailReview.externalId}</div>
                      </div>
                    ) : null}
                    <div>
                      <span className="text-gray-500">Original date</span>
                      <div className="text-gray-900">{formatDate(detailReview.createdAtSource)}</div>
                    </div>
                    {detailReview.editedAt ? (
                      <div className="sm:col-span-2">
                        <span className="text-gray-500">Last edited</span>
                        <div className="text-gray-900">
                          {formatDate(detailReview.editedAt)}
                          {detailReview.editedBy ? ` · ${detailReview.editedBy}` : ''}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
