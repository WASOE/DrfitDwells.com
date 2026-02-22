import { motion, AnimatePresence } from 'framer-motion';
import { memo } from 'react';

/**
 * Glass panel option selector with floating aesthetic
 * Optimized for dark backdrop panel
 */
const OptionSelector = ({ 
  category, 
  selectedOptionId, 
  onSelect,
  stepIndex,
  totalSteps,
  isMobile = false
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="backdrop-blur-xl bg-white lg:bg-white/80 rounded-2xl border border-gray-200 lg:border-gray-200 shadow-lg lg:shadow-2xl p-5 md:p-6 lg:p-8 mb-6"
    >
      {/* Category title */}
      <h3 className="text-xl md:text-2xl lg:text-3xl font-light text-black mb-2 tracking-tight">
        {category.title}
      </h3>
      <p className="text-sm md:text-base text-gray-600 mb-5 md:mb-6 font-light">
        {category.description}
      </p>

      {/* Options */}
      <div className="space-y-3">
        <AnimatePresence>
          {category.options.map((option, index) => (
            <motion.label
              key={option.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ delay: index * 0.05 }}
              className={`
                group relative flex items-center justify-between gap-3 md:gap-4
                rounded-xl border-2 p-4 md:p-5 cursor-pointer
                transition-all duration-300 touch-manipulation
                min-h-[60px] md:min-h-[70px]
                ${
                  selectedOptionId === option.id
                    ? 'border-black bg-gray-50 lg:bg-gray-100 shadow-md lg:shadow-lg'
                    : 'border-gray-200 bg-white lg:bg-white hover:border-gray-300 hover:bg-gray-50 active:bg-gray-100'
                }
              `}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <input
                    type="radio"
                    name={category.id}
                    value={option.id}
                    checked={selectedOptionId === option.id}
                    onChange={() => onSelect(option.id)}
                    className="w-5 h-5 md:w-4 md:h-4 text-black border-gray-300 focus:ring-2 focus:ring-black flex-shrink-0"
                  />
                  <span className={`font-medium text-base md:text-base ${
                    selectedOptionId === option.id ? 'text-black' : 'text-gray-900'
                  }`}>
                    {option.name}
                  </span>
                </div>
                <p className="text-sm text-gray-600 ml-8 md:ml-7 font-light leading-relaxed">
                  {option.description}
                </p>
                {option.included && (
                  <span className="ml-8 md:ml-7 mt-2 inline-block text-xs uppercase tracking-wider text-gray-500">
                    Included
                  </span>
                )}
              </div>

              {/* Selection indicator */}
              {selectedOptionId === option.id && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-6 h-6 md:w-6 md:h-6 rounded-full bg-black flex items-center justify-center flex-shrink-0"
                >
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </motion.div>
              )}
            </motion.label>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default OptionSelector;
