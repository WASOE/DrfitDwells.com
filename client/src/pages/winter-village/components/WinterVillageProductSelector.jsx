import { useMemo, useState, useEffect, useId, useRef } from 'react';
import { getValleyHeroResponsive } from '../../../config/heroResponsive';
import {
  WINTER_VILLAGE_ACCOMMODATIONS,
  WINTER_VILLAGE_MEDIA,
  WINTER_VILLAGE_PRODUCT_ORDER,
  WINTER_VILLAGE_PRODUCTS,
  getWinterVillageProduct
} from '../winterVillageConfig';
import {
  calculateWinterVillageTotal,
  formatEuro
} from '../winterVillageCalculator';
import WinterVillageCinematicMedia from './WinterVillageCinematicMedia';

function Stepper({ id, label, value, min, max, onChange, disabled }) {
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;

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
        <span id={valueId} className="wv-stepper-value" aria-live="polite" aria-atomic="true">
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
 * Split-screen Winter Village configurator. Calculator logic is unchanged.
 */
export default function WinterVillageProductSelector({
  selectedProductId,
  onSelectProduct,
  sectionRef,
  onRequestReserve,
  prefersReducedMotion = false
}) {
  const baseId = useId();
  const tabRefs = useRef({});
  const product = getWinterVillageProduct(selectedProductId);
  const media = WINTER_VILLAGE_MEDIA[selectedProductId] || WINTER_VILLAGE_MEDIA.stay;
  const stayPicture = selectedProductId === 'stay' ? getValleyHeroResponsive('winter') : null;
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

  return (
    <section
      ref={sectionRef}
      id="winter-packages"
      className="wv-config"
      aria-labelledby={`${baseId}-heading`}
    >
      <h2 id={`${baseId}-heading`} className="sr-only">
        Choose how you want to experience Winter Village
      </h2>

      <div className="wv-config-media" data-product={selectedProductId}>
        <WinterVillageCinematicMedia
          key={selectedProductId}
          videoSrc={media.videoSrc}
          posterSrc={media.posterSrc || media.stillSrc}
          picture={stayPicture}
          alt={media.alt}
          overlayClassName={`wv-config-media-overlay wv-config-media-overlay--${selectedProductId}`}
          prefersReducedMotion={prefersReducedMotion}
          objectPosition={selectedProductId === 'parent-child' ? 'center 70%' : 'center center'}
        />
        <p className="wv-config-media-caption">{product.headline}</p>
      </div>

      <div className="wv-config-panel">
        <div
          className="wv-product-tabs"
          role="tablist"
          aria-label="Winter Village products"
        >
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
                <span className="wv-product-tab-kicker">{item.kicker}</span>
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
          className="wv-config-body"
        >
          <p className="wv-kicker">{product.details}</p>
          <h3 className="wv-config-headline">{product.name}</h3>
          <p className="wv-config-story">{product.headline}</p>
          <p className="wv-config-copy">{product.shortDescription || product.description}</p>

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
                <span className="wv-acc-choice-meta">{acc.sleepsLabel}</span>
                <span className="wv-acc-choice-rate">{accommodationRateLabel(product, acc.id)}</span>
              </button>
            ))}
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

            {product.pricing.wellnessOptional ? (
              <label className="wv-wellness">
                <input
                  type="checkbox"
                  checked={wellnessSelected}
                  onChange={(event) => setWellnessSelected(event.target.checked)}
                />
                <span>
                  {product.pricing.wellnessOptional.label}
                  <em>
                    +{formatEuro(product.pricing.wellnessOptional.pricePerBooking)} per booking
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

        <div className="wv-summary" data-wv-summary="true">
          <div className="wv-summary-meta">
            <p className="wv-summary-line">
              <span>{product.kicker}</span>
              <span aria-hidden="true">|</span>
              <span>{accommodation?.name}</span>
              <span aria-hidden="true">|</span>
              <span>{nightsLabel}</span>
              <span aria-hidden="true">|</span>
              <span>{guestSummary(quote, isStone)}</span>
            </p>
            <p className="wv-summary-price">
              <span>Proposed total</span>
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
