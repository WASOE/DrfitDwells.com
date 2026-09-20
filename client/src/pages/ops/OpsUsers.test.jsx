import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { resetOpsOverlayRuntime } from '../../ops/primitives/opsOverlay';
import OpsUsers from './OpsUsers';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    opsUsers: vi.fn()
  },
  opsWriteAPI: {
    createOpsUser: vi.fn(),
    updateOpsUser: vi.fn(),
    setOpsUserPassword: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsUsers.jsx'),
  'utf8'
);

const OPERATOR_MODULES = [
  'dashboard',
  'calendar',
  'reservations',
  'finance',
  'property',
  'guests_comms',
  'operations',
  'cleaning'
];

const MODULE_LABELS = [
  'Dashboard',
  'Calendar',
  'Reservations',
  'Finance',
  'Property',
  'Guests & comms',
  'Operations',
  'Cleaning'
];

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: ['ops.users.manage'],
  defaultRoute: '/ops',
  locale: 'en'
};

function userRow(overrides = {}) {
  return {
    id: 'user-1',
    email: 'operator@example.com',
    name: 'Pat Operator',
    role: 'operator',
    modules: [...OPERATOR_MODULES],
    isActive: true,
    phone: null,
    locale: null,
    propertyKinds: [],
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    pushHealth: { activeCount: 0, invalidatedCount: 0, lastSuccessAt: null, latestUserAgent: null },
    ...overrides
  };
}

function payload(users) {
  return { data: { data: { users } } };
}

function collection() {
  return document.querySelector('.ops-users-rows');
}

function renderPage() {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <OpsSessionProvider session={adminSession}>
        <OpsUsers />
      </OpsSessionProvider>
    </div>
  );
}

function openCreate() {
  fireEvent.click(screen.getAllByRole('button', { name: 'New user' })[0]);
}

function fillCreateBasics(dialog, { email, name, password = 'password1' }) {
  fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: password } });
}

