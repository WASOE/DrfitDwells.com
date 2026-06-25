import { INSTAGRAM_URL, FACEBOOK_URL } from '../data/gmbLocations';
import { localizePath } from './localizedRoutes';
import { getSiteUrl, toAbsoluteSiteUrl } from './siteUrl';

export function buildStayCanonicalPath(slug) {
  const normalized = String(slug || '').trim().toLowerCase();
  if (!normalized) return null;
  return `/stays/${normalized}`;
}

export function buildStayCanonicalUrl(slug, language = 'en') {
  const path = buildStayCanonicalPath(slug);
  if (!path) return null;
  return `${getSiteUrl()}${localizePath(path, language)}`;
}

export function buildStayLodgingJsonLd({
  name,
  description,
  location,
  pricePerNight,
  images,
  imageUrl,
  averageRating,
  reviewsCount,
  slug,
  language = 'en'
}) {
  const canonicalUrl = buildStayCanonicalUrl(slug, language);
  if (!canonicalUrl) return null;

  const hasAgg =
    typeof averageRating === 'number' &&
    typeof reviewsCount === 'number' &&
    reviewsCount > 0;

  let imageList = [];
  if (Array.isArray(images) && images.length > 0) {
    imageList = images
      .slice(0, 5)
      .map((img) => {
        const raw = typeof img === 'string' ? img : img?.url;
        return toAbsoluteSiteUrl(raw);
      })
      .filter(Boolean);
  } else if (imageUrl) {
    const absolute = toAbsoluteSiteUrl(imageUrl);
    if (absolute) imageList = [absolute];
  }

  const data = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    name: name || '',
    description: description || '',
    url: canonicalUrl,
    sameAs: [INSTAGRAM_URL, FACEBOOK_URL],
    numberOfRooms: 1
  };

  if (location) {
    data.address = {
      '@type': 'PostalAddress',
      addressLocality: location
    };
  }

  if (pricePerNight != null && pricePerNight !== '') {
    data.priceRange = `€${pricePerNight}`;
  }

  if (imageList.length > 0) {
    data.image = imageList;
  }

  if (hasAgg) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(Number(averageRating).toFixed(2)),
      reviewCount: reviewsCount,
      bestRating: 5,
      worstRating: 1
    };
  }

  return data;
}

export function buildStayBreadcrumbJsonLd({ stayName, slug, language = 'en' }) {
  const origin = getSiteUrl();
  const stayUrl = buildStayCanonicalUrl(slug, language);
  if (!stayUrl) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Stays',
        item: `${origin}${localizePath('/search', language)}`
      },
      { '@type': 'ListItem', position: 3, name: stayName || 'Stay', item: stayUrl }
    ]
  };
}
