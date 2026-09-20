import { useId } from 'react';
import { opsCx } from './opsCx';
import OpsInlineError from './OpsInlineError';

function OpsSelectChevron() {
  return (
    <svg
      className="ops-select-chevron"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
    >
      <path
        d="M4.5 6.25L8 9.75l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
      <div className="ops-select-wrap">
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
        <OpsSelectChevron />
      </div>
      {hint ? (
        <p id={hintId} className="ops-field-hint">
          {hint}
        </p>
      ) : null}
      {error ? <OpsInlineError id={errorId}>{error}</OpsInlineError> : null}
    </div>
  );
}
