import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { promoAdminAPI } from '../../services/api';

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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PromoCodesList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await promoAdminAPI.list();
      if (res.data.success) {
        setRows(res.data.data?.promoCodes || []);
      }
    } catch (e) {
      if (e.response?.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/login');
        return;
      }
      setError(e.response?.data?.message || 'Failed to load promo codes');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
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
    setDrawerOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
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
        await promoAdminAPI.update(editingId, payload);
      } else {
        await promoAdminAPI.create(payload);
      }
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    try {
      await promoAdminAPI.update(row._id, { isActive: !row.isActive });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Update failed');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A]" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 max-w-7xl mx-auto">
      <div className="sm:flex sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-playfair font-bold text-gray-900">Promo codes</h1>
          <p className="mt-1 text-sm text-gray-600">
            Fixed or percentage discounts for checkout. One code per booking.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="mt-4 sm:mt-0 inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-[#81887A] hover:bg-[#707668]"
        >
          New code
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-800">{error}</div>
      )}

      <div className="mt-8 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 hidden md:table-cell">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Value</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">Active</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 hidden lg:table-cell">Valid</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 hidden lg:table-cell">Min sub</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 hidden md:table-cell">Limit</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Uses</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                  No promo codes yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r._id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3 font-mono font-medium text-gray-900">{r.code}</td>
                  <td className="px-4 py-3 text-gray-700 hidden md:table-cell max-w-[200px] truncate">
                    {r.internalName}
                  </td>
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
                  <td className="px-4 py-3 text-gray-600 text-xs hidden lg:table-cell whitespace-nowrap">
                    {r.validFrom || r.validUntil
                      ? `${r.validFrom ? new Date(r.validFrom).toLocaleDateString() : '—'} → ${r.validUntil ? new Date(r.validUntil).toLocaleDateString() : '—'}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700 hidden lg:table-cell">
                    {r.minSubtotal != null ? `€${r.minSubtotal}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700 hidden md:table-cell">
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

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex md:items-center md:justify-center md:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative mt-auto md:mt-0 w-full md:max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-2xl md:rounded-xl shadow-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Edit promo code' : 'New promo code'}
              </h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Code (guest-facing)</label>
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  required
                  disabled={!!editingId}
                />
                {editingId && (
                  <p className="mt-1 text-xs text-gray-500">Code cannot be changed after creation.</p>
                )}
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
              <div className="grid grid-cols-2 gap-3">
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
                  placeholder="Unlimited"
                />
                <p className="mt-1 text-xs text-gray-500">Max confirmed bookings that can use this code.</p>
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
                  placeholder="None"
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
      )}
    </div>
  );
}
