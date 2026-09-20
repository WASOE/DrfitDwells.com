import { useId } from 'react';
import { opsCx } from './opsCx';
import OpsInlineError from './OpsInlineError';

export default function OpsCheckbox({
  id,
  label,
  hint,
  error,
  disabled = false,
  className,
  ...rest
}) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={opsCx('ops-checkbox-field', className)}>
      <label className="ops-checkbox-hit" htmlFor={fieldId}>
        <input
          id={fieldId}
          type="checkbox"
          className="ops-checkbox"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        <span>{label}</span>
      </label>
      {hint ? (
        <p id={hintId} className="ops-field-hint">
          {hint}
        </p>
      ) : null}
      {error ? <OpsInlineError id={errorId}>{error}</OpsInlineError> : null}
    </div>
  );
}
