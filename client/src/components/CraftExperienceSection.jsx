import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const CraftExperienceSection = ({
  variant = 'editorial', // 'editorial' | 'badge' | 'split'
  ctaHref = '/craft/step-1',
  secondaryHref = '/journal/example-itinerary',
  imageSrc = '/uploads/Content%20website/drift-dwells-bulgaria-cabin-journal.avif',
  imageAlt = 'Warm cabin interior with view over the valley',
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation('home');

  const eyebrow = t('craft.eyebrow');
  const title = t('craft.title');
  const description = t('craft.description');
  const outcomes = [
    t('craft.outcomes.cabinMatch'),
    t('craft.outcomes.activityIdeas'),
    t('craft.outcomes.suggestedRhythm'),
  ];
  const microcopy = t('craft.microcopy');
  const ctaLabel = t('craft.ctaPrimary');
  const secondaryLabel = t('craft.ctaSecondary');

  const handleCTAClick = (e) => {
    e.preventDefault();
    navigate(ctaHref);
  };

  const handleSecondaryClick = (e) => {
    e.preventDefault();
    if (secondaryHref) {
      navigate(secondaryHref);
    }
  };

  // Variant 1: Editorial Minimal (text + clean image)
  if (variant === 'editorial') {
    return (
      <section
        aria-labelledby="craft-experience-heading"
        className="relative bg-white py-12 md:py-24"
      >
        <div className="max-w-7xl mx-auto px-4 md:px-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 lg:gap-16 items-center">
            {/* LEFT – COPY + CTA */}
            <div className="max-w-xl">
              {eyebrow && (
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-4 font-serif">
                  {eyebrow}
                </p>
              )}

              <h2
                id="craft-experience-heading"
                className="font-serif text-3xl md:text-4xl lg:text-5xl text-gray-900 tracking-tight leading-tight mb-6"
              >
                {title}
              </h2>

              <p className="font-serif text-base md:text-lg text-gray-700 leading-relaxed mb-6">
                {description}
              </p>

              {/* Outcomes as compact chips */}
              <div className="flex flex-wrap gap-3 mb-6">
                {outcomes.map((item, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs md:text-sm font-serif text-gray-700"
                  >
                    {item}
                  </span>
                ))}
              </div>

              {/* Microcopy */}
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-6 font-serif">
                {microcopy}
              </p>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <button
                  onClick={handleCTAClick}
                  className="inline-flex items-center justify-center px-8 py-3 rounded-full bg-black text-white text-xs md:text-sm font-semibold uppercase tracking-[0.3em] shadow-lg hover:shadow-xl transition-all duration-200 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                >
                  {ctaLabel}
                </button>

                {secondaryLabel && secondaryHref && (
                  <button
                    onClick={handleSecondaryClick}
                    className="inline-flex items-center text-xs md:text-sm font-serif text-gray-600 hover:text-gray-900 underline underline-offset-4 decoration-gray-300 hover:decoration-gray-600 transition-colors"
                  >
                    {secondaryLabel}
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT – CLEAN IMAGE ONLY */}
            <div className="relative">
              <div className="aspect-[4/5] w-full overflow-hidden rounded-2xl bg-stone-100">
                <img
                  src={imageSrc}
                  alt={imageAlt}
                  className="h-full w-full object-cover transition-transform duration-700 hover:scale-[1.02]"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Variant 2: Anchored Badge (clean image + tiny caption badge)
  if (variant === 'badge') {
    return (
      <section
        aria-labelledby="craft-experience-heading"
        className="relative bg-white py-12 md:py-24"
      >
        <div className="max-w-7xl mx-auto px-4 md:px-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 lg:gap-16 items-center">
            {/* LEFT – COPY + CTA */}
            <div className="max-w-xl">
              {eyebrow && (
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-4 font-serif">
                  {eyebrow}
                </p>
              )}

              <h2
                id="craft-experience-heading"
                className="font-serif text-3xl md:text-4xl lg:text-5xl text-gray-900 tracking-tight leading-tight mb-6"
              >
                {title}
              </h2>

              <p className="font-serif text-base md:text-lg text-gray-700 leading-relaxed mb-6">
                {description}
              </p>

              {/* Outcomes as compact chips */}
              <div className="flex flex-wrap gap-3 mb-6">
                {outcomes.map((item, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs md:text-sm font-serif text-gray-700"
                  >
                    {item}
                  </span>
                ))}
              </div>

              {/* Microcopy */}
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-6 font-serif">
                {microcopy}
              </p>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <button
                  onClick={handleCTAClick}
                  className="inline-flex items-center justify-center px-8 py-3 rounded-full bg-black text-white text-xs md:text-sm font-semibold uppercase tracking-[0.3em] shadow-lg hover:shadow-xl transition-all duration-200 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                >
                  {ctaLabel}
                </button>

                {secondaryLabel && secondaryHref && (
                  <button
                    onClick={handleSecondaryClick}
                    className="inline-flex items-center text-xs md:text-sm font-serif text-gray-600 hover:text-gray-900 underline underline-offset-4 decoration-gray-300 hover:decoration-gray-600 transition-colors"
                  >
                    {secondaryLabel}
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT – IMAGE WITH TINY BOTTOM-LEFT BADGE */}
            <div className="relative">
              <div className="aspect-[4/5] w-full overflow-hidden rounded-2xl bg-stone-100 relative group">
                <img
                  src={imageSrc}
                  alt={imageAlt}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                  loading="lazy"
                  decoding="async"
                />
                {/* Tiny badge - bottom left */}
                <div className="absolute bottom-4 left-4">
                  <div className="bg-white/90 backdrop-blur-sm border border-stone-200 rounded-lg px-3 py-1.5 shadow-sm">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-gray-600 font-serif">
                      Preview of your plan
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Variant 3: Split Card (left text card, right full image, image unobstructed)
  if (variant === 'split') {
    return (
      <section
        aria-labelledby="craft-experience-heading"
        className="relative bg-white py-12 md:py-24"
      >
        <div className="max-w-7xl mx-auto px-4 md:px-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 lg:gap-16 items-center">
            {/* LEFT – TEXT CARD */}
            <div className="max-w-xl bg-white rounded-2xl p-8 md:p-10 border border-stone-100 shadow-sm">
              {eyebrow && (
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-4 font-serif">
                  {eyebrow}
                </p>
              )}

              <h2
                id="craft-experience-heading"
                className="font-serif text-3xl md:text-4xl lg:text-5xl text-gray-900 tracking-tight leading-tight mb-6"
              >
                {title}
              </h2>

              <p className="font-serif text-base md:text-lg text-gray-700 leading-relaxed mb-6">
                {description}
              </p>

              {/* Outcomes as compact chips */}
              <div className="flex flex-wrap gap-3 mb-6">
                {outcomes.map((item, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs md:text-sm font-serif text-gray-700"
                  >
                    {item}
                  </span>
                ))}
              </div>

              {/* Microcopy */}
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-6 font-serif">
                {microcopy}
              </p>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <button
                  onClick={handleCTAClick}
                  className="inline-flex items-center justify-center px-8 py-3 rounded-full bg-black text-white text-xs md:text-sm font-semibold uppercase tracking-[0.3em] shadow-lg hover:shadow-xl transition-all duration-200 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                >
                  {ctaLabel}
                </button>

                {secondaryLabel && secondaryHref && (
                  <button
                    onClick={handleSecondaryClick}
                    className="inline-flex items-center text-xs md:text-sm font-serif text-gray-600 hover:text-gray-900 underline underline-offset-4 decoration-gray-300 hover:decoration-gray-600 transition-colors"
                  >
                    {secondaryLabel}
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT – FULL IMAGE, UNOBSTRUCTED */}
            <div className="relative">
              <div className="aspect-[4/5] w-full overflow-hidden rounded-2xl bg-stone-100">
                <img
                  src={imageSrc}
                  alt={imageAlt}
                  className="h-full w-full object-cover transition-transform duration-700 hover:scale-[1.02]"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return null;
};

export default CraftExperienceSection;
