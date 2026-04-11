import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Lightweight horizontal snap gallery (no deps): Airbnb-style swipe + dots.
 * @param {{ url: string, alt: string }[]} slides
 */
export default function PaidTrafficCardGallery({
  slides = [],
  eagerFirst = false,
  className = '',
  aspectClassName = 'aspect-[4/5]'
}) {
  const scrollerRef = useRef(null);
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

  if (!n) {
    return (
      <div
        className={`rounded-2xl bg-neutral-200 ${aspectClassName} w-full ${className}`}
        data-snap-gallery
      />
    );
  }

  return (
    <div className={`relative w-full ${className}`} data-snap-gallery>
      <div
        ref={scrollerRef}
        className={`flex w-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory rounded-2xl scrollbar-hide ${aspectClassName}`}
        style={{ WebkitOverflowScrolling: 'touch' }}
        aria-roledescription="carousel"
        aria-label="Property photos"
      >
        {slides.map((slide, i) => (
          <div
            key={`${slide.url}-${i}`}
            className="w-full min-w-full shrink-0 snap-center snap-always h-full relative bg-neutral-200"
          >
            <img
              src={slide.url}
              alt={slide.alt || ''}
              className="absolute inset-0 h-full w-full object-cover"
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
              className={`pointer-events-auto h-1.5 rounded-full transition-all duration-200 ${
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
