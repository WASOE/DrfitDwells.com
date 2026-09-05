import { useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import {
  WINTER_VILLAGE_ACCOMMODATIONS,
  WINTER_VILLAGE_CALCULATOR,
  WINTER_VILLAGE_CHRISTMAS_FEATURE,
  WINTER_VILLAGE_CLOSE,
  WINTER_VILLAGE_DATES,
  WINTER_VILLAGE_DEPOSIT,
  WINTER_VILLAGE_FAQ,
  WINTER_VILLAGE_HERO,
  WINTER_VILLAGE_PARENT_FEATURE,
  WINTER_VILLAGE_PREPARE,
  WINTER_VILLAGE_PREVIEW_MODAL,
  WINTER_VILLAGE_PRODUCT_ORDER,
  WINTER_VILLAGE_PRODUCTS,
  WINTER_VILLAGE_SEO,
  WINTER_VILLAGE_WAYS
} from './winterVillageConfig';
import {
  WINTER_VILLAGE_ACCOMMODATION_COPY_BG,
  WINTER_VILLAGE_CALCULATOR_BG,
  WINTER_VILLAGE_CHRISTMAS_FEATURE_BG,
  WINTER_VILLAGE_CLOSE_BG,
  WINTER_VILLAGE_DATES_BG,
  WINTER_VILLAGE_DEPOSIT_BG,
  WINTER_VILLAGE_FAQ_BG,
  WINTER_VILLAGE_HERO_BG,
  WINTER_VILLAGE_PARENT_FEATURE_BG,
  WINTER_VILLAGE_PREPARE_BG,
  WINTER_VILLAGE_PREVIEW_MODAL_BG,
  WINTER_VILLAGE_PRODUCT_COPY_BG,
  WINTER_VILLAGE_SEO_BG,
  WINTER_VILLAGE_WAYS_BG
} from './winterVillageCopy.bg';

function localizeProduct(productId) {
  const base = WINTER_VILLAGE_PRODUCTS[productId];
  const copy = WINTER_VILLAGE_PRODUCT_COPY_BG[productId];
  if (!base || !copy) return base;

  const wellnessBase = base.pricing?.wellnessOptional;
  const wellnessCopy = copy.pricing?.wellnessOptional;

  return {
    ...base,
    ...copy,
    pricing: {
      ...base.pricing,
      wellnessOptional: wellnessBase
        ? {
            ...wellnessBase,
            ...(wellnessCopy || {})
          }
        : wellnessBase
    }
  };
}

function localizeAccommodations() {
  return WINTER_VILLAGE_ACCOMMODATIONS.map((item) => {
    const copy = WINTER_VILLAGE_ACCOMMODATION_COPY_BG[item.id];
    return copy ? { ...item, ...copy } : item;
  });
}

function localizeDates() {
  return {
    ...WINTER_VILLAGE_DATES,
    ...WINTER_VILLAGE_DATES_BG,
    items: WINTER_VILLAGE_DATES.items.map((item) => {
      const copy = WINTER_VILLAGE_DATES_BG.items[item.id];
      return copy ? { ...item, ...copy } : item;
    })
  };
}

function buildEnglishBundle() {
  return {
    language: 'en',
    seo: WINTER_VILLAGE_SEO,
    hero: WINTER_VILLAGE_HERO,
    deposit: WINTER_VILLAGE_DEPOSIT,
    previewModal: WINTER_VILLAGE_PREVIEW_MODAL,
    accommodations: WINTER_VILLAGE_ACCOMMODATIONS,
    products: WINTER_VILLAGE_PRODUCTS,
    productOrder: WINTER_VILLAGE_PRODUCT_ORDER,
    ways: WINTER_VILLAGE_WAYS,
    prepare: WINTER_VILLAGE_PREPARE,
    calculator: WINTER_VILLAGE_CALCULATOR,
    christmasFeature: WINTER_VILLAGE_CHRISTMAS_FEATURE,
    parentFeature: WINTER_VILLAGE_PARENT_FEATURE,
    close: WINTER_VILLAGE_CLOSE,
    dates: WINTER_VILLAGE_DATES,
    faq: WINTER_VILLAGE_FAQ,
    ui: {
      productsAria: 'Winter Village products',
      accommodation: 'Accommodation',
      nights: 'Nights',
      duration: 'Duration',
      guests: 'Guests',
      adults: 'Adults',
      children4to12: 'Children aged 4–12',
      under4: 'Children under 4',
      twoPeople: '2 people',
      perStay: 'per stay',
      included: 'What is included',
      nightSingular: 'night',
      nightPlural: 'nights',
      adultSingular: 'adult',
      adultPlural: 'adults',
      childSingular: 'child',
      childPlural: 'children',
      under4Label: 'under 4',
      people: 'people',
      perNight: '/ night',
      perPersonPerNight: '/ person / night',
      forTwo: 'for two',
      fromAdult: '/ adult'
    },
    getProduct: (productId) => WINTER_VILLAGE_PRODUCTS[productId] || WINTER_VILLAGE_PRODUCTS.stay
  };
}

function buildBulgarianBundle() {
  const products = Object.fromEntries(
    WINTER_VILLAGE_PRODUCT_ORDER.map((id) => [id, localizeProduct(id)])
  );

  return {
    language: 'bg',
    seo: WINTER_VILLAGE_SEO_BG,
    hero: WINTER_VILLAGE_HERO_BG,
    deposit: {
      ...WINTER_VILLAGE_DEPOSIT,
      ...WINTER_VILLAGE_DEPOSIT_BG
    },
    previewModal: WINTER_VILLAGE_PREVIEW_MODAL_BG,
    accommodations: localizeAccommodations(),
    products,
    productOrder: WINTER_VILLAGE_PRODUCT_ORDER,
    ways: WINTER_VILLAGE_WAYS_BG,
    prepare: WINTER_VILLAGE_PREPARE_BG,
    calculator: WINTER_VILLAGE_CALCULATOR_BG,
    christmasFeature: WINTER_VILLAGE_CHRISTMAS_FEATURE_BG,
    parentFeature: WINTER_VILLAGE_PARENT_FEATURE_BG,
    close: WINTER_VILLAGE_CLOSE_BG,
    dates: localizeDates(),
    faq: WINTER_VILLAGE_FAQ_BG,
    ui: {
      productsAria: 'Пакети на Зимното селище',
      accommodation: 'Настаняване',
      nights: 'Нощувки',
      duration: 'Продължителност',
      guests: 'Гости',
      adults: 'Възрастни',
      children4to12: 'Деца 4–12 г.',
      under4: 'Деца под 4 г.',
      twoPeople: '2 души',
      perStay: 'на престой',
      included: 'Какво е включено',
      nightSingular: 'нощувка',
      nightPlural: 'нощувки',
      adultSingular: 'възрастен',
      adultPlural: 'възрастни',
      childSingular: 'дете',
      childPlural: 'деца',
      under4Label: 'под 4 г.',
      people: 'души',
      perNight: '/ нощ',
      perPersonPerNight: '/ човек / нощ',
      forTwo: 'за двама',
      fromAdult: '/ възрастен'
    },
    getProduct: (productId) => products[productId] || products.stay
  };
}

/**
 * Localized Winter Village copy + structure. Pricing always comes from EN config.
 */
export function useWinterVillageLocale() {
  const { language } = useLanguage();
  return useMemo(
    () => (language === 'bg' ? buildBulgarianBundle() : buildEnglishBundle()),
    [language]
  );
}
