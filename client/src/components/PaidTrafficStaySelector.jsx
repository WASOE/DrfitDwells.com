import { Link, useNavigate } from 'react-router-dom';

const sans = { fontFamily: 'var(--valley-font-primary, Montserrat, system-ui, sans-serif)' };

/**
 * @param {{
 *   id: string,
 *   title: string,
 *   fit?: string,
 *   sleepsLabel?: string,
 *   price?: string,
 *   thumb?: string,
 *   thumbAlt?: string,
 *   bookingTo?: { pathname: string, hash?: string },
 *   detailsTo?: { pathname: string, hash?: string },
 *   showDetailsLink?: boolean,
 *   promoted?: boolean
 * }} item
 * @param {{ checkAvailability: string, viewDetails: string }} labels
 * @param {(item: object) => void} goToAvailability
 * @param {boolean} block
 */
function defaultCta(item, labels, goToAvailability, block) {
  return (
    <>
      <button
        type="button"
        onClick={() => goToAvailability(item)}
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
}

/**
 * @param {object} item
 */
function defaultMeta(item) {
  return (
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
}

/**
 * Default off-grid landing selector — unchanged markup/classes from Phase 2 baseline.
 */
function DefaultPaidTrafficStaySelector({ items = [], labels, layout = 'stack' }) {
  const navigate = useNavigate();
  const isRows = layout === 'rows';

  const thumbClass = isRows
    ? 'relative shrink-0 w-32 h-24 rounded-lg overflow-hidden bg-neutral-200'
    : 'relative shrink-0 w-24 h-24 rounded-lg overflow-hidden bg-neutral-200';

  const goToAvailability = (item) => {
    if (item.bookingTo?.pathname) navigate(item.bookingTo);
  };

  return (
    <ul className="flex flex-col gap-3" style={sans}>
      {items.map((item) => {
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
                <div className="min-w-0">{defaultMeta(item)}</div>
                <div className="shrink-0 flex flex-col items-end text-right">
                  {defaultCta(item, labels, goToAvailability, false)}
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
              <div className="min-w-0 flex-1">{defaultMeta(item)}</div>
            </div>
            <div className="mt-3">{defaultCta(item, labels, goToAvailability, true)}</div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * @param {object} item
 */
function embeddedMeta(item) {
  return (
    <>
      <h3 className="text-[14px] font-semibold text-neutral-900 leading-tight tracking-tight truncate">
        {item.title}
      </h3>
      {item.fit ? (
        <p className="mt-0.5 text-[11px] text-neutral-500 leading-snug truncate">{item.fit}</p>
      ) : null}
      {item.sleepsLabel || item.price ? (
        <p className="mt-1 text-[12px] text-neutral-600 leading-snug">
          {item.sleepsLabel ? <span>{item.sleepsLabel}</span> : null}
          {item.sleepsLabel && item.price ? <span aria-hidden> · </span> : null}
          {item.price ? <span className="font-semibold text-neutral-900">{item.price}</span> : null}
        </p>
      ) : null}
    </>
  );
}

/**
 * Embedded hero-card selector — stack layout, no per-row chrome, promoted buyout row.
 */
function EmbeddedPaidTrafficStaySelector({ items = [], labels }) {
  const navigate = useNavigate();

  const goToAvailability = (item) => {
    if (item.bookingTo?.pathname) navigate(item.bookingTo);
  };

  return (
    <ul className="paid-traffic-stay-selector--embedded flex flex-col gap-2" style={sans}>
      {items.map((item) => {
        if (item.promoted) {
          const target = item.bookingTo;
          const content = (
            <>
              <h3 className="text-[14px] font-semibold text-neutral-900 leading-tight tracking-tight">
                {item.title}
              </h3>
              {item.price ? (
                <p className="mt-1 text-[12px] font-semibold text-neutral-800 leading-snug">
                  {item.price}
                </p>
              ) : null}
            </>
          );

          return (
            <li
              key={item.id}
              className="paid-traffic-stay-selector__promoted mt-1 border-t border-[rgba(0,0,0,0.08)] pt-3"
            >
              {target?.pathname ? (
                <Link
                  to={target}
                  className="block w-full rounded-lg bg-[#f7f6f3] px-3 py-3 text-left transition-colors hover:bg-[#f0efe9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2"
                >
                  {content}
                </Link>
              ) : (
                <div className="block w-full rounded-lg bg-[#f7f6f3] px-3 py-3">{content}</div>
              )}
            </li>
          );
        }

        return (
          <li key={item.id} className="py-1.5 first:pt-0">
            <div className="flex items-start gap-2.5">
              <div className="relative shrink-0 w-14 h-14 rounded-md overflow-hidden bg-neutral-200">
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
              <div className="min-w-0 flex-1">{embeddedMeta(item)}</div>
            </div>
            <div className="mt-2">
              {defaultCta(item, labels, goToAvailability, true)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Visual "pick your stay" selector — single-column compact rows.
 * `layout="rows"` (desktop) aligns the CTA in a fixed third column across all rows;
 * `layout="stack"` (mobile) puts a full-width CTA under each row for consistent rhythm.
 * `variant="embedded"` is for the /valley hero card: tighter stack rows, no row chrome,
 * and optional `promoted` buyout row (whole row navigates).
 *
 * @param {{
 *   items: Array<{
 *     id: string, title: string, fit?: string, sleepsLabel?: string, price?: string,
 *     thumb?: string, thumbAlt?: string,
 *     bookingTo?: { pathname: string, hash?: string },
 *     detailsTo?: { pathname: string, hash?: string },
 *     showDetailsLink?: boolean,
 *     promoted?: boolean
 *   }>,
 *   labels: { checkAvailability: string, viewDetails: string },
 *   layout?: 'stack' | 'rows',
 *   variant?: 'default' | 'embedded'
 * }} props
 */
export default function PaidTrafficStaySelector({
  items = [],
  labels,
  layout = 'stack',
  variant = 'default'
}) {
  if (variant === 'embedded') {
    return <EmbeddedPaidTrafficStaySelector items={items} labels={labels} />;
  }

  return <DefaultPaidTrafficStaySelector items={items} labels={labels} layout={layout} />;
}
