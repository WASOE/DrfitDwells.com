import BuildHeroPhoto from './BuildHeroPhoto';
import BuildStepRail from './BuildStepRail';
import BuildStickyBar from './BuildStickyBar';
import BuildModelStep from './BuildModelStep';
import BuildExteriorStep from './BuildExteriorStep';
import BuildInteriorStep from './BuildInteriorStep';
import BuildOptionsStep from './BuildOptionsStep';
import BuildSummary from './BuildSummary';
import { BUILD_STEPS } from '../../data/buildConfiguratorSchema.js';

const StepNav = ({ onBack, onNext, backLabel = '← Back', nextLabel, showBack = true }) => (
  <div className="flex items-center justify-between px-8 pb-8 pt-4">
    {showBack ? (
      <button
        type="button"
        onClick={onBack}
        className="rounded-[2px] border border-[#e0e0e0] px-6 py-2.5 text-[0.68rem] uppercase tracking-[0.1em] text-[#5a5a5a] transition-colors hover:border-[#1a1a1a] hover:text-[#1a1a1a]"
      >
        {backLabel}
      </button>
    ) : (
      <div />
    )}
    {onNext ? (
      <button
        type="button"
        onClick={onNext}
        className="rounded-[2px] bg-[#1a1a1a] px-8 py-2.5 text-[0.68rem] uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#2b2b2b]"
      >
        {nextLabel}
      </button>
    ) : (
      <div />
    )}
  </div>
);

const BuildDesktopShell = ({
  configurator,
  onDownloadPDF,
  onScheduleConsultation,
}) => {
  const {
    state,
    model,
    currentStep,
    barPrice,
    dimensions,
    area,
    capacity,
    heroImageUrl,
    selectModel,
    setCustomDimensions,
    selectRadio,
    toggleOption,
    goToStep,
    nextStep,
    prevStep,
  } = configurator;

  const stepId = BUILD_STEPS[currentStep]?.id;

  return (
    <>
      <div className="mx-auto grid min-h-[calc(100vh-var(--header-offset,68px))] max-w-[1600px] grid-cols-1 lg:grid-cols-[1fr_460px]">
        <BuildHeroPhoto imageUrl={heroImageUrl} alt={model.name} />

        <div className="relative flex max-h-[calc(100vh-var(--header-offset,68px))] flex-col border-[#e0e0e0] bg-white lg:border-l lg:overflow-y-auto">
          <BuildStepRail steps={BUILD_STEPS} currentStep={currentStep} onStepClick={goToStep} />

          <div className="pb-[120px]">
            {stepId === 'model' ? (
              <>
                <BuildModelStep
                  state={state}
                  model={model}
                  onSelectModel={selectModel}
                  onCustomDimensionsChange={setCustomDimensions}
                />
                <StepNav showBack={false} onNext={nextStep} nextLabel="Exterior →" />
              </>
            ) : null}

            {stepId === 'exterior' ? (
              <>
                <BuildExteriorStep
                  state={state}
                  onSelectRadio={selectRadio}
                  onToggleOption={toggleOption}
                />
                <StepNav onBack={prevStep} onNext={nextStep} nextLabel="Interior →" />
              </>
            ) : null}

            {stepId === 'interior' ? (
              <>
                <BuildInteriorStep
                  state={state}
                  onSelectRadio={selectRadio}
                  onToggleOption={toggleOption}
                />
                <StepNav onBack={prevStep} onNext={nextStep} nextLabel="Options →" />
              </>
            ) : null}

            {stepId === 'options' ? (
              <>
                <BuildOptionsStep
                  state={state}
                  onSelectRadio={selectRadio}
                  onToggleOption={toggleOption}
                />
                <StepNav onBack={prevStep} onNext={nextStep} nextLabel="See your build →" />
              </>
            ) : null}

            {stepId === 'summary' ? (
              <>
                <BuildSummary
                  state={state}
                  model={model}
                  onDownloadPDF={onDownloadPDF}
                  onScheduleConsultation={onScheduleConsultation}
                />
                <StepNav onBack={prevStep} backLabel="← Revise choices" showBack />
              </>
            ) : null}
          </div>
        </div>
      </div>

      <BuildStickyBar
        dimensions={dimensions}
        area={area}
        capacity={capacity}
        price={barPrice}
        onDownloadPDF={onDownloadPDF}
        onScheduleConsultation={onScheduleConsultation}
      />
    </>
  );
};

export default BuildDesktopShell;
