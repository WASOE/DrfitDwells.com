import publicSeoRoutes from '../data/publicSeoRoutes.json';

export const DEFAULT_LANGUAGE = 'en';
export const SUPPORTED_LANGUAGES = ['en', 'bg'];
export const BG_EXCLUDED_PATHS = new Set([
  '/build',
  '/about',
  '/terms',
  '/privacy',
  '/cancellation-policy',
  '/career',
  '/press',
  '/cabin/faq'
]);

export const stripLocaleFromPath = (pathname = '/') => {
  if (!pathname || pathname === '/') return '/';

  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/bg') return '/';
  if (normalized.startsWith('/bg/')) {
    return normalized.slice(3) || '/';
  }

  return normalized;
};

export const getLanguageFromPath = (pathname = '/') =>
  pathname === '/bg' || pathname.startsWith('/bg/') ? 'bg' : DEFAULT_LANGUAGE;

export const localizePath = (pathname = '/', language = DEFAULT_LANGUAGE) => {
  const basePath = stripLocaleFromPath(pathname);

  if (language === 'bg') {
    if (BG_EXCLUDED_PATHS.has(basePath)) {
      return basePath;
    }
    return basePath === '/' ? '/bg' : `/bg${basePath}`;
  }

  return basePath;
};

export const buildHreflangAlternates = (pathname = '/') => {
  const basePath = stripLocaleFromPath(pathname);
  const route = publicSeoRoutes.find((entry) => entry.path === basePath);
  const locales = route?.locales || (BG_EXCLUDED_PATHS.has(basePath) ? ['en'] : SUPPORTED_LANGUAGES);
  const canonicalPath = (locale) => {
    const localized = localizePath(basePath, locale);
    return localized === '/' ? '/' : `${localized.replace(/\/+$/, '')}/`;
  };

  return [
    ...locales.map((locale) => ({ href: canonicalPath(locale), hreflang: locale })),
    { href: canonicalPath('en'), hreflang: 'x-default' }
  ];
};
