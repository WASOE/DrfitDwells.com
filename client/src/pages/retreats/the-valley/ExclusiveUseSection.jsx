import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import '../../../i18n/ns/valley';

const EXCLUSIVE_IMAGES = [
  {
    src: '/uploads/The%20Valley/1768207815-2996ea84.jpg',
    altKey: 'panorama'
  },
  {
    src: '/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif',
    altKey: 'fireside'
  },
  {
    src: '/uploads/The%20Valley/-03e7a985-8967-4a35-9169-36206d128506.png',
    altKey: 'firepit'
  }
];

const ExclusiveUseSection = () => {
  const { t } = useTranslation('valley');

  return (
    <section className="valley-section retreat-section-first">
      <div className="valley-container max-w-6xl mx-auto">
        <div className="max-w-3xl mb-10 md:mb-12">
          <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-4 font-serif">
            {t('retreat.exclusiveUse.eyebrow')}
          </p>
          <h2 className="font-serif text-[#1a1a1a] mb-4 text-3xl md:text-4xl lg:text-5xl font-semibold leading-tight">
            {t('retreat.exclusiveUse.title')}
          </h2>
          <p className="valley-intro text-[#4a4a4a] max-w-2xl">
            {t('retreat.exclusiveUse.intro')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          {EXCLUSIVE_IMAGES.map((image, index) => (
            <motion.figure
              key={image.src}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.08 }}
              className="relative overflow-hidden rounded-xl bg-[#e8e8e8] aspect-[4/5] md:aspect-[3/4]"
            >
              <img
                src={image.src}
                alt={t(`retreat.exclusiveUse.images.${image.altKey}`)}
                className="absolute inset-0 h-full w-full object-cover object-center"
                loading="lazy"
              />
              <figcaption className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/70 to-transparent text-white text-sm font-serif">
                {t(`retreat.exclusiveUse.captions.${image.altKey}`)}
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ExclusiveUseSection;
