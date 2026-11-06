import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../data/homepageMedia';
import { localizePath } from '../utils/localizedRoutes';
import { useSiteLanguage } from '../hooks/useSiteLanguage';

/** Authentic photographs already used on the site. No generated archive art. */
const PHOTOS = [
  { image: HOME_IMAGES.firepit, key: 'fire', href: '/retreats/the-valley', position: 'object-[center_62%]' },
  { image: HOME_IMAGES.valleyVillage, key: 'stone', href: '/retreats/the-valley', position: 'object-[42%_center]' },
  { image: HOME_IMAGES.cabinDeer, key: 'lux', href: '/stays/lux-cabin', position: 'object-[center_58%]' },
  { image: HOME_IMAGES.together, key: 'guests', href: '/retreat-venue-bulgaria', position: 'object-center' },
  { image: HOME_IMAGES.valleyAframesRow, key: 'aframes', href: '/valley', position: 'object-center' },
  { image: HOME_IMAGES.cabinForestStove, key: 'stove', href: '/digital-detox-bulgaria', position: 'object-center' },
];

function ArchiveCard({ photo, caption, alt, cta, href, frameClass }) {
  return (
    <div data-archive-card className={frameClass}>
      <figure className="relative aspect-[4/5] overflow-hidden rounded-xl">
        <img
          src={photo.image.src}
          alt={alt}
          className={`h-full w-full object-cover ${photo.position}`}
          loading="lazy"
          decoding="async"
        />
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-5 pb-5 pt-16 text-sm text-white md:px-6 md:pb-6 md:text-base">
          <span className="block">{caption}</span>
          <Link
            to={href}
            className="mt-1 inline text-white underline decoration-white/50 underline-offset-2 hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {cta}
          </Link>
        </figcaption>
      </figure>
    </div>
  );
}

export default function MemoryStream() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const [span, setSpan] = useState(0);
  const sectionRef = useRef(null);
  const trackRef = useRef(null);
  const mobileRef = useRef(null);
  const x = useMotionValue(0);

  useEffect(() => {
    const measure = () => {
      const track = trackRef.current;
      const strip = track?.querySelector('[data-archive-strip]');
      if (!track || !strip) return;
      const next = Math.max(0, strip.scrollWidth - track.clientWidth);
      setSpan(next);
      const current = Math.min(0, Math.max(-next, x.get()));
      x.set(current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    const track = trackRef.current;
    const strip = track?.querySelector('[data-archive-strip]');
    if (track) observer.observe(track);
    if (strip) observer.observe(strip);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [x]);

  const step = (direction) => {
    const mobile = mobileRef.current;
    if (mobile && window.matchMedia('(max-width: 767px)').matches) {
      const card = mobile.querySelector('[data-archive-card]');
      const delta = (card?.getBoundingClientRect().width || mobile.clientWidth) + 16;
      mobile.scrollBy({ left: direction * delta, behavior: 'smooth' });
      return;
    }
    const card = trackRef.current?.querySelector('[data-archive-card]');
    const delta = (card?.getBoundingClientRect().width || 0) + 16;
    const from = x.get();
    const next = Math.min(0, Math.max(-span, from - direction * delta));
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / 350);
      const eased = 1 - (1 - progress) ** 3;
      x.set(from + (next - from) * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    }
  };

  return (
    <section
      ref={sectionRef}
      className="overflow-hidden bg-[#F3EFE6] py-14 md:py-20 lg:py-24"
      aria-roledescription="carousel"
      aria-label={t('memory.title')}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="mx-auto mb-8 flex max-w-7xl items-end justify-between gap-4 px-4 sm:px-6 md:mb-10">
        <div className="max-w-3xl">
          <h2 className="mb-4 font-serif text-3xl tracking-tight text-[#1c1917] sm:text-4xl md:text-5xl leading-[1.06]">
            {t('memory.title')}
          </h2>
          <p className="max-w-2xl text-[17px] leading-relaxed text-[#1c1917] md:text-lg">
            {t('memory.subtitle')}
          </p>
        </div>
        <div className="hidden shrink-0 gap-2 md:flex">
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#1c1917] text-[#1c1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1c1917]"
            aria-label={t('memory.prev')}
            onClick={() => step(-1)}
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#1c1917] text-[#1c1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1c1917]"
            aria-label={t('memory.next')}
            onClick={() => step(1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      <div
          ref={mobileRef}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 scrollbar-hide md:hidden"
        >
          {PHOTOS.map((photo) => (
            <ArchiveCard
              key={photo.key}
              photo={photo}
              alt={t(`memory.photos.${photo.key}.alt`)}
              caption={t(`memory.photos.${photo.key}.caption`)}
              cta={t(`memory.photos.${photo.key}.cta`)}
              href={localizePath(photo.href, language)}
              frameClass="w-[calc((100vw-1.25rem)/1.15)] shrink-0 snap-start"
            />
          ))}
        </div>

      <motion.div
          ref={trackRef}
          className="hidden w-full cursor-grab overflow-hidden pl-8 active:cursor-grabbing md:block lg:pl-16"
        >
          <motion.div data-archive-strip drag="x" dragConstraints={{ right: 0, left: -span }} dragElastic={0.08} style={{ x }} className="flex w-fit gap-4 pr-8 lg:pr-16">
            {PHOTOS.map((photo) => (
              <ArchiveCard
                key={photo.key}
                photo={photo}
                alt={t(`memory.photos.${photo.key}.alt`)}
                caption={t(`memory.photos.${photo.key}.caption`)}
                cta={t(`memory.photos.${photo.key}.cta`)}
                href={localizePath(photo.href, language)}
                frameClass="w-[calc((100vw-4.5rem)/3.3)] shrink-0"
              />
            ))}
          </motion.div>
        </motion.div>
    </section>
  );
}
