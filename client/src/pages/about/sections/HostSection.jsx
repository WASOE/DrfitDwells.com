import { motion } from 'framer-motion';
import { useInView } from 'framer-motion';
import { useRef } from 'react';

const HostSection = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section ref={ref} className="valley-section">
      <div className="valley-container">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.6 }}
              className="w-full order-2 lg:order-1"
            >
              <div 
                className="relative w-full overflow-hidden bg-[#f4f2ee]" 
                style={{ aspectRatio: '4 / 5' }}
              >
                <img
                  src="/uploads/Content%20website/Picture-jose-valley.png"
                  alt="Jose in front of a cabin"
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="max-w-xl order-1 lg:order-2"
            >
              <h2 className="valley-h2 mb-6">
                The builder and host
              </h2>
              <p className="valley-intro max-w-[56ch] mb-8">
                I build what we host, and host what we build. That feedback loop is the whole point.
              </p>
              <ul className="space-y-4 mb-8">
                <motion.li
                  initial={{ opacity: 0, x: -10 }}
                  animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                  className="valley-body flex items-start text-lg"
                >
                  <span className="mr-4 text-xl" style={{ color: 'var(--valley-text-heading)' }}>•</span>
                  <span>Built by hand</span>
                </motion.li>
                <motion.li
                  initial={{ opacity: 0, x: -10 }}
                  animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
                  transition={{ duration: 0.5, delay: 0.4 }}
                  className="valley-body flex items-start text-lg"
                >
                  <span className="mr-4 text-xl" style={{ color: 'var(--valley-text-heading)' }}>•</span>
                  <span>Off grid systems that work in winter</span>
                </motion.li>
                <motion.li
                  initial={{ opacity: 0, x: -10 }}
                  animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
                  transition={{ duration: 0.5, delay: 0.5 }}
                  className="valley-body flex items-start text-lg"
                >
                  <span className="mr-4 text-xl" style={{ color: 'var(--valley-text-heading)' }}>•</span>
                  <span>Designed for sleep, silence, and simplicity</span>
                </motion.li>
              </ul>
              <p 
                className="valley-caption italic"
                style={{ color: 'var(--valley-text-muted)' }}
              >
                Built and hosted by the same hands.
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HostSection;
