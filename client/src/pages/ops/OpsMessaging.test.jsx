import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { resetOpsOverlayRuntime } from '../../ops/primitives/opsOverlay';
import OpsMessaging from './OpsMessaging';

vi.mock('../../services/opsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    decodeRoleFromToken: actual.decodeRoleFromToken,
    opsReadAPI: {
      messagingSystemState: vi.fn(),
      messagingRules: vi.fn(),
      reservations: vi.fn(),
      communicationsOversight: vi.fn(),
      reservationMessagingSummary: vi.fn(),
      previewGmaMessage: vi.fn(),
      messagingDispatchDeliveryEvents: vi.fn()
    },
    opsWriteAPI: {
      patchMessagingShadowRuleEnabled: vi.fn(),
      cancelMessagingJob: vi.fn()
    }
  };
});

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsMessaging.jsx'),
  'utf8'
);
const pageCss = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsMessaging.css'),
  'utf8'
);
const registrySource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ops/status/opsStatusRegistry.js'),
  'utf8'
);

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

const operatorSession = {
  ...adminSession,
  actorId: 'operator-1',
  role: 'operator',
  modules: ['guests_comms', 'dashboard', 'reservations']
};

function createRoleToken(role) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: role === 'admin' ? '507f1f77bcf86cd799439011' : 'operator',
      role,
      modules: role === 'admin' ? ['*'] : ['guests_comms'],
      src: role === 'admin' ? 'ops_user' : 'legacy_env',
      tv: '1'
    })
  ).toString('base64url');
  return `${payload}.qa`;
}

function explanations(overrides = {}) {
  return {
    schedulerVsDirectDispatcher:
      'The scheduler worker flag controls whether scheduled jobs are claimed and handed to the dispatcher.',
    emailProvider: 'When the email provider flag is off, the automation email channel uses the internal shadow provider only.',
    dispatcher: 'When the dispatcher flag is off, claimed jobs are not processed by the message dispatcher.',
    ...overrides
  };
}

function systemState(overrides = {}) {
  return {
    dispatcherEnabled: true,
    schedulerWorkerEnabled: true,
    emailProviderEnabled: true,
    explanations: explanations(overrides.explanations),
    ...overrides
  };
}

function rule(overrides = {}) {
  return {
    ruleKey: 'guest_cabin_prearrival',
    enabled: false,
    mode: 'shadow',
    audience: 'guest',
    propertyScope: 'cabin',
    channelStrategy: 'whatsapp_first_email_fallback',
    triggerType: 'time_relative_to_check_in',
    triggerConfig: { offsetHours: -72 },
    templateKeyByChannel: {
      whatsapp: 'arrival_3d_the_cabin',
      email: 'arrival_3d_the_cabin_email'
    },
    templateReadinessByChannel: {
      whatsapp: 'approved',
      email: 'draft'
    },
    updatedAt: '2026-09-20T08:00:00.000Z',
    ...overrides
  };
}

function envelope(data) {
  return { data: { data } };
}

function forbiddenReads() {
  return [
    opsReadAPI.reservations,
    opsReadAPI.communicationsOversight,
    opsReadAPI.reservationMessagingSummary,
    opsReadAPI.previewGmaMessage,
    opsReadAPI.messagingDispatchDeliveryEvents,
    opsWriteAPI.cancelMessagingJob
  ];
}

function renderPage({ session = adminSession } = {}) {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <MemoryRouter initialEntries={['/ops/messaging']}>
        <OpsSessionProvider session={session}>
          <Routes>
            <Route path="/ops/messaging" element={<OpsMessaging />} />
            <Route path="/ops/reservations" element={<div data-testid="reservations-page" />} />
            <Route path="/ops/communications" element={<div data-testid="comms-page" />} />
          </Routes>
        </OpsSessionProvider>
      </MemoryRouter>
    </div>
  );
}

async function waitLoaded() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 2, name: 'System flags' })).toBeInTheDocument();
  });
}

