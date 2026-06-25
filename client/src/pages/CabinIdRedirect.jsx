import { useEffect, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { cabinAPI } from '../services/api';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import {
  KNOWN_CABIN_ID_TO_SLUG,
  appendQueryString,
  resolveCabinStaySlug,
  stayPathForSlug
} from '../utils/stayRoutes';
import CabinDetails from './CabinDetails';

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="text-sm tracking-[0.3em] uppercase text-gray-400">Loading...</div>
  </div>
);

/**
 * Legacy /cabin/:id → /stays/:slug redirect (preserves query string, no bare ?).
 */
const CabinIdRedirect = () => {
  const { id } = useParams();
  const location = useLocation();
  const { language } = useSiteLanguage();
  const [targetPath, setTargetPath] = useState(() => {
    const slug = KNOWN_CABIN_ID_TO_SLUG[id];
    return slug ? stayPathForSlug(slug, language) : null;
  });
  const [fallbackToLegacy, setFallbackToLegacy] = useState(false);

  useEffect(() => {
    if (targetPath) return undefined;

    let cancelled = false;

    const resolve = async () => {
      try {
        const response = await cabinAPI.getById(id);
        if (cancelled) return;
        const cabin = response.data?.data?.cabin;
        const slug = resolveCabinStaySlug(cabin);
        if (slug) {
          setTargetPath(stayPathForSlug(slug, language));
        } else {
          setFallbackToLegacy(true);
        }
      } catch {
        if (!cancelled) setFallbackToLegacy(true);
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [id, language, targetPath]);

  if (targetPath) {
    return <Navigate to={appendQueryString(targetPath, location.search)} replace />;
  }

  if (fallbackToLegacy) {
    return <CabinDetails cabinId={id} />;
  }

  return <PageLoader />;
};

export default CabinIdRedirect;
