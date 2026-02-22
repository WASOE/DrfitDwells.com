import { motion } from 'framer-motion';

/**
 * Cinematic hero header for the configurator
 * Minimalist typography with generous white space
 */
const ConfiguratorHeader = () => {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full bg-gradient-to-b from-white via-gray-50 to-white pt-24 md:pt-32 pb-12 md:pb-16"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-xs uppercase tracking-[0.3em] text-gray-500 mb-4 font-sans"
          >
            Architectural Configurator
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-4xl md:text-5xl lg:text-6xl font-light text-black mb-6 leading-[1.1] tracking-tight"
            style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
          >
            Build Your
            <br />
            <span className="font-normal">Off-Grid Cabin</span>
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-lg md:text-xl text-gray-600 max-w-2xl leading-relaxed font-light"
          >
            Handcrafted in Bulgaria. Delivered ready to connect. Configure every detail to match your vision.
          </motion.p>
        </div>
      </div>
    </motion.section>
  );
};

export default ConfiguratorHeader;
