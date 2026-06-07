import { BUILD_STEP_SECTIONS } from '../../data/buildConfiguratorSchema.js';
import BuildOptionSection from './BuildOptionSection';

const BuildInteriorStep = ({ state, onSelectRadio, onToggleOption, padX = 'px-8', hideHeader = false }) => {
  const sections = BUILD_STEP_SECTIONS.interior;

  return (
    <>
      {!hideHeader ? (
      <div className={`${padX} pt-8`}>
        <h2 className="mb-1.5 font-serif text-[2rem] font-normal leading-tight text-[#1a1a1a]">
          Interior Finish
        </h2>
        <p className="text-[0.8rem] leading-relaxed text-[#9a9a9a]">
          The materials you wake up to every morning.
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
          variant={index === 0 ? 'default' : 'divider'}
          padX={padX}
        />
      ))}
    </>
  );
};

export default BuildInteriorStep;
