import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Images, X, ChevronLeft, ChevronRight } from 'lucide-react';
import HeroResponsivePicture from '../../components/HeroResponsivePicture';
import {
  ENDURO_GALLERY,
  ENDURO_MOSAIC_COUNT,
  ENDURO_STRIP_COUNT
} from '../../data/enduroMedia';
import '../../i18n/ns/seo';
import '../../components/gallery/lightbox.css';
import './EnduroGallerySection.css';

function GalleryPicture({ item, sizes, loading = 'lazy' }) {
  return (
    <HeroResponsivePicture
      avifSrcSet={item.avifSrcSet}
      webpSrcSet={item.webpSrcSet}
      fallbackSrc={item.fallbackSrc}
      width={item.width}
      height={item.height}
      sizes={sizes}
      alt={item.alt}
      className=""
      loading={loading}
      decoding="async"
    />
  );
}

function MosaicTile({ item, sizes, className = '', onOpen, loading = 'lazy' }) {
  return (
    <button
      type="button"
      className={`enduro-mosaic__tile ${className}`}
      onClick={onOpen}
      aria-label={item.alt}
    >
      <GalleryPicture item={item} sizes={sizes} loading={loading} />
    </button>
  );
}

function EnduroLightbox({ items, index, onClose, onPrev, onNext, closeLabel }) {
  const current = items[index];
  if (!current) return null;

  return (
    <div
      className="lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={current.alt}
      onClick={onClose}
    >
      <div className="lightbox-container" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lightbox-close" onClick={onClose} aria-label={closeLabel}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        {items.length > 1 ? (
          <>
            <button
              type="button"
              className="lightbox-nav lightbox-prev"
              onClick={onPrev}
              aria-label="Previous photo"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="lightbox-nav lightbox-next"
              onClick={onNext}
              aria-label="Next photo"
            >
              <ChevronRight className="h-6 w-6" aria-hidden="true" />
            </button>
          </>
        ) : null}

        <div className="lightbox-image-container">
          <img
            src={current.fallbackSrc}
            srcSet={current.webpSrcSet}
            sizes="100vw"
            alt={current.alt}
            className="lightbox-image"
          />
          <p className="mt-3 text-center text-sm text-white/80 font-['Montserrat'] px-4">
            {current.caption}
            <span className="text-white/45">
              {' '}
              · {index + 1}/{items.length}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Dense hospitality mosaic for /enduro — Airbnb Plus / Soho calm.
 * Does not touch the Enduro hero / stay selector.
 */
export default function EnduroGallerySection() {
  const { t } = useTranslation('seo');
  const g = (key) => t(`enduro.gallery.${key}`);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const items = useMemo(
    () =>
      ENDURO_GALLERY.map((item) => ({
        ...item,
        alt: g(`items.${item.id}.alt`),
        caption: g(`items.${item.id}.caption`)
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolve copy when language changes
    [t]
  );

  const mosaic = items.slice(0, ENDURO_MOSAIC_COUNT);
  const lead = mosaic[0];
  const side = mosaic.slice(1);
  const strip = items.slice(ENDURO_MOSAIC_COUNT, ENDURO_MOSAIC_COUNT + ENDURO_STRIP_COUNT);
  const lightboxOpen = lightboxIndex != null;

  const openAt = useCallback((index) => setLightboxIndex(index), []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const goPrev = useCallback(() => {
    setLightboxIndex((i) => (i == null ? i : (i - 1 + items.length) % items.length));
  }, [items.length]);
  const goNext = useCallback(() => {
    setLightboxIndex((i) => (i == null ? i : (i + 1) % items.length));
  }, [items.length]);

  useEffect(() => {
    if (!lightboxOpen) return undefined;
    document.body.classList.add('lightbox-open');
    const onKey = (e) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('lightbox-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [lightboxOpen, closeLightbox, goPrev, goNext]);

  if (!lead) return null;

  return (
    <section className="valley-section enduro-mosaic">
      <div className="valley-container max-w-6xl mx-auto">
        <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-4 font-serif">
          {g('eyebrow')}
        </p>
        <h2 className="font-serif text-[#1a1a1a] mb-3 text-3xl md:text-4xl lg:text-5xl font-semibold leading-tight max-w-2xl">
          {g('title')}
        </h2>
        <p className="valley-intro text-[#4a4a4a] mb-8 md:mb-10 max-w-2xl">{g('intro')}</p>

        <div className="enduro-mosaic__shell">
          <div className="enduro-mosaic__grid">
            <MosaicTile
              item={lead}
              sizes="(max-width: 639px) 100vw, 66vw"
              className="enduro-mosaic__lead"
              onOpen={() => openAt(0)}
            />
            {side.map((item, i) => (
              <MosaicTile
                key={item.id}
                item={item}
                sizes="(max-width: 639px) 50vw, 25vw"
                className="enduro-mosaic__side-tile"
                onOpen={() => openAt(i + 1)}
              />
            ))}
          </div>

          <button type="button" className="enduro-mosaic__show-all" onClick={() => openAt(0)}>
            <Images className="h-3.5 w-3.5" aria-hidden="true" />
            {g('showAll')}
          </button>
        </div>

        <button type="button" className="enduro-mosaic__mobile-cta" onClick={() => openAt(0)}>
          <Images className="h-4 w-4" aria-hidden="true" />
          {g('showAll')}
        </button>

        {strip.length > 0 ? (
          <div className="enduro-mosaic__strip">
            {strip.map((item, i) => (
              <MosaicTile
                key={item.id}
                item={item}
                sizes="(max-width: 767px) 50vw, 280px"
                className="enduro-mosaic__strip-tile"
                onOpen={() => openAt(ENDURO_MOSAIC_COUNT + i)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {lightboxOpen ? (
        <EnduroLightbox
          items={items}
          index={lightboxIndex}
          onClose={closeLightbox}
          onPrev={goPrev}
          onNext={goNext}
          closeLabel={g('close')}
        />
      ) : null}
    </section>
  );
}
