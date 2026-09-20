import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OpsAppearanceProvider } from '../appearance/OpsAppearanceProvider';
import { OPS_APPEARANCE_STORAGE_KEY } from '../appearance/opsAppearance';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { getOpsCleanerMessage, listOpsCleanerMessageKeys } from '../i18n/opsUiLanguage';
import { getOpsStatusByKey, resolveOpsStatus } from '../status/opsStatusRegistry';
import { resetOpsOverlayRuntime } from '../primitives/opsOverlay';
import OpsDesignSystemPage from './OpsDesignSystemPage';

const adminSession = {
  authenticated: true,
  role: 'admin',
  modules: ['*'],
  actions: ['ops.users.manage'],
  defaultRoute: '/ops',
  locale: 'en'
};

afterEach(() => {
  cleanup();
  resetOpsOverlayRuntime();
  localStorage.removeItem(OPS_APPEARANCE_STORAGE_KEY);
  document.documentElement.removeAttribute('data-ops-active');
  document.documentElement.removeAttribute('data-ops-appearance');
  document.documentElement.removeAttribute('data-ops-appearance-mode');
});

function renderPage() {
  return render(
    <MemoryRouter>
      <OpsAppearanceProvider>
        <OpsSessionProvider session={adminSession}>
          <OpsDesignSystemPage />
        </OpsSessionProvider>
      </OpsAppearanceProvider>
    </MemoryRouter>
  );
}

describe('OpsDesignSystemPage', () => {
  beforeEach(() => {
    localStorage.removeItem(OPS_APPEARANCE_STORAGE_KEY);
  });

  it('opts into themed ops-root and uses the real appearance provider', () => {
    renderPage();
    const root = screen.getByTestId('ops-design-system');
    expect(root).toHaveClass('ops-root');
    expect(root).toHaveAttribute('data-ops-themed', 'true');
    expect(root).toHaveAttribute('data-ops-appearance');
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(localStorage.getItem(OPS_APPEARANCE_STORAGE_KEY)).toBe('dark');
    expect(root).toHaveAttribute('data-ops-appearance', 'dark');
    expect(root).toHaveAttribute('data-ops-appearance-mode', 'dark');
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(localStorage.getItem(OPS_APPEARANCE_STORAGE_KEY)).toBe('light');
    expect(root).toHaveAttribute('data-ops-appearance', 'light');
    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(localStorage.getItem(OPS_APPEARANCE_STORAGE_KEY)).toBe('system');
  });

  it('renders representative primitives', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Design system' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('ops-button--primary');
    expect(screen.getByRole('button', { name: 'Edit stay' })).toHaveAttribute('aria-label', 'Edit stay');
    expect(screen.getByLabelText('Guest name')).toBeInTheDocument();
    expect(screen.getByLabelText('Property')).toBeInTheDocument();
    expect(screen.getByLabelText('Internal note')).toBeInTheDocument();
    expect(screen.getByLabelText('Send confirmation email')).toBeInTheDocument();
    expect(screen.getByText('Needs review')).toHaveClass('ops-badge--info');
    expect(screen.getByRole('table', { name: 'Sample stays' })).toBeInTheDocument();
    expect(screen.getAllByText('Георги Иванов').length).toBeGreaterThan(1);
    expect(screen.getAllByText('€280.00').some((node) => node.classList.contains('ops-table__cell--numeric'))).toBe(
      true
    );
    expect(screen.getByText('Loading stays')).toHaveAttribute('role', 'status');
    expect(screen.getByText('No stays in this range')).toBeInTheDocument();
    expect(screen.getByText('Check-out must be after check-in.')).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: 'Open modal' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
  });

  it('resolves status examples through the registry', () => {
    renderPage();
    expect(getOpsStatusByKey('reservation.confirmed').label.en).toBe('Confirmed');
    expect(screen.getByText('reservation.confirmed').closest('.ops-ds-status-item').querySelector('[data-ops-status-key]')).toHaveAttribute(
      'data-ops-status-key',
      'reservation.confirmed'
    );
    expect(resolveOpsStatus('commission', 'void').key).toBe('commission.voided');
    expect(screen.getByTestId('ops-ds-commission-void').querySelector('[data-ops-status-key]')).toHaveAttribute(
      'data-ops-status-key',
      'commission.voided'
    );
    expect(screen.getByTestId('ops-ds-commission-void')).toHaveTextContent('Voided');
  });

  it('uses actual cleaner namespace strings for the EN/BG sample', () => {
    renderPage();
    const keys = listOpsCleanerMessageKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const row = document.querySelector(`[data-ops-cleaner-key="${key}"]`);
      expect(row).toBeTruthy();
      expect(row).toHaveTextContent(getOpsCleanerMessage(key, 'en'));
      expect(row.querySelector(`[data-ops-cleaner-bg="${key}"]`)).toHaveTextContent(getOpsCleanerMessage(key, 'bg'));
    }
    expect(screen.getByText('За почистване')).toBeInTheDocument();
    expect(screen.getByText('Смяна в същия ден')).toBeInTheDocument();
  });

  it('opens and closes overlay samples', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open modal' }));
    expect(screen.getByRole('dialog', { name: 'Edit stay' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit stay' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open bottom sheet' }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveClass('ops-sheet--bottom');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open right sheet' }));
    expect(screen.getByRole('dialog', { name: 'Stay details' })).toHaveClass('ops-sheet--right');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Stay details' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }));
    const confirm = screen.getByRole('dialog', { name: 'Discard unsaved dates?' });
    expect(confirm).toBeInTheDocument();
    await waitFor(() => {
      expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Cancel' }));
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Discard unsaved dates?' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open destructive confirm' }));
    const destructive = screen.getByRole('dialog', { name: 'Delete this stay?' });
    expect(within(destructive).getByRole('button', { name: 'Delete' })).toHaveClass('ops-button--destructive');
    fireEvent.click(within(destructive).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Delete this stay?' })).not.toBeInTheDocument();
    });
  });
});
