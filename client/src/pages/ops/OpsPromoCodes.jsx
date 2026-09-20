import { useCallback, useEffect, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsCheckbox from '../../ops/primitives/OpsCheckbox';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsInlineError from '../../ops/primitives/OpsInlineError';
import OpsCollectionRow from '../../ops/primitives/OpsCollectionRow';
import OpsModal from '../../ops/primitives/OpsModal';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../ops/primitives/OpsTable';
import './OpsPromoCodes.css';

const emptyForm = {
  code: '',
  internalName: '',
  discountType: 'percent',
  discountValue: '',
  isActive: true,
  validFrom: '',
  validUntil: '',
  usageLimit: '',
  minSubtotal: ''
};

function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function discountDisplay(row) {
  return row.discountType === 'percent' ? `${row.discountValue}%` : `€${row.discountValue}`;
}

function usageLimitDisplay(row) {
  return row.usageLimit != null ? row.usageLimit : '—';
}

function promoStatusValue(row) {
  return row.isActive ? 'active' : 'inactive';
}

function PromoStatus({ row }) {
  return (
    <span className="ops-promo-status">
      <OpsStatus domain="promo" value={promoStatusValue(row)} />
    </span>
  );
}

function PromoActions({ row, onEdit, onToggle }) {
  return (
    <div className="ops-promo-actions">
      <OpsButton variant="quiet" size="compact" onClick={() => onEdit(row)}>
        Edit
      </OpsButton>
      <OpsButton variant="secondary" size="compact" onClick={() => onToggle(row)}>
        {row.isActive ? 'Disable' : 'Enable'}
      </OpsButton>
    </div>
  );
}

export default function OpsPromoCodes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState({ type: '', message: '' });
  const [formError, setFormError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await opsReadAPI.promoCodes();
      setRows(res.data?.data?.promoCodes || []);
    } catch (e) {
      setBanner({ type: 'error', message: e?.response?.data?.message || 'Failed to load promo codes' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setBanner({ type: '', message: '' });
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(row) {
    setEditingId(row._id);
    setForm({
      code: row.code || '',
      internalName: row.internalName || '',
      discountType: row.discountType || 'percent',
      discountValue: String(row.discountValue ?? ''),
      isActive: !!row.isActive,
      validFrom: toDatetimeLocalValue(row.validFrom),
      validUntil: toDatetimeLocalValue(row.validUntil),
      usageLimit: row.usageLimit != null ? String(row.usageLimit) : '',
      minSubtotal: row.minSubtotal != null ? String(row.minSubtotal) : ''
    });
    setBanner({ type: '', message: '' });
    setFormError('');
    setDrawerOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setBanner({ type: '', message: '' });
    setFormError('');
    try {
      const payload = {
        code: form.code.trim(),
        internalName: form.internalName.trim(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        isActive: form.isActive,
        validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
        usageLimit: form.usageLimit === '' ? null : Math.max(0, Math.floor(Number(form.usageLimit))),
        minSubtotal: form.minSubtotal === '' ? null : Number(form.minSubtotal)
      };
      if (editingId) {
        await opsWriteAPI.updatePromoCode(editingId, payload);
        setBanner({ type: 'success', message: 'Promo code updated.' });
      } else {
        await opsWriteAPI.createPromoCode(payload);
        setBanner({ type: 'success', message: 'Promo code created.' });
      }
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setFormError(err?.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    setBanner({ type: '', message: '' });
    try {
      await opsWriteAPI.updatePromoCode(row._id, { isActive: !row.isActive });
      setBanner({ type: 'success', message: `Promo code ${row.isActive ? 'disabled' : 'enabled'}.` });
      await load();
    } catch (err) {
      setBanner({ type: 'error', message: err?.response?.data?.message || 'Update failed' });
    }
  }

  const createAction = (
    <OpsButton onClick={openCreate}>Create promo code</OpsButton>
  );

  return (
    <OpsPage width="wide">
      <div className="ops-promo-page">
        <OpsPageHeader
          title="Promo codes"
          description="Create and manage fixed/percent checkout promo codes."
          actions={createAction}
        />

        {banner.message ? (
          <OpsBanner
            tone={banner.type === 'success' ? 'success' : 'danger'}
            title={banner.message}
          />
        ) : null}

        {loading ? (
          <OpsLoadingState label="Loading promo codes..." />
        ) : rows.length === 0 ? (
          <OpsEmptyState
            title="No promo codes yet."
            action={
              <OpsButton variant="secondary" onClick={openCreate}>
                Create promo code
              </OpsButton>
            }
          />
        ) : (
          <>
            <div className="ops-promo-table">
              <OpsTable caption="Promo codes">
                <OpsTableHead>
                  <OpsTableRow>
                    <OpsTableHeader>Code</OpsTableHeader>
                    <OpsTableHeader>Name</OpsTableHeader>
                    <OpsTableHeader>Type</OpsTableHeader>
                    <OpsTableHeader align="end" numeric>
                      Value
                    </OpsTableHeader>
                    <OpsTableHeader>Active</OpsTableHeader>
                    <OpsTableHeader align="end" numeric>
                      Limit
                    </OpsTableHeader>
                    <OpsTableHeader align="end" numeric>
                      Uses
                    </OpsTableHeader>
                    <OpsTableHeader align="end">Actions</OpsTableHeader>
                  </OpsTableRow>
                </OpsTableHead>
                <OpsTableBody>
                  {rows.map((row) => (
                    <OpsTableRow key={row._id}>
                      <OpsTableCell>
                        <span className="ops-promo-code">{row.code}</span>
                      </OpsTableCell>
                      <OpsTableCell>{row.internalName}</OpsTableCell>
                      <OpsTableCell>{row.discountType}</OpsTableCell>
                      <OpsTableCell align="end" numeric>
                        {discountDisplay(row)}
                      </OpsTableCell>
                      <OpsTableCell>
                        <PromoStatus row={row} />
                      </OpsTableCell>
                      <OpsTableCell align="end" numeric>
                        {usageLimitDisplay(row)}
                      </OpsTableCell>
                      <OpsTableCell align="end" numeric>
                        {row.usageCount ?? 0}
                      </OpsTableCell>
                      <OpsTableCell align="end">
                        <PromoActions row={row} onEdit={openEdit} onToggle={toggleActive} />
                      </OpsTableCell>
                    </OpsTableRow>
                  ))}
                </OpsTableBody>
              </OpsTable>
            </div>

            <div className="ops-promo-rows">
              {rows.map((row) => (
                <OpsCollectionRow
                  key={row._id}
                  title={<span className="ops-promo-code">{row.code}</span>}
                  meta={`${row.internalName} · ${row.discountType} · ${discountDisplay(row)} · Limit ${usageLimitDisplay(row)} · Uses ${row.usageCount ?? 0}`}
                  status={<PromoStatus row={row} />}
                  actions={<PromoActions row={row} onEdit={openEdit} onToggle={toggleActive} />}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <OpsModal
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? 'Edit promo code' : 'New promo code'}
        footer={
          <>
            <OpsButton variant="secondary" onClick={() => setDrawerOpen(false)}>
              Cancel
            </OpsButton>
            <OpsButton type="submit" form="ops-promo-form" loading={saving} loadingLabel="Saving…">
              Save
            </OpsButton>
          </>
        }
      >
        <form id="ops-promo-form" className="ops-promo-form" onSubmit={handleSubmit}>
          {formError ? <OpsInlineError>{formError}</OpsInlineError> : null}
          <OpsTextField
            label="Code (guest-facing)"
            className="ops-promo-form__code"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            required
            disabled={!!editingId}
          />
          <OpsTextField
            label="Internal name"
            value={form.internalName}
            onChange={(e) => setForm((f) => ({ ...f, internalName: e.target.value }))}
            required
          />
          <OpsSelect
            label="Type"
            value={form.discountType}
            onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value }))}
          >
            <option value="percent">Percent</option>
            <option value="fixed">Fixed (€)</option>
          </OpsSelect>
          <OpsTextField
            label="Value"
            type="number"
            step="0.01"
            min="0"
            value={form.discountValue}
            onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
            required
          />
          <OpsCheckbox
            label="Active"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          <OpsTextField
            label="Valid from"
            type="datetime-local"
            value={form.validFrom}
            onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
          />
          <OpsTextField
            label="Valid until"
            type="datetime-local"
            value={form.validUntil}
            onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
          />
          <OpsTextField
            label="Usage limit"
            optional
            type="number"
            step="1"
            min="0"
            value={form.usageLimit}
            onChange={(e) => setForm((f) => ({ ...f, usageLimit: e.target.value }))}
          />
          <OpsTextField
            label="Minimum subtotal"
            optional
            type="number"
            step="0.01"
            min="0"
            value={form.minSubtotal}
            onChange={(e) => setForm((f) => ({ ...f, minSubtotal: e.target.value }))}
          />
        </form>
      </OpsModal>
    </OpsPage>
  );
}
