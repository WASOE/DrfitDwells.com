import { Link, useNavigate } from 'react-router-dom';

const sans = { fontFamily: 'var(--valley-font-primary, Montserrat, system-ui, sans-serif)' };

/**
 * Visual "pick your stay" selector — single-column compact rows.
 * `layout="rows"` (desktop) aligns the CTA in a fixed third column across all rows;
 * `layout="stack"` (mobile) puts a full-width CTA under each row for consistent rhythm.
 * Navigation uses each item's pre-built `bookingTo` / `detailsTo` (from `stay.route`),
 * never listingSlug.
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
 *   layout?: 'stack' | 'rows'
 * }} props
 */
export default function PaidTrafficStaySelector({ items = [], labels, layout = 'stack' }) {
  const navigate = useNavigate();
  const isRows = layout === 'rows';

  const thumbClass = isRows
    ? 'relative shrink-0 w-32 h-24 rounded-lg overflow-hidden bg-neutral-200'
    : 'relative shrink-0 w-24 h-24 rounded-lg overflow-hidden bg-neutral-200';

  const meta = (item) => (
    <>
      <h3 className="text-[15px] font-semibold text-neutral-900 leading-tight tracking-tight truncate">
        {item.title}
      </h3>
      {item.fit ? (
        <p className="mt-0.5 text-[12px] text-neutral-500 leading-snug truncate">{item.fit}</p>
      ) : null}
      <p className="mt-1 text-[13px] text-neutral-600 leading-snug">
        {item.sleepsLabel ? <span>{item.sleepsLabel}</span> : null}
        {item.sleepsLabel && item.price ? <span aria-hidden> · </span> : null}
        {item.price ? <span className="font-semibold text-neutral-900">{item.price}</span> : null}
      </p>
    </>
  );

  const cta = (item, goToAvailability, block) => (
    <>
      <button
        type="button"
        onClick={goToAvailability}
        disabled={!item.bookingTo?.pathname}
        className={`${block ? 'w-full' : ''} min-h-[40px] px-4 py-2 bg-[#1a1a1a] text-white text-[12px] font-semibold tracking-wide rounded-lg hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2 active:scale-[0.99] transition-all touch-manipulation disabled:opacity-50 whitespace-nowrap`}
      >
        {labels.checkAvailability}
      </button>
      {item.showDetailsLink && item.detailsTo?.pathname ? (
        <Link
          to={item.detailsTo}
          className={`${block ? 'mt-2 inline-block' : 'mt-1.5 block text-center'} text-[11px] text-neutral-500 underline underline-offset-4 hover:text-neutral-800`}
        >
          {labels.viewDetails}
        </Link>
      ) : null}
    </>
  );

  return (
    <ul className="flex flex-col gap-3" style={sans}>
      {items.map((item) => {
        const goToAvailability = () => {
          if (item.bookingTo?.pathname) navigate(item.bookingTo);
        };

        if (isRows) {
          return (
            <li key={item.id} className="rounded-xl border border-[rgba(0,0,0,0.1)] bg-white p-3">
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
                <div className={thumbClass}>
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
                <div className="min-w-0">{meta(item)}</div>
                <div className="shrink-0 flex flex-col items-end text-right">
                  {cta(item, goToAvailability, false)}
                </div>
              </div>
            </li>
          );
        }

        return (
          <li key={item.id} className="rounded-xl border border-[rgba(0,0,0,0.1)] bg-white p-3">
            <div className="flex items-start gap-3">
              <div className={thumbClass}>
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
              <div className="min-w-0 flex-1">{meta(item)}</div>
            </div>
            <div className="mt-3">{cta(item, goToAvailability, true)}</div>
          </li>
        );
      })}
    </ul>
  );
}
