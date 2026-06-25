import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { stayAPI } from '../services/api';
import AFrameDetails from './AFrameDetails';
import CabinDetails from './CabinDetails';
import NotFoundPage from './NotFoundPage';

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
  const [resolved, setResolved] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setResolved(null);
      try {
        const response = await stayAPI.resolve(slug);
        if (cancelled) return;
        if (response.data?.success && response.data?.data?.kind) {
          setResolved(response.data.data);
        } else {
          setResolved(null);
        }
      } catch {
        if (!cancelled) setResolved(null);
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
  }, [slug]);

  if (loading) return <PageLoader />;
  if (!resolved?.kind) return <NotFoundPage />;

  if (resolved.kind === 'cabinType') {
    return <AFrameDetails staySlug={slug} />;
  }

  return <CabinDetails cabinId={resolved.cabinId} staySlug={slug} />;
};

export default StayDetails;
