import { opsCx } from './opsCx';

/**
 * Canonical record container for non-tabular operational collections.
 *
 * Feature classes own record layout. This primitive owns the responsive
 * mobile-card / desktop-divider presentation so collection pages do not
 * recreate chrome independently.
 */
export default function OpsRecord({
  as: Component = 'article',
  density = 'default',
  className,
  children,
  ...rest
}) {
  return (
    <Component
      className={opsCx('ops-record', density === 'roomy' && 'ops-record--roomy', className)}
      {...rest}
    >
      {children}
    </Component>
  );
}
