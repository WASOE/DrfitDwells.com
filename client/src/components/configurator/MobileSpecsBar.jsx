import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { ChevronUp } from 'lucide-react';

/**
 * Mobile-optimized collapsible specs bar
 * Shows key stats, can expand for more details
 */
const MobileSpecsBar = ({ 
  dimensions = '7 m × 3 m × 3 m',
  area = '21 m²',
  capacity = '2 Persons',
  price = '€35,000',
  onDownloadPDF,
  onScheduleConsultation,
  isConfigPanelOpen = false,
  onExpandedChange
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    if (onExpandedChange) {
      onExpandedChange(newExpanded);
    }
  };

  const specs = [
    { label: 'Dimensions', value: dimensions },
    { label: 'Area', value: area },
    { label: 'Capacity', value: capacity },
    { label: 'Price', value: `Starting at ${price}` }
  ];

  // Hide specs bar when config panel is open
  if (isConfigPanelOpen) {
    return null;
  }

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg lg:hidden"
      style={{ zIndex: 30 }}
    >
      {/* Collapsed View */}
      <div className="px-4 py-3">
        <button
          onClick={handleToggle}
          className="w-full flex items-center justify-between touch-manipulation active:bg-gray-50 rounded-lg p-2 -m-2"
        >
          <div className="flex items-center gap-4 flex-1 overflow-x-auto scrollbar-hide">
            {specs.map((spec) => (
              <div key={spec.label} className="flex-shrink-0 flex flex-col">
                <span className="text-[9px] uppercase tracking-[0.2em] text-gray-500 mb-0.5 font-medium">
                  {spec.label}
                </span>
                <span className="text-sm font-medium text-black whitespace-nowrap">
                  {spec.value}
                </span>
              </div>
            ))}
          </div>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            className="ml-4 flex-shrink-0"
          >
            <ChevronUp className="w-5 h-5 text-gray-400" />
          </motion.div>
        </button>
      </div>

      {/* Expanded View */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-gray-100"
          >
            <div className="px-4 py-4 space-y-4">
              {/* Detailed Specs */}
              <div className="grid grid-cols-2 gap-4">
                {specs.map((spec) => (
                  <div key={spec.label} className="flex flex-col">
                    <span className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-1 font-medium">
                      {spec.label}
                    </span>
                    <span className="text-base font-medium text-black">
                      {spec.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={onScheduleConsultation}
                  className="flex-1 px-4 py-3 bg-black text-white rounded-full text-sm uppercase tracking-wider font-medium touch-manipulation active:bg-gray-900"
                >
                  Consult
                </button>
                <button
                  onClick={onDownloadPDF}
                  className="flex-1 px-4 py-3 border-2 border-black text-black rounded-full text-sm uppercase tracking-wider font-medium touch-manipulation active:bg-gray-100"
                >
                  PDF
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default MobileSpecsBar;
