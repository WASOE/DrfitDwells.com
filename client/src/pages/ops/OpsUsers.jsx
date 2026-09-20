import { useCallback, useEffect, useMemo, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import { formatPushLastSuccess, pushHealthLabel } from '../../utils/opsPushReadiness';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsCheckbox from '../../ops/primitives/OpsCheckbox';
import OpsBadge from '../../ops/primitives/OpsBadge';
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
import './OpsUsers.css';

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

const PROPERTY_KIND_OPTIONS = [
  { value: 'cabin', label: 'Cabin' },
  { value: 'valley', label: 'Valley' }
];

const LOCALE_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'en', label: 'English' },
  { value: 'bg', label: 'Bulgarian' }
];

const E164_HINT = /^\+[1-9]\d{6,14}$/;

const emptyForm = {
  email: '',
  name: '',
  password: '',
  resetPassword: '',
  role: 'operator',
  modules: [...DEFAULT_OPERATOR_MODULES],
  isActive: true,
  phone: '',
  locale: '',
  propertyKinds: []
};

function copyEmptyForm() {
  return {
    ...emptyForm,
    modules: [...DEFAULT_OPERATOR_MODULES],
    propertyKinds: []
  };
}

function cleanerContactPayload(form) {
  if (form.role !== 'cleaner') {
    return {};
  }
  return {
    phone: form.phone.trim() || null,
    locale: form.locale || null,
    propertyKinds: [...form.propertyKinds]
  };
}

function phoneFormatHint(phone) {
  const trimmed = String(phone || '').trim();
  if (!trimmed) {
    return 'International E.164 format, e.g. +359881234567';
  }
  if (trimmed.startsWith('+') && E164_HINT.test(trimmed)) {
    return 'Looks like valid E.164.';
  }
  return 'Use international E.164 (+country code). Local numbers are normalized on save when possible.';
}

function modulesSummary(role, modules) {
  if (role === 'admin') return 'All modules';
  if (role === 'cleaner') return 'Cleaning';
  if (!Array.isArray(modules) || modules.length === 0) return 'Default operator access';
  return modules.join(', ');
}

function roleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'operator') return 'Operator';
  if (role === 'cleaner') return 'Cleaner';
  return role;
}

function pushHealthSummary(row) {
  const health = row.pushHealth || {};
  const label = pushHealthLabel(health);
  const parts = [label];
  if (health.activeCount > 0) {
    parts.push(`${health.activeCount} device${health.activeCount === 1 ? '' : 's'}`);
  }
  const lastSuccess = formatPushLastSuccess(health.lastSuccessAt);
  if (health.lastSuccessAt) {
    parts.push(`Last OK ${lastSuccess}`);
  }
  return parts.join(' · ');
}

function UserRoleMarker({ role }) {
  return <OpsBadge>{roleLabel(role)}</OpsBadge>;
}

function UserActiveMarker({ isActive }) {
  return <OpsBadge>{isActive ? 'Active' : 'Inactive'}</OpsBadge>;
}

function UserRowActions({ row, onEdit }) {
  return (
    <div className="ops-users-actions">
      <OpsButton variant="quiet" size="compact" onClick={() => onEdit(row)}>
        Edit
      </OpsButton>
    </div>
  );
}

