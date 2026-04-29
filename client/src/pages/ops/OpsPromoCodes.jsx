import { useCallback, useEffect, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

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

export default function OpsPromoCodes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState({ type: '', message: '' });
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
    setDrawerOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setBanner({ type: '', message: '' });
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
      setBanner({ type: 'error', message: err?.response?.data?.message || 'Save failed' });
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

  return (
    <div className="space-y-4 pb-16 sm:pb-0 max-w-7xl mx-auto px-4 py-6 md:py-8">
      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg md:text-xl font-semibold text-gray-900">Promo codes</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              Create and manage fixed/percent checkout promo codes.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="px-3 py-2 text-sm rounded-lg bg-[#81887A] text-white hover:bg-[#707668]"
          >
            New code
          </button>
        </div>
      </section>

      {banner.message ? (
        <div
          className={`text-sm rounded-xl border p-3 ${
            banner.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {banner.message}
        </div>
      ) : null}

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6">
        {loading ? (
          <div className="text-sm text-gray-500">Loading promo codes...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Value</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Active</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Limit</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Uses</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                      No promo codes yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r._id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3 font-mono font-medium text-gray-900">{r.code}</td>
                      <td className="px-4 py-3 text-gray-700">{r.internalName}</td>
                      <td className="px-4 py-3 text-gray-700">{r.discountType}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                        {r.discountType === 'percent' ? `${r.discountValue}%` : `€${r.discountValue}`}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            r.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {r.isActive ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {r.usageLimit != null ? r.usageLimit : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900">{r.usageCount ?? 0}</td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="text-[#81887A] font-medium hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(r)}
                          className="text-gray-600 font-medium hover:underline"
                        >
                          {r.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 md:px-6 flex flex-wrap items-center justify-between gap-3 z-10">
              <h3 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit promo code' : 'New promo code'}</h3>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Code (guest-facing)</label>
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  required
                  disabled={!!editingId}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Internal name</label>
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={form.internalName}
                  onChange={(e) => setForm((f) => ({ ...f, internalName: e.target.value }))}
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.discountType}
                    onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value }))}
                  >
                    <option value="percent">Percent</option>
                    <option value="fixed">Fixed (€)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums"
                    value={form.discountValue}
                    onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Valid from</label>
                  <input
                    type="datetime-local"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.validFrom}
                    onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Valid until</label>
                  <input
                    type="datetime-local"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.validUntil}
                    onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Usage limit (optional)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums"
                  value={form.usageLimit}
                  onChange={(e) => setForm((f) => ({ ...f, usageLimit: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Minimum subtotal (optional)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums"
                  value={form.minSubtotal}
                  onChange={(e) => setForm((f) => ({ ...f, minSubtotal: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#81887A] rounded-lg hover:bg-[#707668] disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
