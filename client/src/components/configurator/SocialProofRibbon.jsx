import { motion } from 'framer-motion';

/**
 * Building-focused trust badges for the configurator
 * Emphasizes Dutch design, Bulgarian craftsmanship, and proven quality
 */
const SocialProofRibbon = () => {
  const proofs = [
    { 
      label: 'Manufacturing', 
      value: 'Built in Bulgaria', 
      subtitle: 'Expert craftsmanship & local materials',
      icon: null,
      size: 'normal'
    },
    { 
      label: 'Design & Company', 
      value: 'Dutch Company & Dutch Design', 
      subtitle: 'Premium European engineering',
      icon: null,
      size: 'large'
    },
    { 
      label: 'Quality Assurance', 
      value: 'Proven in Production', 
      subtitle: 'Tested in our own rental properties',
      icon: null,
      size: 'normal'
    }
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="py-12 md:py-16 border-t border-gray-200 bg-gradient-to-b from-white to-gray-50"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 md:gap-12">
          {proofs.map((proof, index) => (
            <motion.div
              key={proof.label}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className={`flex flex-col items-center text-center ${
                proof.size === 'large' 
                  ? 'md:flex-[1.5] md:px-8' 
                  : 'md:flex-1'
              }`}
            >
              <div className={`font-medium text-black mb-2 ${
                proof.size === 'large'
                  ? 'text-2xl md:text-3xl lg:text-4xl font-bold'
                  : 'text-lg md:text-xl'
              }`}>
                {proof.value}
              </div>
              <div className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-1">
                {proof.label}
              </div>
              <div className="text-xs text-gray-600 font-light">
                {proof.subtitle}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.section>
  );
};

export default SocialProofRibbon;
