import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Full-screen admin image preview (portal): viewer + same operational actions as the grid.
 * No zoom in v1 — object-contain only. Mutations go through parent callbacks (no duplicated API logic).
 */
export default function AdminGalleryLightbox({
  open,
  images,
  activeImageId,
  onClose,
  onActiveChange,
  spaceTags = [],
  getPrimaryTag = () => null,
  onSetCover,
  onUpdateTag,
  onSaveAlt,
  onDelete
}) {
  const closeBtnRef = useRef(null);
  const [altDraft, setAltDraft] = useState('');

  const idx = open ? images.findIndex((i) => i._id === activeImageId) : -1;
  const current = idx >= 0 ? images[idx] : null;
  const viewerActive = Boolean(open && current && images.length > 0);

  useEffect(() => {
    if (current?._id) {
      setAltDraft(current.alt || '');
    }
  }, [current?._id]);

  useEffect(() => {
    if (!viewerActive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [viewerActive]);

  useEffect(() => {
    if (!viewerActive) return;
    closeBtnRef.current?.focus({ preventScroll: true });
  }, [viewerActive, current?._id]);

  const goPrev = useCallback(() => {
    if (idx <= 0) return;
    onActiveChange(images[idx - 1]._id);
  }, [idx, images, onActiveChange]);

  const goNext = useCallback(() => {
    if (idx < 0 || idx >= images.length - 1) return;
    onActiveChange(images[idx + 1]._id);
  }, [idx, images, onActiveChange]);

  useEffect(() => {
    if (!viewerActive) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.target.closest('input, textarea, select')) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerActive, onClose, goPrev, goNext]);

  if (!viewerActive) return null;

  const canPrev = idx > 0;
  const canNext = idx < images.length - 1;
  const primaryTag = getPrimaryTag(current);
  const spaceLabel = primaryTag
    ? spaceTags.find((t) => t.value === primaryTag)?.label || primaryTag
    : 'Unassigned';

  const handleSetCoverClick = (e) => {
    e.stopPropagation();
    if (current.isCover) return;
    onSetCover?.(current._id);
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    onDelete?.(current._id);
  };

  const handleSpaceChange = (e) => {
    e.stopPropagation();
    const v = e.target.value;
    const newTags = v ? [v] : [];
    onUpdateTag?.(current._id, newTags);
  };

  const handleAltBlur = (e) => {
    e.stopPropagation();
    const next = e.target.value;
    if (next !== (current.alt || '')) {
      onSaveAlt?.(current._id, next);
    }
  };

  const layer = (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-stretch justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:p-6 touch-manipulation"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview and actions"
    >
      <button
        type="button"
        aria-label="Close preview"
        className="absolute inset-0 bg-black/85 z-0 cursor-default border-0 p-0"
        onClick={onClose}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[min(100%,1400px)] flex-col min-h-0 max-h-full flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
          <span className="text-sm font-medium tabular-nums text-white/90">
            {idx + 1} / {images.length}
          </span>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 sm:h-10 sm:w-10"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-6">
          <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center gap-2 sm:gap-4">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              disabled={!canPrev}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:pointer-events-none disabled:opacity-30 sm:h-11 sm:w-11"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden />
            </button>

            <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
              <img
                src={current.url}
                alt={current.alt || ''}
                className="max-h-[min(55dvh,70vh)] lg:max-h-[min(65dvh,75vh)] max-w-full object-contain select-none"
                draggable={false}
              />
              {current.isCover && (
                <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[#81887A] px-3 py-1 text-xs font-medium text-white shadow-md">
                  Cover
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              disabled={!canNext}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:pointer-events-none disabled:opacity-30 sm:h-11 sm:w-11"
              aria-label="Next image"
            >
              <ChevronRight className="h-6 w-6" aria-hidden />
            </button>
          </div>

          <aside
            className="flex max-h-[38vh] shrink-0 flex-col gap-4 overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-4 backdrop-blur-md max-lg:sticky max-lg:bottom-0 max-lg:max-h-none max-lg:border-white/15 lg:max-h-[min(72vh,640px)] lg:w-80 lg:max-w-[min(20rem,32vw)]"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-white/50">Status</p>
              <p className="mt-1 text-sm text-white/90">
                {current.isCover ? 'Cover image' : 'Gallery image'}
                <span className="mx-2 text-white/30">·</span>
                <span className="text-white/70">{spaceLabel}</span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {!current.isCover && (
                <button
                  type="button"
                  onClick={handleSetCoverClick}
                  className="inline-flex flex-1 min-w-[8rem] items-center justify-center rounded-lg bg-[#81887A] px-3 py-2.5 text-sm font-medium text-white hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-white/40 sm:flex-none sm:min-w-0"
                >
                  Set as cover
                </button>
              )}
              <button
                type="button"
                onClick={handleDeleteClick}
                className="inline-flex flex-1 min-w-[8rem] items-center justify-center rounded-lg border border-red-400/60 bg-red-950/40 px-3 py-2.5 text-sm font-medium text-red-100 hover:bg-red-950/70 focus:outline-none focus:ring-2 focus:ring-red-400/50 sm:flex-none sm:min-w-0"
              >
                Delete
              </button>
            </div>

            <div className="border-t border-white/10 pt-4 space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-white/50">Metadata</p>
              <div>
                <label htmlFor="admin-lightbox-space" className="block text-xs font-medium text-white/70 mb-1.5">
                  Space
                </label>
                <select
                  id="admin-lightbox-space"
                  value={primaryTag || ''}
                  onChange={handleSpaceChange}
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-white focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                  <option value="">Unassigned</option>
                  {spaceTags.map((tag) => (
                    <option key={tag.value} value={tag.value}>
                      {tag.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="admin-lightbox-alt" className="block text-xs font-medium text-white/70 mb-1.5">
                  Alt text
                </label>
                <input
                  id="admin-lightbox-alt"
                  type="text"
                  value={altDraft}
                  onChange={(e) => setAltDraft(e.target.value)}
                  onBlur={handleAltBlur}
                  placeholder="Short description for accessibility"
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );

  return createPortal(layer, document.body);
}
