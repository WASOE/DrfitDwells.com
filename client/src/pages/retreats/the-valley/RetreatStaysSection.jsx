import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { formatBedConfigSummary, resolveTargetSleeps } from '../../../utils/bedConfigDisplay';
import '../../../i18n/ns/valley';

const RetreatStaysSection = ({ accommodationsRef, includedTargets = [] }) => {
  const { t } = useTranslation('valley');
  const targets = Array.isArray(includedTargets) ? includedTargets : [];
  const hasTargets = targets.length > 0;

  return (
    <section
      ref={accommodationsRef}
      id="accommodations"
      className="valley-section"
      style={{ paddingTop: 0, borderTop: 'none' }}
    >
      <div className="valley-container max-w-5xl mx-auto">
        <h2 className="font-serif text-[#1a1a1a] mb-4 text-3xl md:text-5xl font-bold">
          {t('retreat.stays.title')}
        </h2>
        <p className="font-serif mb-10 md:mb-12 max-w-3xl text-base md:text-lg text-[#4a4a4a]">
          {t('retreat.stays.intro')}
        </p>

        {!hasTargets ? (
          <p className="text-sm text-[#6a6a6a] border border-[rgba(0,0,0,0.12)] rounded-xl bg-white px-6 py-8 text-center max-w-2xl">
            {t('retreat.stays.emptyHint')}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {targets.map((target, index) => {
              const bedsLine = formatBedConfigSummary(target.bedConfig, target.capacity);
              const sleeps = resolveTargetSleeps(target);
              const unitLabel =
                target.unitCount > 1
                  ? `${target.name} × ${target.unitCount}`
                  : target.name;

              return (
                <motion.article
                  key={`${target.slug || target.name}-${index}`}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.06 }}
                  className="rounded-xl border border-[rgba(0,0,0,0.12)] bg-white p-6 md:p-8 flex flex-col"
                >
                  <h3 className="font-serif text-xl md:text-2xl text-[#1a1a1a] font-semibold mb-4">
                    {unitLabel}
                  </h3>
                  <dl className="space-y-2 text-sm text-[#4a4a4a] flex-1">
                    <div className="flex justify-between gap-3">
                      <dt className="text-[#1a1a1a] font-semibold">{t('retreat.stays.labels.sleeps')}</dt>
                      <dd className="tabular-nums">{sleeps}</dd>
                    </div>
                    {target.capacity > 0 && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-[#1a1a1a] font-semibold">{t('retreat.stays.labels.capacity')}</dt>
                        <dd className="tabular-nums">
                          {target.unitCount > 1
                            ? `${target.capacity} ${t('retreat.stays.perUnit')}`
                            : target.capacity}
                        </dd>
                      </div>
                    )}
                    {bedsLine && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-[#1a1a1a] font-semibold shrink-0">
                          {Array.isArray(target.bedConfig) && target.bedConfig.length > 0
                            ? t('retreat.stays.labels.beds')
                            : t('retreat.stays.labels.capacity')}
                        </dt>
                        <dd className="text-right">{bedsLine}</dd>
                      </div>
                    )}
                  </dl>
                </motion.article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export default RetreatStaysSection;
