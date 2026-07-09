import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import '../../../i18n/ns/valley';

const GROUP_MOMENTS = [
  {
    id: 'firepit',
    image: '/uploads/The%20Valley/-03e7a985-8967-4a35-9169-36206d128506.png',
    ratio: '4/5'
  },
  {
    id: 'fireside',
    image: '/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif',
    ratio: '4/5'
  },
  {
    id: 'village',
    image: '/uploads/The%20Valley/1768207815-2996ea84.jpg',
    ratio: '4/5'
  },
  {
    id: 'evening',
    image: '/uploads/Content%20website/drift-dwells-bulgaria-starlit-mountain.avif',
    ratio: '4/5'
  }
];

const RetreatGroupVibeSection = ({ galleryRef }) => {
  const { t } = useTranslation('valley');

  return (
    <section ref={galleryRef} className="valley-section">
      <div className="valley-container max-w-6xl mx-auto">
        <h2 className="font-serif text-[#1a1a1a] mb-4 text-3xl md:text-5xl font-bold">
          {t('retreat.groupVibe.title')}
        </h2>
        <p className="font-serif mb-10 md:mb-12 max-w-2xl text-base md:text-lg text-[#4a4a4a]">
          {t('retreat.groupVibe.intro')}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {GROUP_MOMENTS.map((moment, index) => (
            <motion.figure
              key={moment.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.06 }}
              className="flex flex-col"
            >
              <div
                className="relative overflow-hidden rounded-xl bg-[#e8e8e8] mb-3"
                style={{ aspectRatio: moment.ratio }}
              >
                <img
                  src={moment.image}
                  alt={t(`retreat.groupVibe.moments.${moment.id}.imageAlt`)}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <figcaption className="font-serif text-sm md:text-base text-[#1a1a1a] px-1">
                {t(`retreat.groupVibe.moments.${moment.id}.caption`)}
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
};

export default RetreatGroupVibeSection;
