import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import HeroResponsivePicture from '../../components/HeroResponsivePicture';
import { ENDURO_GALLERY } from '../../data/enduroMedia';
import '../../i18n/ns/seo';

function GalleryPicture({ item, sizes, className, loading = 'lazy' }) {
  return (
    <HeroResponsivePicture
      avifSrcSet={item.avifSrcSet}
      webpSrcSet={item.webpSrcSet}
      fallbackSrc={item.fallbackSrc}
      width={1200}
      height={item.role === 'feature' ? 750 : 1600}
      sizes={sizes}
      alt={item.alt}
      className={className}
      loading={loading}
      decoding="async"
    />
  );
}

function GalleryFigure({ item, sizes, className = '', captionClassName = '', delay = 0 }) {
  return (
    <motion.figure
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      className={`flex flex-col ${className}`}
    >
      <div
        className="relative w-full mb-2 overflow-hidden rounded-xl bg-[#e8e8e8]"
        style={{ aspectRatio: item.ratio }}
      >
        <GalleryPicture
          item={item}
          sizes={sizes}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 hover:scale-105"
        />
      </div>
      <figcaption className={captionClassName || "font-['Montserrat'] text-[#1a1a1a] text-center text-[13px] md:text-[15px] font-normal px-1"}>
        {item.caption}
      </figcaption>
    </motion.figure>
  );
}

/**
 * Editorial Valley gallery for /enduro —
 * place feature → emotion pair → moments → cabin details.
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
    <section className="valley-section">
      <div className="valley-container max-w-6xl mx-auto">
        <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-4 font-serif">
          {g('eyebrow')}
        </p>
        <h2 className="font-serif text-[#1a1a1a] mb-3 text-3xl md:text-4xl lg:text-5xl font-semibold leading-tight max-w-2xl">
          {g('title')}
        </h2>
        <p className="valley-intro text-[#4a4a4a] mb-10 md:mb-12 max-w-2xl">{g('intro')}</p>

        {feature ? (
          <motion.figure
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55 }}
            className="mb-10 md:mb-14"
          >
            <div
              className="relative w-full overflow-hidden rounded-xl bg-[#e8e8e8]"
              style={{ aspectRatio: feature.ratio }}
            >
              <GalleryPicture
                item={feature}
                sizes="(max-width: 1023px) 100vw, 1120px"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <figcaption className="valley-caption mt-3 text-left">{feature.caption}</figcaption>
          </motion.figure>
        ) : null}

        {emotions.length > 0 ? (
          <div className="mb-10 md:mb-14">
            <p className="text-xs uppercase tracking-[0.28em] text-[#81887A] mb-5 font-serif">
              {g('bands.afterRide')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
              {emotions.map((item, index) => (
                <GalleryFigure
                  key={item.id}
                  item={item}
                  sizes="(max-width: 639px) 100vw, 540px"
                  delay={Math.min(index * 0.06, 0.18)}
                  captionClassName="font-['Montserrat'] text-[#1a1a1a] text-center text-[14px] md:text-[16px] font-medium px-1"
                />
              ))}
            </div>
          </div>
        ) : null}

        {moments.length > 0 ? (
          <div className="mb-10 md:mb-14">
            <p className="text-xs uppercase tracking-[0.28em] text-[#81887A] mb-5 font-serif">
              {g('bands.land')}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
              {moments.map((item, index) => (
                <GalleryFigure
                  key={item.id}
                  item={item}
                  sizes="(max-width: 767px) 50vw, 360px"
                  delay={Math.min(index * 0.05, 0.2)}
                  className={index === 2 ? 'col-span-2 md:col-span-1' : ''}
                />
              ))}
            </div>
          </div>
        ) : null}

        {details.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[#81887A] mb-5 font-serif">
              {g('bands.cabin')}
            </p>
            <div className="grid grid-cols-2 gap-3 md:gap-6 max-w-3xl mx-auto">
              {details.map((item, index) => (
                <GalleryFigure
                  key={item.id}
                  item={item}
                  sizes="(max-width: 767px) 50vw, 420px"
                  delay={Math.min(index * 0.06, 0.12)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
