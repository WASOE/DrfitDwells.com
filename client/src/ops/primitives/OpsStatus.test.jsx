import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import OpsStatus from './OpsStatus';

afterEach(() => {
  cleanup();
});

function renderStatus(ui, session = null) {
  return render(<OpsSessionProvider session={session}>{ui}</OpsSessionProvider>);
}

describe('OpsStatus', () => {
  it('resolves a canonical key', () => {
    renderStatus(<OpsStatus name="sync.stale" />);
    const status = screen.getByText('Sync stale');
    expect(status).toHaveClass('ops-status--warning');
    expect(status).toHaveAttribute('data-ops-status-key', 'sync.stale');
  });

  it('resolves domain and backend value', () => {
    renderStatus(<OpsStatus domain="cleaning" value="pending" />);
    expect(screen.getByText('Needs cleaning')).toHaveClass('ops-status--warning');
  });

  it('resolves commission void to Voided', () => {
    renderStatus(<OpsStatus domain="commission" value="void" />);
    expect(screen.getByText('Voided')).toHaveAttribute('data-ops-status-key', 'commission.voided');
  });

  it('renders unknown values as a safe fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderStatus(<OpsStatus domain="reservation" value="not_a_real_state" />);
    const status = screen.getByText('Not a real state');
    expect(status).toHaveClass('ops-status--neutral');
    expect(status).toHaveAttribute('data-ops-status-unknown', 'true');
    warn.mockRestore();
  });

  it('uses the English cleaning label for admin', () => {
    renderStatus(<OpsStatus name="cleaning.pending" />, {
      role: 'admin',
      locale: 'bg'
    });
    expect(screen.getByText('Needs cleaning')).toBeInTheDocument();
    expect(screen.queryByText('За почистване')).not.toBeInTheDocument();
  });

  it('uses the Bulgarian cleaning label for a cleaner with locale bg', () => {
    renderStatus(<OpsStatus name="cleaning.pending" />, {
      role: 'cleaner',
      locale: 'bg'
    });
    expect(screen.getByText('За почистване')).toBeInTheDocument();
  });
});
