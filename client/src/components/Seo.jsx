import { Helmet } from 'react-helmet-async';
import {
  buildHreflangAlternates,
  localizePath,
  stripLocaleFromPath
} from '../utils/localizedRoutes';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { getSiteUrl, toAbsoluteSiteUrl } from '../utils/siteUrl';
import publicSeoRoutes from '../data/publicSeoRoutes.json';

const canonicalizePublicPath = (pathname) => {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return normalized === '/' ? '/' : `${normalized}/`;
};

const serializeJsonLd = (schema) => JSON.stringify(schema)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const Seo = ({
  title,
  description,
  canonicalPath: requestedCanonicalPath,
  suppressCanonical = false,
  noindex = false,
  jsonLd,
  ogImage,
  ogTitle,
  ogDescription,
  ogType = 'website',
  preloadImages = [],
  hreflangAlternates = []
}) => {
  const siteUrl = getSiteUrl();
  const { language: detectedLanguage } = useSiteLanguage();
  const basePath = requestedCanonicalPath ? stripLocaleFromPath(requestedCanonicalPath) : null;
  const route = basePath ? publicSeoRoutes.find((entry) => entry.path === basePath) : null;
  const routeLanguage = route && !route.locales.includes(detectedLanguage)
    ? route.locales[0]
    : detectedLanguage;
  const isUnsupportedLocale = route && !route.locales.includes(detectedLanguage);
  const localizedCanonicalPath = localizePath(requestedCanonicalPath || '/', routeLanguage);
  const canonicalPath = route ? canonicalizePublicPath(localizedCanonicalPath) : localizedCanonicalPath;
  const canonical = `${siteUrl}${canonicalPath}`;
  const absoluteOgImage = toAbsoluteSiteUrl(route?.ogImage || ogImage);
  const socialTitle = ogTitle || title;
  const socialDescription = ogDescription || description;
  const alternates = route
    ? buildHreflangAlternates(basePath)
    : hreflangAlternates;
  const alternateLocales = alternates
    .map(({ hreflang }) => hreflang)
    .filter((hreflang) => hreflang !== 'x-default');

  return (
    <>
      <Helmet>
      <html lang={routeLanguage} />
      {title && <title>{title}</title>}
      {description && <meta name="description" content={description} />}
      {!suppressCanonical && <link rel="canonical" href={canonical} />}
      {alternates.length > 0 && alternates.map(({ href, hreflang }) => (
        <link key={hreflang} rel="alternate" hrefLang={hreflang} href={href.startsWith('http') ? href : `${siteUrl}${href}`} />
      ))}
      {(noindex || isUnsupportedLocale) && <meta name="robots" content="noindex,nofollow" />}
      {/* Open Graph */}
      {socialTitle && <meta property="og:title" content={socialTitle} />}
      {socialDescription && <meta property="og:description" content={socialDescription} />}
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonical} />
      <meta property="og:locale" content={routeLanguage === 'bg' ? 'bg_BG' : 'en_GB'} />
      {alternateLocales
        .filter((locale) => locale !== routeLanguage)
        .map((locale) => (
          <meta key={locale} property="og:locale:alternate" content={locale === 'bg' ? 'bg_BG' : 'en_GB'} />
        ))}
      {absoluteOgImage && <meta property="og:image" content={absoluteOgImage} />}
      {absoluteOgImage && socialTitle && <meta property="og:image:alt" content={socialTitle} />}
      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      {socialTitle && <meta name="twitter:title" content={socialTitle} />}
      {socialDescription && <meta name="twitter:description" content={socialDescription} />}
      {absoluteOgImage && <meta name="twitter:image" content={absoluteOgImage} />}
      {/* Route-specific image preloads */}
      {preloadImages.map((entry, index) => {
        const spec = typeof entry === 'string' ? { href: entry } : entry;
        const href = /^https?:\/\//i.test(spec.href)
          ? spec.href
          : spec.href.startsWith('/')
            ? spec.href
            : `/${spec.href}`;
        return (
          <link
            key={index}
            rel="preload"
            as={spec.as || 'image'}
            href={href}
            type={spec.type || undefined}
            media={spec.media || undefined}
            fetchPriority={spec.fetchPriority || 'high'}
          />
        );
      })}
      </Helmet>
      {jsonLd && (
        Array.isArray(jsonLd)
          ? jsonLd.map((schema, index) => (
              <script
                dangerouslySetInnerHTML={{ __html: serializeJsonLd(schema) }}
                type="application/ld+json"
                key={index}
              />
            ))
          : (
            <script
              dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
              type="application/ld+json"
            />
          )
      )}
    </>
  );
};

export default Seo;
