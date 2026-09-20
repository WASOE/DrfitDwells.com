import { opsCx } from './opsCx';

/**
 * Layout-only filter chrome. No URL, fetch, enum, or reset knowledge.
 */
export default function OpsFilterBar({ children, footer, className, ...rest }) {
  return (
    <div className={opsCx('ops-filter-bar', className)} data-ops-filter-bar="" {...rest}>
      <div className="ops-filter-bar__controls">{children}</div>
      {footer ? <div className="ops-filter-bar__footer">{footer}</div> : null}
    </div>
  );
}