export default function OpsUsers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState({ type: '', message: '' });
  const [formError, setFormError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(copyEmptyForm);
  const [saving, setSaving] = useState(false);

  const modulesLocked = form.role === 'admin' || form.role === 'cleaner';

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setListError('');
      const res = await opsReadAPI.opsUsers();
      setRows(res.data?.data?.users || []);
    } catch (e) {
      setListError(e?.response?.data?.message || 'Failed to load OPS users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(copyEmptyForm());
    setNotice({ type: '', message: '' });
    setFormError('');
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
      isActive: row.isActive !== false,
      phone: row.phone || '',
      locale: row.locale || '',
      propertyKinds: Array.isArray(row.propertyKinds) ? [...row.propertyKinds] : []
    });
    setNotice({ type: '', message: '' });
    setFormError('');
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

  const phoneHint = useMemo(() => phoneFormatHint(form.phone), [form.phone]);

  function togglePropertyKind(value) {
    setForm((prev) => {
      if (prev.role !== 'cleaner') return prev;
      const set = new Set(prev.propertyKinds);
      if (set.has(value)) {
        set.delete(value);
      } else {
        set.add(value);
      }
      return { ...prev, propertyKinds: [...set] };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setNotice({ type: '', message: '' });
    setFormError('');

    try {
      const name = form.name.trim();
      if (!name) {
        setFormError('Name is required.');
        return;
      }

      if (editingId) {
        await opsWriteAPI.updateOpsUser(editingId, {
          name,
          role: form.role,
          modules: form.role === 'operator' ? form.modules : undefined,
          isActive: form.isActive,
          ...cleanerContactPayload(form)
        });
        if (form.resetPassword.trim()) {
          if (form.resetPassword.length < 8) {
            setFormError('New password must be at least 8 characters.');
            return;
          }
          await opsWriteAPI.setOpsUserPassword(editingId, form.resetPassword);
        }
        setNotice({ type: 'success', message: 'User updated.' });
      } else {
        const email = form.email.trim();
        if (!email) {
          setFormError('Email is required.');
          return;
        }
        if (!form.password || form.password.length < 8) {
          setFormError('Password must be at least 8 characters.');
          return;
        }
        await opsWriteAPI.createOpsUser({
          email,
          name,
          password: form.password,
          role: form.role,
          modules: form.role === 'operator' ? form.modules : undefined,
          isActive: form.isActive,
          ...cleanerContactPayload(form)
        });
        setNotice({ type: 'success', message: 'User created.' });
      }

      setDrawerOpen(false);
      await load();
    } catch (err) {
      setFormError(err?.response?.data?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const createAction = <OpsButton onClick={openCreate}>New user</OpsButton>;
  const showEmpty = !loading && !listError && rows.length === 0;
  const showCollection = !loading && rows.length > 0;

  return (
    <OpsPage width="wide">
      <div className="ops-users-page">
        <OpsPageHeader
          title="Users"
          description="Manage limited OPS accounts for cleaners and operators. Passwords are set manually here — no email invites."
          actions={createAction}
        />

        {listError ? <OpsBanner tone="danger" body={listError} /> : null}
        {notice.message ? (
          <OpsBanner tone={notice.type === 'success' ? 'success' : 'danger'} body={notice.message} />
        ) : null}

        {loading ? (
          <OpsLoadingState label="Loading users" />
        ) : showEmpty ? (
          <OpsEmptyState
            title="No OPS users yet."
            action={
              <OpsButton variant="secondary" onClick={openCreate}>
                New user
              </OpsButton>
            }
          />
        ) : showCollection ? (
          <>
            <div className="ops-users-table">
              <OpsTable caption="OPS users">
                <OpsTableHead>
                  <OpsTableRow>
                    <OpsTableHeader>Email</OpsTableHeader>
                    <OpsTableHeader>Name</OpsTableHeader>
                    <OpsTableHeader>Role</OpsTableHeader>
                    <OpsTableHeader>Modules</OpsTableHeader>
                    <OpsTableHeader>Push</OpsTableHeader>
                    <OpsTableHeader>Active</OpsTableHeader>
                    <OpsTableHeader align="end">Actions</OpsTableHeader>
                  </OpsTableRow>
                </OpsTableHead>
                <OpsTableBody>
                  {rows.map((row) => (
                    <OpsTableRow key={row.id}>
                      <OpsTableCell>
                        <span className="ops-users-email">{row.email}</span>
                      </OpsTableCell>
                      <OpsTableCell>{row.name}</OpsTableCell>
                      <OpsTableCell>
                        <UserRoleMarker role={row.role} />
                      </OpsTableCell>
                      <OpsTableCell>
                        <span className="ops-users-modules" title={modulesSummary(row.role, row.modules)}>
                          {modulesSummary(row.role, row.modules)}
                        </span>
                      </OpsTableCell>
                      <OpsTableCell>
                        <p className="ops-users-push" title={pushHealthSummary(row)}>
                          {pushHealthSummary(row)}
                        </p>
                      </OpsTableCell>
                      <OpsTableCell>
                        <UserActiveMarker isActive={row.isActive} />
                      </OpsTableCell>
                      <OpsTableCell align="end">
                        <UserRowActions row={row} onEdit={openEdit} />
                      </OpsTableCell>
                    </OpsTableRow>
                  ))}
                </OpsTableBody>
              </OpsTable>
            </div>

            <div className="ops-users-rows">
              {rows.map((row) => (
                <OpsCollectionRow
                  key={row.id}
                  title={<span className="ops-users-email">{row.email}</span>}
                  meta={`${row.name} · ${modulesSummary(row.role, row.modules)} · ${pushHealthSummary(row)}`}
                  status={
                    <span className="ops-users-markers">
                      <UserRoleMarker role={row.role} />
                      <UserActiveMarker isActive={row.isActive} />
                    </span>
                  }
                  actions={<UserRowActions row={row} onEdit={openEdit} />}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      <OpsModal
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? 'Edit OPS user' : 'New OPS user'}
        footer={
          <>
            <OpsButton variant="secondary" onClick={() => setDrawerOpen(false)}>
              Cancel
            </OpsButton>
            <OpsButton type="submit" form="ops-users-form" loading={saving} loadingLabel="Saving…">
              Save
            </OpsButton>
          </>
        }
      >
        <form id="ops-users-form" className="ops-users-form" onSubmit={handleSubmit}>
          {formError ? <OpsInlineError>{formError}</OpsInlineError> : null}
          <OpsTextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required={!editingId}
            disabled={!!editingId}
            hint={editingId ? 'Email cannot be changed after creation.' : undefined}
          />
          <OpsTextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            maxLength={120}
          />
          {!editingId ? (
            <OpsTextField
              label="Password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
            />
          ) : (
            <OpsTextField
              label="Reset password"
              optional
              type="password"
              autoComplete="new-password"
              value={form.resetPassword}
              onChange={(e) => setForm((f) => ({ ...f, resetPassword: e.target.value }))}
              minLength={8}
              placeholder="Leave blank to keep current password"
            />
          )}
          <OpsSelect
            label="Role"
            value={form.role}
            onChange={(e) => handleRoleChange(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </OpsSelect>
          {form.role === 'cleaner' ? (
            <div className="ops-users-cleaner">
              <p className="ops-users-cleaner__title">Cleaner contact &amp; assignment</p>
              <OpsTextField
                label="Phone (WhatsApp)"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+359881234567"
                hint={phoneHint}
              />
              <OpsSelect
                label="Notification locale"
                optional
                value={form.locale}
                onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))}
                hint="Optional. Used for cleaner notifications in later batches."
              >
                {LOCALE_OPTIONS.map((opt) => (
                  <option key={opt.value || 'none'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </OpsSelect>
              <div>
                <p className="ops-users-note">Property kinds</p>
                <div className="ops-users-checkgrid">
                  {PROPERTY_KIND_OPTIONS.map(({ value, label }) => (
                    <OpsCheckbox
                      key={value}
                      label={label}
                      checked={form.propertyKinds.includes(value)}
                      onChange={() => togglePropertyKind(value)}
                    />
                  ))}
                </div>
                <p className="ops-users-note">
                  Assign which property kinds this cleaner receives notifications for.
                </p>
              </div>
            </div>
          ) : null}
          <div>
            <p className="ops-users-note">Modules</p>
            <p className="ops-users-note">{moduleHint}</p>
            {modulesLocked ? (
              <p className="ops-users-locked">{form.role === 'admin' ? 'All modules' : 'Cleaning'}</p>
            ) : (
              <div className="ops-users-checkgrid">
                {OPERATOR_MODULE_OPTIONS.map(({ key, label }) => (
                  <OpsCheckbox
                    key={key}
                    label={label}
                    checked={form.modules.includes(key)}
                    onChange={() => toggleModule(key)}
                  />
                ))}
              </div>
            )}
          </div>
          <OpsCheckbox
            label="Active"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
        </form>
      </OpsModal>
    </OpsPage>
  );
}
