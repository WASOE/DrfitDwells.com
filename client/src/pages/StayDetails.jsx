import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { stayAPI } from '../services/api';
import AFrameDetails from './AFrameDetails';
import CabinDetails from './CabinDetails';
import NotFoundPage from './NotFoundPage';
import PublicStayIntro, { getPublicStayEntry } from '../components/PublicStayIntro';
import { useSiteLanguage } from '../hooks/useSiteLanguage';

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="text-sm tracking-[0.3em] uppercase text-gray-400">Loading...</div>
  </div>
);

/**
 * Unified public stay route: /stays/:slug
 * Resolves multi-unit cabin types (e.g. a-frame) and single cabins (e.g. the-cabin).
 */
const StayDetails = () => {
  const { slug } = useParams();
  const { language } = useSiteLanguage();
  const [resolved, setResolved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setResolved(null);
      setLoadError(false);
      try {
        const response = await stayAPI.resolve(slug);
        if (cancelled) return;
        if (response.data?.success && response.data?.data?.kind) {
          setResolved(response.data.data);
        } else {
          setResolved(null);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Unable to load live stay details:', error);
          setLoadError(true);
          setResolved(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (slug) {
      load();
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  const intro = getPublicStayEntry(slug) ? <PublicStayIntro slug={slug} /> : <PageLoader />;
  if (loading) return intro;
  if (loadError && getPublicStayEntry(slug)) {
    return (
      <PublicStayIntro slug={slug}>
        <p role="alert">{language === 'bg' ? 'Неуспешно зареждане на наличността.' : 'Live availability could not be loaded.'}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {language === 'bg' ? 'Опитайте отново' : 'Try again'}
        </button>
      </PublicStayIntro>
    );
  }
  if (!resolved?.kind) return <NotFoundPage />;

  if (resolved.kind === 'cabinType') {
    return <AFrameDetails staySlug={slug} loadingFallback={intro} />;
  }

  return <CabinDetails cabinId={resolved.cabinId} staySlug={slug} loadingFallback={intro} />;
};

export default StayDetails;
