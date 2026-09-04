import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WINTER_VILLAGE_FAQ } from '../winterVillageConfig';

export default function WinterVillageFaq({ prefersReducedMotion }) {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="wv-faq" aria-labelledby="wv-faq-heading">
      <h2 id="wv-faq-heading" className="wv-faq-heading">
        Questions
      </h2>

      <div className="wv-faq-list">
        {WINTER_VILLAGE_FAQ.map((item, index) => {
          const isOpen = openIndex === index;
          return (
            <div key={item.id} className="wv-faq-item">
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? -1 : index)}
                className="wv-faq-trigger"
                aria-expanded={isOpen}
                aria-controls={`wv-faq-${item.id}`}
              >
                <span>{item.question}</span>
                <span className="wv-faq-mark" aria-hidden="true">
                  {isOpen ? '–' : '+'}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={`wv-faq-${item.id}`}
                    initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={prefersReducedMotion ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.28 }}
                    className="overflow-hidden"
                  >
                    <p className="wv-faq-answer">{item.answer}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