describe('OpsUsers collection migration', () => {
  beforeEach(() => {
    opsReadAPI.opsUsers.mockReset();
    opsWriteAPI.createOpsUser.mockReset();
    opsWriteAPI.updateOpsUser.mockReset();
    opsWriteAPI.setOpsUserPassword.mockReset();
    opsReadAPI.opsUsers.mockResolvedValue(payload([userRow()]));
    opsWriteAPI.createOpsUser.mockResolvedValue({ data: { success: true } });
    opsWriteAPI.updateOpsUser.mockResolvedValue({ data: { success: true } });
    opsWriteAPI.setOpsUserPassword.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    cleanup();
    resetOpsOverlayRuntime();
  });

  it('uses OpsPage wide and OpsPageHeader without a local width wrapper', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(pageSource).not.toMatch(/max-w-7xl|mx-auto|bg-white border border-gray-200 rounded-xl|#81887A/);
    expect(pageSource).toContain('Passwords are set manually here — no email invites.');
    expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument();
  });

  it('reads all users once with no params, pagination, filters, or polling', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.opsUsers).toHaveBeenCalledTimes(1);
    });
    expect(opsReadAPI.opsUsers).toHaveBeenCalledWith();
    expect(opsReadAPI.opsUsers.mock.calls[0]).toEqual([]);
    expect(pageSource).toContain('opsReadAPI.opsUsers()');
    expect(pageSource).not.toMatch(/OpsPagination|OpsFilterBar|setInterval|page:\s*1|\/ops\/users\//);
    expect(pageSource).not.toMatch(/action checkbox|ops\.users\.manage checkbox|listAllowedActions/);
  });

  it('renders representative rows with categorical role/active and muted push text', async () => {
    opsReadAPI.opsUsers.mockResolvedValue(
      payload([
        userRow(),
        userRow({
          id: 'user-admin',
          email: 'admin@example.com',
          name: 'Ada Admin',
          role: 'admin',
          modules: ['*'],
          pushHealth: {
            activeCount: 2,
            invalidatedCount: 0,
            lastSuccessAt: '2026-09-20T08:10:00.000Z'
          }
        }),
        userRow({
          id: 'user-subset',
          email: 'very.long.operator.address+alias@example-domain-that-must-wrap.test',
          name: 'Long Name That Should Wrap Across The Row',
          role: 'operator',
          modules: ['calendar', 'finance'],
          pushHealth: { activeCount: 0, invalidatedCount: 2, lastSuccessAt: null }
        }),
        userRow({
          id: 'user-cleaner',
          email: 'cleaner@example.com',
          name: 'Kim Cleaner',
          role: 'cleaner',
          modules: ['cleaning'],
          locale: 'bg',
          phone: '+359881234567',
          propertyKinds: ['cabin'],
          isActive: false,
          pushHealth: { activeCount: 0, invalidatedCount: 0, lastSuccessAt: null }
        })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByText('operator@example.com')).toBeInTheDocument();
    });
    expect(within(collection()).getByText('Admin')).toBeInTheDocument();
    expect(within(collection()).getAllByText('Operator')).toHaveLength(2);
    expect(within(collection()).getByText('Cleaner')).toBeInTheDocument();
    expect(within(collection()).getByText(/All modules/)).toBeInTheDocument();
    expect(within(collection()).getByText(/calendar, finance/)).toBeInTheDocument();
    expect(within(collection()).getByText(/Cleaning/)).toBeInTheDocument();
    expect(within(collection()).getByText(/Ready/)).toBeInTheDocument();
    expect(within(collection()).getByText(/Expired/)).toBeInTheDocument();
    expect(within(collection()).getAllByText(/None/).length).toBeGreaterThan(0);
    expect(within(collection()).getAllByText('Active').length).toBeGreaterThan(0);
    expect(within(collection()).getByText('Inactive')).toBeInTheDocument();
    expect(document.querySelector('[data-ops-status-key]')).toBeNull();
    expect(pageSource).not.toMatch(/OpsStatus|domain="user"|domain='user'/);

    const table = screen.getByRole('table', { hidden: true, name: 'OPS users' });
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Email' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Name' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Role' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Modules' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Push' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Active' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { hidden: true, name: /locale/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { hidden: true, name: /phone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { hidden: true, name: /created/i })).not.toBeInTheDocument();
  });

  it('opens create with operator defaults and submits the exact operator payload', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument();
    });
    openCreate();
    const dialog = await screen.findByRole('dialog', { name: 'New OPS user' });
    expect(within(dialog).getByLabelText('Email')).toHaveValue('');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('');
    expect(within(dialog).getByLabelText('Password')).toHaveValue('');
    expect(within(dialog).getByLabelText('Role')).toHaveValue('operator');
    expect(within(dialog).getByLabelText('Active')).toBeChecked();
    MODULE_LABELS.forEach((label) => {
      expect(within(dialog).getByLabelText(label)).toBeChecked();
    });
    expect(within(dialog).queryByLabelText('users')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Phone (WhatsApp)')).not.toBeInTheDocument();

    fillCreateBasics(dialog, { email: '  new.op@example.com ', name: ' New Operator ' });
    fireEvent.submit(document.getElementById('ops-users-form'));

    await waitFor(() => {
      expect(opsWriteAPI.createOpsUser).toHaveBeenCalled();
    });
    expect(opsWriteAPI.createOpsUser).toHaveBeenCalledWith({
      email: 'new.op@example.com',
      name: 'New Operator',
      password: 'password1',
      role: 'operator',
      modules: OPERATOR_MODULES,
      isActive: true
    });
    expect(opsWriteAPI.createOpsUser.mock.calls[0][0]).not.toHaveProperty('phone');
    expect(opsWriteAPI.setOpsUserPassword).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('User created.')).toBeInTheDocument();
    expect(opsReadAPI.opsUsers.mock.calls.length).toBeGreaterThan(1);
  });

  it('omits modules when creating an admin', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument();
    });
    openCreate();
    const dialog = await screen.findByRole('dialog', { name: 'New OPS user' });
    fillCreateBasics(dialog, { email: 'ada@example.com', name: 'Ada' });
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'admin' } });
    expect(within(dialog).getByText('All modules')).toBeInTheDocument();
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.createOpsUser).toHaveBeenCalledWith({
        email: 'ada@example.com',
        name: 'Ada',
        password: 'password1',
        role: 'admin',
        modules: undefined,
        isActive: true
      });
    });
  });

  it('sends cleaner contact fields and omits modules when creating a cleaner', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument();
    });
    openCreate();
    const dialog = await screen.findByRole('dialog', { name: 'New OPS user' });
    fillCreateBasics(dialog, { email: 'kim@example.com', name: 'Kim' });
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'cleaner' } });
    expect(within(dialog).getByText('Cleaning')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Phone (WhatsApp)'), { target: { value: ' +359881234567 ' } });
    fireEvent.change(within(dialog).getByLabelText(/Notification locale/), { target: { value: 'bg' } });
    fireEvent.click(within(dialog).getByLabelText('Cabin'));
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.createOpsUser).toHaveBeenCalledWith({
        email: 'kim@example.com',
        name: 'Kim',
        password: 'password1',
        role: 'cleaner',
        modules: undefined,
        isActive: true,
        phone: '+359881234567',
        locale: 'bg',
        propertyKinds: ['cabin']
      });
    });
  });

  it('sends locale null when cleaner locale is Not set', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument();
    });
    openCreate();
    const dialog = await screen.findByRole('dialog', { name: 'New OPS user' });
    fillCreateBasics(dialog, { email: 'unset@example.com', name: 'Unset Locale' });
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'cleaner' } });
    expect(within(dialog).getByLabelText(/Notification locale/)).toHaveValue('');
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.createOpsUser).toHaveBeenCalled();
    });
    expect(opsWriteAPI.createOpsUser.mock.calls[0][0]).toMatchObject({
      role: 'cleaner',
      locale: null,
      phone: null,
      propertyKinds: []
    });
  });

  it('sends modules: [] when every operator module is unchecked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument();
    });
    openCreate();
    const dialog = await screen.findByRole('dialog', { name: 'New OPS user' });
    fillCreateBasics(dialog, { email: 'empty@example.com', name: 'Empty Mods' });
    MODULE_LABELS.forEach((label) => {
      fireEvent.click(within(dialog).getByLabelText(label));
    });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.createOpsUser).toHaveBeenCalled();
    });
    expect(opsWriteAPI.createOpsUser.mock.calls[0][0].modules).toEqual([]);
  });

  it('requires create password of at least 8 characters', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument();
    });
    openCreate();
    const dialog = await screen.findByRole('dialog', { name: 'New OPS user' });
    fillCreateBasics(dialog, { email: 'short@example.com', name: 'Short', password: 'short' });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Password must be at least 8 characters.');
    });
    expect(opsWriteAPI.createOpsUser).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Email')).toHaveValue('short@example.com');
  });

  it('initializes operator edit, keeps email disabled, and PATCHes without email or password', async () => {
    const row = userRow({
      modules: ['calendar', 'finance'],
      isActive: false
    });
    opsReadAPI.opsUsers.mockResolvedValue(payload([row]));
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit OPS user' });
    expect(within(dialog).getByLabelText('Email')).toHaveValue('operator@example.com');
    expect(within(dialog).getByLabelText('Email')).toBeDisabled();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Pat Operator');
    expect(within(dialog).getByLabelText('Role')).toHaveValue('operator');
    expect(within(dialog).getByLabelText('Active')).not.toBeChecked();
    expect(within(dialog).getByLabelText('Calendar')).toBeChecked();
    expect(within(dialog).getByLabelText('Finance')).toBeChecked();
    expect(within(dialog).getByLabelText('Dashboard')).not.toBeChecked();
    expect(within(dialog).getByLabelText(/Reset password/)).toHaveValue('');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' Pat Relaunch ' } });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.updateOpsUser).toHaveBeenCalledWith('user-1', {
        name: 'Pat Relaunch',
        role: 'operator',
        modules: ['calendar', 'finance'],
        isActive: false
      });
    });
    expect(opsWriteAPI.setOpsUserPassword).not.toHaveBeenCalled();
    expect(opsWriteAPI.updateOpsUser.mock.calls[0][1]).not.toHaveProperty('email');
    expect(opsWriteAPI.updateOpsUser.mock.calls[0][1]).not.toHaveProperty('password');
    expect(screen.getByText('User updated.')).toBeInTheDocument();
  });

  it('omits modules when editing an admin', async () => {
    opsReadAPI.opsUsers.mockResolvedValue(
      payload([
        userRow({
          id: 'user-admin',
          email: 'admin@example.com',
          name: 'Ada Admin',
          role: 'admin',
          modules: ['*']
        })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('dialog', { name: 'Edit OPS user' });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.updateOpsUser).toHaveBeenCalledWith('user-admin', {
        name: 'Ada Admin',
        role: 'admin',
        modules: undefined,
        isActive: true
      });
    });
  });

  it('sends cleaner fields on cleaner edit and omits modules', async () => {
    opsReadAPI.opsUsers.mockResolvedValue(
      payload([
        userRow({
          id: 'user-cleaner',
          email: 'cleaner@example.com',
          name: 'Kim Cleaner',
          role: 'cleaner',
          modules: ['cleaning'],
          phone: '+359881234567',
          locale: 'en',
          propertyKinds: ['cabin']
        })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit OPS user' });
    expect(within(dialog).getByLabelText(/Notification locale/)).toHaveValue('en');
    fireEvent.change(within(dialog).getByLabelText(/Notification locale/), { target: { value: 'bg' } });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.updateOpsUser).toHaveBeenCalledWith('user-cleaner', {
        name: 'Kim Cleaner',
        role: 'cleaner',
        modules: undefined,
        isActive: true,
        phone: '+359881234567',
        locale: 'bg',
        propertyKinds: ['cabin']
      });
    });
  });

  it('PATCHes then POSTs password, and keeps that order when the password call fails', async () => {
    const order = [];
    opsWriteAPI.updateOpsUser.mockImplementation(async () => {
      order.push('patch');
      return { data: { success: true } };
    });
    opsWriteAPI.setOpsUserPassword.mockImplementation(async () => {
      order.push('password');
      const err = { response: { data: { message: 'Password reset unavailable' } } };
      throw err;
    });
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit OPS user' });
    fireEvent.change(within(dialog).getByLabelText(/Reset password/), { target: { value: 'newpass12' } });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.setOpsUserPassword).toHaveBeenCalledWith('user-1', 'newpass12');
    });
    expect(order).toEqual(['patch', 'password']);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Password reset unavailable');
    expect(within(dialog).getByLabelText(/Reset password/)).toHaveValue('newpass12');
    expect(screen.getByRole('dialog', { name: 'Edit OPS user' })).toBeInTheDocument();
  });

  it('does not call password POST when reset is blank, and still PATCHes before a short reset error', async () => {
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    let dialog = await screen.findByRole('dialog', { name: 'Edit OPS user' });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.updateOpsUser).toHaveBeenCalledTimes(1);
    });
    expect(opsWriteAPI.setOpsUserPassword).not.toHaveBeenCalled();

    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    dialog = await screen.findByRole('dialog', { name: 'Edit OPS user' });
    fireEvent.change(within(dialog).getByLabelText(/Reset password/), { target: { value: 'short' } });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('New password must be at least 8 characters.');
    });
    expect(opsWriteAPI.updateOpsUser).toHaveBeenCalledTimes(2);
    expect(opsWriteAPI.setOpsUserPassword).not.toHaveBeenCalled();
  });

  it('omits modules when switching operator to admin', async () => {
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit OPS user' });
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'admin' } });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.updateOpsUser).toHaveBeenCalledWith('user-1', {
        name: 'Pat Operator',
        role: 'admin',
        modules: undefined,
        isActive: true
      });
    });
  });

  it('applies cleaner semantics when switching operator to cleaner', async () => {
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit OPS user' });
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'cleaner' } });
    fireEvent.change(within(dialog).getByLabelText('Phone (WhatsApp)'), { target: { value: '+359881234567' } });
    fireEvent.change(within(dialog).getByLabelText(/Notification locale/), { target: { value: 'en' } });
    fireEvent.click(within(dialog).getByLabelText('Valley'));
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.updateOpsUser).toHaveBeenCalledWith('user-1', {
        name: 'Pat Operator',
        role: 'cleaner',
        modules: undefined,
        isActive: true,
        phone: '+359881234567',
        locale: 'en',
        propertyKinds: ['valley']
      });
    });
  });

  it('restores operator defaults when switching from cleaner and omits contact fields', async () => {
    opsReadAPI.opsUsers.mockResolvedValue(
      payload([
        userRow({
          id: 'user-cleaner',
          email: 'cleaner@example.com',
          name: 'Kim Cleaner',
          role: 'cleaner',
          modules: ['cleaning'],
          phone: '+359881234567',
          locale: 'bg',
          propertyKinds: ['cabin', 'valley']
        })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit OPS user' });
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'operator' } });
    expect(within(dialog).queryByLabelText('Phone (WhatsApp)')).not.toBeInTheDocument();
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(opsWriteAPI.updateOpsUser).toHaveBeenCalledWith('user-cleaner', {
        name: 'Kim Cleaner',
        role: 'operator',
        modules: OPERATOR_MODULES,
        isActive: true
      });
    });
    expect(opsWriteAPI.updateOpsUser.mock.calls[0][1]).not.toHaveProperty('phone');
    expect(opsWriteAPI.updateOpsUser.mock.calls[0][1]).not.toHaveProperty('locale');
    expect(opsWriteAPI.updateOpsUser.mock.calls[0][1]).not.toHaveProperty('propertyKinds');
  });

  it('retains create input after a failed save and shows the error inside the modal', async () => {
    opsWriteAPI.createOpsUser.mockRejectedValue({
      response: { data: { message: 'An OPS user with this email already exists.' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument();
    });
    openCreate();
    const dialog = await screen.findByRole('dialog', { name: 'New OPS user' });
    fillCreateBasics(dialog, { email: 'dupe@example.com', name: 'Dupe' });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'An OPS user with this email already exists.'
      );
    });
    expect(within(dialog).getByLabelText('Email')).toHaveValue('dupe@example.com');
    expect(screen.getByRole('dialog', { name: 'New OPS user' })).toBeInTheDocument();
  });

  it('retains edit input after a failed save and keeps the modal open', async () => {
    opsWriteAPI.updateOpsUser.mockRejectedValue({
      response: { data: { message: 'Save failed.' } }
    });
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit OPS user' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Kept Name' } });
    fireEvent.submit(document.getElementById('ops-users-form'));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Save failed.');
    });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Kept Name');
    expect(screen.getByRole('dialog', { name: 'Edit OPS user' })).toBeInTheDocument();
  });

  it('keeps the header visible while loading and does not invent empty data on list error', async () => {
    let resolveLoad;
    opsReadAPI.opsUsers.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading users');
    resolveLoad(payload([userRow()]));
    await waitFor(() => {
      expect(within(collection()).getByText('operator@example.com')).toBeInTheDocument();
    });
  });

  it('shows a page error from the API message without an empty-success state', async () => {
    opsReadAPI.opsUsers.mockRejectedValue({
      response: { data: { message: 'Users list unavailable' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Users list unavailable');
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(screen.queryByText('No OPS users yet.')).not.toBeInTheDocument();
  });

  it('shows an empty state that reuses the New user workflow', async () => {
    opsReadAPI.opsUsers.mockResolvedValue(payload([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No OPS users yet.')).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'New user' })[1]);
    expect(await screen.findByRole('dialog', { name: 'New OPS user' })).toBeInTheDocument();
  });

  it('does not add delete, self-guards, action-permission UI, or extra APIs', () => {
    expect(pageSource).not.toMatch(/deleteOpsUser|OpsConfirmDialog|window\.confirm|last-admin|self-deactivat/);
    expect(pageSource).not.toMatch(/listAllowedActions|OpsPermission|action checkbox/);
    expect(pageSource).toContain('opsWriteAPI.createOpsUser({');
    expect(pageSource).toContain('opsWriteAPI.updateOpsUser(editingId, {');
    expect(pageSource).toContain('opsWriteAPI.setOpsUserPassword(editingId, form.resetPassword)');
    expect(pageSource.match(/opsReadAPI\.\w+/g)).toEqual(['opsReadAPI.opsUsers']);
  });
});
