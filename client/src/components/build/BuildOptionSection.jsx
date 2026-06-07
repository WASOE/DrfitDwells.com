import { getOptionsForCategory } from '../../data/buildConfiguratorLogic.js';
import BuildRadioOptionCard from './BuildRadioOptionCard';
import BuildToggleOptionCard from './BuildToggleOptionCard';

const BuildOptionSection = ({
  section,
  modelId,
  state,
  onSelectRadio,
  onToggleOption,
  variant = 'default',
  padX = 'px-8',
}) => {
  const options = getOptionsForCategory(section.categoryId, modelId);
  if (!options.length) return null;

  const isRadio = section.selectionType === 'radio';
  const selectedRadioId = state.radio[section.categoryId];

  return (
    <div className={variant === 'divider' ? `${padX} pb-5` : `${padX} py-5`}>
      {variant === 'divider' ? (
        <div className="mb-2.5">
          <div className="text-[0.62rem] font-medium uppercase tracking-[0.14em] text-[#9a9a9a]">
            {section.title}
          </div>
          {section.description ? (
            <p className="mt-1 text-[0.78rem] text-[#9a9a9a]">{section.description}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        {options.map((option) =>
          isRadio ? (
            <BuildRadioOptionCard
              key={option.id}
              option={option}
              selected={selectedRadioId === option.id}
              onSelect={(optionId) => onSelectRadio(section.categoryId, optionId)}
            />
          ) : (
            <BuildToggleOptionCard
              key={option.id}
              option={option}
              selected={state.toggles.includes(option.id)}
              onToggle={onToggleOption}
            />
          )
        )}
      </div>
    </div>
  );
};

export default BuildOptionSection;
