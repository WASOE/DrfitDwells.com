import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OpsGalleryLightbox from '../../../components/ops/OpsGalleryLightbox';
import { MEDIA_TAG_OPTIONS, normalizeMediaSrc } from './cabinOpsUtils.js';
import { opsWriteAPI } from '../../../services/opsApi';

export default function CabinMediaManager({ titleId, isMulti, content, onReload }) {
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
