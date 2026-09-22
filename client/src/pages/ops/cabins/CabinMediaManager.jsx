import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OpsGalleryLightbox from '../../../components/ops/OpsGalleryLightbox';
import OpsBadge from '../../../ops/primitives/OpsBadge';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsConfirmDialog from '../../../ops/primitives/OpsConfirmDialog';
import OpsEmptyState from '../../../ops/primitives/OpsEmptyState';
import OpsSelect from '../../../ops/primitives/OpsSelect';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import { opsWriteAPI } from '../../../services/opsApi';
import { CabinEditorRow, CabinEditorSection } from './CabinEditorSection';
import { MEDIA_TAG_OPTIONS, normalizeMediaSrc } from './cabinOpsUtils.js';

export default function CabinMediaManager({ titleId, isMulti, content, onReload }) {
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaMessage, setMediaMessage] = useState('');
  const [mediaError, setMediaError] = useState('');
  const uploadRef = useRef(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const mediaImages = useMemo(() => {
    const arr = Array.isArray(content?.images) ? [...content.images] : [];
    return arr.sort((a, b) => {
      if (Boolean(b?.isCover) !== Boolean(a?.isCover)) return Number(b?.isCover) - Number(a?.isCover);
      return (a?.sort ?? 0) - (b?.sort ?? 0);
    });
  }, [content?.images]);

  const lightboxImages = useMemo(
    () =>
      mediaImages.map((image) => ({
        _id: String(image._id),
        src: normalizeMediaSrc(image.url),
        alt: image.alt || '',
        tags: Array.isArray(image.tags) ? image.tags : [],
        isCover: Boolean(image.isCover)
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
      } catch (error) {
        setMediaError(error?.response?.data?.message || 'Media update failed');
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
      const index = mediaImages.findIndex((image) => String(image?._id) === String(imageId));
      if (index < 0) return;
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= mediaImages.length) return;
      const next = [...mediaImages];
      const swap = next[index];
      next[index] = next[target];
      next[target] = swap;
      const order = next.map((image, sort) => ({
        imageId: String(image._id),
        sort,
        spaceOrder: typeof image.spaceOrder === 'number' ? image.spaceOrder : 0
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
      await runMediaMutation(
        () => opsWriteAPI.deleteCabinImage(titleId, imageId),
        'Image deleted'
      );
      setDeleteTarget(null);
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
      await runMediaMutation(
        () => opsWriteAPI.updateCabinImage(titleId, imageId, { tags: tag ? [tag] : [] }),
        'Image category updated'
      );
    },
    [runMediaMutation, titleId]
  );

  return (
    <CabinEditorSection title="Media manager" className="ops-cabin-media">
      <div className="ops-cabin-media__toolbar">
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="sr-only"
          disabled={mediaBusy || isMulti}
        />
        <OpsButton
          size="compact"
          disabled={mediaBusy || isMulti}
          loading={mediaBusy}
          loadingLabel="Working…"
          onClick={() => uploadRef.current?.click()}
        >
          Upload image
        </OpsButton>
      </div>
      {isMulti ? (
        <OpsBanner
          tone="warning"
          body="Media editing is currently available for single cabins only in this batch."
        />
      ) : null}
      {mediaError ? <OpsBanner tone="danger" body={mediaError} /> : null}
      {mediaMessage ? <OpsBanner tone="success" body={mediaMessage} /> : null}

      {mediaImages.length === 0 ? (
        <OpsEmptyState title="No images yet." />
      ) : (
        <div className="ops-cabin-media__grid">
          {mediaImages.map((image, index) => (
            <CabinEditorRow key={String(image._id)} className="ops-cabin-media__item">
              <button
                type="button"
                className="ops-cabin-media__preview"
                onClick={() => setLightboxIndex(index)}
              >
                <img
                  src={normalizeMediaSrc(image.url)}
                  alt={image.alt || ''}
                  loading="lazy"
                />
                {image.isCover ? <OpsBadge>Cover</OpsBadge> : null}
              </button>
              <p className="ops-cabin-editor__row-meta">Order: {index + 1}</p>
              <OpsTextField
                label="Alt text"
                defaultValue={image.alt || ''}
                onBlur={(event) => {
                  const nextAlt = String(event.target.value || '');
                  if (nextAlt !== String(image.alt || '')) {
                    handleSaveAlt(String(image._id), nextAlt);
                  }
                }}
                disabled={mediaBusy || isMulti}
                placeholder="Short image description"
              />
              <OpsSelect
                label="Category"
                value={Array.isArray(image.tags) && image.tags[0] ? String(image.tags[0]) : ''}
                onChange={(event) => handleSetTag(String(image._id), event.target.value)}
                disabled={mediaBusy || isMulti}
              >
                <option value="">Unassigned</option>
                {MEDIA_TAG_OPTIONS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </OpsSelect>
              <div className="ops-cabin-media__actions">
                <OpsButton
                  variant="secondary"
                  size="compact"
                  disabled={mediaBusy || isMulti || Boolean(image.isCover)}
                  onClick={() => handleSetCover(String(image._id))}
                >
                  Set cover
                </OpsButton>
                <OpsButton
                  variant="quiet"
                  size="compact"
                  disabled={mediaBusy || isMulti || index === 0}
                  onClick={() => handleMove(String(image._id), 'up')}
                >
                  Move up
                </OpsButton>
                <OpsButton
                  variant="quiet"
                  size="compact"
                  disabled={mediaBusy || isMulti || index === mediaImages.length - 1}
                  onClick={() => handleMove(String(image._id), 'down')}
                >
                  Move down
                </OpsButton>
                <OpsButton
                  variant="destructive"
                  size="compact"
                  disabled={mediaBusy || isMulti}
                  onClick={() => setDeleteTarget(String(image._id))}
                >
                  Delete
                </OpsButton>
              </div>
            </CabinEditorRow>
          ))}
        </div>
      )}

      <OpsGalleryLightbox
        open={lightboxIndex !== null}
        images={lightboxImages}
        activeIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onPrev={() => setLightboxIndex((index) => (index === null ? index : Math.max(0, index - 1)))}
        onNext={() =>
          setLightboxIndex((index) =>
            index === null ? index : Math.min(lightboxImages.length - 1, index + 1)
          )
        }
      />
      <OpsConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => !mediaBusy && setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title="Delete image?"
        body="This removes the image permanently and cannot be undone."
        confirmLabel="Delete image"
        destructive
        loading={mediaBusy}
      />
    </CabinEditorSection>
  );
}
