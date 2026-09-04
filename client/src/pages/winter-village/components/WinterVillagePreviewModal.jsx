import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { WINTER_VILLAGE_PREVIEW_MODAL } from '../winterVillageConfig';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('aria-hidden') && el.getAttribute('tabindex') !== '-1'
  );
}

/**
 * Preview-only modal. Portals to document.body under a winter-village-page wrapper
 * so modal CSS stays scoped and cannot leak to unrelated components.
 */
export default function WinterVillagePreviewModal({ open, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      closeRef.current?.focus({ preventScroll: true });
    }, 0);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const root = dialogRef.current;
      if (!root) return;
      const focusables = getFocusableElements(root);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      const restore = previouslyFocusedRef.current;
      if (restore && typeof restore.focus === 'function') {
        restore.focus({ preventScroll: true });
      }
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="winter-village-page">
      <div
        className="wv-modal-backdrop"
        role="presentation"
        data-wv-modal-backdrop="true"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="wv-preview-modal-title"
          className="wv-modal"
          data-wv-modal="true"
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2
              id="wv-preview-modal-title"
              className="font-serif text-2xl text-[#1a1a1a] font-semibold leading-tight"
            >
              {WINTER_VILLAGE_PREVIEW_MODAL.title}
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgba(0,0,0,0.12)] text-[#1a1a1a] hover:bg-[rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A]"
              aria-label={WINTER_VILLAGE_PREVIEW_MODAL.closeLabel}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <p className="valley-body text-[#4a4a4a] mb-6">{WINTER_VILLAGE_PREVIEW_MODAL.body}</p>
          <button
            type="button"
            onClick={onClose}
            className="w-full max-w-sm bg-[#1a1a1a] text-white px-8 py-3.5 font-semibold uppercase tracking-wider text-sm hover:bg-[#2a2a2a] transition-colors min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2"
          >
            {WINTER_VILLAGE_PREVIEW_MODAL.closeLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
