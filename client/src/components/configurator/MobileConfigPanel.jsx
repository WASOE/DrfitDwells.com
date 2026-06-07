import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { BUILD_STEPS } from '../../data/buildConfiguratorSchema.js';
import BuildModelStep from '../build/BuildModelStep';
import BuildExteriorStep from '../build/BuildExteriorStep';
import BuildInteriorStep from '../build/BuildInteriorStep';
import BuildOptionsStep from '../build/BuildOptionsStep';
import BuildSummary from '../build/BuildSummary';

const STEP_HEADERS = {
  model: 'Choose your model',
  exterior: 'Exterior Cladding',
  interior: 'Interior Finish',
  options: 'Off-Grid & Extras',
  summary: 'Your build summary',
};

const MobileConfigPanel = ({
  isOpen,
  onClose,
  configurator,
  onDownloadPDF,
  onScheduleConsultation,
}) => {
  const {
    state,
    model,
    currentStep,
    selectModel,
    setCustomDimensions,
    selectRadio,
    toggleOption,
    nextStep,
    prevStep,
  } = configurator;

  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [startY, setStartY] = useState(0);

  const stepId = BUILD_STEPS[currentStep]?.id;
  const isSummaryStep = stepId === 'summary';
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === BUILD_STEPS.length - 1;
  const panelHeight = isSummaryStep ? '90vh' : '80vh';
  const padX = 'px-0';

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
    const deltaY = e.touches[0].clientY - startY;
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

  const renderStepContent = () => {
    switch (stepId) {
      case 'model':
        return (
          <BuildModelStep
            state={state}
            model={model}
            onSelectModel={selectModel}
            onCustomDimensionsChange={setCustomDimensions}
            padX={padX}
            hideHeader
          />
        );
      case 'exterior':
        return (
          <BuildExteriorStep
            state={state}
            onSelectRadio={selectRadio}
            onToggleOption={toggleOption}
            padX={padX}
            hideHeader
          />
        );
      case 'interior':
        return (
          <BuildInteriorStep
            state={state}
            onSelectRadio={selectRadio}
            onToggleOption={toggleOption}
            padX={padX}
            hideHeader
          />
        );
      case 'options':
        return (
          <BuildOptionsStep
            state={state}
            onSelectRadio={selectRadio}
            onToggleOption={toggleOption}
            padX={padX}
            hideHeader
          />
        );
      case 'summary':
        return (
          <BuildSummary
            state={state}
            model={model}
            onDownloadPDF={onDownloadPDF}
            onScheduleConsultation={onScheduleConsultation}
            padX={padX}
            omitActions
          />
        );
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[9998] bg-black/40 lg:hidden"
          />

          <motion.div
            initial={{ y: '100%' }}
            animate={{
              y: dragY > 0 ? dragY : 0,
              transition: { type: 'spring', damping: 30, stiffness: 300 },
            }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 flex flex-col rounded-t-3xl bg-white shadow-2xl lg:hidden"
            style={{
              zIndex: 9999,
              height: panelHeight,
              maxHeight: '92vh',
              touchAction: 'pan-y',
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="flex shrink-0 items-center justify-center pt-3 pb-2">
              <div className="h-1.5 w-12 rounded-full bg-[#e0e0e0]" />
            </div>

            <div className="shrink-0 border-b border-[#e0e0e0] px-6 pb-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="mb-1 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-[#9a9a9a]">
                    Step {currentStep + 1} of {BUILD_STEPS.length}
                  </div>
                  <h2 className="font-serif text-2xl font-normal text-[#1a1a1a]">
                    {STEP_HEADERS[stepId] ?? 'Configure'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-full bg-[#f5f5f3] active:bg-[#e0e0e0]"
                  aria-label="Close"
                >
                  <X className="h-5 w-5 text-[#5a5a5a]" />
                </button>
              </div>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-4"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {renderStepContent()}
            </div>

            <div className="shrink-0 border-t border-[#e0e0e0] bg-white px-6 py-4">
              {isSummaryStep ? (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={onScheduleConsultation}
                    className="w-full touch-manipulation rounded-[2px] bg-[#1a1a1a] px-4 py-3.5 text-[0.68rem] font-medium uppercase tracking-[0.1em] text-white active:bg-[#2b2b2b]"
                  >
                    Schedule consultation
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onDownloadPDF}
                      className="flex-1 touch-manipulation rounded-[2px] border border-[#e0e0e0] px-4 py-3 text-[0.68rem] uppercase tracking-[0.1em] text-[#5a5a5a] active:border-[#1a1a1a]"
                    >
                      Download PDF
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 touch-manipulation rounded-[2px] border border-[#e0e0e0] px-4 py-3 text-[0.68rem] uppercase tracking-[0.1em] text-[#5a5a5a] active:border-[#1a1a1a]"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  {!isFirstStep ? (
                    <button
                      type="button"
                      onClick={prevStep}
                      className="flex-1 touch-manipulation rounded-[2px] border border-[#e0e0e0] px-4 py-3 text-[0.68rem] uppercase tracking-[0.1em] text-[#5a5a5a] active:border-[#1a1a1a]"
                    >
                      ← Back
                    </button>
                  ) : (
                    <div className="flex-1" />
                  )}
                  {!isLastStep ? (
                    <button
                      type="button"
                      onClick={nextStep}
                      className="flex-1 touch-manipulation rounded-[2px] bg-[#1a1a1a] px-4 py-3 text-[0.68rem] uppercase tracking-[0.14em] text-white active:bg-[#2b2b2b]"
                    >
                      Next →
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default MobileConfigPanel;
