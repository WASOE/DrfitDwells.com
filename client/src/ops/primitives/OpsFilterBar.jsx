import { opsCx } from './opsCx';

/**
 * Layout-only filter chrome. No URL, fetch, enum, or reset knowledge.
 */
export default function OpsFilterBar({ as: Component = 'div', children, footer, className, ...rest }) {
  return (
    <Component className={opsCx('ops-filter-bar', className)} data-ops-filter-bar="" {...rest}>
      <div className="ops-filter-bar__controls">{children}</div>
      {footer ? <div className="ops-filter-bar__footer">{footer}</div> : null}
    </Component>
  );
}
