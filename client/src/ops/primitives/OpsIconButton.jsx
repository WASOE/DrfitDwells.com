import { forwardRef } from 'react';
import { opsCx } from './opsCx';

const OpsIconButton = forwardRef(function OpsIconButton(
  { label, type = 'button', disabled = false, onClick, className, children, ...rest },
  ref
) {
  if (!label) {
    throw new Error('OpsIconButton requires a label');
  }

  return (
    <button
      ref={ref}
      type={type}
      className={opsCx('ops-icon-button', className)}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
});

export default OpsIconButton;
