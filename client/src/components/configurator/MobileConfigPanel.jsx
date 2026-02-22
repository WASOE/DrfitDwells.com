import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import OptionSelector from './OptionSelector';

/**
 * Mobile bottom sheet configuration panel
 * Slides up from bottom, native-feeling interactions
 */
const MobileConfigPanel = ({
  isOpen,
  onClose,
  currentStep,
  totalSteps,
  currentCategories,
  selections,
  onOptionSelect,
  onNextStep,
  onPrevStep,
  canGoNext,
  canGoPrev,
  isDeliveryStep,
  deliveryContent,
  onDownloadPDF,
  onScheduleConsultation
}) => {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [startY, setStartY] = useState(0);

  // Prevent body scroll when panel is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleTouchStart = (e) => {
    setIsDragging(true);
    setStartY(e.touches[0].clientY);
  };

  const handleTouchMove = (e) => {
    if (!isDragging) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    if (deltaY > 0) {
      setDragY(deltaY);
    }
  };

  const handleTouchEnd = () => {
    if (dragY > 100) {
      onClose();
    }
    setDragY(0);
    setIsDragging(false);
  };

  const panelHeight = isDeliveryStep ? '85vh' : '75vh';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 z-[9998] lg:hidden"
          />

          {/* Bottom Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ 
              y: dragY > 0 ? dragY : 0,
              transition: { type: 'spring', damping: 30, stiffness: 300 }
            }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl lg:hidden"
            style={{ 
              zIndex: 9999,
              height: panelHeight,
              maxHeight: '90vh',
              touchAction: 'pan-y'
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Drag Handle */}
            <div className="flex items-center justify-center pt-3 pb-2">
              <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
            </div>

            {/* Header */}
            <div className="px-6 pb-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500 font-medium mb-1">
                    Step {currentStep + 1} of {totalSteps}
                  </div>
                  <h2 className="text-2xl font-light text-black">
                    {isDeliveryStep ? 'Delivery & Timeline' : currentCategories[0]?.title || 'Configure'}
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center touch-manipulation active:bg-gray-200"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>

              {/* Progress Bar */}
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
                  className="h-full bg-black rounded-full"
                />
              </div>
            </div>

            {/* Content - Scrollable */}
            <div className="overflow-y-auto h-full pb-24" style={{ 
              height: `calc(${panelHeight} - 120px)`,
              WebkitOverflowScrolling: 'touch'
            }}>
              <div className="px-6 py-6">
                <AnimatePresence mode="wait">
                  {isDeliveryStep ? (
                    <motion.div
                      key="delivery"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="space-y-6"
                    >
                      <p className="text-base text-gray-600 font-light leading-relaxed">
                        Review your configuration and plan delivery.
                      </p>
                      
                      <div className="space-y-4">
                        {deliveryContent?.map((item, index) => (
                          <div key={index} className="flex items-start gap-4 p-4 rounded-xl bg-gray-50 border border-gray-200">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-medium">
                              {item.step}
                            </div>
                            <div>
                              <div className="font-medium text-black mb-1">{item.title}</div>
                              <div className="text-sm text-gray-600 font-light">{item.desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-3 pt-4">
                        <button
                          onClick={onDownloadPDF}
                          className="w-full px-6 py-4 bg-black text-white rounded-full text-sm uppercase tracking-wider font-medium active:bg-gray-900 touch-manipulation"
                        >
                          Download Your Spec PDF
                        </button>
                        <a
                          href="mailto:info@driftdwells.com?subject=Cabin Configuration Consultation"
                          className="block w-full px-6 py-4 border-2 border-black text-black rounded-full text-sm uppercase tracking-wider font-medium active:bg-gray-100 text-center touch-manipulation"
                        >
                          Schedule a Design Consultation
                        </a>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key={currentStep}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                      {currentCategories.map((category) => (
                        <OptionSelector
                          key={category.id}
                          category={category}
                          selectedOptionId={selections[category.id]}
                          onSelect={(optionId) => onOptionSelect(category.id, optionId)}
                          isMobile={true}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Navigation Footer - Fixed at bottom */}
            <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-6 py-4 flex items-center justify-between gap-4">
              {canGoPrev && (
                <button
                  onClick={onPrevStep}
                  className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-full text-sm font-medium active:bg-gray-50 touch-manipulation flex-1"
                >
                  Previous
                </button>
              )}
              {canGoNext && !isDeliveryStep && (
                <button
                  onClick={onNextStep}
                  className="px-6 py-3 bg-black text-white rounded-full text-sm font-medium active:bg-gray-900 touch-manipulation flex-1"
                >
                  Next Step
                </button>
              )}
              {isDeliveryStep && (
                <button
                  onClick={onClose}
                  className="px-6 py-3 bg-black text-white rounded-full text-sm font-medium active:bg-gray-900 touch-manipulation flex-1"
                >
                  Close
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default MobileConfigPanel;
