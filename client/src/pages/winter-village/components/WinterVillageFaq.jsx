import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { WINTER_VILLAGE_FAQ } from '../winterVillageConfig';

export default function WinterVillageFaq({ prefersReducedMotion }) {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="valley-section" aria-labelledby="wv-faq-heading">
      <div className="valley-container" style={{ maxWidth: '900px' }}>
        <div className="valley-divider" />
        <h2 id="wv-faq-heading" className="valley-h2 mb-5 text-left">
          Winter Village FAQ
        </h2>
        <p className="valley-intro mb-10 md:mb-12 max-w-2xl">
          Clear answers about hosted packages, accommodation, facilities and proposed pricing.
        </p>

        <div className="border border-[rgba(0,0,0,0.12)] rounded-xl overflow-hidden bg-white">
          {WINTER_VILLAGE_FAQ.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={item.id} className="border-b border-[rgba(0,0,0,0.12)] last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? -1 : index)}
                  className={`w-full flex items-center gap-4 p-5 md:p-6 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] ${
                    isOpen ? 'bg-[rgba(0,0,0,0.02)]' : 'bg-transparent hover:bg-[rgba(0,0,0,0.01)]'
                  }`}
                  aria-expanded={isOpen}
                  aria-controls={`wv-faq-${item.id}`}
                >
                  <HelpCircle className="w-5 h-5 text-[#81887A] flex-shrink-0" aria-hidden="true" />
                  <span className="flex-1 text-base font-semibold text-[#1a1a1a]">
                    {item.question}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-[#4a4a4a] transition-transform duration-300 flex-shrink-0 ${
                      isOpen ? 'rotate-180' : ''
                    } motion-reduce:transition-none`}
                    aria-hidden="true"
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`wv-faq-${item.id}`}
                      initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={prefersReducedMotion ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 md:px-6 pb-5 md:pb-6 pl-[3.25rem] md:pl-20">
                        <p className="valley-body text-[#4a4a4a]">{item.answer}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
        <div className="valley-divider" />
      </div>
    </section>
  );
}
