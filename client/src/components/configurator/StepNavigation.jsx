import { motion } from 'framer-motion';

/**
 * Step navigation bar for the 4-step journey
 */
const StepNavigation = ({ 
  steps, 
  currentStep, 
  onStepClick 
}) => {
  return (
    <div className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-gray-200/50 py-4 mb-8">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 overflow-x-auto scrollbar-hide">
          {steps.map((step, index) => (
            <motion.button
              key={step.id}
              onClick={() => onStepClick(index)}
              disabled={index > currentStep}
              className={`
                relative flex items-center gap-3 px-4 py-2 rounded-full
                transition-all duration-300 whitespace-nowrap
                ${
                  index === currentStep
                    ? 'bg-black text-white'
                    : index < currentStep
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-white text-gray-400 border border-gray-200 cursor-not-allowed'
                }
              `}
              whileHover={index <= currentStep ? { scale: 1.05 } : {}}
              whileTap={index <= currentStep ? { scale: 0.95 } : {}}
            >
              <span className="text-sm font-medium">
                {index + 1}. {step.title}
              </span>
              {index < currentStep && (
                <motion.svg
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </motion.svg>
              )}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default StepNavigation;
