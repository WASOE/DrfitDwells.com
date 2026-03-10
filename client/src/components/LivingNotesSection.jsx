import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { cabinAPI, reviewAPI } from '../services/api';
import { deriveDisplayName } from '../utils/nameUtils';

function Stars({ value }) {
  const full = Math.round(value);
  return (
    <span aria-label={`${value} stars`} className="inline-flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < full ? 'text-amber-400' : 'text-white/30'}>★</span>
      ))}
    </span>
  );
}

function sanitize(text = '') {
  if (!text) return '';
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

const MAX_CHARS = 90;

const LivingNotesSection = () => {
  const { t } = useTranslation('cabin');
  const [cabinId, setCabinId] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadCabinAndReviews = useCallback(async () => {
    try {
      setLoading(true);
      const res = await cabinAPI.getAll();
      if (!res?.data?.success) return;
      const cabins = res.data?.data?.cabins || res.data?.cabins || [];
      const cabin = cabins.find(
        c => c?.name && ['the cabin', 'bucephalus', 'the cabin (bucephalus)'].includes(c.name.trim().toLowerCase())
      ) || cabins[0];
      if (!cabin?._id) return;
      setCabinId(cabin._id);

      const revRes = await reviewAPI.getByCabinId(cabin._id, {
        limit: 12,
        sort: 'pinned_first',
        minRating: 2
      });
      if (revRes?.data?.success) {
        const data = revRes.data?.data || {};
        const items = data.items || [];
        const filtered = items.filter(r => (r?.rating ?? 5) >= 2 && r?.status !== 'hidden');
        setReviews(filtered);
        setTotalCount(data.total ?? filtered.length);
      }
    } catch {
      setReviews([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCabinAndReviews();
  }, [loadCabinAndReviews]);

  if (loading && reviews.length === 0) {
    return (
      <section className="relative py-20 md:py-28" style={{ backgroundColor: '#121212' }}>
        <div className="max-w-3xl mx-auto px-4 md:px-6 text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-[#F1ECE2]/30 border-t-[#F1ECE2]"></div>
          <p className="mt-4 text-sm text-white/60">{t('livingNotes.loading', 'Loading reviews...')}</p>
        </div>
      </section>
    );
  }

  const hasMore = cabinId && reviews.length > 0;

  return (
    <section className="relative py-16 md:py-24" style={{ backgroundColor: '#121212' }}>
      <div className="relative z-10 max-w-6xl mx-auto px-4 md:px-6">
        <div className="text-center mb-8 md:mb-10">
          <h2 className="font-serif text-2xl md:text-3xl text-[#F1ECE2] mb-2">
            {t('livingNotes.title')}
          </h2>
          <p className="text-sm text-[#F1ECE2]/70">
            {t('livingNotes.subtitle')}
            {totalCount > 0 && (
              <span className="ml-2 font-medium text-[#F1ECE2]/90">
                {t('livingNotes.reviewCount', '{{count}} reviews', { count: totalCount })}
              </span>
            )}
          </p>
        </div>

        {reviews.length === 0 ? (
          <p className="text-center text-[#F1ECE2]/60 font-serif italic">
            {t('livingNotes.noReviews', 'Guest reviews will appear here.')}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {reviews.map((r, index) => {
              const text = sanitize(r.text);
              const truncated = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '...' : text;
              return (
                <motion.div
                  key={r._id || index}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.3) }}
                  className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-4 md:p-5 hover:bg-white/[0.06] hover:border-white/[0.12] transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Stars value={r.rating ?? 5} />
                  </div>
                  <p className="font-serif text-sm md:text-base text-[#F1ECE2] leading-relaxed italic line-clamp-3">
                    &ldquo;{truncated}&rdquo;
                  </p>
                  <cite className="mt-2 text-xs text-[#F1ECE2]/60 not-italic block font-serif">
                    {deriveDisplayName(r)}
                  </cite>
                </motion.div>
              );
            })}
          </div>
        )}

        {hasMore && (
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mt-8 md:mt-10"
          >
            <Link
              to={cabinId ? `/cabin/${cabinId}` : '/search'}
              className="inline-flex items-center gap-2 text-[#F1ECE2] font-medium text-sm md:text-base border-b border-[#F1ECE2]/50 hover:border-[#F1ECE2] transition-colors pb-1"
            >
              {t('livingNotes.more', 'See all reviews & book')}
              <span aria-hidden>→</span>
            </Link>
          </motion.div>
        )}
      </div>
    </section>
  );
};

export default LivingNotesSection;
