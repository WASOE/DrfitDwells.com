import { Link, useNavigate } from 'react-router-dom';
import PaidTrafficCardGallery from './PaidTrafficCardGallery';

const sans = { fontFamily: 'var(--valley-font-primary, Montserrat, system-ui, sans-serif)' };

/**
 * Paid-traffic listing card: gallery + explicit primary CTA to stay booking section.
 */
export default function PaidTrafficStayCard({
  slides = [],
  title,
  price,
  fitLine,
  specLine,
  bookingTo,
  detailsTo,
  showDetailsLink,
  labels,
  ratingDisplay,
  imageBadge,
  eagerGallery
}) {
  const navigate = useNavigate();
  const bookingReady = Boolean(bookingTo?.pathname);

  const goToAvailability = () => {
    if (!bookingReady) return;
    navigate(bookingTo);
  };

  const textBlock = (
    <div className="mt-2.5 space-y-1" style={sans}>
      <div className="flex justify-between items-start gap-3">
        <h3 className="text-[15px] font-semibold text-neutral-900 leading-tight tracking-tight pr-1">
          {title}
        </h3>
        {ratingDisplay ? (
          <span
            className="shrink-0 text-[13px] font-medium text-neutral-900 tabular-nums flex items-center gap-0.5"
            aria-label={`${ratingDisplay} average rating`}
          >
            <span className="text-[12px]" aria-hidden>
              ★
            </span>
            {ratingDisplay}
          </span>
        ) : null}
      </div>
      {fitLine ? (
        <p className="text-[13px] text-neutral-500 leading-snug line-clamp-2">{fitLine}</p>
      ) : null}
      {specLine ? (
        <p className="text-[12px] text-neutral-500 leading-snug">{specLine}</p>
      ) : null}
      <p className="pt-0.5 text-[15px] font-semibold text-neutral-900 leading-tight">{price}</p>
    </div>
  );

  const detailsLink =
    showDetailsLink && detailsTo?.pathname ? (
      <Link
        to={detailsTo}
        className="mt-2 inline-block text-[12px] text-neutral-500 underline underline-offset-4 hover:text-neutral-800"
        style={sans}
      >
        {labels.viewDetails}
      </Link>
    ) : null;

  return (
    <article className="flex flex-col max-w-lg mx-auto w-full md:max-w-none rounded-2xl">
      <div className="relative shadow-sm rounded-2xl">
        <PaidTrafficCardGallery
          slides={slides}
          eagerFirst={eagerGallery}
          pointerCursor={false}
        />
        {imageBadge ? (
          <span className="pointer-events-none absolute top-3 left-3 z-10 rounded-full bg-white/90 backdrop-blur-sm px-2.5 py-1 text-[11px] font-semibold text-neutral-900 shadow-sm border border-black/5">
            {imageBadge}
          </span>
        ) : null}
      </div>
      {textBlock}
      {bookingReady ? (
        <button
          type="button"
          onClick={goToAvailability}
          className="mt-3 w-full min-h-[44px] px-4 py-3 bg-[#1a1a1a] text-white text-[13px] font-semibold tracking-wide rounded-lg hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2 active:scale-[0.99] transition-all touch-manipulation"
          style={sans}
        >
          {labels.checkAvailability}
        </button>
      ) : null}
      {detailsLink}
    </article>
  );
}
