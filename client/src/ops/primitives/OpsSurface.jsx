import { opsCx } from './opsCx';

/**
 * Canonical Ops content section.
 *
 * The primitive owns product-wide surface chrome and hierarchy. Feature classes
 * may add domain layout, but must not recreate borders, backgrounds, radii, or
 * heading typography.
 */
export default function OpsSurface({
  as: Component = 'section',
  variant = 'default',
  className,
  children,
  ...rest
}) {
  return (
    <Component
      className={opsCx('ops-surface', variant !== 'default' && `ops-surface--${variant}`, className)}
      {...rest}
    >
      {children}
    </Component>
  );
}

export function OpsSurfaceHeader({ as: Component = 'div', className, children, ...rest }) {
  return (
    <Component className={opsCx('ops-surface__header', className)} {...rest}>
      {children}
    </Component>
  );
}

export function OpsSurfaceTitle({ as: Component = 'h2', className, children, ...rest }) {
  return (
    <Component className={opsCx('ops-surface__title', className)} {...rest}>
      {children}
    </Component>
  );
}

export function OpsSurfaceDescription({ as: Component = 'p', className, children, ...rest }) {
  return (
    <Component className={opsCx('ops-surface__description', className)} {...rest}>
      {children}
    </Component>
  );
}
