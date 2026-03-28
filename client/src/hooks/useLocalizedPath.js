import { useLocation } from 'react-router-dom';
import { getLanguageFromPath, localizePath } from '../utils/localizedRoutes';

/** Resolves internal paths for the active route locale (e.g. /bg/... when on Bulgarian). */
export function useLocalizedPath() {
  const { pathname } = useLocation();
  const language = getLanguageFromPath(pathname);
  return (path) => localizePath(path, language);
}
