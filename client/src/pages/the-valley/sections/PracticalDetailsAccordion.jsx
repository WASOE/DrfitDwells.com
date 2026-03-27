import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Home, Mountain, Cloud, HelpCircle, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import GMBContactStrip from '../../../components/GMBContactStrip';

const ITEM_IDS = ['access', 'amenities', 'water', 'winter', 'support'];

const PracticalDetailsAccordion = () => {
  const { t } = useTranslation('valley');
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="valley-section">
      <div className="valley-container" style={{ maxWidth: '900px' }}>
        <div className="valley-divider" />

        <h2 className="valley-h2 mb-5 text-left">{t('practical.title')}</h2>

        <p className="valley-intro mb-12 max-w-2xl">{t('practical.intro')}</p>

        <div className="border border-[rgba(0,0,0,0.12)] rounded-xl overflow-hidden bg-white">
          {ITEM_IDS.map((id, index) => {
            const Icon = [MapPin, Home, Mountain, Cloud, HelpCircle][index];
            const isOpen = openIndex === index;
            const title = t(`practical.items.${id}.title`);
            const content = t(`practical.items.${id}.content`);

            return (
              <div
                key={id}
                className="border-b border-[rgba(0,0,0,0.12)] last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? -1 : index)}
                  className={`w-full flex items-center gap-4 p-6 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] ${
                    isOpen ? 'bg-[rgba(0,0,0,0.02)]' : 'bg-transparent hover:bg-[rgba(0,0,0,0.01)]'
                  }`}
                  aria-expanded={isOpen}
                  aria-controls={`accordion-content-${id}`}
                >
                  <Icon className="w-5 h-5 text-[#81887A] flex-shrink-0" />
                  <span className="flex-1 text-base font-semibold text-[#1a1a1a]">{title}</span>
                  <ChevronDown
                    className={`w-5 h-5 text-[#4a4a4a] transition-transform duration-300 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      id={`accordion-content-${id}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-6 pl-20">
                        <p className="valley-body text-[#4a4a4a]">{content}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* NAP / directions: same SEO links, reads as part of Practical details */}
        <div className="mt-10 md:mt-12">
          <h3 className="font-['Montserrat'] text-[#1a1a1a] mb-3 text-lg md:text-xl" style={{ fontWeight: 600 }}>
            {t('practical.locationTitle')}
          </h3>
          <p className="valley-body text-[#4a4a4a] mb-6 max-w-2xl">{t('practical.locationBody')}</p>
          <div className="border border-[rgba(0,0,0,0.12)] rounded-xl bg-white p-6 md:p-7">
            <div className="valley-body">
              <GMBContactStrip
                locationKey="valley"
                variant="light"
                directionsLabel={t('practical.directionsCta')}
                callLabel={t('practical.callCta')}
              />
            </div>
          </div>
        </div>

        <div className="valley-divider" />
      </div>
    </section>
  );
};

export default PracticalDetailsAccordion;
