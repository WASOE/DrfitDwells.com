import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import HeroResponsivePicture from '../../components/HeroResponsivePicture';
import { ENDURO_GALLERY } from '../../data/enduroMedia';
import '../../i18n/ns/seo';
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
      className="w-full h-auto"
      loading={loading}
      decoding="async"
    />
  );
}

function GalleryFigure({ item, sizes, className = '', delay = 0, captionAlign = 'center' }) {
  return (
    <motion.figure
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      <div className="enduro-gallery__frame">
        <GalleryPicture item={item} sizes={sizes} />
      </div>
      <figcaption
        className={`enduro-gallery__caption ${captionAlign === 'left' ? 'text-left' : 'text-center'}`}
      >
        {item.caption}
      </figcaption>
    </motion.figure>
  );
}

/**
 * Premium editorial Valley gallery — natural aspect ratios, no forced crops.
 */
export default function EnduroGallerySection() {
  const { t } = useTranslation('seo');
  const g = (key) => t(`enduro.gallery.${key}`);

  const resolve = (item) => ({
    ...item,
    alt: g(`items.${item.id}.alt`),
    caption: g(`items.${item.id}.caption`)
  });

  const feature = ENDURO_GALLERY.filter((item) => item.role === 'feature').map(resolve)[0];
  const emotions = ENDURO_GALLERY.filter((item) => item.role === 'emotion').map(resolve);
  const moments = ENDURO_GALLERY.filter((item) => item.role === 'moment').map(resolve);
  const details = ENDURO_GALLERY.filter((item) => item.role === 'detail').map(resolve);

  return (
    <section className="enduro-gallery valley-section">
      <div className="valley-container max-w-6xl mx-auto">
        <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-4 font-serif">
          {g('eyebrow')}
        </p>
        <h2 className="font-serif text-[#1a1a1a] mb-3 text-3xl md:text-4xl lg:text-5xl font-semibold leading-tight max-w-2xl">
          {g('title')}
        </h2>
        <p className="valley-intro text-[#4a4a4a] mb-10 md:mb-14 max-w-2xl">{g('intro')}</p>

        {feature ? (
          <div className="mb-14 md:mb-20">
            <GalleryFigure
              item={feature}
              sizes="(max-width: 767px) 92vw, 640px"
              className="enduro-gallery__feature"
              captionAlign="left"
            />
          </div>
        ) : null}

        {emotions.length > 0 ? (
          <div className="mb-14 md:mb-20">
            <p className="enduro-gallery__band-label">{g('bands.afterRide')}</p>
            <div className="enduro-gallery__pair enduro-gallery__pair--stagger mx-auto max-w-5xl">
              {emotions.map((item, index) => (
                <GalleryFigure
                  key={item.id}
                  item={item}
                  sizes="(max-width: 767px) 92vw, (max-width: 1023px) 45vw, 520px"
                  delay={Math.min(index * 0.07, 0.14)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {moments.length > 0 ? (
          <div className="mb-14 md:mb-20">
            <p className="enduro-gallery__band-label px-[1.25rem] lg:px-0">
              {g('bands.land')}
            </p>
            <div className="enduro-gallery__rail" role="list">
              {moments.map((item, index) => (
                <div key={item.id} className="enduro-gallery__rail-item" role="listitem">
                  <GalleryFigure
                    item={item}
                    sizes="(max-width: 1023px) 72vw, 360px"
                    delay={Math.min(index * 0.05, 0.15)}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {details.length > 0 ? (
          <div>
            <p className="enduro-gallery__band-label">{g('bands.cabin')}</p>
            <div className="enduro-gallery__pair max-w-3xl mx-auto">
              {details.map((item, index) => (
                <GalleryFigure
                  key={item.id}
                  item={item}
                  sizes="(max-width: 767px) 92vw, 400px"
                  delay={Math.min(index * 0.07, 0.14)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
