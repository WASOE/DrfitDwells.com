import { BUILD_STEP_SECTIONS } from '../../data/buildConfiguratorSchema.js';
import BuildOptionSection from './BuildOptionSection';

const BuildExteriorStep = ({ state, onSelectRadio, onToggleOption, padX = 'px-8', hideHeader = false }) => {
  const sections = BUILD_STEP_SECTIONS.exterior;
  const [first, ...rest] = sections;

  return (
    <>
      {!hideHeader ? (
      <div className={`${padX} pt-8`}>
        <h2 className="mb-1.5 font-serif text-[2rem] font-normal leading-tight text-[#1a1a1a]">
          {first.title}
        </h2>
        {first.description ? (
          <p className="text-[0.8rem] leading-relaxed text-[#9a9a9a]">{first.description}</p>
        ) : null}
      </div>
      ) : null}

      <BuildOptionSection
        section={first}
        modelId={state.modelId}
        state={state}
        onSelectRadio={onSelectRadio}
        onToggleOption={onToggleOption}
        variant="default"
        padX={padX}
      />

      {rest.map((section) => (
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

export default BuildExteriorStep;
