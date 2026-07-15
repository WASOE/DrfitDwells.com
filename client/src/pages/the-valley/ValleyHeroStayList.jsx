import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import PaidTrafficStaySelector from '../../components/PaidTrafficStaySelector';
import useValleyHeroStayItems from '../../hooks/useValleyHeroStayItems';
import '../../i18n/ns/valley';

function ValleyHeroStayListSkeleton() {
  return (
    <ul
      className="paid-traffic-stay-selector--embedded flex flex-col gap-2"
      aria-hidden="true"
      data-testid="valley-hero-stay-list-skeleton"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <li key={`unit-skeleton-${index}`} className="py-1.5 first:pt-0">
          <div className="flex items-start gap-2.5">
            <div className="shrink-0 w-14 h-14 rounded-md bg-neutral-200 animate-pulse" />
            <div className="min-w-0 flex-1 space-y-2 pt-0.5">
              <div className="h-3.5 w-28 rounded bg-neutral-200 animate-pulse" />
              <div className="h-3 w-36 rounded bg-neutral-200/90 animate-pulse" />
              <div className="h-3 w-24 rounded bg-neutral-200/80 animate-pulse" />
            </div>
          </div>
          <div className="mt-2 h-9 w-full rounded-lg bg-neutral-200 animate-pulse" />
        </li>
      ))}
      <li className="mt-1 border-t border-[rgba(0,0,0,0.08)] pt-3">
        <div className="h-[60px] w-full rounded-lg bg-neutral-200 animate-pulse" />
      </li>
    </ul>
  );
}

/**
 * /valley hero card stay list — label, three units, promoted buyout row.
 * Consumes {@link useValleyHeroStayItems}; mounted in {@link ValleyBrowseHeroSection} on desktop.
 */
export default function ValleyHeroStayList() {
  const { units, buyout, listings, buyoutInventory } = useValleyHeroStayItems();
  const { t } = useTranslation('valley');

  const isLoading =
    listings.status === 'loading' || buyoutInventory.status === 'loading';

  const labels = useMemo(
    () => ({
      checkAvailability: t('hero.selector.checkAvailability'),
      viewDetails: ''
    }),
    [t]
  );

  const selectorItems = useMemo(() => {
    const unitItems = units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      fit: unit.fit,
      sleepsLabel: unit.sleeps || undefined,
      price: unit.fromPrice || undefined,
      thumb: unit.cover?.url,
      thumbAlt: unit.cover?.alt,
      bookingTo: unit.bookingTo
    }));

    const buyoutItem = {
      id: buyout.id,
      title: buyout.title,
      price: buyout.fromPriceLabel || undefined,
      promoted: true,
      bookingTo: buyout.bookingTo
    };

    return [...unitItems, buyoutItem];
  }, [units, buyout]);

  return (
    <div className="valley-hero-stay-list w-full max-w-md" data-testid="valley-hero-stay-list">
      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#717171] mb-3">
        {t('hero.selector.label')}
      </p>
      {isLoading ? (
        <ValleyHeroStayListSkeleton />
      ) : (
        <PaidTrafficStaySelector variant="embedded" items={selectorItems} labels={labels} />
      )}
    </div>
  );
}

export { ValleyHeroStayListSkeleton };
