import { useEffect, useState } from 'react';
import { formatMoney } from './OpsCleaningLineItemsTable';

function coerceDraftValue(field, raw) {
  if (field.type === 'boolean') return Boolean(raw);
  if (field.type === 'quantity') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }
  return raw;
}

export default function OpsCleaningDayInputsForm({
  editableInputFields = [],
  inputs = {},
  canEditInputs = false,
  currency = 'EUR',
  saving = false,
  error = '',
  onSave
}) {
  const [draft, setDraft] = useState({});

  useEffect(() => {
    const next = {};
    editableInputFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(inputs, field.inputKey)) {
        next[field.inputKey] = inputs[field.inputKey];
      } else if (field.type === 'boolean') {
        next[field.inputKey] = false;
      } else if (field.type === 'quantity') {
        next[field.inputKey] = 0;
      }
    });
    setDraft(next);
  }, [editableInputFields, inputs]);

  if (!editableInputFields.length) {
    return (
      <p className="mt-4 text-sm text-gray-500">
        No selectable cleaning tasks configured for this location. Run the pricing policy seed or use legacy
        mode.
      </p>
    );
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canEditInputs || saving) return;
    onSave(draft);
  };

  return (
    <form className="mt-4" onSubmit={handleSubmit} data-testid="cleaning-day-inputs-form">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Cleaning tasks</p>
      <div className="mt-2 space-y-3">
        {editableInputFields.map((field) => {
          const priceHint =
            field.type === 'boolean' && typeof field.amountEUR === 'number'
              ? formatMoney(field.amountEUR, currency)
              : field.type === 'quantity' && typeof field.unitAmountEUR === 'number'
                ? `${formatMoney(field.unitAmountEUR, currency)} each`
                : null;

          if (field.type === 'boolean') {
            return (
              <label
                key={field.inputKey}
                className={`flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 ${
                  canEditInputs ? 'cursor-pointer' : 'opacity-80'
                }`}
              >
                <input
                  type="checkbox"
                  checked={Boolean(draft[field.inputKey])}
                  disabled={!canEditInputs || saving}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, [field.inputKey]: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  data-testid={`input-${field.inputKey}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">{field.label}</span>
                  {priceHint ? <span className="text-xs text-gray-500">{priceHint}</span> : null}
                </span>
              </label>
            );
          }

          return (
            <label key={field.inputKey} className="block rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <span className="block text-sm font-medium text-gray-900">{field.label}</span>
              {priceHint ? <span className="text-xs text-gray-500">{priceHint}</span> : null}
              <input
                type="number"
                min="0"
                step="1"
                value={draft[field.inputKey] ?? 0}
                disabled={!canEditInputs || saving}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    [field.inputKey]: coerceDraftValue(field, e.target.value)
                  }))
                }
                className="mt-2 w-full max-w-[8rem] rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
                data-testid={`input-${field.inputKey}`}
              />
            </label>
          );
        })}
      </div>
      {canEditInputs ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#81887A] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            data-testid="save-day-inputs"
          >
            {saving ? 'Saving…' : 'Save tasks'}
          </button>
          {error ? <span className="text-xs text-red-600">{error}</span> : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-500">Tasks are locked for this day.</p>
      )}
    </form>
  );
}
