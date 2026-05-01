import { useEffect } from 'react';

function isFormLikeTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
}

export default function OpsGalleryLightbox({
  open,
  images,
  activeIndex,
  onClose,
  onPrev,
  onNext
}) {
  const hasImages = Array.isArray(images) && images.length > 0;
  const safeIndex = Number.isInteger(activeIndex) ? activeIndex : -1;
  const current = hasImages && safeIndex >= 0 && safeIndex < images.length ? images[safeIndex] : null;

  useEffect(() => {
    if (!open || !current) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, current]);

  useEffect(() => {
    if (!open || !current) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (isFormLikeTarget(event.target)) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, current, onClose, onPrev, onNext]);

  if (!open || !current) return null;

  const category = Array.isArray(current.tags) && current.tags[0] ? String(current.tags[0]) : 'Unassigned';
  const canPrev = safeIndex > 0;
  const canNext = safeIndex < images.length - 1;

  return (
    <div
      className="fixed inset-0 z-[120] p-3 md:p-6 bg-black/80 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Image lightbox"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl max-h-[90vh] rounded-xl bg-gray-950 border border-white/10 p-3 md:p-4 text-white flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-xs md:text-sm text-white/80 tabular-nums">
            {safeIndex + 1} / {images.length}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs md:text-sm rounded-lg border border-white/25 bg-white/10 hover:bg-white/20"
          >
            Close
          </button>
        </div>

        <div className="flex-1 min-h-0 flex items-center justify-center gap-2 md:gap-4">
          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev}
            className="px-3 py-2 text-xs md:text-sm rounded-lg border border-white/25 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous image"
          >
            Prev
          </button>

          <div className="flex-1 min-w-0 h-full flex items-center justify-center">
            <img
              src={current.src}
              alt={current.alt || ''}
              className="max-w-full max-h-[60vh] md:max-h-[68vh] object-contain rounded-md"
              draggable={false}
            />
          </div>

          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            className="px-3 py-2 text-xs md:text-sm rounded-lg border border-white/25 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next image"
          >
            Next
          </button>
        </div>

        <div className="mt-3 border-t border-white/10 pt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs md:text-sm">
          <p>
            <span className="text-white/60">Alt:</span> {current.alt || '—'}
          </p>
          <p>
            <span className="text-white/60">Category:</span> {category}
          </p>
          <p>
            <span className="text-white/60">Cover:</span> {current.isCover ? 'Yes' : 'No'}
          </p>
        </div>
      </div>
    </div>
  );
}
