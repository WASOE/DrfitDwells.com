import { forwardRef } from 'react';
import { opsCx } from './opsCx';

const VARIANTS = {
  primary: 'ops-button--primary',
  secondary: 'ops-button--secondary',
  quiet: 'ops-button--quiet',
  destructive: 'ops-button--destructive'
};

const SIZES = {
  default: null,
  compact: 'ops-button--compact'
};

const OpsButton = forwardRef(function OpsButton(
  {
    variant = 'primary',
    size = 'default',
    type = 'button',
    disabled = false,
    loading = false,
    loadingLabel = 'Saving…',
    onClick,
    className,
    children,
    ...rest
  },
  ref
) {
  const busy = Boolean(loading);
  const isDisabled = disabled || busy;
  const variantClass = VARIANTS[variant] || VARIANTS.primary;
  const sizeClass = SIZES[size] || null;

  function handleClick(event) {
    if (isDisabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      ref={ref}
      type={type}
      className={opsCx('ops-button', variantClass, sizeClass, className)}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      onClick={handleClick}
      {...rest}
    >
      {busy ? loadingLabel : children}
    </button>
  );
});

export default OpsButton;
export const OPS_BUTTON_VARIANTS = Object.keys(VARIANTS);
export const OPS_BUTTON_SIZES = Object.keys(SIZES);
