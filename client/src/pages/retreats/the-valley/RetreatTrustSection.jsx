import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import '../../../i18n/ns/valley';

const RetreatTrustSection = ({ trustRef }) => {
  const { t } = useTranslation('valley');

  return (
    <section ref={trustRef} className="valley-section">
      <div className="valley-container max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="rounded-xl border border-[rgba(0,0,0,0.12)] bg-white px-6 py-10 md:px-12 md:py-14"
        >
          <p className="text-xs uppercase tracking-[0.35em] text-[#81887A] mb-4 font-serif">
            {t('retreat.trust.eyebrow')}
          </p>
          <blockquote className="valley-quote text-[#1a1a1a] mb-6" style={{ fontSize: '1.5rem', lineHeight: '1.4' }}>
            {t('retreat.trust.quote')}
          </blockquote>
          <p className="valley-body text-[#4a4a4a] max-w-2xl">{t('retreat.trust.body')}</p>
        </motion.div>
      </div>
    </section>
  );
};

export default RetreatTrustSection;
