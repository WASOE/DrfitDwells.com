import CabinCard from './CabinCard';
import { locations } from '../data/content';
import { useTranslation } from 'react-i18next';
import { useSeason } from '../context/SeasonContext';
import { CABIN_MEDIA, VALLEY_MEDIA } from '../config/mediaConfig';

// Entry point rule: cards for a specific stay → listing; cards for a collection → category
const DestinationsFooter = () => {
  const { season } = useSeason();
  const cabin = locations.find(loc => loc.id === 'cabin');
  const valley = locations.find(loc => loc.id === 'valley');
  const { t } = useTranslation('common');

  // Match footer card media to current hero season (winter/summer)
  const CABIN_VIDEO = CABIN_MEDIA.heroVideo[season];
  const CABIN_VIDEO_POSTER = CABIN_MEDIA.heroPoster[season];
  const VALLEY_VIDEO = VALLEY_MEDIA.heroVideo[season];
  const VALLEY_VIDEO_POSTER = VALLEY_MEDIA.heroPoster[season];

  const cabinTranslated = cabin ? {
    ...cabin,
    name: t('destinations.cabin.name'),
    description: t('destinations.cabin.description'),
    price: t('destinations.cabin.price'),
    cta: t('destinations.cabin.cta'),
    details: cabin.details ? {
      ...cabin.details,
      access: cabin.details.access ? t('destinations.cabin.details.access') : undefined,
      power: cabin.details.power ? t('destinations.cabin.details.power') : undefined
    } : undefined
  } : null;

  const valleyTranslated = valley ? {
    ...valley,
    name: t('destinations.valley.name'),
    description: t('destinations.valley.description'),
    price: t('destinations.valley.price'),
    cta: t('destinations.valley.cta'),
    details: valley.details ? {
      ...valley.details,
      access: valley.details.access ? t('destinations.valley.details.access') : undefined,
      connectivity: valley.details.connectivity ? t('destinations.valley.details.connectivity') : undefined,
      altitude: valley.details.altitude ? t('destinations.valley.details.altitude') : undefined
    } : undefined
  } : null;

  return (
    <div className="relative w-full">
      {/* 1. WHITE SECTION */}
      <section className="relative py-12 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          {/* Header */}
          <div className="text-center mb-8 md:mb-10">
            <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-2 md:mb-3">
              {t('destinations.headline')}
            </h2>
            <p className="font-script text-lg md:text-xl text-stone-500 italic">
              {t('destinations.tagline')}
            </p>
          </div>

          {/* Cards Grid */}
          <div className="mb-0">
            {/* Mobile: Horizontal Scroll Carousel */}
            <div className="flex md:hidden overflow-x-auto snap-x snap-mandatory gap-4 px-4 pb-8 scrollbar-hide -mx-4">
              {cabinTranslated && (
                <div className="flex-shrink-0 w-[85vw] snap-center">
                  <CabinCard
                    title={cabinTranslated.name}
                    description={cabinTranslated.description}
                    image={cabinTranslated.image}
                    interiorImage={cabinTranslated.interiorImage}
                    audioSrc={cabinTranslated.audioSrc}
                    details={cabinTranslated.details}
                    locationId={cabinTranslated.id}
                    price={cabinTranslated.price}
                    cta={cabinTranslated.cta}
                    videoSrc={CABIN_VIDEO}
                    videoPoster={CABIN_VIDEO_POSTER}
                  />
                </div>
              )}
              {valleyTranslated && (
                <div className="flex-shrink-0 w-[85vw] snap-center">
                  <CabinCard
                    title={valleyTranslated.name}
                    description={valleyTranslated.description}
                    image={valleyTranslated.image}
                    interiorImage={valleyTranslated.interiorImage}
                    audioSrc={valleyTranslated.audioSrc}
                    details={valleyTranslated.details}
                    locationId={valleyTranslated.id}
                    price={valleyTranslated.price}
                    cta={valleyTranslated.cta}
                    videoSrc={VALLEY_VIDEO}
                    videoPoster={VALLEY_VIDEO_POSTER}
                  />
                </div>
              )}
            </div>

            {/* Desktop: Grid Layout */}
            <div className="hidden md:grid md:grid-cols-2 gap-4 lg:gap-6" style={{ alignItems: 'stretch' }}>
              {/* CABIN CARD */}
              {cabinTranslated && (
                <div className="flex">
                  <CabinCard
                    title={cabinTranslated.name}
                    description={cabinTranslated.description}
                    image={cabinTranslated.image}
                    interiorImage={cabinTranslated.interiorImage}
                    audioSrc={cabinTranslated.audioSrc}
                    details={cabinTranslated.details}
                    locationId={cabinTranslated.id}
                    price={cabinTranslated.price}
                    cta={cabinTranslated.cta}
                    videoSrc={CABIN_VIDEO}
                    videoPoster={CABIN_VIDEO_POSTER}
                  />
                </div>
              )}

              {/* VALLEY CARD */}
              {valleyTranslated && (
                <div className="flex">
                  <CabinCard
                    title={valleyTranslated.name}
                    description={valleyTranslated.description}
                    image={valleyTranslated.image}
                    interiorImage={valleyTranslated.interiorImage}
                    audioSrc={valleyTranslated.audioSrc}
                    details={valleyTranslated.details}
                    locationId={valleyTranslated.id}
                    price={valleyTranslated.price}
                    cta={valleyTranslated.cta}
                    videoSrc={VALLEY_VIDEO}
                    videoPoster={VALLEY_VIDEO_POSTER}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default DestinationsFooter;
