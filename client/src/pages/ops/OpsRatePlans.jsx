import { useCallback, useEffect, useMemo, useState } from 'react';
import { ratePlanAdminAPI } from '../../services/api';
import {
  createEmptyForm,
  planToForm,
  buildCreatePayload,
  buildUpdatePayload,
  buildRevisionOnlyPayload,
  assertNoForbiddenKeys,
  safeErrorMessage,
  describeActivationResult,
  statusBadgeClass,
  formatWindow,
  emptyAccommodation,
  RATE_PLAN_TYPES,
  PRICING_METHODS,
  ENTITY_TYPES,
  isDraftEditable
} from './ratePlans/ratePlanFormUtils';

function LifecycleMeta({ plan }) {
  if (!plan) return null;
  const bits = [];
  if (plan.updatedBy) bits.push(`Updated by ${plan.updatedBy}`);
  if (plan.updatedAt) bits.push(String(plan.updatedAt).slice(0, 19).replace('T', ' '));
  if (plan.activatedBy) bits.push(`Activated by ${plan.activatedBy}`);
  if (plan.activatedAt) bits.push(String(plan.activatedAt).slice(0, 19).replace('T', ' '));
  if (plan.retiredBy) bits.push(`Retired by ${plan.retiredBy}`);
  if (plan.retiredAt) bits.push(String(plan.retiredAt).slice(0, 19).replace('T', ' '));
  if (!bits.length) return <span className="text-gray-400">—</span>;
  return <span className="text-xs text-gray-500">{bits.join(' · ')}</span>;
}

