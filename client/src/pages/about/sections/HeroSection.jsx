import { motion } from 'framer-motion';
import { useInView } from 'framer-motion';
import { useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const HeroSection = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section 
      ref={ref}
      className="relative min-h-[70vh] md:min-h-[80vh] flex items-center justify-center overflow-hidden"
    >
      {/* Hero Image */}
      <motion.div
        initial={{ scale: 1.1 }}
        animate={isInView ? { scale: 1 } : { scale: 1.1 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
        className="absolute inset-0"
      >
        <img
          src="/uploads/The%20Valley/Lux-cabin-WhatsApp%20Image%202026-01-11%20at%2011.43.42%20AM%20(1).jpeg"
          alt="Lux cabin interior"
          className="w-full h-full object-cover"
          loading="eager"
          decoding="async"
        />
        {/* Dark gradient overlay for readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/50 to-black/60" />
      </motion.div>

      {/* Content Overlay */}
      <div className="relative z-10 text-center px-4 max-w-3xl mx-auto">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="valley-label mb-4 text-white/90"
        >
          About
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="text-3xl md:text-4xl lg:text-5xl font-semibold text-white mb-4 leading-tight"
          style={{ fontFamily: 'var(--valley-font-primary)' }}
        >
          Handcrafted places<br />for living, not scrolling.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="text-base md:text-lg text-white/90 max-w-2xl mx-auto"
          style={{ fontFamily: 'var(--valley-font-primary)' }}
        >
          How one cabin in Bulgaria became Drift & Dwells.
        </motion.p>
      </div>

      {/* Scroll Cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 1, delay: 1 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronDown className="w-5 h-5 text-white/70" />
        </motion.div>
      </motion.div>
    </section>
  );
};

export default HeroSection;
