import BuildOptionPriceTag from './BuildOptionPriceTag';

const CheckIcon = () => (
  <svg viewBox="0 0 10 10" fill="none" className="h-2.5 w-2.5" aria-hidden="true">
    <path
      d="M2 5L4 7.5L8 2.5"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const BuildRadioOptionCard = ({ option, selected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(option.id)}
    className={`relative flex w-full cursor-pointer items-start gap-4 rounded-[2px] border bg-white p-4 text-left transition-colors md:p-5 ${
      selected
        ? 'border-[#1a1a1a] border-[1.5px]'
        : 'border-[#e0e0e0] hover:border-[#bbb]'
    }`}
  >
    <span
      className={`relative mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] transition-colors ${
        selected ? 'border-[#1a1a1a] bg-[#1a1a1a]' : 'border-[#e0e0e0]'
      }`}
    >
      {selected ? (
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      ) : null}
    </span>

    <span className="min-w-0 flex-1 pr-6">
      <span className="block text-[0.88rem] font-medium text-[#1a1a1a]">{option.name}</span>
      {option.description ? (
        <span className="mt-0.5 block text-[0.76rem] leading-relaxed text-[#5a5a5a]">
          {option.description}
        </span>
      ) : null}
      <BuildOptionPriceTag option={option} selected={selected} />
    </span>

    {selected ? (
      <span className="absolute right-4 top-3 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#1a1a1a]">
        <CheckIcon />
      </span>
    ) : null}
  </button>
);

export default BuildRadioOptionCard;
