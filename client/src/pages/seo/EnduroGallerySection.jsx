import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import HeroResponsivePicture from '../../components/HeroResponsivePicture';
import { ENDURO_GALLERY } from '../../data/enduroMedia';
import '../../i18n/ns/seo';

/**
 * Valley-style moments grid for /enduro — same pattern as The Valley vibe gallery.
 */
export default function EnduroGallerySection() {
  const { t } = useTranslation('seo');
  const g = (key) => t(`enduro.gallery.${key}`);

  const items = ENDURO_GALLERY.map((item) => ({
    ...item,
    alt: g(`items.${item.id}.alt`),
    caption: g(`items.${item.id}.caption`)
  }));

  return (
    <section className="valley-section">
      <div className="valley-container max-w-6xl mx-auto">
        <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-4 font-serif">
          {g('eyebrow')}
        </p>
        <h2 className="font-serif text-[#1a1a1a] mb-3 text-3xl md:text-4xl lg:text-5xl font-semibold leading-tight max-w-2xl">
          {g('title')}
        </h2>
        <p className="valley-intro text-[#4a4a4a] mb-8 md:mb-10 max-w-2xl">{g('intro')}</p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
          {items.map((item, index) => (
            <motion.figure
              key={item.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: Math.min(index * 0.05, 0.25) }}
              className="flex flex-col"
            >
              <div
                className="relative w-full mb-2 overflow-hidden rounded-xl bg-[#e8e8e8]"
                style={{ aspectRatio: '4 / 5' }}
              >
                <HeroResponsivePicture
                  avifSrcSet={item.avifSrcSet}
                  webpSrcSet={item.webpSrcSet}
                  fallbackSrc={item.fallbackSrc}
                  width={item.width}
                  height={item.height}
                  sizes="(max-width: 767px) 50vw, 360px"
                  alt={item.alt}
                  className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 hover:scale-105"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <figcaption className="font-['Montserrat'] text-[#1a1a1a] text-center text-[13px] md:text-[15px] font-normal px-1">
                {item.caption}
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}
