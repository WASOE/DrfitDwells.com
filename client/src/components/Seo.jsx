import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import { getLanguageFromPath, localizePath } from '../utils/localizedRoutes';
import { getSiteUrl, toAbsoluteAssetUrl, toAbsoluteSiteUrl } from '../utils/siteUrl';

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
  const location = useLocation();
  const siteUrl = getSiteUrl();
  const routeLanguage = getLanguageFromPath(location.pathname);
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
      {preloadImages.map((img, index) => {
        const href = toAbsoluteAssetUrl(img);
        return (
          <link
            key={index}
            rel="preload"
            as="image"
            href={href}
            fetchPriority="high"
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

