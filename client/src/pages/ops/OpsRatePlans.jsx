import { useCallback, useEffect, useMemo, useState } from 'react';
import { packageAdminAPI, ratePlanAdminAPI } from '../../services/api';
import {
  createEmptyForm,
  planToForm,
  buildCreatePayload,
  buildUpdatePayload,
  buildRevisionOnlyPayload,
  assertNoForbiddenKeys,
  safeErrorMessage,
  describeActivationResult,
  formatWindow,
  emptyAccommodation,
  RATE_PLAN_TYPES,
  PACKAGE_TYPES,
  PACKAGE_VISIBILITIES,
  PRICING_METHODS,
  ENTITY_TYPES,
  isDraftEditable
} from './ratePlans/ratePlanFormUtils';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsTextarea from '../../ops/primitives/OpsTextarea';
import OpsCheckbox from '../../ops/primitives/OpsCheckbox';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsFilterBar from '../../ops/primitives/OpsFilterBar';
import OpsSheet from '../../ops/primitives/OpsSheet';
import OpsConfirmDialog from '../../ops/primitives/OpsConfirmDialog';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsSurface, { OpsSurfaceHeader, OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../ops/primitives/OpsTable';
import './OpsRatePlans.css';

function LifecycleMeta({ plan }) {
  if (!plan) return null;
  const bits = [];
  if (plan.updatedBy) bits.push(`Updated by ${plan.updatedBy}`);
  if (plan.updatedAt) bits.push(String(plan.updatedAt).slice(0, 19).replace('T', ' '));
  if (plan.activatedBy) bits.push(`Activated by ${plan.activatedBy}`);
  if (plan.activatedAt) bits.push(String(plan.activatedAt).slice(0, 19).replace('T', ' '));
  if (plan.retiredBy) bits.push(`Retired by ${plan.retiredBy}`);
  if (plan.retiredAt) bits.push(String(plan.retiredAt).slice(0, 19).replace('T', ' '));
  if (!bits.length) return <span className="ops-rate-plans__muted">—</span>;
  return <span className="ops-rate-plans__lifecycle">{bits.join(' · ')}</span>;
}

function bannerTone(type) {
  if (type === 'success') return 'success';
  if (type === 'warning') return 'warning';
  return 'danger';
}

export default function OpsRatePlans({ packagesOnly = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState({ type: '', message: '' });
  const [filters, setFilters] = useState({
    status: '',
    type: packagesOnly ? 'fixed_package' : '',
    code: ''
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState('create'); // create | edit | view
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(() => createEmptyForm('seasonal_stay'));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { action: 'activate'|'retire', plan }
  const managementAPI = useMemo(
    () => (packagesOnly ? packageAdminAPI : ratePlanAdminAPI),
    [packagesOnly]
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.type) params.type = filters.type;
      if (filters.code.trim()) params.code = filters.code.trim().toLowerCase();
      const res = await managementAPI.list(params);
      const plans = res.data?.data?.ratePlans || [];
      setRows(packagesOnly ? plans.filter((plan) => plan.type === 'fixed_package') : plans);
    } catch (e) {
      setBanner({ type: 'error', message: safeErrorMessage(e, 'Failed to load rate plans') });
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.type, filters.code, packagesOnly, managementAPI]);

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
        await managementAPI.create(payload);
        setBanner({ type: 'success', message: 'Draft rate plan created.' });
        setDrawerOpen(false);
      } else if (mode === 'edit' && selected) {
        const revision = selected.revision;
        const payload = buildUpdatePayload(form, revision);
        assertNoForbiddenKeys(payload);
        await managementAPI.update(selected.id, payload);
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
      const res = await managementAPI.clone(plan.id);
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
        const res = await managementAPI.activate(plan.id, payload);
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
        await managementAPI.retire(plan.id, payload);
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
    <OpsPage width="wide" className="ops-rate-plans" data-testid="ops-rate-plans">
      <OpsPageHeader
        title={packagesOnly ? 'Packages' : 'Rate plans'}
        description={
          packagesOnly
            ? 'Create and manage fixed-package commercial offers using the authoritative RatePlan lifecycle.'
            : 'Manage seasonal and fixed-package commercial rate plans.'
        }
        actions={
          <>
            <OpsButton disabled={busy} onClick={() => openCreate(packagesOnly ? 'fixed_package' : 'seasonal_stay')}>
              {packagesOnly ? 'New Package' : 'New seasonal draft'}
            </OpsButton>
            {!packagesOnly ? (
              <OpsButton variant="secondary" disabled={busy} onClick={() => openCreate('fixed_package')}>
                New package draft
              </OpsButton>
            ) : null}
          </>
        }
      />

      {banner.message ? (
        <OpsBanner data-testid="rate-plans-banner" tone={bannerTone(banner.type)} title={banner.message} />
      ) : null}

      <OpsFilterBar>
        <OpsSelect
          label="Status"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="retired">Retired</option>
        </OpsSelect>
        {!packagesOnly ? (
          <OpsSelect
            label="Type"
            value={filters.type}
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
          >
            <option value="">All</option>
            {RATE_PLAN_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </OpsSelect>
        ) : null}
        <OpsTextField
          className="ops-filter-bar__search ops-rate-plans__mono"
          label="Code"
          value={filters.code}
          onChange={(e) => setFilters((f) => ({ ...f, code: e.target.value }))}
          placeholder="e.g. winter-2026"
        />
      </OpsFilterBar>
      {filteredHint ? <p className="ops-rate-plans__filter-hint">{filteredHint}</p> : null}

      <OpsSurface variant="plain" aria-labelledby="ops-rate-plan-catalogue">
        <OpsSurfaceTitle id="ops-rate-plan-catalogue">
          {packagesOnly ? 'Package catalogue' : 'Rate plan catalogue'}
        </OpsSurfaceTitle>
        {loading ? (
          <div data-testid="rate-plans-loading">
            <OpsLoadingState label="Loading rate plans" />
          </div>
        ) : rows.length === 0 ? (
          <div data-testid="rate-plans-empty">
            <OpsEmptyState title="No rate plans match these filters." />
          </div>
        ) : (
          <OpsTable className="ops-rate-plans__table" caption="Rate plans">
            <OpsTableHead>
              <OpsTableRow>
                <OpsTableHeader>Code / version</OpsTableHeader>
                <OpsTableHeader>Status</OpsTableHeader>
                <OpsTableHeader>Type</OpsTableHeader>
                {packagesOnly ? <OpsTableHeader>Visibility</OpsTableHeader> : null}
                {packagesOnly ? <OpsTableHeader>Capacity</OpsTableHeader> : null}
                <OpsTableHeader>Window</OpsTableHeader>
                <OpsTableHeader>Pricing</OpsTableHeader>
                <OpsTableHeader numeric>Rev</OpsTableHeader>
                <OpsTableHeader>Lifecycle</OpsTableHeader>
                <OpsTableHeader align="end">Actions</OpsTableHeader>
              </OpsTableRow>
            </OpsTableHead>
            <OpsTableBody>
              {rows.map((plan) => (
                <OpsTableRow key={plan.id} data-testid={`rate-plan-row-${plan.id}`}>
                  <OpsTableCell>
                    <div className="ops-rate-plans__identity ops-rate-plans__mono">
                      {plan.code}<span>@v{plan.version}</span>
                    </div>
                    <p className="ops-rate-plans__internal-name">{plan.internalName}</p>
                  </OpsTableCell>
                  <OpsTableCell><OpsStatus domain="rate_plan" value={plan.status} /></OpsTableCell>
                  <OpsTableCell className="ops-rate-plans__nowrap">{plan.type}</OpsTableCell>
                  {packagesOnly ? (
                    <OpsTableCell className="ops-rate-plans__nowrap">
                      {plan.packageVisibility || (plan.status === 'active' ? 'public' : 'private')}
                    </OpsTableCell>
                  ) : null}
                  {packagesOnly ? (
                    <OpsTableCell className="ops-rate-plans__nowrap">
                      {(plan.accommodations || []).length} accommodation{(plan.accommodations || []).length === 1 ? '' : 's'}
                    </OpsTableCell>
                  ) : null}
                  <OpsTableCell className="ops-rate-plans__nowrap">{formatWindow(plan)}</OpsTableCell>
                  <OpsTableCell>
                    <div className="ops-rate-plans__pricing">
                      {(plan.accommodations || []).slice(0, 2).map((accommodation) => (
                        <span key={`${accommodation.accommodationKey}-${accommodation.pricingMethod}`}>
                          {accommodation.accommodationKey}: {accommodation.pricingMethod}
                          {accommodation.nightlyPerUnitAmount != null ? ` €${accommodation.nightlyPerUnitAmount}` : ''}
                          {accommodation.adultPackageAmount != null ? ` adult €${accommodation.adultPackageAmount}` : ''}
                        </span>
                      ))}
                    </div>
                  </OpsTableCell>
                  <OpsTableCell numeric>{plan.revision}</OpsTableCell>
                  <OpsTableCell className="ops-rate-plans__lifecycle-cell"><LifecycleMeta plan={plan} /></OpsTableCell>
                  <OpsTableCell align="end">
                    <div className="ops-rate-plans__actions">
                      <OpsButton variant="quiet" size="compact" onClick={() => openPlan(plan)}>
                        {isDraftEditable(plan) ? 'Edit' : 'View'}
                      </OpsButton>
                      <OpsButton variant="quiet" size="compact" disabled={busy} onClick={() => handleClone(plan)}>
                        Clone
                      </OpsButton>
                      {plan.status === 'draft' ? (
                        <OpsButton variant="quiet" size="compact" disabled={busy} onClick={() => setConfirm({ action: 'activate', plan })}>
                          Activate
                        </OpsButton>
                      ) : null}
                      {plan.status === 'active' ? (
                        <OpsButton variant="quiet" size="compact" disabled={busy} onClick={() => setConfirm({ action: 'retire', plan })}>
                          Retire
                        </OpsButton>
                      ) : null}
                    </div>
                  </OpsTableCell>
                </OpsTableRow>
              ))}
            </OpsTableBody>
          </OpsTable>
        )}
      </OpsSurface>

      <OpsSheet
        open={drawerOpen}
        side="right"
        dismissible={!busy}
        showCloseButton={false}
        onClose={() => !busy && setDrawerOpen(false)}
        title={mode === 'create' ? 'Create draft' : mode === 'edit' ? 'Edit draft' : 'View plan'}
        description={selected ? `Revision ${selected.revision} · ${selected.status}` : undefined}
        panelProps={{ 'data-testid': 'rate-plan-drawer' }}
        footer={
          <>
            <OpsButton variant="secondary" disabled={busy} onClick={() => setDrawerOpen(false)}>Close</OpsButton>
            {!readOnly ? (
              <OpsButton type="submit" form="ops-rate-plan-form" loading={busy} loadingLabel="Saving…">
                {mode === 'create' ? 'Create draft' : 'Save draft'}
              </OpsButton>
            ) : null}
          </>
        }
      >
        <form id="ops-rate-plan-form" className="ops-rate-plans__form" onSubmit={handleSave}>
          <fieldset disabled={readOnly || busy} className="ops-rate-plans__fieldset">
            {mode === 'create' ? (
              <OpsSelect label="Type" value={form.type} onChange={(e) => onTypeChange(e.target.value)}>
                {RATE_PLAN_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </OpsSelect>
            ) : (
              <p className="ops-rate-plans__readout">Type: <strong>{form.type}</strong></p>
            )}

            {form.type === 'fixed_package' ? (
              <div className="ops-rate-plans__grid ops-rate-plans__grid--2">
                <OpsSelect
                  label="Package type"
                  value={form.packageType}
                  onChange={(e) => updateField('packageType', e.target.value)}
                >
                  {PACKAGE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </OpsSelect>
                <OpsSelect
                  label="Visibility"
                  value={form.packageVisibility}
                  onChange={(e) => updateField('packageVisibility', e.target.value)}
                >
                  {PACKAGE_VISIBILITIES.map((visibility) => (
                    <option key={visibility} value={visibility}>{visibility}</option>
                  ))}
                </OpsSelect>
              </div>
            ) : null}

            <div className="ops-rate-plans__grid ops-rate-plans__grid--2">
              <OpsTextField
                className="ops-rate-plans__mono"
                label="Code"
                required
                value={form.code}
                onChange={(e) => updateField('code', e.target.value)}
                disabled={mode === 'edit'}
              />
              <OpsTextField
                label="Version"
                required
                type="number"
                min={1}
                step={1}
                value={form.version}
                onChange={(e) => updateField('version', e.target.value)}
                disabled={mode === 'edit'}
              />
            </div>

            <OpsTextField label="Internal name" required value={form.internalName} onChange={(e) => updateField('internalName', e.target.value)} />

            {seasonal ? (
              <div className="ops-rate-plans__grid ops-rate-plans__grid--2">
                <OpsTextField label="Arrival window start" type="date" required value={form.arrivalWindowStart} onChange={(e) => updateField('arrivalWindowStart', e.target.value)} />
                <OpsTextField label="Arrival window end" type="date" required value={form.arrivalWindowEnd} onChange={(e) => updateField('arrivalWindowEnd', e.target.value)} />
              </div>
            ) : (
              <div className="ops-rate-plans__grid ops-rate-plans__grid--2">
                <OpsTextField label="Package arrival" type="date" required value={form.packageArrivalDate} onChange={(e) => updateField('packageArrivalDate', e.target.value)} />
                <OpsTextField label="Package departure" type="date" required value={form.packageDepartureDate} onChange={(e) => updateField('packageDepartureDate', e.target.value)} />
              </div>
            )}

            <div className="ops-rate-plans__grid ops-rate-plans__grid--2">
              <OpsTextField label="Booking window start" type="date" value={form.bookingWindowStart} onChange={(e) => updateField('bookingWindowStart', e.target.value)} />
              <OpsTextField label="Booking window end" type="date" value={form.bookingWindowEnd} onChange={(e) => updateField('bookingWindowEnd', e.target.value)} />
            </div>

            <div className="ops-rate-plans__grid ops-rate-plans__grid--3">
              <OpsTextField label="Min nights" type="number" min={1} step={1} required value={form.minNights} onChange={(e) => updateField('minNights', e.target.value)} />
              <OpsSelect label="Currency" value={form.currency} onChange={(e) => updateField('currency', e.target.value)}><option value="EUR">EUR</option></OpsSelect>
              <OpsSelect label="Inventory" value={form.inventoryMode} onChange={(e) => updateField('inventoryMode', e.target.value)}>
                <option value="shared">shared</option>
                <option value="exclusive">exclusive</option>
              </OpsSelect>
            </div>

            <OpsCheckbox label="Requires full payment" checked={form.requiresFullPayment === true} onChange={(e) => updateField('requiresFullPayment', e.target.checked)} />

            <div className="ops-rate-plans__grid ops-rate-plans__grid--2">
              <OpsTextField label="Cancellation policy code" required value={form.cancellationPolicyCode} onChange={(e) => updateField('cancellationPolicyCode', e.target.value)} />
              <OpsTextField label="Policy version" type="number" min={1} step={1} required value={form.cancellationPolicyVersion} onChange={(e) => updateField('cancellationPolicyVersion', e.target.value)} />
            </div>

            <div className="ops-rate-plans__grid ops-rate-plans__grid--2">
              <OpsTextField
                label="Payment term code (optional)"
                value={form.paymentTermCode || ''}
                onChange={(e) => updateField('paymentTermCode', e.target.value)}
                placeholder="Leave empty for full payment only"
                disabled={readOnly}
              />
              <OpsTextField
                label="Payment term version"
                type="number"
                min={1}
                step={1}
                value={form.paymentTermVersion || ''}
                onChange={(e) => updateField('paymentTermVersion', e.target.value)}
                disabled={readOnly}
              />
            </div>

            <OpsTextarea label="Inclusions (one per line)" rows={4} value={form.inclusionsText} onChange={(e) => updateField('inclusionsText', e.target.value)} />

            <section className="ops-rate-plans__accommodations" aria-labelledby="rate-plan-accommodations-title">
              <OpsSurfaceHeader>
                <OpsSurfaceTitle id="rate-plan-accommodations-title" as="h3">Accommodations</OpsSurfaceTitle>
                {!readOnly ? <OpsButton variant="quiet" size="compact" onClick={addAccommodation}>Add row</OpsButton> : null}
              </OpsSurfaceHeader>
              {form.accommodations.map((row, index) => (
                <OpsSurface as="div" variant="inset" className="ops-rate-plans__accommodation" key={`acc-${index}`}>
                  <div className="ops-rate-plans__grid ops-rate-plans__grid--3">
                    <OpsTextField label="Key (slug)" className="ops-rate-plans__mono" value={row.accommodationKey} onChange={(e) => updateAccommodation(index, 'accommodationKey', e.target.value)} />
                    <OpsSelect label="Entity" value={row.entityType} onChange={(e) => updateAccommodation(index, 'entityType', e.target.value)}>
                      {ENTITY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </OpsSelect>
                    <OpsSelect label="Pricing method" value={row.pricingMethod} onChange={(e) => updateAccommodation(index, 'pricingMethod', e.target.value)}>
                      {PRICING_METHODS.filter((method) => seasonal ? method.startsWith('nightly') : method.startsWith('fixed')).map((method) => (
                        <option key={method} value={method}>{method}</option>
                      ))}
                    </OpsSelect>
                  </div>
                  {seasonal ? (
                    <div className="ops-rate-plans__grid ops-rate-plans__grid--3">
                      <OpsTextField label="Nightly €" type="number" min={0} step="0.01" value={row.nightlyPerUnitAmount} onChange={(e) => updateAccommodation(index, 'nightlyPerUnitAmount', e.target.value)} />
                      <OpsTextField label="Included guests" type="number" min={0} step={1} value={row.includedGuests} onChange={(e) => updateAccommodation(index, 'includedGuests', e.target.value)} />
                      <OpsTextField label="Extra guest nightly €" type="number" min={0} step="0.01" value={row.additionalGuestNightlyAmount} onChange={(e) => updateAccommodation(index, 'additionalGuestNightlyAmount', e.target.value)} />
                    </div>
                  ) : (
                    <div className="ops-rate-plans__grid ops-rate-plans__grid--2">
                      <OpsTextField label="Fixed per unit €" type="number" min={0} step="0.01" value={row.fixedPerUnitAmount} onChange={(e) => updateAccommodation(index, 'fixedPerUnitAmount', e.target.value)} />
                      <OpsTextField label="Adult package €" type="number" min={0} step="0.01" value={row.adultPackageAmount} onChange={(e) => updateAccommodation(index, 'adultPackageAmount', e.target.value)} />
                      <OpsTextField label="Child package €" type="number" min={0} step="0.01" value={row.childPackageAmount} onChange={(e) => updateAccommodation(index, 'childPackageAmount', e.target.value)} />
                      <OpsTextField label="Infant package €" type="number" min={0} step="0.01" value={row.infantPackageAmount} onChange={(e) => updateAccommodation(index, 'infantPackageAmount', e.target.value)} />
                    </div>
                  )}
                  {!readOnly && form.accommodations.length > 1 ? (
                    <OpsButton variant="quiet" size="compact" className="ops-rate-plans__remove" onClick={() => removeAccommodation(index)}>Remove row</OpsButton>
                  ) : null}
                </OpsSurface>
              ))}
            </section>
          </fieldset>

          {readOnly ? (
            <p className="ops-rate-plans__note">Active and retired plans are read-only. Clone to create an editable next draft.</p>
          ) : null}
          {packagesOnly ? (
            <p className="ops-rate-plans__note">
              Capacity is validated against active physical inventory on the server. Booking counts and sold-place metrics are not available in the current OPS read model.
            </p>
          ) : null}
        </form>
      </OpsSheet>

      <OpsConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.action === 'activate' ? 'Activate rate plan?' : 'Retire rate plan?'}
        body={confirm ? `${confirm.plan.code}@v${confirm.plan.version} (revision ${confirm.plan.revision}). This uses the exact server revision and does not retry on conflict.` : ''}
        confirmLabel="Confirm"
        loading={busy}
        onCancel={() => !busy && setConfirm(null)}
        onConfirm={() => confirm && runLifecycle(confirm.action, confirm.plan)}
        panelProps={{ 'data-testid': 'rate-plan-confirm' }}
      />
    </OpsPage>
  );
}
