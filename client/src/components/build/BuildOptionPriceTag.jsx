import { formatBuildPrice } from '../../data/buildConfiguratorLogic.js';

/**
 * @param {{ included?: boolean, priceOnConsultation?: boolean, priceDelta?: number, selected?: boolean }} option
 */
export function getBuildOptionPriceLabel(option) {
  if (option.priceOnConsultation) {
    return 'Price at consultation';
  }
  if (option.included) {
    return 'Included';
  }
  if (option.priceDelta) {
    return `+ ${formatBuildPrice(option.priceDelta)}`;
  }
  return null;
}

const BuildOptionPriceTag = ({ option, selected = false, className = '' }) => {
  const label = getBuildOptionPriceLabel(option);
  if (!label) return null;

  return (
    <div
      className={`text-[0.65rem] font-medium uppercase tracking-[0.12em] ${
        selected ? 'text-[#1a1a1a]' : 'text-[#9a9a9a]'
      } ${className || 'mt-1.5'}`}
    >
      {label}
    </div>
  );
};

export default BuildOptionPriceTag;
