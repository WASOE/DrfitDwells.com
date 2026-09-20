import OpsButton from './OpsButton';
import { opsCx } from './opsCx';

/**
 * Thin prev / page / next control. No URL, fetch, or data-source knowledge.
 */
export default function OpsPagination({
  page,
  totalPages,
  onPageChange,
  disabled = false,
  loading = false,
  className,
  ...rest
}) {
  const current = Math.max(1, Number(page) || 1);
  const last = Math.max(1, Number(totalPages) || 1);
  const busy = Boolean(disabled || loading);
  const prevDisabled = busy || current <= 1;
  const nextDisabled = busy || current >= last;

  function goTo(nextPage) {
    if (busy || typeof onPageChange !== 'function') return;
    if (nextPage < 1 || nextPage > last || nextPage === current) return;
    onPageChange(nextPage);
  }

  return (
    <nav
      className={opsCx('ops-pagination', className)}
      aria-label="Pagination"
      aria-busy={busy || undefined}
      {...rest}
    >
      <OpsButton variant="secondary" disabled={prevDisabled} onClick={() => goTo(current - 1)}>
        Previous
      </OpsButton>
      <p className="ops-pagination__status">
        Page {current} of {last}
      </p>
      <OpsButton variant="secondary" disabled={nextDisabled} onClick={() => goTo(current + 1)}>
        Next
      </OpsButton>
    </nav>
  );
}
