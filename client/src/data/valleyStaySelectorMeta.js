import { STAY_CARDS } from '../pages/the-valley/data';

const fallbackByListingSlug = Object.fromEntries(
  STAY_CARDS.filter((card) => card.listingSlug).map((card) => [
    card.listingSlug,
    card.fallbackImage
  ])
);

/** Valley hero stay selector: slugs, routes, order, i18n refs only — no prices or sleeps. */
export const VALLEY_STAY_SELECTOR_META = Object.freeze([
  {
    id: 'a-frame',
    listingSlug: 'a-frame',
    route: '/stays/a-frame',
    i18nKey: 'aFrame',
    fallbackImage: fallbackByListingSlug['a-frame']
  },
  {
    id: 'lux-cabin',
    listingSlug: 'lux-cabin',
    route: '/stays/lux-cabin',
    i18nKey: 'luxCabin',
    fallbackImage: fallbackByListingSlug['lux-cabin']
  },
  {
    id: 'stone-house',
    listingSlug: 'stone-house',
    route: '/stays/stone-house',
    i18nKey: 'stoneHouse',
    fallbackImage: fallbackByListingSlug['stone-house']
  }
]);

export const VALLEY_BUYOUT_SELECTOR_META = Object.freeze({
  id: 'buyout',
  route: '/retreats/the-valley',
  inventorySlug: 'the-valley',
  i18nTitleKey: 'hero.selector.buyout.title',
  i18nFromPriceKey: 'hero.selector.buyout.fromPrice'
});
