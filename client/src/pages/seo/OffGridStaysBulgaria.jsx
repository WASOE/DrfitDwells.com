import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AiSearchArticle from '../../components/AiSearchArticle';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { usePaidTrafficListingSlides } from '../../hooks/usePaidTrafficListingSlides';
import { PAID_TRAFFIC_STAY_META } from '../../data/paidTrafficLandingStays';
import { buildPaidTrafficStayNavTarget, PAID_TRAFFIC_BOOKING_HASH } from '../../utils/paidTrafficRoutes';
import '../../i18n/ns/seo';

const discoveryPhotos = {
  'the-cabin': '/media/seo/aframe-bedroom-winter.jpeg',
  'valley-a-frame': '/media/seo/aframe-row-sunset.png',
  'valley-lux-cabin': '/media/seo/aframe-field-sunset.jpeg',
  'valley-stone-house': '/media/seo/stone-house-winter-wide.jpeg'
};

export default function OffGridStaysBulgaria() {
  const { t } = useTranslation('seo');
  const { language } = useSiteLanguage();
  const { slidesByStayId } = usePaidTrafficListingSlides();
  const p = (key) => t(`paidStaysBulgaria.${key}`);

  return (
    <AiSearchArticle kind="offGrid">
      <section id="stays" className="ai-search-stays">
        <div className="ai-search-discovery-heading">
          <span className="ai-search-eyebrow">{p('staysTitle')}</span>
          <h2>{p('exploreTitle')}</h2>
        </div>
        <div className="ai-search-stay-grid">
          {PAID_TRAFFIC_STAY_META.map((stay) => {
            const photo = slidesByStayId[stay.id]?.[0];
            const image = photo?.url && photo.url !== stay.fallbackImage ? photo.url : discoveryPhotos[stay.id];
            const title = p(`stays.${stay.id}.title`);
            const bookingTo = buildPaidTrafficStayNavTarget(stay.route, language, { hash: PAID_TRAFFIC_BOOKING_HASH });
            return (
              <article className="ai-search-stay" key={stay.id}>
                <img className="ai-search-stay-image" src={image}
                  alt={image === photo?.url ? photo.alt || title : title} width="720" height="480" loading="lazy" decoding="async"
                  srcSet={image === discoveryPhotos[stay.id] ? `${image} 720w, ${image.replace('-720w.', '-1200w.')} 1200w` : undefined}
                  sizes="(min-width: 1200px) 536px, (min-width: 700px) 45vw, 100vw"
                  style={image === discoveryPhotos['valley-a-frame'] ? { objectPosition: 'center 85%' } : undefined} />
                <div className="ai-search-stay-copy">
                  <span className="ai-search-eyebrow">{stay.id === 'the-cabin' ? 'The Cabin' : 'The Valley'}</span>
                  <h3>{title}</h3>
                  <p>{p(`stays.${stay.id}.fitLine`)}</p>
                  <p className="ai-search-stay-sleeps">{p('comparison.labels.sleeps')} {p(`stays.${stay.id}.comparison.sleeps`)}</p>
                  <p className="ai-search-stay-price">{p(`selector.stays.${stay.id}.price`)}</p>
                  <div className="ai-search-stay-actions">
                    <Link className="ai-search-cta" to={bookingTo}>{p('cta.checkAvailability')}</Link>
                    {stay.showDetailsLink && <Link className="ai-search-details" to={buildPaidTrafficStayNavTarget(stay.route, language)}>{p('cta.viewDetails')}</Link>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </AiSearchArticle>
  );
}