export default function OpsRatePlans() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState({ type: '', message: '' });
  const [filters, setFilters] = useState({ status: '', type: '', code: '' });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState('create'); // create | edit | view
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(() => createEmptyForm('seasonal_stay'));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { action: 'activate'|'retire', plan }

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.type) params.type = filters.type;
      if (filters.code.trim()) params.code = filters.code.trim().toLowerCase();
      const res = await ratePlanAdminAPI.list(params);
      setRows(res.data?.data?.ratePlans || []);
    } catch (e) {
      setBanner({ type: 'error', message: safeErrorMessage(e, 'Failed to load rate plans') });
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.type, filters.code]);

  useEffect(() => {
    load();
  }, [load]);

  const readOnly = mode === 'view' || (mode === 'edit' && selected && !isDraftEditable(selected));

  function openCreate(type = 'seasonal_stay') {
    setMode('create');
    setSelected(null);
    setForm(createEmptyForm(type));
    setBanner({ type: '', message: '' });
    setDrawerOpen(true);
  }

  function openPlan(plan, forceView = false) {
    setSelected(plan);
    setForm(planToForm(plan));
    setMode(forceView || !isDraftEditable(plan) ? 'view' : 'edit');
    setBanner({ type: '', message: '' });
    setDrawerOpen(true);
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateAccommodation(index, key, value) {
    setForm((prev) => {
      const accommodations = prev.accommodations.map((row, i) =>
        i === index ? { ...row, [key]: value } : row
      );
      return { ...prev, accommodations };
    });
  }

  function addAccommodation() {
    setForm((prev) => ({
      ...prev,
      accommodations: [...prev.accommodations, emptyAccommodation(prev.type)]
    }));
  }

  function removeAccommodation(index) {
    setForm((prev) => ({
      ...prev,
      accommodations: prev.accommodations.filter((_, i) => i !== index)
    }));
  }

  function onTypeChange(nextType) {
    setForm((prev) => {
      const next = createEmptyForm(nextType);
      return {
        ...next,
        code: prev.code,
        internalName: prev.internalName,
        version: prev.version,
        cancellationPolicyCode: prev.cancellationPolicyCode,
        cancellationPolicyVersion: prev.cancellationPolicyVersion,
        paymentTermCode: prev.paymentTermCode,
        paymentTermVersion: prev.paymentTermVersion,
        inclusionsText: prev.inclusionsText,
        requiresFullPayment: prev.requiresFullPayment
      };
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    if (busy || readOnly) return;
    setBusy(true);
    setBanner({ type: '', message: '' });
    try {
      if (mode === 'create') {
        const payload = buildCreatePayload(form);
        assertNoForbiddenKeys(payload);
        await ratePlanAdminAPI.create(payload);
        setBanner({ type: 'success', message: 'Draft rate plan created.' });
        setDrawerOpen(false);
      } else if (mode === 'edit' && selected) {
        const revision = selected.revision;
        const payload = buildUpdatePayload(form, revision);
        assertNoForbiddenKeys(payload);
        await ratePlanAdminAPI.update(selected.id, payload);
        setBanner({ type: 'success', message: 'Draft updated.' });
        setDrawerOpen(false);
      }
      await load();
    } catch (err) {
      // Keep form open with unsaved data
      setBanner({ type: 'error', message: safeErrorMessage(err, 'Save failed') });
    } finally {
      setBusy(false);
    }
  }

  async function handleClone(plan) {
    if (busy) return;
    setBusy(true);
    setBanner({ type: '', message: '' });
    try {
      const res = await ratePlanAdminAPI.clone(plan.id);
      const draft = res.data?.data?.ratePlan;
      await load();
      if (draft) openPlan(draft, false);
      setBanner({ type: 'success', message: 'Cloned as next draft version.' });
    } catch (err) {
      setBanner({ type: 'error', message: safeErrorMessage(err, 'Clone failed') });
    } finally {
      setBusy(false);
    }
  }

  async function runLifecycle(action, plan) {
    if (busy) return;
    setBusy(true);
    setBanner({ type: '', message: '' });
    setConfirm(null);
    try {
      const payload = buildRevisionOnlyPayload(plan.revision);
      assertNoForbiddenKeys(payload);
      if (action === 'activate') {
        const res = await ratePlanAdminAPI.activate(plan.id, payload);
        const data = res.data?.data || {};
        const desc = describeActivationResult(data);
        if (!desc.committed) {
          setBanner({ type: 'error', message: desc.successMessage });
        } else {
          setBanner({
            type: desc.hasCleanupWarning && !desc.lockReleased ? 'warning' : 'success',
            message: desc.successMessage
          });
        }
      } else {
        await ratePlanAdminAPI.retire(plan.id, payload);
        setBanner({ type: 'success', message: 'Rate plan retired.' });
      }
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setBanner({ type: 'error', message: safeErrorMessage(err, `${action} failed`) });
    } finally {
      setBusy(false);
    }
  }

  const seasonal = form.type === 'seasonal_stay';

  const filteredHint = useMemo(() => {
    const parts = [];
    if (filters.status) parts.push(filters.status);
    if (filters.type) parts.push(filters.type);
    if (filters.code.trim()) parts.push(`code:${filters.code.trim()}`);
    return parts.length ? `Filters: ${parts.join(', ')}` : null;
  }, [filters]);

  return (
    <div className="space-y-4 pb-20 sm:pb-0 max-w-7xl mx-auto px-4 py-6 md:py-8" data-testid="ops-rate-plans">
      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg md:text-xl font-semibold text-gray-900">Rate plans</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              Manage seasonal and fixed-package commercial rate plans. Production activation tooling
              remains blocked pending controlled lock recovery.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => openCreate('seasonal_stay')}
              className="px-3 py-2 text-sm rounded-lg bg-[#81887A] text-white hover:bg-[#707668] disabled:opacity-50"
            >
              New seasonal draft
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => openCreate('fixed_package')}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              New package draft
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-sm text-gray-600">
            Status
            <select
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="retired">Retired</option>
            </select>
          </label>
          <label className="text-sm text-gray-600">
            Type
            <select
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={filters.type}
              onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="">All</option>
              {RATE_PLAN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-600">
            Code
            <input
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={filters.code}
              onChange={(e) => setFilters((f) => ({ ...f, code: e.target.value }))}
              placeholder="e.g. winter-2026"
            />
          </label>
        </div>
        {filteredHint ? <p className="mt-2 text-xs text-gray-400">{filteredHint}</p> : null}
      </section>

      {banner.message ? (
        <div
          role="status"
          data-testid="rate-plans-banner"
          className={`text-sm rounded-xl border p-3 ${
            banner.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : banner.type === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {banner.message}
        </div>
      ) : null}

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 overflow-hidden">
        {loading ? (
          <div className="text-sm text-gray-500" data-testid="rate-plans-loading">
            Loading rate plans…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500 py-8 text-center" data-testid="rate-plans-empty">
            No rate plans match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 md:mx-0">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Code / version</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Window</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Pricing</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Rev</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Lifecycle</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((plan) => (
                  <tr key={plan.id} className="hover:bg-gray-50/80" data-testid={`rate-plan-row-${plan.id}`}>
                    <td className="px-4 py-3">
                      <div className="font-mono font-medium text-gray-900">
                        {plan.code}
                        <span className="text-gray-400">@v{plan.version}</span>
                      </div>
                      <div className="text-xs text-gray-500 truncate max-w-[12rem]">{plan.internalName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded border text-xs font-medium capitalize ${statusBadgeClass(
                          plan.status
                        )}`}
                      >
                        {plan.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{plan.type}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatWindow(plan)}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {(plan.accommodations || []).slice(0, 2).map((a) => (
                        <div key={`${a.accommodationKey}-${a.pricingMethod}`} className="text-xs">
                          {a.accommodationKey}: {a.pricingMethod}
                          {a.nightlyPerUnitAmount != null ? ` €${a.nightlyPerUnitAmount}` : ''}
                          {a.adultPackageAmount != null ? ` adult €${a.adultPackageAmount}` : ''}
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-900">{plan.revision}</td>
                    <td className="px-4 py-3 max-w-[14rem]">
                      <LifecycleMeta plan={plan} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        className="text-[#81887A] hover:underline"
                        onClick={() => openPlan(plan)}
                      >
                        {isDraftEditable(plan) ? 'Edit' : 'View'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="text-gray-700 hover:underline disabled:opacity-50"
                        onClick={() => handleClone(plan)}
                      >
                        Clone
                      </button>
                      {plan.status === 'draft' ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="text-emerald-700 hover:underline disabled:opacity-50"
                          onClick={() => setConfirm({ action: 'activate', plan })}
                        >
                          Activate
                        </button>
                      ) : null}
                      {plan.status === 'active' ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="text-amber-800 hover:underline disabled:opacity-50"
                          onClick={() => setConfirm({ action: 'retire', plan })}
                        >
                          Retire
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end" data-testid="rate-plan-drawer">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            aria-label="Close drawer"
            onClick={() => !busy && setDrawerOpen(false)}
          />
          <div className="relative w-full max-w-xl h-full bg-white shadow-xl overflow-y-auto p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {mode === 'create' ? 'Create draft' : mode === 'edit' ? 'Edit draft' : 'View plan'}
                </h3>
                {selected ? (
                  <p className="text-xs text-gray-500 mt-1">
                    Revision {selected.revision} · {selected.status}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="text-sm text-gray-500"
                disabled={busy}
                onClick={() => setDrawerOpen(false)}
              >
                Close
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleSave}>
              <fieldset disabled={readOnly || busy} className="space-y-4">
                {mode === 'create' ? (
                  <label className="block text-sm text-gray-700">
                    Type
                    <select
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.type}
                      onChange={(e) => onTypeChange(e.target.value)}
                    >
                      {RATE_PLAN_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="text-sm text-gray-600">
                    Type: <span className="font-medium text-gray-900">{form.type}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm text-gray-700">
                    Code
                    <input
                      required
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 font-mono"
                      value={form.code}
                      onChange={(e) => updateField('code', e.target.value)}
                      disabled={mode === 'edit'}
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Version
                    <input
                      required
                      type="number"
                      min={1}
                      step={1}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.version}
                      onChange={(e) => updateField('version', e.target.value)}
                      disabled={mode === 'edit'}
                    />
                  </label>
                </div>

                <label className="block text-sm text-gray-700">
                  Internal name
                  <input
                    required
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={form.internalName}
                    onChange={(e) => updateField('internalName', e.target.value)}
                  />
                </label>

                {seasonal ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block text-sm text-gray-700">
                      Arrival window start
                      <input
                        type="date"
                        required
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                        value={form.arrivalWindowStart}
                        onChange={(e) => updateField('arrivalWindowStart', e.target.value)}
                      />
                    </label>
                    <label className="block text-sm text-gray-700">
                      Arrival window end
                      <input
                        type="date"
                        required
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                        value={form.arrivalWindowEnd}
                        onChange={(e) => updateField('arrivalWindowEnd', e.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block text-sm text-gray-700">
                      Package arrival
                      <input
                        type="date"
                        required
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                        value={form.packageArrivalDate}
                        onChange={(e) => updateField('packageArrivalDate', e.target.value)}
                      />
                    </label>
                    <label className="block text-sm text-gray-700">
                      Package departure
                      <input
                        type="date"
                        required
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                        value={form.packageDepartureDate}
                        onChange={(e) => updateField('packageDepartureDate', e.target.value)}
                      />
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm text-gray-700">
                    Booking window start
                    <input
                      type="date"
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.bookingWindowStart}
                      onChange={(e) => updateField('bookingWindowStart', e.target.value)}
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Booking window end
                    <input
                      type="date"
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.bookingWindowEnd}
                      onChange={(e) => updateField('bookingWindowEnd', e.target.value)}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="block text-sm text-gray-700">
                    Min nights
                    <input
                      type="number"
                      min={1}
                      step={1}
                      required
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.minNights}
                      onChange={(e) => updateField('minNights', e.target.value)}
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Currency
                    <select
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.currency}
                      onChange={(e) => updateField('currency', e.target.value)}
                    >
                      <option value="EUR">EUR</option>
                    </select>
                  </label>
                  <label className="block text-sm text-gray-700">
                    Inventory
                    <select
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.inventoryMode}
                      onChange={(e) => updateField('inventoryMode', e.target.value)}
                    >
                      <option value="shared">shared</option>
                      <option value="exclusive">exclusive</option>
                    </select>
                  </label>
                </div>

                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.requiresFullPayment === true}
                    onChange={(e) => updateField('requiresFullPayment', e.target.checked)}
                  />
                  Requires full payment
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm text-gray-700">
                    Cancellation policy code
                    <input
                      required
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.cancellationPolicyCode}
                      onChange={(e) => updateField('cancellationPolicyCode', e.target.value)}
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Policy version
                    <input
                      type="number"
                      min={1}
                      step={1}
                      required
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.cancellationPolicyVersion}
                      onChange={(e) => updateField('cancellationPolicyVersion', e.target.value)}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm text-gray-700">
                    Payment term code (optional)
                    <input
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.paymentTermCode || ''}
                      onChange={(e) => updateField('paymentTermCode', e.target.value)}
                      placeholder="Leave empty for full payment only"
                      disabled={readOnly}
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Payment term version
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={form.paymentTermVersion || ''}
                      onChange={(e) => updateField('paymentTermVersion', e.target.value)}
                      disabled={readOnly}
                    />
                  </label>
                </div>

                <label className="block text-sm text-gray-700">
                  Inclusions (one per line)
                  <textarea
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 min-h-[72px]"
                    value={form.inclusionsText}
                    onChange={(e) => updateField('inclusionsText', e.target.value)}
                  />
                </label>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-900">Accommodations</h4>
                    {!readOnly ? (
                      <button
                        type="button"
                        className="text-sm text-[#81887A]"
                        onClick={addAccommodation}
                      >
                        Add row
                      </button>
                    ) : null}
                  </div>
                  {form.accommodations.map((row, index) => (
                    <div
                      key={`acc-${index}`}
                      className="border border-gray-200 rounded-lg p-3 space-y-2"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="block text-xs text-gray-600">
                          Key (slug)
                          <input
                            className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                            value={row.accommodationKey}
                            onChange={(e) =>
                              updateAccommodation(index, 'accommodationKey', e.target.value)
                            }
                          />
                        </label>
                        <label className="block text-xs text-gray-600">
                          Entity
                          <select
                            className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                            value={row.entityType}
                            onChange={(e) =>
                              updateAccommodation(index, 'entityType', e.target.value)
                            }
                          >
                            {ENTITY_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs text-gray-600">
                          Pricing method
                          <select
                            className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                            value={row.pricingMethod}
                            onChange={(e) =>
                              updateAccommodation(index, 'pricingMethod', e.target.value)
                            }
                          >
                            {PRICING_METHODS.filter((m) =>
                              seasonal
                                ? m.startsWith('nightly')
                                : m.startsWith('fixed')
                            ).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {seasonal ? (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <label className="block text-xs text-gray-600">
                            Nightly €
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              value={row.nightlyPerUnitAmount}
                              onChange={(e) =>
                                updateAccommodation(index, 'nightlyPerUnitAmount', e.target.value)
                              }
                            />
                          </label>
                          <label className="block text-xs text-gray-600">
                            Included guests
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              value={row.includedGuests}
                              onChange={(e) =>
                                updateAccommodation(index, 'includedGuests', e.target.value)
                              }
                            />
                          </label>
                          <label className="block text-xs text-gray-600">
                            Extra guest nightly €
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              value={row.additionalGuestNightlyAmount}
                              onChange={(e) =>
                                updateAccommodation(
                                  index,
                                  'additionalGuestNightlyAmount',
                                  e.target.value
                                )
                              }
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="block text-xs text-gray-600">
                            Fixed per unit €
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              value={row.fixedPerUnitAmount}
                              onChange={(e) =>
                                updateAccommodation(index, 'fixedPerUnitAmount', e.target.value)
                              }
                            />
                          </label>
                          <label className="block text-xs text-gray-600">
                            Adult package €
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              value={row.adultPackageAmount}
                              onChange={(e) =>
                                updateAccommodation(index, 'adultPackageAmount', e.target.value)
                              }
                            />
                          </label>
                          <label className="block text-xs text-gray-600">
                            Child package €
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              value={row.childPackageAmount}
                              onChange={(e) =>
                                updateAccommodation(index, 'childPackageAmount', e.target.value)
                              }
                            />
                          </label>
                          <label className="block text-xs text-gray-600">
                            Infant package €
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              value={row.infantPackageAmount}
                              onChange={(e) =>
                                updateAccommodation(index, 'infantPackageAmount', e.target.value)
                              }
                            />
                          </label>
                        </div>
                      )}
                      {!readOnly && form.accommodations.length > 1 ? (
                        <button
                          type="button"
                          className="text-xs text-red-700"
                          onClick={() => removeAccommodation(index)}
                        >
                          Remove row
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </fieldset>

              {!readOnly ? (
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full sm:w-auto px-4 py-2 rounded-lg bg-[#81887A] text-white text-sm disabled:opacity-50"
                >
                  {busy ? 'Saving…' : mode === 'create' ? 'Create draft' : 'Save draft'}
                </button>
              ) : (
                <p className="text-sm text-gray-500">
                  Active and retired plans are read-only. Clone to create an editable next draft.
                </p>
              )}
            </form>
          </div>
        </div>
      ) : null}

      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="rate-plan-confirm">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cancel"
            onClick={() => !busy && setConfirm(null)}
          />
          <div className="relative bg-white rounded-xl border border-gray-200 p-5 max-w-md w-full shadow-lg">
            <h4 className="text-base font-semibold text-gray-900">
              {confirm.action === 'activate' ? 'Activate rate plan?' : 'Retire rate plan?'}
            </h4>
            <p className="text-sm text-gray-600 mt-2">
              {confirm.plan.code}@v{confirm.plan.version} (revision {confirm.plan.revision}). This
              uses the exact server revision and does not retry on conflict.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                disabled={busy}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className="px-3 py-2 text-sm rounded-lg bg-[#81887A] text-white disabled:opacity-50"
                onClick={() => runLifecycle(confirm.action, confirm.plan)}
              >
                {busy ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
