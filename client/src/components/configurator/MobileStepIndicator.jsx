import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';

/**
 * Mobile step indicator - horizontal scrollable pills
 * Shows all steps with current step highlighted
 */
const MobileStepIndicator = ({ 
  steps, 
  currentStep, 
  onStepClick 
}) => {
  const scrollRef = useRef(null);
  const stepRefs = useRef([]);

  // Auto-scroll to current step
  useEffect(() => {
    if (stepRefs.current[currentStep] && scrollRef.current) {
      const stepElement = stepRefs.current[currentStep];
      const container = scrollRef.current;
      const containerRect = container.getBoundingClientRect();
      const stepRect = stepElement.getBoundingClientRect();
      
      const scrollLeft = stepElement.offsetLeft - (containerRect.width / 2) + (stepRect.width / 2);
      container.scrollTo({
        left: scrollLeft,
        behavior: 'smooth'
      });
    }
  }, [currentStep]);

  return (
    <div className="lg:hidden fixed top-16 left-0 right-0 bg-white border-b border-gray-100" style={{ zIndex: 55 }}>
      <div 
        ref={scrollRef}
        className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;
          
          return (
            <motion.button
              key={step.id}
              ref={(el) => (stepRefs.current[index] = el)}
              onClick={() => onStepClick(index)}
              className={`
                flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium
                touch-manipulation active:scale-95 transition-all
                ${isActive 
                  ? 'bg-black text-white' 
                  : isCompleted
                  ? 'bg-gray-100 text-gray-700'
                  : 'bg-gray-50 text-gray-500'
                }
              `}
              whileTap={{ scale: 0.95 }}
            >
              <span className="flex items-center gap-2">
                {isCompleted && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {step.title}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

export default MobileStepIndicator;
