import { useCallback, useEffect, useMemo, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const ROLES = [
  { value: 'operator', label: 'Operator' },
  { value: 'cleaner', label: 'Cleaner' },
  { value: 'admin', label: 'Admin' }
];

const OPERATOR_MODULE_OPTIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'reservations', label: 'Reservations' },
  { key: 'finance', label: 'Finance' },
  { key: 'property', label: 'Property' },
  { key: 'guests_comms', label: 'Guests & comms' },
  { key: 'operations', label: 'Operations' },
  { key: 'cleaning', label: 'Cleaning' }
];

const DEFAULT_OPERATOR_MODULES = OPERATOR_MODULE_OPTIONS.map((m) => m.key);

const emptyForm = {
  email: '',
  name: '',
  password: '',
  resetPassword: '',
  role: 'operator',
  modules: [...DEFAULT_OPERATOR_MODULES],
  isActive: true
};

function modulesSummary(role, modules) {
  if (role === 'admin') return 'All modules';
  if (role === 'cleaner') return 'Cleaning';
  if (!Array.isArray(modules) || modules.length === 0) return 'Default operator access';
  return modules.join(', ');
}

function roleBadgeClass(role) {
  if (role === 'cleaner') return 'bg-emerald-50 text-emerald-800';
  if (role === 'operator') return 'bg-sky-50 text-sky-800';
  return 'bg-amber-50 text-amber-900';
}

export default function OpsUsers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState({ type: '', message: '' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const modulesLocked = form.role === 'admin' || form.role === 'cleaner';

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await opsReadAPI.opsUsers();
      setRows(res.data?.data?.users || []);
    } catch (e) {
      setBanner({ type: 'error', message: e?.response?.data?.message || 'Failed to load OPS users.' });
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
    setEditingId(row.id);
    setForm({
      email: row.email,
      name: row.name || '',
      password: '',
      resetPassword: '',
      role: row.role || 'operator',
      modules:
        row.role === 'operator' && Array.isArray(row.modules) && row.modules.length > 0
          ? [...row.modules]
          : [...DEFAULT_OPERATOR_MODULES],
      isActive: row.isActive !== false
    });
    setBanner({ type: '', message: '' });
    setDrawerOpen(true);
  }

  function handleRoleChange(role) {
    setForm((prev) => {
      const next = { ...prev, role };
      if (role === 'operator' && (!prev.modules.length || prev.role !== 'operator')) {
        next.modules = [...DEFAULT_OPERATOR_MODULES];
      }
      if (role === 'cleaner') {
        next.modules = ['cleaning'];
      }
      if (role === 'admin') {
        next.modules = ['*'];
      }
      return next;
    });
  }

  function toggleModule(key) {
    setForm((prev) => {
      if (prev.role !== 'operator') return prev;
      const set = new Set(prev.modules);
      if (set.has(key)) {
        set.delete(key);
      } else {
        set.add(key);
      }
      return { ...prev, modules: [...set] };
    });
  }

  const moduleHint = useMemo(() => {
    if (form.role === 'admin') return 'Admin users always have access to all modules.';
    if (form.role === 'cleaner') return 'Cleaner users are limited to the cleaning module.';
    return 'Select which OPS modules this operator can access.';
  }, [form.role]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setBanner({ type: '', message: '' });

    try {
      const name = form.name.trim();
      if (!name) {
        setBanner({ type: 'error', message: 'Name is required.' });
        return;
      }

      if (editingId) {
        await opsWriteAPI.updateOpsUser(editingId, {
          name,
          role: form.role,
          modules: form.role === 'operator' ? form.modules : undefined,
          isActive: form.isActive
        });
        if (form.resetPassword.trim()) {
          if (form.resetPassword.length < 8) {
            setBanner({ type: 'error', message: 'New password must be at least 8 characters.' });
            return;
          }
          await opsWriteAPI.setOpsUserPassword(editingId, form.resetPassword);
        }
        setBanner({ type: 'success', message: 'User updated.' });
      } else {
        const email = form.email.trim();
        if (!email) {
          setBanner({ type: 'error', message: 'Email is required.' });
          return;
        }
        if (!form.password || form.password.length < 8) {
          setBanner({ type: 'error', message: 'Password must be at least 8 characters.' });
          return;
        }
        await opsWriteAPI.createOpsUser({
          email,
          name,
          password: form.password,
          role: form.role,
          modules: form.role === 'operator' ? form.modules : undefined,
          isActive: form.isActive
        });
        setBanner({ type: 'success', message: 'User created.' });
      }

      setDrawerOpen(false);
      await load();
    } catch (err) {
      setBanner({ type: 'error', message: err?.response?.data?.message || 'Save failed.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 pb-16 sm:pb-0 max-w-7xl mx-auto px-4 py-6 md:py-8">
      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg md:text-xl font-semibold text-gray-900">OPS Users</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              Manage limited OPS accounts for cleaners and operators. Passwords are set manually here — no email invites.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="px-3 py-2 text-sm rounded-lg bg-[#81887A] text-white hover:bg-[#707668]"
          >
            New user
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
          <div className="text-sm text-gray-500">Loading users…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Modules</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Active</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                      No OPS users yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3 text-gray-900">{row.email}</td>
                      <td className="px-4 py-3 text-gray-700">{row.name}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${roleBadgeClass(row.role)}`}>
                          {row.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs max-w-xs truncate" title={modulesSummary(row.role, row.modules)}>
                        {modulesSummary(row.role, row.modules)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            row.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {row.isActive ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="text-[#81887A] font-medium hover:underline"
                        >
                          Edit
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
              <h3 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit OPS user' : 'New OPS user'}</h3>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required={!editingId}
                  disabled={!!editingId}
                />
                {editingId ? (
                  <p className="mt-1 text-xs text-gray-500">Email cannot be changed after creation.</p>
                ) : null}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  maxLength={120}
                />
              </div>
              {!editingId ? (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                    minLength={8}
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Reset password (optional)</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={form.resetPassword}
                    onChange={(e) => setForm((f) => ({ ...f, resetPassword: e.target.value }))}
                    minLength={8}
                    placeholder="Leave blank to keep current password"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={form.role}
                  onChange={(e) => handleRoleChange(e.target.value)}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Modules</p>
                <p className="text-xs text-gray-500 mb-2">{moduleHint}</p>
                {modulesLocked ? (
                  <p className="text-sm text-gray-700 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    {form.role === 'admin' ? 'All modules' : 'Cleaning'}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {OPERATOR_MODULE_OPTIONS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-gray-800">
                        <input
                          type="checkbox"
                          checked={form.modules.includes(key)}
                          onChange={() => toggleModule(key)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
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
