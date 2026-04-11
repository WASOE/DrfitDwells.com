import { Helmet } from 'react-helmet-async';
import { localizePath } from '../utils/localizedRoutes';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { getSiteUrl, toAbsoluteSiteUrl } from '../utils/siteUrl';

const Seo = ({
  title,
  description,
  canonicalPath,
  suppressCanonical = false,
  noindex = false,
  jsonLd,
  ogImage,
  ogType = 'website',
  preloadImages = [],
  hreflangAlternates = []
}) => {
  const siteUrl = getSiteUrl();
  const { language: routeLanguage } = useSiteLanguage();
  const localizedCanonicalPath = canonicalPath ? localizePath(canonicalPath, routeLanguage) : '/';
  const canonical = `${siteUrl}${localizedCanonicalPath}`;
  const absoluteOgImage = toAbsoluteSiteUrl(ogImage);

  return (
    <Helmet>
      <html lang={routeLanguage} />
      {title && <title>{title}</title>}
      {description && <meta name="description" content={description} />}
      {!suppressCanonical && <link rel="canonical" href={canonical} />}
      {hreflangAlternates.length > 0 && hreflangAlternates.map(({ href, hreflang }) => (
        <link key={hreflang} rel="alternate" hrefLang={hreflang} href={href.startsWith('http') ? href : `${siteUrl}${href}`} />
      ))}
      {noindex && <meta name="robots" content="noindex,nofollow" />}
      {/* Open Graph */}
      {title && <meta property="og:title" content={title} />}
      {description && <meta property="og:description" content={description} />}
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonical} />
      {absoluteOgImage && <meta property="og:image" content={absoluteOgImage} />}
      {absoluteOgImage && title && <meta property="og:image:alt" content={title} />}
      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      {title && <meta name="twitter:title" content={title} />}
      {description && <meta name="twitter:description" content={description} />}
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
      {jsonLd && (
        Array.isArray(jsonLd)
          ? jsonLd.map((schema, index) => (
              <script
                dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
                type="application/ld+json"
                key={index}
              />
            ))
          : (
            <script
              dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
              type="application/ld+json"
            />
          )
      )}
    </Helmet>
  );
};

export default Seo;