describe('OpsMessaging migration', () => {
  beforeEach(() => {
    localStorage.setItem('adminToken', createRoleToken('admin'));
    opsReadAPI.messagingSystemState.mockReset();
    opsReadAPI.messagingRules.mockReset();
    forbiddenReads().forEach((fn) => fn.mockReset());
    opsWriteAPI.patchMessagingShadowRuleEnabled.mockReset();
    opsReadAPI.messagingSystemState.mockResolvedValue(envelope(systemState()));
    opsReadAPI.messagingRules.mockResolvedValue(envelope({ rules: [rule()] }));
    opsWriteAPI.patchMessagingShadowRuleEnabled.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    cleanup();
    resetOpsOverlayRuntime();
    localStorage.clear();
  });

  it('uses OpsPage wide and Messaging header without max-w-7xl or page Save', async () => {
    renderPage();
    await waitLoaded();
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(screen.getByRole('heading', { level: 1, name: 'Messaging' })).toBeInTheDocument();
    expect(screen.getByText(/Guest Message Automation/)).toBeInTheDocument();
    expect(screen.getByText(/booking lifecycle emails/)).toBeInTheDocument();
    expect(screen.getByText(/EmailEvent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(pageSource).toContain('decodeRoleFromToken()');
    expect(pageSource).not.toMatch(/max-w-7xl|#81887A|window\.confirm|z-50|bg-black\/40|min-w-\[800px\]/);
    expect(pageSource).not.toMatch(/session\.actions|canPerformAction|ops\.messaging\.shadow_rule\.enable/);
    expect(pageCss).toContain('@container ops-page');
    expect(pageCss).toContain('.ops-messaging-table');
    expect(pageCss).toContain('.ops-messaging-rows');
  });

  it('reads messagingSystemState and messagingRules once each with no params and no sibling APIs', async () => {
    renderPage();
    await waitLoaded();
    expect(opsReadAPI.messagingSystemState).toHaveBeenCalledTimes(1);
    expect(opsReadAPI.messagingSystemState).toHaveBeenCalledWith();
    expect(opsReadAPI.messagingRules).toHaveBeenCalledTimes(1);
    expect(opsReadAPI.messagingRules).toHaveBeenCalledWith();
    forbiddenReads().forEach((fn) => expect(fn).not.toHaveBeenCalled());
    expect(pageSource).not.toMatch(/setInterval|addEventListener\(['"]visibilitychange|addEventListener\(['"]focus/);
    expect(pageSource).not.toMatch(/communicationsOversight|reservationMessagingSummary|previewGmaMessage|cancelMessagingJob/);
  });

  it('renders On flags and explanations', async () => {
    renderPage();
    await waitLoaded();
    const flags = document.querySelector('.ops-messaging-flags');
    expect(within(flags).getByText('Dispatcher')).toBeInTheDocument();
    expect(within(flags).getByText('Scheduler worker')).toBeInTheDocument();
    expect(within(flags).getByText('Real email provider')).toBeInTheDocument();
    expect(screen.getAllByText('On')).toHaveLength(3);
    expect(screen.getByText(/scheduler worker flag controls whether scheduled jobs are claimed/i)).toBeInTheDocument();
    expect(screen.getByText(/internal shadow provider only/i)).toBeInTheDocument();
    expect(screen.getByText(/claimed jobs are not processed by the message dispatcher/i)).toBeInTheDocument();
    expect(pageSource).not.toMatch(/MESSAGE_DISPATCHER_ENABLED|MESSAGE_SCHEDULER_WORKER_ENABLED|MESSAGE_EMAIL_PROVIDER_ENABLED/);
  });

  it('renders mixed and all-off flag states as On/Off', async () => {
    opsReadAPI.messagingSystemState.mockResolvedValue(
      envelope(
        systemState({
          dispatcherEnabled: true,
          schedulerWorkerEnabled: false,
          emailProviderEnabled: false
        })
      )
    );
    const { unmount } = renderPage();
    await waitLoaded();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getAllByText('Off')).toHaveLength(2);
    unmount();

    opsReadAPI.messagingSystemState.mockResolvedValue(
      envelope(
        systemState({
          dispatcherEnabled: false,
          schedulerWorkerEnabled: false,
          emailProviderEnabled: false
        })
      )
    );
    renderPage();
    await waitLoaded();
    expect(screen.getAllByText('Off')).toHaveLength(3);
    expect(screen.queryByText('On')).not.toBeInTheDocument();
  });

  it('renders rules in payload order across table and structured rows', async () => {
    opsReadAPI.messagingRules.mockResolvedValue(
      envelope({
        rules: [
          rule({ ruleKey: 'zeta_rule', mode: 'auto' }),
          rule({ ruleKey: 'alpha_rule', mode: 'shadow' })
        ]
      })
    );
    renderPage();
    await waitLoaded();
    const keys = screen.getAllByText(/zeta_rule|alpha_rule/).map((el) => el.textContent);
    const zeta = keys.findIndex((text) => text.includes('zeta_rule'));
    const alpha = keys.findIndex((text) => text.includes('alpha_rule'));
    expect(zeta).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeGreaterThan(zeta);
    expect(document.querySelector('.ops-messaging-table')).toBeInTheDocument();
    expect(document.querySelector('.ops-messaging-rows')).toBeInTheDocument();
    expect(screen.getAllByText('zeta_rule')).toHaveLength(2);
    expect(screen.getAllByText('alpha_rule')).toHaveLength(2);
  });

  it('shows quiet empty copy with no Create action', async () => {
    opsReadAPI.messagingRules.mockResolvedValue(envelope({ rules: [] }));
    renderPage();
    await waitLoaded();
    expect(screen.getAllByText('No automation rules in database.')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
    expect(pageSource).not.toMatch(/OpsEmptyState/);
  });

  it('humanizes mode, audience, scope, channels, and trigger type without mutating stored values', async () => {
    opsReadAPI.messagingRules.mockResolvedValue(
      envelope({
        rules: [
          rule({
            ruleKey: 'mode_shadow',
            mode: 'shadow',
            audience: 'guest',
            propertyScope: 'cabin',
            channelStrategy: 'whatsapp_only',
            triggerType: 'time_relative_to_check_in'
          }),
          rule({
            ruleKey: 'mode_auto',
            mode: 'auto',
            audience: 'ops',
            propertyScope: 'valley',
            channelStrategy: 'email_only',
            triggerType: 'time_relative_to_check_out'
          }),
          rule({
            ruleKey: 'mode_manual',
            mode: 'manual_approve',
            audience: 'cleaner',
            propertyScope: 'any',
            channelStrategy: 'both',
            triggerType: 'booking_status_change'
          })
        ]
      })
    );
    renderPage();
    await waitLoaded();
    expect(screen.getAllByText('Shadow').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Auto').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Manual approval').length).toBeGreaterThan(0);
    expect(screen.queryByText('manual_approve')).not.toBeInTheDocument();
    expect(screen.getAllByText('Guest').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ops').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cleaner').length).toBeGreaterThan(0);
    expect(screen.getAllByText('The Cabin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('The Valley').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Any').length).toBeGreaterThan(0);
    expect(screen.getAllByText('WhatsApp only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Email only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Both').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Time relative to check-in').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Time relative to check-out').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Booking status change').length).toBeGreaterThan(0);
    expect(pageSource).toContain("rule.mode === 'shadow'");
    expect(pageSource).toContain('rule.ruleKey');
    expect(pageSource).toContain('rule.propertyScope');
    expect(pageSource).toContain('rule.channelStrategy');
  });

  it('uses canonical template statuses and human Missing without adding template.missing', async () => {
    opsReadAPI.messagingRules.mockResolvedValue(
      envelope({
        rules: [
          rule({
            templateReadinessByChannel: { whatsapp: 'approved', email: 'draft' }
          }),
          rule({
            ruleKey: 'missing_templates',
            templateReadinessByChannel: { whatsapp: 'missing', email: 'missing' },
            templateKeyByChannel: { whatsapp: '', email: '' }
          })
        ]
      })
    );
    renderPage();
    await waitLoaded();
    expect(document.querySelectorAll('[data-ops-status-key="template.approved"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-ops-status-key="template.draft"]').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Missing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(pageSource).not.toMatch(/template\.missing/);
    expect(pageSource).not.toMatch(/domain="template" value="missing"/);
    expect(registrySource).not.toMatch(/template\.missing/);
  });

  it('keeps technical ruleKey and triggerConfig visible', async () => {
    opsReadAPI.messagingRules.mockResolvedValue(
      envelope({
        rules: [
          rule({
            ruleKey: 'very_long_guest_prearrival_cabin_rule_key_that_must_wrap',
            triggerConfig: { offsetHours: -72, window: 'Europe/Sofia-not-transformed', nested: { a: 1 } }
          })
        ]
      })
    );
    renderPage();
    await waitLoaded();
    expect(screen.getAllByText('very_long_guest_prearrival_cabin_rule_key_that_must_wrap').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/offsetHours/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/arrival_3d_the_cabin/).length).toBeGreaterThan(0);
  });

  it('shows admin shadow control only for shadow mode', async () => {
    opsReadAPI.messagingRules.mockResolvedValue(
      envelope({
        rules: [
          rule({ ruleKey: 'shadow_rule', mode: 'shadow', enabled: false }),
          rule({ ruleKey: 'auto_rule', mode: 'auto', enabled: true })
        ]
      })
    );
    renderPage();
    await waitLoaded();
    expect(screen.getAllByRole('button', { name: 'Enable shadow' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Disable shadow' })).not.toBeInTheDocument();
  });

  it('shows Admins only for operators and does not PATCH', async () => {
    localStorage.setItem('adminToken', createRoleToken('operator'));
    renderPage({ session: operatorSession });
    await waitLoaded();
    expect(screen.getByRole('heading', { level: 1, name: 'Messaging' })).toBeInTheDocument();
    expect(screen.getAllByText('Admins only').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /shadow/i })).not.toBeInTheDocument();
    expect(opsWriteAPI.patchMessagingShadowRuleEnabled).not.toHaveBeenCalled();
  });

  it('opens OpsConfirmDialog without PATCHing until Enable is confirmed', async () => {
    renderPage();
    await waitLoaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enable shadow' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm rule change' });
    expect(within(dialog).getByText(/Existing scheduled jobs are not deleted when disabling/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(opsWriteAPI.patchMessagingShadowRuleEnabled).not.toHaveBeenCalled();
  });

  it('cancel closes the dialog and sends no PATCH', async () => {
    renderPage();
    await waitLoaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enable shadow' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(opsWriteAPI.patchMessagingShadowRuleEnabled).not.toHaveBeenCalled();
  });

  it('confirms with exact { enabled } payload and no extra keys', async () => {
    renderPage();
    await waitLoaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enable shadow' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
    await waitFor(() => {
      expect(opsWriteAPI.patchMessagingShadowRuleEnabled).toHaveBeenCalledTimes(1);
    });
    expect(opsWriteAPI.patchMessagingShadowRuleEnabled).toHaveBeenCalledWith('guest_cabin_prearrival', {
      enabled: true
    });
    const payload = opsWriteAPI.patchMessagingShadowRuleEnabled.mock.calls[0][1];
    expect(Object.keys(payload)).toEqual(['enabled']);
  });

  it('sends enabled false when disabling shadow', async () => {
    opsReadAPI.messagingRules.mockResolvedValue(envelope({ rules: [rule({ enabled: true })] }));
    renderPage();
    await waitLoaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'Disable shadow' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm rule change' });
    expect(within(dialog).getByText(/Existing scheduled jobs are not deleted when disabling/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));
    await waitFor(() => {
      expect(opsWriteAPI.patchMessagingShadowRuleEnabled).toHaveBeenCalledWith('guest_cabin_prearrival', {
        enabled: false
      });
    });
  });

  it('keeps the dialog open and shows a local error on PATCH failure', async () => {
    opsWriteAPI.patchMessagingShadowRuleEnabled.mockRejectedValue({
      response: { data: { message: 'Rule is not in shadow mode' }, status: 409 }
    });
    renderPage();
    await waitLoaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enable shadow' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm rule change' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Rule is not in shadow mode');
    expect(screen.getByRole('heading', { level: 1, name: 'Messaging' })).toBeInTheDocument();
    expect(screen.queryByText('Failed to load messaging')).not.toBeInTheDocument();
    expect(opsReadAPI.messagingRules).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog and refetches both reads after a successful PATCH', async () => {
    renderPage();
    await waitLoaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enable shadow' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(opsReadAPI.messagingSystemState).toHaveBeenCalledTimes(2);
      expect(opsReadAPI.messagingRules).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Messaging' })).toBeInTheDocument();
    expect(screen.queryByTestId('comms-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reservations-page')).not.toBeInTheDocument();
  });

  it('keeps the header and OpsLoadingState during the initial read without fake flags', () => {
    opsReadAPI.messagingSystemState.mockReturnValue(new Promise(() => {}));
    opsReadAPI.messagingRules.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Messaging' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading guest message automation…');
    expect(screen.queryByText('Dispatcher')).not.toBeInTheDocument();
    expect(screen.queryByText('System flags')).not.toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  it('keeps the header and shows a danger banner on load error without fake Off state or Retry', async () => {
    opsReadAPI.messagingSystemState.mockRejectedValue({
      response: { data: { message: 'Failed to load messaging' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to load messaging');
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Messaging' })).toBeInTheDocument();
    expect(screen.queryByText('Dispatcher')).not.toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'System flags' })).not.toBeInTheDocument();
  });

  it('preserves the Reservations link and does not merge Communications', async () => {
    renderPage();
    await waitLoaded();
    const reservationLinks = screen.getAllByRole('link', { name: 'reservation' });
    expect(reservationLinks[0]).toHaveAttribute('href', '/ops/reservations');
    expect(screen.queryByRole('link', { name: /communications/i })).not.toBeInTheDocument();
    expect(pageSource).not.toMatch(/to="\/ops\/communications"/);
  });
});
