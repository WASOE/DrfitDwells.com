import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';

/**
 * Mobile step rail — visual match to BuildStepRail (5 steps, scrollable on narrow viewports).
 */
const MobileStepIndicator = ({ steps, currentStep, onStepClick }) => {
  const scrollRef = useRef(null);
  const stepRefs = useRef([]);

  useEffect(() => {
    if (stepRefs.current[currentStep] && scrollRef.current) {
      const stepElement = stepRefs.current[currentStep];
      const container = scrollRef.current;
      const containerRect = container.getBoundingClientRect();
      const stepRect = stepElement.getBoundingClientRect();
      const scrollLeft =
        stepElement.offsetLeft - containerRect.width / 2 + stepRect.width / 2;
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  }, [currentStep]);

  return (
    <div
      className="fixed left-0 right-0 top-[var(--header-offset,68px)] z-[55] border-b border-[#e0e0e0] bg-white lg:hidden"
    >
      <div
        ref={scrollRef}
        className="scrollbar-hide flex overflow-x-auto"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isDone = index < currentStep;

          return (
            <motion.button
              key={step.id}
              type="button"
              ref={(el) => {
                stepRefs.current[index] = el;
              }}
              onClick={() => onStepClick(index)}
              whileTap={{ scale: 0.98 }}
              className={`min-w-[4.5rem] flex-1 touch-manipulation border-b-2 px-1 py-3 text-center transition-colors ${
                isActive ? 'border-[#1a1a1a]' : 'border-transparent'
              }`}
            >
              <div
                className={`mx-auto mb-1 flex h-[18px] w-[18px] items-center justify-center rounded-full text-[0.6rem] font-medium ${
                  isActive || isDone
                    ? 'bg-[#1a1a1a] text-white'
                    : 'bg-[#e0e0e0] text-[#9a9a9a]'
                }`}
              >
                {isDone ? '✓' : index + 1}
              </div>
              <div
                className={`text-[0.6rem] uppercase tracking-[0.1em] ${
                  isActive ? 'text-[#1a1a1a]' : isDone ? 'text-[#2b2b2b]' : 'text-[#9a9a9a]'
                }`}
              >
                {step.label}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

export default MobileStepIndicator;
