import { useId } from 'react';
import { opsCx } from './opsCx';
import OpsInlineError from './OpsInlineError';

export default function OpsSelect({
  id,
  label,
  hint,
  error,
  optional = false,
  disabled = false,
  className,
  children,
  ...rest
}) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={opsCx('ops-field', className)}>
      <label className="ops-field-label" htmlFor={fieldId}>
        {label}
        {optional ? <span className="ops-field-optional">Optional</span> : null}
      </label>
      <select
        id={fieldId}
        className="ops-select"
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      >
        {children}
      </select>
      {hint ? (
        <p id={hintId} className="ops-field-hint">
          {hint}
        </p>
      ) : null}
      {error ? <OpsInlineError id={errorId}>{error}</OpsInlineError> : null}
    </div>
  );
}
