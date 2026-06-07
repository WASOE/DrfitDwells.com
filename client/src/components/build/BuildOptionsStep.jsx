import { BUILD_STEP_SECTIONS } from '../../data/buildConfiguratorSchema.js';
import BuildOptionSection from './BuildOptionSection';

const BuildOptionsStep = ({ state, onSelectRadio, onToggleOption, padX = 'px-8', hideHeader = false }) => {
  const sections = BUILD_STEP_SECTIONS.options;

  return (
    <>
      {!hideHeader ? (
      <div className={`${padX} pt-8`}>
        <h2 className="mb-1.5 font-serif text-[2rem] font-normal leading-tight text-[#1a1a1a]">
          Off-Grid &amp; Extras
        </h2>
        <p className="text-[0.8rem] leading-relaxed text-[#9a9a9a]">
          Integrated during the build. Not bolted on afterward.
        </p>
      </div>
      ) : null}

      {sections.map((section, index) => (
        <BuildOptionSection
          key={section.id}
          section={section}
          modelId={state.modelId}
          state={state}
          onSelectRadio={onSelectRadio}
          onToggleOption={onToggleOption}
          variant="divider"
          padX={padX}
        />
      ))}
    </>
  );
};

export default BuildOptionsStep;
