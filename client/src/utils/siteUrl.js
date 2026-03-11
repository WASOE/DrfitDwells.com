const DEFAULT_SITE_URL = 'https://driftdwells.com';

const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');

export const getSiteUrl = () => trimTrailingSlash(import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL);

export const isLocalHost = () => {
  if (typeof window === 'undefined' || !window.location?.hostname) return false;
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
};

export const getRuntimeOrigin = () => {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return getSiteUrl();
  }
  return trimTrailingSlash(window.location.origin);
};

export const toAbsoluteSiteUrl = (path = '') => {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${getSiteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
};

export const toAbsoluteAssetUrl = (path = '') => {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = isLocalHost() ? getRuntimeOrigin() : getSiteUrl();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};
