import { useCallback, useEffect, useRef, useState } from 'react';

/** During move: past this (px) counts as a drag — do not navigate the card. */
const TAP_SLOP_PX = 10;
/** If scrollLeft moved by at least this much during the gesture, treat as swipe (not a tap). */
const SCROLL_SUPPRESS_MIN_PX = 2;
/** At pointerup: total displacement past this (px) suppresses click (catches fast short swipes). */
const TAP_MAX_FINAL_PX = 10;

/**
 * Lightweight horizontal snap gallery (no deps): Airbnb-style swipe + dots.
 * Tap on the track opens the parent card target; drag/swipe scrolls photos only (click suppressed).
 * @param {{ url: string, alt: string }[]} slides
 */
export default function PaidTrafficCardGallery({
  slides = [],
  eagerFirst = false,
  pointerCursor = false,
  className = '',
  aspectClassName = 'aspect-[4/5]'
}) {
  const scrollerRef = useRef(null);
  const gestureRef = useRef({
    down: false,
    startX: 0,
    startY: 0,
    scroll0: 0,
    slop: false,
    suppressClick: false
  });
  const [active, setActive] = useState(0);

  const n = slides.length;
  const showDots = n > 1;

  const updateActiveFromScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || n === 0) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const idx = Math.min(n - 1, Math.max(0, Math.round(el.scrollLeft / w)));
    setActive(idx);
  }, [n]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      window.requestAnimationFrame(updateActiveFromScroll);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateActiveFromScroll]);

  useEffect(() => {
    updateActiveFromScroll();
  }, [slides, updateActiveFromScroll]);

  const goTo = (idx) => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    el.scrollTo({ left: idx * w, behavior: 'smooth' });
  };

  const onPointerDown = useCallback(
    (e) => {
      const el = scrollerRef.current;
      if (!el) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const g = gestureRef.current;
      g.down = true;
      g.startX = e.clientX;
      g.startY = e.clientY;
      g.scroll0 = el.scrollLeft;
      g.slop = false;
      g.suppressClick = false;
    },
    []
  );

  const onPointerMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g.down) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.hypot(dx, dy) > TAP_SLOP_PX) g.slop = true;
  }, []);

  const finishPointer = useCallback((e) => {
    const g = gestureRef.current;
    if (!g.down) return;
    g.down = false;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
    const el = scrollerRef.current;
    const scrollDelta = el ? Math.abs(el.scrollLeft - g.scroll0) : 0;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const releaseTravel = Math.hypot(dx, dy);
    g.suppressClick =
      g.slop ||
      scrollDelta >= SCROLL_SUPPRESS_MIN_PX ||
      releaseTravel > TAP_MAX_FINAL_PX;
  }, []);

  const onScrollerClickCapture = useCallback((e) => {
    const g = gestureRef.current;
    if (g.suppressClick) {
      e.stopPropagation();
      g.suppressClick = false;
    }
  }, []);

  const cursorCls = pointerCursor ? 'cursor-pointer' : '';

  if (!n) {
    return (
      <div
        className={`rounded-2xl bg-neutral-200 ${aspectClassName} w-full ${cursorCls} ${className}`}
        data-snap-gallery
      />
    );
  }

  return (
    <div className={`relative w-full ${cursorCls} ${className}`} data-snap-gallery>
      <div
        ref={scrollerRef}
        className={`flex w-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory rounded-2xl scrollbar-hide ${aspectClassName} ${cursorCls}`}
        style={{ WebkitOverflowScrolling: 'touch' }}
        aria-roledescription="carousel"
        aria-label="Property photos"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onClickCapture={onScrollerClickCapture}
      >
        {slides.map((slide, i) => (
          <div
            key={`${slide.url}-${i}`}
            className="w-full min-w-full shrink-0 snap-center snap-always h-full relative bg-neutral-200"
          >
            <img
              src={slide.url}
              alt={slide.alt || ''}
              className={`absolute inset-0 h-full w-full object-cover ${pointerCursor ? 'cursor-pointer' : ''}`}
              loading={eagerFirst && i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              {...(eagerFirst && i === 0 ? { fetchpriority: 'high' } : {})}
              draggable={false}
            />
          </div>
        ))}
      </div>

      {showDots ? (
        <div
          className="pointer-events-none absolute bottom-2.5 left-0 right-0 flex justify-center gap-1.5"
          aria-hidden
        >
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              className={`pointer-events-auto cursor-pointer h-1.5 rounded-full transition-all duration-200 ${
                i === active ? 'w-2 bg-white shadow-sm' : 'w-1.5 bg-white/60'
              }`}
              aria-label={`Photo ${i + 1} of ${n}`}
              onClick={(e) => {
                e.stopPropagation();
                goTo(i);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
