import { Link, useNavigate } from 'react-router-dom';

const sans = { fontFamily: 'var(--valley-font-primary, Montserrat, system-ui, sans-serif)' };

/**
 * Visual "pick your stay" selector. Image-led tiles (mobile 2x2) or stacked rows
 * (desktop hero panel via `layout="rows"`). Navigation uses each item's pre-built
 * `bookingTo` / `detailsTo` targets (from `stay.route`), never listingSlug.
 *
 * @param {{
 *   items: Array<{
 *     id: string, title: string, fit?: string, sleepsLabel?: string, price?: string,
 *     thumb?: string, thumbAlt?: string,
 *     bookingTo?: { pathname: string, hash?: string },
 *     detailsTo?: { pathname: string, hash?: string },
 *     showDetailsLink?: boolean
 *   }>,
 *   labels: { checkAvailability: string, viewDetails: string },
 *   layout?: 'grid' | 'rows'
 * }} props
 */
export default function PaidTrafficStaySelector({ items = [], labels, layout = 'grid' }) {
  const navigate = useNavigate();
  const isRows = layout === 'rows';

  const listClass = isRows
    ? 'flex flex-col gap-2.5'
    : 'grid grid-cols-2 gap-3';

  return (
    <ul className={listClass} style={sans}>
      {items.map((item) => {
        const goToAvailability = () => {
          if (item.bookingTo?.pathname) navigate(item.bookingTo);
        };

        const tileClass = isRows
          ? 'flex flex-row items-stretch gap-3 rounded-xl border border-[rgba(0,0,0,0.1)] bg-white p-2.5'
          : 'flex flex-col rounded-xl border border-[rgba(0,0,0,0.1)] bg-white overflow-hidden';

        const imgWrapClass = isRows
          ? 'relative shrink-0 w-[104px] rounded-lg overflow-hidden bg-neutral-200 self-stretch'
          : 'relative w-full aspect-[4/3] bg-neutral-200';

        return (
          <li key={item.id} className={tileClass}>
            <div className={imgWrapClass}>
              {item.thumb ? (
                <img
                  src={item.thumb}
                  alt={item.thumbAlt || item.title}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
            </div>

            <div className={isRows ? 'flex min-w-0 flex-1 flex-col' : 'flex flex-1 flex-col p-3'}>
              <h3 className="text-[14px] font-semibold text-neutral-900 leading-tight tracking-tight">
                {item.title}
              </h3>
              {item.fit ? (
                <p className="mt-0.5 text-[12px] text-neutral-500 leading-snug line-clamp-2">
                  {item.fit}
                </p>
              ) : null}
              <p className="mt-1 text-[12px] text-neutral-600 leading-snug">
                {item.sleepsLabel ? <span>{item.sleepsLabel}</span> : null}
                {item.sleepsLabel && item.price ? <span aria-hidden> · </span> : null}
                {item.price ? <span className="font-semibold text-neutral-900">{item.price}</span> : null}
              </p>

              <div className="mt-auto pt-2.5">
                <button
                  type="button"
                  onClick={goToAvailability}
                  disabled={!item.bookingTo?.pathname}
                  className="w-full min-h-[40px] px-3 py-2 bg-[#1a1a1a] text-white text-[12px] font-semibold tracking-wide rounded-lg hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2 active:scale-[0.99] transition-all touch-manipulation disabled:opacity-50"
                >
                  {labels.checkAvailability}
                </button>
                {item.showDetailsLink && item.detailsTo?.pathname ? (
                  <Link
                    to={item.detailsTo}
                    className="mt-1.5 inline-block text-[11px] text-neutral-500 underline underline-offset-4 hover:text-neutral-800"
                  >
                    {labels.viewDetails}
                  </Link>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
