import { useMemo, useState, useEffect, useId, useRef } from 'react';
import {
  WINTER_VILLAGE_ACCOMMODATIONS,
  WINTER_VILLAGE_CALCULATOR,
  WINTER_VILLAGE_DEPOSIT,
  WINTER_VILLAGE_PRODUCT_ORDER,
  WINTER_VILLAGE_PRODUCTS,
  getWinterVillageProduct
} from '../winterVillageConfig';
import {
  calculateWinterVillageTotal,
  formatEuro
} from '../winterVillageCalculator';

function Stepper({ id, label, value, min, max, onChange, disabled }) {
  const labelId = `${id}-label`;

  return (
    <div className="wv-stepper-row" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="wv-stepper-label">
        {label}
      </span>
      <div className="wv-stepper">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <span className="wv-stepper-value" aria-live="polite" aria-atomic="true">
          {value}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}

function accommodationRateLabel(product, accId) {
  const unit = product.pricing.units[accId];
  if (!unit) return '';
  if (product.pricing.type === 'per-night') {
    if (unit.ratePerNight) return `€${unit.ratePerNight} / night`;
    if (unit.ratePerPersonPerNight) return `€${unit.ratePerPersonPerNight} / person / night`;
  }
  if (unit.packagePrice) return `€${unit.packagePrice} for two`;
  if (unit.adultPrice) return `From €${unit.adultPrice} / adult`;
  return '';
}

function guestSummary(quote, isStone) {
  if (isStone) {
    const { guests, adults, children4to12, under4 } = quote.normalised;
    if (quote.normalised.product.pricing.type === 'package') {
      const parts = [`${adults} adult${adults === 1 ? '' : 's'}`];
      if (children4to12) parts.push(`${children4to12} child${children4to12 === 1 ? '' : 'ren'}`);
      if (under4) parts.push(`${under4} under 4`);
      return parts.join(' · ');
    }
    return `${guests} people`;
  }
  return '2 people';
}

/**
 * Winter Village configurator. Price lives here, after the story — never before it.
 * Calculator logic is unchanged.
 */
export default function WinterVillageProductSelector({
  selectedProductId,
  onSelectProduct,
  sectionRef,
  onRequestReserve
}) {
  const baseId = useId();
  const tabRefs = useRef({});
  const sectionNodeRef = useRef(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const product = getWinterVillageProduct(selectedProductId);
  const [accommodationId, setAccommodationId] = useState('a-frame');
  const [nights, setNights] = useState(product.defaultNights);
  const [guests, setGuests] = useState(3);
  const [adults, setAdults] = useState(2);
  const [children4to12, setChildren4to12] = useState(1);
  const [under4, setUnder4] = useState(0);
  const [wellnessSelected, setWellnessSelected] = useState(false);

  useEffect(() => {
    const next = getWinterVillageProduct(selectedProductId);
    setNights(next.defaultNights);
    setWellnessSelected(false);
    setAccommodationId((current) => {
      if (current === 'stone-house') {
        const unit = next.pricing.units['stone-house'];
        setGuests(unit?.defaultGuests ?? 3);
        setAdults(unit?.defaultAdults ?? 2);
        setChildren4to12(unit?.defaultChildren4to12 ?? 1);
        setUnder4(unit?.defaultUnder4 ?? 0);
      }
      return current;
    });
  }, [selectedProductId]);

  const quote = useMemo(
    () =>
      calculateWinterVillageTotal({
        productId: selectedProductId,
        accommodationId,
        nights,
        guests,
        adults,
        children4to12,
        under4,
        wellnessSelected
      }),
    [
      selectedProductId,
      accommodationId,
      nights,
      guests,
      adults,
      children4to12,
      under4,
      wellnessSelected
    ]
  );

  const unit = product.pricing.units[accommodationId];
  const isStone = accommodationId === 'stone-house';
  const isStay = product.pricing.type === 'per-night';
  const nightsLocked = product.nightsFixed != null;
  const accommodation = WINTER_VILLAGE_ACCOMMODATIONS.find((item) => item.id === accommodationId);
  const nightsLabel = nightsLocked
    ? product.durationLabel
    : `${quote.normalised.nights} night${quote.normalised.nights === 1 ? '' : 's'}`;

  const selectProductWithFocus = (nextId) => {
    onSelectProduct(nextId);
    requestAnimationFrame(() => {
      tabRefs.current[nextId]?.focus();
    });
  };

  const attachSection = (node) => {
    sectionNodeRef.current = node;
    if (typeof sectionRef === 'function') sectionRef(node);
    else if (sectionRef) sectionRef.current = node;
  };

  useEffect(() => {
    const node = sectionNodeRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;

    // Shrink the root so the bar only appears once the configurator genuinely occupies
    // the screen, rather than the moment its top edge clips the viewport.
    const observer = new IntersectionObserver(
      ([entry]) => setSummaryVisible(entry.isIntersecting),
      { threshold: 0, rootMargin: '-25% 0px -20% 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={attachSection}
      id="winter-packages"
      className="wv-config"
      aria-labelledby={`${baseId}-heading`}
    >
      <div className="wv-config-inner">
        <div className="wv-config-head">
          <p className="wv-kicker">{WINTER_VILLAGE_CALCULATOR.eyebrow}</p>
          <h2 id={`${baseId}-heading`} className="wv-display wv-display--sm">
            {WINTER_VILLAGE_CALCULATOR.headline}
          </h2>
          <p className="wv-lede">{WINTER_VILLAGE_CALCULATOR.copy}</p>
          <p className="wv-config-status">{WINTER_VILLAGE_CALCULATOR.statusNote}</p>
        </div>

        <div className="wv-product-tabs" role="tablist" aria-label="Winter Village products">
          {WINTER_VILLAGE_PRODUCT_ORDER.map((id) => {
            const item = WINTER_VILLAGE_PRODUCTS[id];
            const selected = id === selectedProductId;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${baseId}-tab-${id}`}
                ref={(node) => {
                  tabRefs.current[id] = node;
                }}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                className="wv-product-tab"
                onClick={() => onSelectProduct(id)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                  event.preventDefault();
                  const idx = WINTER_VILLAGE_PRODUCT_ORDER.indexOf(id);
                  const delta = event.key === 'ArrowRight' ? 1 : -1;
                  const next =
                    WINTER_VILLAGE_PRODUCT_ORDER[
                      (idx + delta + WINTER_VILLAGE_PRODUCT_ORDER.length) %
                        WINTER_VILLAGE_PRODUCT_ORDER.length
                    ];
                  selectProductWithFocus(next);
                }}
              >
                <span className="wv-product-tab-label">{item.name}</span>
                <span className="wv-product-tab-meta">{item.details}</span>
                <span className="wv-product-tab-price">{item.fromPrice}</span>
              </button>
            );
          })}
        </div>

        <div
          id={`${baseId}-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${selectedProductId}`}
          className="wv-config-grid"
        >
          <div className="wv-config-body">
            <div>
              <h3 className="wv-config-headline">{product.name}</h3>
              <p className="wv-config-story">{product.headline}</p>
              <p className="wv-config-copy">{product.shortDescription || product.description}</p>
            </div>

            <div>
              <p className="wv-field-label">Accommodation</p>
              <div className="wv-acc-list" role="group" aria-label="Accommodation">
                {WINTER_VILLAGE_ACCOMMODATIONS.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    className="wv-acc-choice"
                    aria-pressed={accommodationId === acc.id}
                    onClick={() => {
                      setAccommodationId(acc.id);
                      if (acc.id === 'stone-house') {
                        const stone = product.pricing.units['stone-house'];
                        setGuests(stone?.defaultGuests ?? 3);
                        setAdults(stone?.defaultAdults ?? 2);
                        setChildren4to12(stone?.defaultChildren4to12 ?? 1);
                        setUnder4(stone?.defaultUnder4 ?? 0);
                      }
                    }}
                  >
                    <span className="wv-acc-choice-name">{acc.name}</span>
                    <span className="wv-acc-choice-rate">
                      {accommodationRateLabel(product, acc.id)}
                    </span>
                    <span className="wv-acc-choice-meta">{acc.sleepsLabel}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="wv-config-controls">
              {isStay && !nightsLocked ? (
                <Stepper
                  id={`${baseId}-nights`}
                  label="Nights"
                  value={quote.normalised.nights}
                  min={product.minNights}
                  max={21}
                  onChange={setNights}
                />
              ) : (
                <div className="wv-stepper-row">
                  <span className="wv-stepper-label">Duration</span>
                  <span className="wv-static-value">{product.durationLabel}</span>
                </div>
              )}

              {isStay && isStone ? (
                <Stepper
                  id={`${baseId}-guests`}
                  label="Guests"
                  value={quote.normalised.guests}
                  min={unit?.minGuests ?? 3}
                  max={unit?.maxGuests ?? 6}
                  onChange={setGuests}
                />
              ) : null}

              {!isStay && isStone ? (
                <>
                  <Stepper
                    id={`${baseId}-adults`}
                    label="Adults"
                    value={quote.normalised.adults}
                    min={1}
                    max={unit?.maxOccupancy ?? 6}
                    onChange={setAdults}
                  />
                  <Stepper
                    id={`${baseId}-children`}
                    label="Children aged 4–12"
                    value={quote.normalised.children4to12}
                    min={0}
                    max={unit?.maxOccupancy ?? 6}
                    onChange={setChildren4to12}
                  />
                  <Stepper
                    id={`${baseId}-under4`}
                    label="Children under 4"
                    value={quote.normalised.under4}
                    min={0}
                    max={unit?.maxOccupancy ?? 6}
                    onChange={setUnder4}
                  />
                </>
              ) : null}

              {!isStone ? (
                <div className="wv-stepper-row">
                  <span className="wv-stepper-label">Guests</span>
                  <span className="wv-static-value">2 people</span>
                </div>
              ) : null}

              {product.pricing.wellnessOptional?.purchasable ? (
                <label className="wv-wellness">
                  <input
                    type="checkbox"
                    checked={wellnessSelected}
                    onChange={(event) => setWellnessSelected(event.target.checked)}
                  />
                  <span>
                    {product.pricing.wellnessOptional.label}
                    <em>
                      +{formatEuro(product.pricing.wellnessOptional.pricePerBooking)} per stay
                    </em>
                  </span>
                </label>
              ) : null}
            </div>

            {quote.warnings.length > 0 ? (
              <ul className="wv-warnings" aria-live="polite">
                {quote.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <aside className="wv-config-aside">
            <div>
              <p className="wv-field-label">What is included</p>
              <ul className="wv-included">
                {product.included.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>

            <div className="wv-terms">
              <h3 className="wv-field-label">{WINTER_VILLAGE_DEPOSIT.termsHeading}</h3>
              <p className="wv-terms-note">{WINTER_VILLAGE_DEPOSIT.termsBody}</p>
              <p className="wv-terms-line">{WINTER_VILLAGE_DEPOSIT.depositLabel}</p>
              <p className="wv-terms-line">
                {product.depositRule === 'christmas'
                  ? WINTER_VILLAGE_DEPOSIT.christmasBalanceLabel
                  : WINTER_VILLAGE_DEPOSIT.stayBalanceLabel}
              </p>
              <p className="wv-terms-note">{WINTER_VILLAGE_DEPOSIT.previewNote}</p>
            </div>
          </aside>
        </div>
      </div>

      <div
        className={`wv-summary ${summaryVisible ? 'is-visible' : ''}`.trim()}
        data-wv-summary="true"
      >
        <div className="wv-summary-inner">
          <div>
            <p className="wv-summary-line">
              <span>{product.shortName}</span>
              <span aria-hidden="true">|</span>
              <span>{accommodation?.name}</span>
              <span className="wv-summary-opt" aria-hidden="true">
                |
              </span>
              <span className="wv-summary-opt">{nightsLabel}</span>
              <span className="wv-summary-opt" aria-hidden="true">
                |
              </span>
              <span className="wv-summary-opt">{guestSummary(quote, isStone)}</span>
            </p>
            <p className="wv-summary-price">
              <span>{WINTER_VILLAGE_CALCULATOR.totalLabel}</span>
              <strong>{formatEuro(quote.total)}</strong>
            </p>
          </div>
          <button type="button" className="wv-btn wv-btn--light" onClick={onRequestReserve}>
            {product.actionLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
