import { motion } from 'framer-motion';
import { useInView } from 'framer-motion';
import { useRef } from 'react';
import { Link } from 'react-router-dom';

const CTASection = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section ref={ref} className="py-16 md:py-24 border-t" style={{ borderColor: 'var(--valley-border-subtle)' }}>
      <div className="valley-container">
        <div className="max-w-4xl mx-auto text-center">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.6 }}
            className="valley-body mb-10 text-lg md:text-xl max-w-2xl mx-auto"
          >
            If the story resonates, start with the place that fits you.
          </motion.p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <Link
                to="/cabin"
                className="block border rounded-2xl px-8 py-6 text-center transition-all hover:bg-[var(--valley-text-heading)] hover:text-white hover:scale-105"
                style={{ 
                  borderColor: 'var(--valley-text-heading)',
                  color: 'var(--valley-text-heading)'
                }}
              >
                <span 
                  className="text-lg md:text-xl font-semibold"
                  style={{ fontFamily: 'var(--valley-font-primary)' }}
                >
                  Explore The Cabin
                </span>
              </Link>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Link
                to="/the-valley"
                className="block border rounded-2xl px-8 py-6 text-center transition-all hover:bg-[var(--valley-text-heading)] hover:text-white hover:scale-105"
                style={{ 
                  borderColor: 'var(--valley-text-heading)',
                  color: 'var(--valley-text-heading)'
                }}
              >
                <span 
                  className="text-lg md:text-xl font-semibold"
                  style={{ fontFamily: 'var(--valley-font-primary)' }}
                >
                  Explore The Valley
                </span>
              </Link>
            </motion.div>
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mb-12"
          >
            <Link
              to="/build"
              className="valley-label transition-colors hover:text-[var(--valley-text-heading)]"
              style={{ color: 'var(--valley-text-subtle)' }}
            >
              Looking to own one? Build your cabin →
            </Link>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="valley-body text-xl md:text-2xl"
            style={{ color: 'var(--valley-text-heading)' }}
          >
            We build places for living, not scrolling.
          </motion.p>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
