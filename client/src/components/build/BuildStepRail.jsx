const BuildStepRail = ({ steps, currentStep, onStepClick }) => (
  <div className="flex shrink-0 border-b border-[#e0e0e0] bg-white">
    {steps.map((step, index) => {
      const isActive = index === currentStep;
      const isDone = index < currentStep;

      return (
        <button
          key={step.id}
          type="button"
          onClick={() => onStepClick(index)}
          className={`flex-1 border-b-2 px-1 py-3.5 text-center transition-colors ${
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
        </button>
      );
    })}
  </div>
);

export default BuildStepRail;
