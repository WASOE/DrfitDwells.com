import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import '../../../i18n/ns/valley';

const USE_CASE_IDS = ['offsite', 'reunion', 'friends', 'wellness', 'creative'];

const USE_CASE_IMAGES = {
  offsite: '/uploads/The%20Valley/1768207815-2996ea84.jpg',
  reunion: '/uploads/The%20Valley/-03e7a985-8967-4a35-9169-36206d128506.png',
  friends: '/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif',
  wellness: '/uploads/Content%20website/drift-dwells-bulgaria-starlit-mountain.avif',
  creative: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.23%20AM.jpeg'
};

const RetreatUseCasesSection = () => {
  const { t } = useTranslation('valley');

  return (
    <section className="valley-section">
      <div className="valley-container max-w-6xl mx-auto">
        <h2 className="font-serif text-[#1a1a1a] mb-4 text-3xl md:text-5xl font-bold">
          {t('retreat.useCases.title')}
        </h2>
        <p className="font-serif mb-10 md:mb-12 max-w-2xl text-base md:text-lg text-[#4a4a4a]">
          {t('retreat.useCases.intro')}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {USE_CASE_IDS.map((id, index) => (
            <motion.article
              key={id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.06 }}
              className="rounded-xl border border-[rgba(0,0,0,0.12)] bg-white overflow-hidden flex flex-col"
            >
              <div className="relative aspect-[4/3] bg-[#e8e8e8]">
                <img
                  src={USE_CASE_IMAGES[id]}
                  alt={t(`retreat.useCases.items.${id}.imageAlt`)}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="p-6 md:p-8">
                <h3 className="font-serif text-lg md:text-xl text-[#1a1a1a] font-semibold mb-2">
                  {t(`retreat.useCases.items.${id}.title`)}
                </h3>
                <p className="text-sm text-[#4a4a4a] leading-relaxed">
                  {t(`retreat.useCases.items.${id}.body`)}
                </p>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default RetreatUseCasesSection;
