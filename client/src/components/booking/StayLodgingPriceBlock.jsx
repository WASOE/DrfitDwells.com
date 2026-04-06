/**
 * Shared stay/lodging price presentation: optional pre-promo strike-through + final amount.
 * Matches SearchBar micro-labels (uppercase serif caps) and card typography (serif sage totals).
 */
export const promoStatusMicrocopyClass =
  'text-[9px] uppercase tracking-[0.3em] font-serif text-gray-500';

export function PromoAppliedMicrocopy({ children = 'Promo applied', className = '' }) {
  return (
    <p className={`${promoStatusMicrocopyClass} ${className}`.trim()} role="status">
      {children}
    </p>
  );
}

/**
 * @param {number|null|undefined} originalAmount - Pre-discount amount (lodging or full quote subtotal)
 * @param {number} finalAmount - Current total to emphasize
 * @param {boolean} [showPromoMicrocopy] - Show muted "Promo applied" when promo context is active
 * @param {string} [promoMicrocopyText]
 * @param {string|null} [invalidReason]
 * @param {import('react').ReactNode} [footnote] - e.g. per-night line (rendered below prices)
 * @param {import('react').ReactNode} [priceSuffix] - e.g. muted "total" label inline after the amount
 */
export function StayLodgingPriceBlock({
  originalAmount = null,
  finalAmount,
  showPromoMicrocopy = false,
  promoMicrocopyText = 'Promo applied',
  invalidReason = null,
  footnote = null,
  priceSuffix = null,
  priceClassName = 'font-serif text-2xl font-bold text-sage',
  strikeClassName = 'font-serif text-lg text-gray-400 line-through decoration-gray-400/70 tabular-nums',
  wrapperClassName = ''
}) {
  const orig = originalAmount != null ? Number(originalAmount) : null;
  const fin = Number(finalAmount);
  const invalid = Boolean(invalidReason);
  /** Never treat invalid / rejected promos as a successful discount UI */
  const showStrike =
    !invalid &&
    orig != null &&
    Number.isFinite(orig) &&
    Number.isFinite(fin) &&
    orig > fin + 0.005;
  const savings =
    showStrike && Number.isFinite(orig) && Number.isFinite(fin)
      ? Math.round((orig - fin) * 100) / 100
      : 0;
  const showSavingsLine = showPromoMicrocopy && !invalid && savings >= 0.01;
  const showAppliedLine = showPromoMicrocopy && !invalid && showStrike;

  return (
    <div className={wrapperClassName}>
      {showStrike && (
        <p className={`${strikeClassName} mb-0.5`} aria-hidden="true">
          €{orig.toLocaleString()}
        </p>
      )}
      <p className={`${priceClassName} tabular-nums leading-tight`}>
        €{fin.toLocaleString()}
        {priceSuffix}
      </p>
      {footnote}
      {showSavingsLine && (
        <p className="text-xs text-gray-500 font-light tabular-nums mt-1.5">
          Save €{savings.toLocaleString()} on stay
        </p>
      )}
      {showAppliedLine && (
        <PromoAppliedMicrocopy className="mt-2">{promoMicrocopyText}</PromoAppliedMicrocopy>
      )}
      {invalidReason && (
        <p className="text-xs text-stone-600 mt-2 leading-relaxed">{invalidReason}</p>
      )}
    </div>
  );
}
