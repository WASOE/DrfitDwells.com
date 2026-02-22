import { motion } from 'framer-motion';

/**
 * Real-time specs bar at bottom of screen
 * Shows dimensions, area, capacity, and price
 */
const SpecsBar = ({ 
  dimensions = '7 m × 3 m × 3 m',
  area = '21 m²',
  capacity = '2 Persons',
  price = '€35,000',
  onDownloadPDF,
  onScheduleConsultation
}) => {
  const specs = [
    { label: 'Dimensions', value: dimensions },
    { label: 'Area', value: area },
    { label: 'Capacity', value: capacity },
    { label: 'Price', value: `Starting at ${price}` }
  ];

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-xl bg-white/95 border-t border-gray-200/30"
      style={{
        boxShadow: '0 -4px 20px -4px rgba(0, 0, 0, 0.08)'
      }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="flex items-center justify-between py-3 md:py-3.5">
          {/* Specs */}
          <div className="flex items-center gap-8 md:gap-16 flex-wrap">
            {specs.map((spec, index) => (
              <motion.div
                key={spec.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex flex-col"
              >
                <span className="text-[10px] uppercase tracking-[0.25em] text-gray-400 mb-0.5 font-medium">
                  {spec.label}
                </span>
                <span className="text-base md:text-lg font-light text-black">
                  {spec.value}
                </span>
              </motion.div>
            ))}
          </div>

          {/* CTA - Hidden on mobile, shown on desktop */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
            className="hidden lg:flex items-center gap-3"
          >
            <button 
              onClick={onScheduleConsultation}
              className="px-5 py-2.5 bg-black text-white rounded-full text-xs uppercase tracking-wider font-medium hover:bg-gray-900 transition-colors"
            >
              Schedule Consultation
            </button>
            <button 
              onClick={onDownloadPDF}
              className="px-5 py-2.5 border border-black text-black rounded-full text-xs uppercase tracking-wider font-medium hover:bg-black hover:text-white transition-colors"
            >
              Download Spec PDF
            </button>
          </motion.div>
          
          {/* Mobile CTA */}
          <div className="lg:hidden flex items-center gap-2">
            <button 
              onClick={onScheduleConsultation}
              className="px-4 py-2.5 bg-black text-white rounded-full text-xs uppercase tracking-wider font-medium touch-manipulation active:bg-gray-900"
            >
              Consult
            </button>
            <button 
              onClick={onDownloadPDF}
              className="px-4 py-2.5 border-2 border-black text-black rounded-full text-xs uppercase tracking-wider font-medium touch-manipulation active:bg-gray-100"
            >
              PDF
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default SpecsBar;
