import { Link, useNavigate } from 'react-router-dom';
import PaidTrafficCardGallery from './PaidTrafficCardGallery';

const sans = { fontFamily: 'var(--valley-font-primary, Montserrat, system-ui, sans-serif)' };

/**
 * Paid-traffic listing: inline snap gallery + compact sans meta.
 * The whole card (image, copy, price / check dates) opens booking or check-dates flow.
 * Gallery: drag swipes photos without navigating; tap on the image track still navigates.
 * Dots jump slides; "View details" is a separate link (stops propagation).
 */
export default function PaidTrafficStayCard({
  slides = [],
  title,
  price,
  fitLine,
  specLine,
  bookingHref,
  detailsHref,
  showDetailsLink,
  linksLoaded,
  onAvailabilityFallback,
  labels,
  ratingDisplay,
  imageBadge,
  eagerGallery
}) {
  const navigate = useNavigate();
  const bookingReady = Boolean(linksLoaded && bookingHref);
  const fallbackReady = Boolean(linksLoaded && !bookingHref && onAvailabilityFallback);
  const actionable = bookingReady || fallbackReady;

  const go = () => {
    if (bookingReady) navigate(bookingHref);
    else if (fallbackReady) onAvailabilityFallback();
  };

  const onArticleClick = (e) => {
    if (!actionable) return;
    go();
  };

  const onArticleKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!actionable) return;
    if (e.target !== e.currentTarget && e.target.closest?.('a[href]')) return;
    if (e.repeat) return;
    e.preventDefault();
    go();
  };

  const textBlock = (
    <div
      className={`mt-2.5 space-y-0.5 ${actionable ? 'cursor-pointer' : ''}`}
      style={sans}
    >
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
      <p className="pt-1 leading-tight">
        <span className="text-[15px] font-semibold text-neutral-900 underline decoration-neutral-900 underline-offset-2">
          {price}
        </span>
        <span className="text-[13px] font-medium text-neutral-500"> · {labels.checkDates}</span>
      </p>
      {!actionable ? (
        <p className="text-[13px] text-neutral-400 pt-1">{labels.loading}</p>
      ) : null}
    </div>
  );

  const detailsLink =
    showDetailsLink && detailsHref ? (
      <Link
        to={detailsHref}
        onClick={(e) => e.stopPropagation()}
        className="mt-2 inline-block text-[13px] text-neutral-500 underline underline-offset-4 hover:text-neutral-900"
        style={sans}
      >
        {labels.viewDetails}
      </Link>
    ) : null;

  return (
    <article
      className={`flex flex-col max-w-lg mx-auto w-full md:max-w-none rounded-2xl ${actionable ? 'cursor-pointer' : ''}`}
      onClick={onArticleClick}
      onKeyDown={onArticleKeyDown}
      role={actionable ? 'button' : undefined}
      tabIndex={actionable ? 0 : undefined}
      aria-label={actionable ? `${title} — ${labels.checkDates}` : undefined}
    >
      <div className="relative shadow-sm rounded-2xl">
        <PaidTrafficCardGallery
          slides={slides}
          eagerFirst={eagerGallery}
          pointerCursor={actionable}
        />
        {imageBadge ? (
          <span className="pointer-events-none absolute top-3 left-3 z-10 rounded-full bg-white/90 backdrop-blur-sm px-2.5 py-1 text-[11px] font-semibold text-neutral-900 shadow-sm border border-black/5">
            {imageBadge}
          </span>
        ) : null}
      </div>
      {textBlock}
      {detailsLink}
    </article>
  );
}
