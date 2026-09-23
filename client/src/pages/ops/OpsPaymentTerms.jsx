import { useCallback, useEffect, useState } from 'react';
import { paymentTermAdminAPI } from '../../services/api';

const EMPTY_LEG = {
  sequence: 1,
  amountType: 'remainder',
  amountValue: null,
  dueRule: 'checkout',
  dueOffsetDays: 0,
  cancellationTreatment: 'standard_policy'
};

const AMOUNT_TYPES = ['percent_bps', 'fixed_cents', 'remainder'];
const DUE_RULES = ['checkout', 'days_before_arrival', 'days_after_booking'];
const CANCELLATION_TREATMENTS = ['standard_policy', 'stay_credit', 'forfeit'];

function emptyForm() {
  return {
    code: '',
    internalName: '',
    version: 1,
    scheduleKind: 'percent_split',
    currency: 'EUR',
    allowDateTransfer: false,
    legs: [
      {
        sequence: 1,
        amountType: 'percent_bps',
        amountValue: 3000,
        dueRule: 'checkout',
        dueOffsetDays: 0,
        cancellationTreatment: 'stay_credit'
      },
      {
        sequence: 2,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 30,
        cancellationTreatment: 'standard_policy'
      }
    ]
  };
}

function safeError(e, fallback) {
  return e?.response?.data?.error?.message || e?.message || fallback;
}

