import { motion } from 'framer-motion';

const AylyakSection = ({ aylyakRef }) => {
  return (
    <section 
      ref={aylyakRef}
      className="relative py-24 md:py-32 border-t border-white/15"
    >
      <div className="relative max-w-4xl mx-auto px-4 md:px-6 flex items-center justify-center min-h-[50vh] md:min-h-[60vh]">
        {/* Cinematic Definition */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-center space-y-6 md:space-y-8"
        >
          {/* Word - Large, elegant serif, lowercase */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <h2 className="font-serif italic font-light text-6xl md:text-7xl lg:text-8xl xl:text-9xl text-white leading-none tracking-tight">
              aylyak
            </h2>
          </motion.div>
          
          {/* Pronunciation & Part of Speech */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="flex items-center justify-center gap-2 md:gap-3 text-[#aaaaaa]"
          >
            <span className="text-sm md:text-base lg:text-lg font-serif italic">
              [eye-ly-ack]
            </span>
            <span className="text-white/20">•</span>
            <span className="text-sm md:text-base lg:text-lg font-serif italic">
              noun
            </span>
          </motion.div>
          
          {/* Definition */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="pt-4 md:pt-6 max-w-2xl mx-auto"
          >
            <p className="text-base md:text-lg lg:text-xl text-[#e8e8e8] leading-relaxed font-serif" style={{ lineHeight: '1.6' }}>
              A deliberate refusal to be rushed. The art of not worrying.
            </p>
          </motion.div>
        </motion.div>
      </div>
      
      {/* Subtle Clarification */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.8 }}
        className="mt-12 md:mt-16 text-center max-w-2xl mx-auto px-4"
      >
        <p className="text-xs md:text-sm text-[#aaaaaa] leading-relaxed font-serif italic" style={{ lineHeight: '1.6' }}>
          Wi-Fi is available inside the cabins. Outdoor and shared spaces are intentionally offline.
        </p>
      </motion.div>
    </section>
  );
};

export default AylyakSection;
