import BuildOptionPriceTag from './BuildOptionPriceTag';

const BuildToggleOptionCard = ({ option, selected, onToggle }) => (
  <button
    type="button"
    onClick={() => onToggle(option.id)}
    className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[2px] border bg-white px-5 py-4 text-left transition-colors ${
      selected
        ? 'border-[#1a1a1a] border-[1.5px]'
        : 'border-[#e0e0e0] hover:border-[#bbb]'
    }`}
  >
    <span className="min-w-0 flex-1">
      <span className="block text-[0.84rem] font-medium text-[#1a1a1a]">{option.name}</span>
      {option.description ? (
        <span className="mt-0.5 block text-[0.72rem] text-[#9a9a9a]">{option.description}</span>
      ) : null}
    </span>

    <span className="flex shrink-0 items-center gap-3">
      <BuildOptionPriceTag option={option} selected={selected} className="mt-0 whitespace-nowrap" />
      <span
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
          selected ? 'bg-[#1a1a1a]' : 'bg-[#e0e0e0]'
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${
            selected ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </span>
  </button>
);

export default BuildToggleOptionCard;