export default function OpsPaymentTerms() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await paymentTermAdminAPI.list();
      setRows(res.data?.data?.paymentTerms || []);
    } catch (e) {
      setBanner(safeError(e, 'Failed to load payment terms'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createDraft() {
    setBusy(true);
    try {
      await paymentTermAdminAPI.create(form);
      setBanner('Draft created');
      setForm(emptyForm());
      await load();
    } catch (e) {
      setBanner(safeError(e, 'Create failed'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!selected || selected.status !== 'draft') return;
    setBusy(true);
    try {
      await paymentTermAdminAPI.update(selected.id, {
        ...form,
        expectedRevision: selected.revision
      });
      setBanner('Draft updated');
      await load();
    } catch (e) {
      setBanner(safeError(e, 'Update failed'));
    } finally {
      setBusy(false);
    }
  }

  async function activate(row) {
    setBusy(true);
    try {
      await paymentTermAdminAPI.activate(row.id, { expectedRevision: row.revision });
      setBanner(`Activated ${row.code}@v${row.version}`);
      await load();
    } catch (e) {
      setBanner(safeError(e, 'Activate failed'));
    } finally {
      setBusy(false);
    }
  }

  async function retire(row) {
    setBusy(true);
    try {
      await paymentTermAdminAPI.retire(row.id, { expectedRevision: row.revision });
      setBanner(`Retired ${row.code}@v${row.version}`);
      await load();
    } catch (e) {
      setBanner(safeError(e, 'Retire failed'));
    } finally {
      setBusy(false);
    }
  }

  async function clone(row) {
    setBusy(true);
    try {
      const res = await paymentTermAdminAPI.clone(row.id);
      setBanner(`Cloned as v${res.data?.data?.paymentTerm?.version}`);
      await load();
    } catch (e) {
      setBanner(safeError(e, 'Clone failed'));
    } finally {
      setBusy(false);
    }
  }

  function selectRow(row) {
    setSelected(row);
    setForm({
      code: row.code,
      internalName: row.internalName,
      version: row.version,
      scheduleKind: row.scheduleKind,
      currency: row.currency || 'EUR',
      allowDateTransfer: row.allowDateTransfer === true,
      legs: row.legs || [EMPTY_LEG]
    });
  }

  function updateLeg(index, field, value) {
    setForm((current) => ({
      ...current,
      legs: current.legs.map((leg, legIndex) => {
        if (legIndex !== index) return leg;
        if (field === 'amountType') {
          return {
            ...leg,
            amountType: value,
            amountValue: value === 'remainder' ? null : leg.amountValue ?? 1
          };
        }
        return { ...leg, [field]: value };
      })
    }));
  }

  const editable = selected?.status === 'draft';

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 md:py-12" data-testid="ops-payment-terms">
      <h1 className="text-2xl md:text-3xl font-semibold mb-2">Payment terms</h1>
      <p className="text-sm text-gray-600 mb-6 max-w-2xl">
        Versioned schedule definitions for split payment. Active and retired versions are immutable;
        commercial changes require a new version. Attach an active exact version on a Rate Plan.
      </p>
      {banner ? <p className="mb-4 text-sm">{banner}</p> : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <h2 className="text-lg font-medium mb-3">Versions</h2>
          {loading ? (
            <p>Loading…</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="border border-gray-200 rounded-md p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                >
                  <button type="button" className="text-left" onClick={() => selectRow(row)}>
                    <div className="font-medium">
                      {row.code}@v{row.version}{' '}
                      <span className="text-xs uppercase tracking-wide text-gray-500">{row.status}</span>
                    </div>
                    <div className="text-sm text-gray-600">{row.internalName}</div>
                    <div className="text-xs text-gray-500">
                      {row.scheduleKind} · date transfer {row.allowDateTransfer ? 'yes' : 'no'}
                    </div>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    {row.status === 'draft' ? (
                      <button type="button" disabled={busy} onClick={() => activate(row)}>
                        Activate
                      </button>
                    ) : null}
                    {row.status === 'active' ? (
                      <button type="button" disabled={busy} onClick={() => retire(row)}>
                        Retire
                      </button>
                    ) : null}
                    <button type="button" disabled={busy} onClick={() => clone(row)}>
                      Clone
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border border-gray-200 rounded-md p-4 md:p-6">
          <h2 className="text-lg font-medium mb-3">{selected ? 'Edit selected' : 'Create draft'}</h2>
          <div className="space-y-3 max-w-xl">
            <label className="block text-sm">
              Code
              <input
                className="mt-1 w-full border rounded px-2 py-1"
                value={form.code}
                disabled={Boolean(selected)}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              Internal name
              <input
                className="mt-1 w-full border rounded px-2 py-1"
                value={form.internalName}
                disabled={selected && !editable}
                onChange={(e) => setForm((f) => ({ ...f, internalName: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              Version
              <input
                type="number"
                className="mt-1 w-full border rounded px-2 py-1"
                value={form.version}
                disabled={Boolean(selected)}
                onChange={(e) => setForm((f) => ({ ...f, version: Number(e.target.value) }))}
              />
            </label>
            <label className="block text-sm">
              Schedule kind
              <select
                className="mt-1 w-full border rounded px-2 py-1"
                value={form.scheduleKind}
                disabled={selected && !editable}
                onChange={(e) => setForm((f) => ({ ...f, scheduleKind: e.target.value }))}
              >
                <option value="full">full</option>
                <option value="percent_split">percent_split</option>
                <option value="fixed_deposit">fixed_deposit</option>
                <option value="installment_plan">installment_plan</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allowDateTransfer}
                disabled={selected && !editable}
                onChange={(e) => setForm((f) => ({ ...f, allowDateTransfer: e.target.checked }))}
              />
              Allow one date transfer
            </label>
            <div className="text-sm">
              <div className="font-medium mb-1">Legs</div>
              {(form.legs || []).map((leg, idx) => (
                <div key={idx} className="border rounded p-3 mb-2 text-xs space-y-3">
                  {editable || !selected ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label>
                        Leg {idx + 1} sequence
                        <input
                          type="number"
                          min="1"
                          step="1"
                          className="mt-1 w-full border rounded px-2 py-1"
                          value={leg.sequence}
                          onChange={(e) => updateLeg(idx, 'sequence', Number(e.target.value))}
                        />
                      </label>
                      <label>
                        Leg {idx + 1} amount type
                        <select
                          className="mt-1 w-full border rounded px-2 py-1"
                          value={leg.amountType}
                          onChange={(e) => updateLeg(idx, 'amountType', e.target.value)}
                        >
                          {AMOUNT_TYPES.map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      {leg.amountType !== 'remainder' ? (
                        <label>
                          Leg {idx + 1} amount value
                          <input
                            type="number"
                            min="1"
                            step="1"
                            className="mt-1 w-full border rounded px-2 py-1"
                            value={leg.amountValue ?? ''}
                            onChange={(e) => updateLeg(idx, 'amountValue', Number(e.target.value))}
                          />
                        </label>
                      ) : null}
                      <label>
                        Leg {idx + 1} due rule
                        <select
                          className="mt-1 w-full border rounded px-2 py-1"
                          value={leg.dueRule}
                          onChange={(e) => updateLeg(idx, 'dueRule', e.target.value)}
                        >
                          {DUE_RULES.map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Leg {idx + 1} due offset days
                        <input
                          type="number"
                          min="0"
                          step="1"
                          className="mt-1 w-full border rounded px-2 py-1"
                          value={leg.dueOffsetDays}
                          onChange={(e) => updateLeg(idx, 'dueOffsetDays', Number(e.target.value))}
                        />
                      </label>
                      <label>
                        Leg {idx + 1} cancellation treatment
                        <select
                          className="mt-1 w-full border rounded px-2 py-1"
                          value={leg.cancellationTreatment}
                          onChange={(e) => updateLeg(idx, 'cancellationTreatment', e.target.value)}
                        >
                          {CANCELLATION_TREATMENTS.map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <div>
                      #{leg.sequence} · {leg.amountType} {leg.amountValue ?? '—'} · {leg.dueRule} +
                      {leg.dueOffsetDays}d · {leg.cancellationTreatment}
                    </div>
                  )}
                </div>
              ))}
              <p className="text-gray-500">
                Leg editor keeps commercial fields only (no Stripe details). Use clone for structural
                changes on active terms.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {!selected ? (
                <button type="button" disabled={busy} onClick={createDraft}>
                  Create draft
                </button>
              ) : editable ? (
                <button type="button" disabled={busy} onClick={saveDraft}>
                  Save draft
                </button>
              ) : (
                <p className="text-sm text-gray-500">Active/retired templates cannot be edited in place.</p>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setForm(emptyForm());
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
