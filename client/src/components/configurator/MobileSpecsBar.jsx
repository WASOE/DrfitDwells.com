import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { ChevronUp } from 'lucide-react';

/**
 * Mobile specs bar — matches BuildStickyBar (black, white text).
 */
const MobileSpecsBar = ({
  dimensions = '—',
  area = '—',
  capacity = '—',
  price = '—',
  onDownloadPDF,
  onScheduleConsultation,
  isConfigPanelOpen = false,
  onExpandedChange,
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
    { label: 'Dimensions', value: dimensions || '—' },
    { label: 'Area', value: area || '—' },
    { label: 'Capacity', value: capacity || '—' },
    { label: 'Price', value: price || '—' },
  ];

  if (isConfigPanelOpen) {
    return null;
  }

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed bottom-0 left-0 right-0 border-t border-[#333] bg-[#1a1a1a] text-white lg:hidden"
      style={{ zIndex: 30 }}
    >
      <div className="px-4 py-3">
        <button
          type="button"
          onClick={handleToggle}
          className="-m-2 flex w-full touch-manipulation items-center justify-between rounded-lg p-2 active:bg-[#2b2b2b]"
        >
          <div className="scrollbar-hide flex flex-1 items-center gap-3 overflow-x-auto">
            {specs.map((spec) => (
              <div key={spec.label} className="flex shrink-0 flex-col">
                <span className="mb-0.5 text-[0.55rem] uppercase tracking-[0.14em] text-[#888]">
                  {spec.label}
                </span>
                <span className="whitespace-nowrap text-[0.82rem] font-normal text-white">
                  {spec.value}
                </span>
              </div>
            ))}
          </div>
          <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} className="ml-3 shrink-0">
            <ChevronUp className="h-5 w-5 text-[#888]" />
          </motion.div>
        </button>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-[#333]"
          >
            <div className="space-y-4 px-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                {specs.map((spec) => (
                  <div key={spec.label} className="flex flex-col">
                    <span className="mb-1 text-[0.55rem] uppercase tracking-[0.14em] text-[#888]">
                      {spec.label}
                    </span>
                    <span className="text-base font-normal text-white">{spec.value}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onScheduleConsultation}
                  className="flex-1 touch-manipulation rounded-[2px] bg-white px-4 py-3 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-[#1a1a1a] active:bg-[#eee]"
                >
                  Schedule Consultation
                </button>
                <button
                  type="button"
                  onClick={onDownloadPDF}
                  className="flex-1 touch-manipulation rounded-[2px] border border-[#555] px-4 py-3 text-[0.62rem] uppercase tracking-[0.1em] text-white active:border-white"
                >
                  Download Spec PDF
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
