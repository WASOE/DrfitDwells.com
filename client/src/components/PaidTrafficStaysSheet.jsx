import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const sans = { fontFamily: 'var(--valley-font-primary, Montserrat, system-ui, sans-serif)' };

/**
 * Mobile bottom sheet listing the 4 stays. Each row navigates via the item's
 * pre-built `bookingTo` target (from `stay.route`), never listingSlug.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   items: Array<object>,
 *   title: string,
 *   ariaLabel: string,
 *   closeLabel: string,
 *   labels: { checkAvailability: string }
 * }} props
 */
export default function PaidTrafficStaysSheet({
  open,
  onClose,
  items = [],
  title,
  ariaLabel,
  closeLabel,
  labels
}) {
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const closeBtnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    closeBtnRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const go = (item) => {
    if (!item.bookingTo?.pathname) return;
    onClose();
    navigate(item.bookingTo);
  };

  return (
    <div className="fixed inset-0 z-[110] md:hidden" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
      />
      <div
        ref={panelRef}
        style={sans}
        className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-[#F9F8F6] shadow-[0_-8px_30px_rgba(0,0,0,0.18)] max-h-[85vh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="sticky top-0 flex items-center justify-between gap-3 bg-[#F9F8F6]/95 backdrop-blur-md px-4 pt-4 pb-3 border-b border-[rgba(0,0,0,0.08)]">
          <h2 className="text-[15px] font-semibold text-neutral-900 tracking-tight">{title}</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="shrink-0 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] text-xl leading-none"
            aria-label={closeLabel}
          >
            ×
          </button>
        </div>

        <ul className="px-4 py-3 space-y-2.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-row items-stretch gap-3 rounded-xl border border-[rgba(0,0,0,0.1)] bg-white p-2.5"
            >
              <div className="relative shrink-0 w-[92px] rounded-lg overflow-hidden bg-neutral-200 self-stretch">
                {item.thumb ? (
                  <img
                    src={item.thumb}
                    alt={item.thumbAlt || item.title}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="text-[14px] font-semibold text-neutral-900 leading-tight tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-1 text-[12px] text-neutral-600 leading-snug">
                  {item.sleepsLabel ? <span>{item.sleepsLabel}</span> : null}
                  {item.sleepsLabel && item.price ? <span aria-hidden> · </span> : null}
                  {item.price ? (
                    <span className="font-semibold text-neutral-900">{item.price}</span>
                  ) : null}
                </p>
                <div className="mt-auto pt-2.5">
                  <button
                    type="button"
                    onClick={() => go(item)}
                    disabled={!item.bookingTo?.pathname}
                    className="w-full min-h-[40px] px-3 py-2 bg-[#1a1a1a] text-white text-[12px] font-semibold tracking-wide rounded-lg hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2 active:scale-[0.99] transition-all touch-manipulation disabled:opacity-50"
                  >
                    {labels.checkAvailability}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
