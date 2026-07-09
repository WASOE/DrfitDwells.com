import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import '../../../i18n/ns/valley';

const ExclusiveUseSection = () => {
  const { t } = useTranslation('valley');

  return (
    <section className="valley-section" style={{ paddingTop: 0 }}>
      <div className="valley-container max-w-3xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="rounded-xl border border-[rgba(0,0,0,0.12)] bg-white px-6 py-10 md:px-12 md:py-14"
        >
          <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-4 font-serif">
            {t('retreat.exclusiveUse.eyebrow')}
          </p>
          <h2 className="font-serif text-[#1a1a1a] mb-4 text-3xl md:text-4xl font-semibold leading-tight">
            {t('retreat.exclusiveUse.title')}
          </h2>
          <p className="valley-intro text-[#4a4a4a] max-w-2xl mx-auto">
            {t('retreat.exclusiveUse.intro')}
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default ExclusiveUseSection;
