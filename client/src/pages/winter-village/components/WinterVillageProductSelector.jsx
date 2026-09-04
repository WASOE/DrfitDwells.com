import { useMemo, useState, useEffect, useId, useRef } from 'react';
import { Check } from 'lucide-react';
import {
  WINTER_VILLAGE_ACCOMMODATIONS,
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
  const valueId = `${id}-value`;

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      role="group"
      aria-labelledby={labelId}
    >
      <span id={labelId} className="text-sm font-medium text-[#1a1a1a]">
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
        <span
          id={valueId}
          className="wv-stepper-value"
          aria-live="polite"
          aria-atomic="true"
        >
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

/**
 * Data-driven three-product Winter Village selector + calculator.
 */
export default function WinterVillageProductSelector({
  selectedProductId,
  onSelectProduct,
  sectionRef,
  onRequestReserve
}) {
  const baseId = useId();
  const tabRefs = useRef({});
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
      className="valley-section"
      aria-labelledby={`${baseId}-heading`}
    >
      <div className="valley-container">
        <p className="valley-label mb-3">Three winter products</p>
        <h2 id={`${baseId}-heading`} className="valley-h2 mb-4 max-w-3xl">
          Choose how you want to experience Winter Village
        </h2>
        <p className="valley-intro mb-10 md:mb-12 max-w-2xl">
          Stay simply, join a hosted Parent &amp; Child weekend, or come for Christmas. Selecting a
          product updates the package details and proposed price below.
        </p>

        <div
          className="wv-product-tabs mb-10 md:mb-12"
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
                <span className="wv-product-tab-label">{item.name}</span>
                <span className="wv-product-tab-meta">{item.durationLabel}</span>
              </button>
            );
          })}
        </div>

        <div
          id={`${baseId}-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${selectedProductId}`}
          className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start"
        >
          <div>
            <div
              className="relative w-full overflow-hidden rounded-xl bg-[#e8e8e8] mb-6"
              style={{ aspectRatio: '4 / 5', maxHeight: '560px' }}
            >
              <img
                key={product.image}
                src={product.image}
                alt={product.imageAlt}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                width={800}
                height={1000}
              />
            </div>
            <p className="text-sm uppercase tracking-[0.14em] text-[#81887A] mb-2 font-medium">
              {product.durationLabel}
            </p>
            <h3 className="font-serif text-3xl md:text-4xl text-[#1a1a1a] font-semibold mb-3">
              {product.name}
            </h3>
            <p className="valley-body text-[#4a4a4a] mb-4">{product.description}</p>
            <p className="valley-body text-[#6a6a6a] text-sm mb-6">{product.purpose}</p>

            <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#1a1a1a] mb-3">
              Included
            </h4>
            <ul className="space-y-2 mb-2">
              {product.included.map((item) => (
                <li key={item} className="flex gap-3 valley-body text-[#4a4a4a]">
                  <Check className="w-4 h-4 mt-1 shrink-0 text-[#81887A]" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border border-[rgba(0,0,0,0.12)] rounded-xl bg-white p-5 md:p-7 lg:p-8 max-w-xl lg:max-w-none">
            <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#717171] mb-4">
              Accommodation
            </h4>
            <div className="grid grid-cols-1 gap-2 mb-6" role="group" aria-label="Accommodation">
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
                  <span className="block font-semibold text-[#1a1a1a]">{acc.name}</span>
                  <span className="block text-sm text-[#6a6a6a] mt-0.5">{acc.sleepsLabel}</span>
                </button>
              ))}
            </div>

            <div className="space-y-4 mb-6 border-t border-[rgba(0,0,0,0.08)] pt-5">
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
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[#1a1a1a]">Duration</span>
                  <span className="text-sm text-[#4a4a4a]">{product.durationLabel}</span>
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
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[#1a1a1a]">Guests</span>
                  <span className="text-sm text-[#4a4a4a]">2 people</span>
                </div>
              ) : null}

              {product.pricing.wellnessOptional ? (
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-[rgba(0,0,0,0.25)] text-[#81887A] focus-visible:ring-2 focus-visible:ring-[#81887A]"
                    checked={wellnessSelected}
                    onChange={(event) => setWellnessSelected(event.target.checked)}
                  />
                  <span className="text-sm text-[#2a2a2a]">
                    {product.pricing.wellnessOptional.label}
                    <span className="block text-[#81887A] mt-0.5">
                      +{formatEuro(product.pricing.wellnessOptional.pricePerBooking)} per booking
                    </span>
                  </span>
                </label>
              ) : null}
            </div>

            {quote.warnings.length > 0 ? (
              <ul className="mb-4 space-y-1" aria-live="polite">
                {quote.warnings.map((warning) => (
                  <li key={warning} className="text-xs text-[#81887A]">
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="border-t border-[rgba(0,0,0,0.08)] pt-5 mb-5">
              <p className="text-xs uppercase tracking-[0.14em] text-[#717171] mb-2">
                Proposed total
              </p>
              <p className="font-serif text-4xl text-[#1a1a1a] font-semibold mb-3">
                {formatEuro(quote.total)}
              </p>
              <ul className="space-y-1 mb-4">
                {quote.lines.map((line) => (
                  <li
                    key={line.label}
                    className="flex justify-between gap-4 text-sm text-[#4a4a4a]"
                  >
                    <span>{line.label}</span>
                    <span className="shrink-0">{formatEuro(line.amount)}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg bg-[rgba(0,0,0,0.02)] border border-[rgba(0,0,0,0.08)] p-4 text-sm text-[#4a4a4a] space-y-1.5">
                <p>
                  <strong className="text-[#1a1a1a] font-semibold">{quote.depositLabel}:</strong>{' '}
                  {formatEuro(quote.deposit)}
                </p>
                <p>{quote.balanceLabel}</p>
                <p className="text-xs text-[#6a6a6a] pt-1">
                  Proposed prices only. No payment is taken on this page.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onRequestReserve}
              className="w-full bg-[#1a1a1a] text-white px-8 py-4 font-semibold uppercase tracking-wider text-sm hover:bg-[#2a2a2a] transition-colors min-h-[52px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2"
            >
              {product.actionLabel}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
