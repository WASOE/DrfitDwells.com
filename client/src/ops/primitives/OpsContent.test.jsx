import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpsPageHeader from './OpsPageHeader';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from './OpsTable';
import OpsCollectionRow from './OpsCollectionRow';
import OpsBanner from './OpsBanner';
import OpsLoadingState from './OpsLoadingState';
import OpsEmptyState from './OpsEmptyState';
import OpsInlineError from './OpsInlineError';
import OpsButton from './OpsButton';

afterEach(() => {
  cleanup();
});

describe('OpsPageHeader', () => {
  it('renders an h1, description, and actions', () => {
    render(
      <OpsPageHeader
        title="Reservations"
        description="Open stays"
        actions={<OpsButton>Create</OpsButton>}
      />
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Reservations' })).toBeInTheDocument();
    expect(screen.getByText('Open stays')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('does not render a back control when the back prop is absent', () => {
    render(<OpsPageHeader title="Reservations" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('.ops-page-header__back')).toBeNull();
  });

  it('renders a single back link with the provided to and label', () => {
    render(
      <MemoryRouter>
        <OpsPageHeader
          back={{ to: '/ops/gift-vouchers', label: 'Gift vouchers' }}
          title="DD-ACTIVE-01"
          meta={<span>Active</span>}
          actions={<OpsButton variant="secondary">Print card</OpsButton>}
        />
      </MemoryRouter>
    );
    const back = screen.getByRole('link', { name: 'Gift vouchers' });
    expect(back).toHaveAttribute('href', '/ops/gift-vouchers');
    expect(back).toHaveClass('ops-page-header__back-link');
    expect(screen.getByRole('heading', { level: 1, name: 'DD-ACTIVE-01' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print card' })).toBeInTheDocument();
    expect(back.contains(screen.getByRole('button', { name: 'Print card' }))).toBe(false);
  });

  it('keeps token class architecture and does not nest actions inside the back link', () => {
    const { container } = render(
      <MemoryRouter>
        <OpsPageHeader
          back={{ to: '/ops/gift-vouchers', label: 'Gift vouchers' }}
          title="DD-ACTIVE-01"
          actions={<OpsButton>Print card</OpsButton>}
        />
      </MemoryRouter>
    );
    const header = container.querySelector('.ops-page-header');
    expect(header.querySelector('.ops-page-header__title')).toBeTruthy();
    expect(header.querySelector('.ops-page-header__actions')).toBeTruthy();
    expect(header.querySelector('.ops-page-header__back-link').tagName).toBe('A');
    expect(header.className).not.toMatch(/dark:|html\.dark|gray-/);
  });

  it('exposes inline meta as an opt-in header variant', () => {
    const { container } = render(
      <OpsPageHeader title="Dashboard" meta={<span>Healthy</span>} metaPlacement="inline" />
    );
    expect(container.querySelector('.ops-page-header')).toHaveClass('ops-page-header--meta-inline');
  });
});

describe('OpsTable', () => {
  it('uses semantic table structure and numeric alignment', () => {
    render(
      <OpsTable>
        <OpsTableHead>
          <OpsTableRow>
            <OpsTableHeader>Guest</OpsTableHeader>
            <OpsTableHeader align="end" numeric>
              Amount
            </OpsTableHeader>
          </OpsTableRow>
        </OpsTableHead>
        <OpsTableBody>
          <OpsTableRow>
            <OpsTableCell>Ada</OpsTableCell>
            <OpsTableCell align="end" numeric>
              120
            </OpsTableCell>
          </OpsTableRow>
        </OpsTableBody>
      </OpsTable>
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Guest' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveClass(
      'ops-table__cell--end',
      'ops-table__cell--numeric'
    );
    expect(screen.getByRole('cell', { name: '120' })).toHaveClass('ops-table__cell--numeric');
  });
});

describe('OpsCollectionRow', () => {
  it('renders a navigation row as a link', () => {
    render(
      <MemoryRouter>
        <OpsCollectionRow title="Ada Lovelace" meta="The Cabin" to="/ops/reservations/1" />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /Ada Lovelace/ })).toHaveAttribute(
      'href',
      '/ops/reservations/1'
    );
  });

  it('keeps row actions outside the navigation link', () => {
    render(
      <MemoryRouter>
        <OpsCollectionRow
          title="Ada Lovelace"
          to="/ops/reservations/1"
          actions={<OpsButton>More</OpsButton>}
        />
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: /Ada Lovelace/ });
    const action = screen.getByRole('button', { name: 'More' });
    expect(link.contains(action)).toBe(false);
  });
});

describe('OpsBanner and feedback', () => {
  it('uses status for info and alert for danger/warning', () => {
    const { rerender } = render(<OpsBanner tone="info" title="Synced" />);
    expect(screen.getByRole('status')).toHaveTextContent('Synced');
    rerender(<OpsBanner tone="warning" title="Stale" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Stale');
    rerender(<OpsBanner tone="danger" title="Failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  });

  it('exposes loading, empty, and inline error semantics', () => {
    render(
      <>
        <OpsLoadingState label="Loading reservations" />
        <OpsEmptyState variant="filtered" title="No matches" body="Try clearing filters" />
        <OpsInlineError>Could not save</OpsInlineError>
      </>
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading reservations');
    expect(screen.getByText('No matches').closest('[data-ops-empty-variant]')).toHaveAttribute(
      'data-ops-empty-variant',
      'filtered'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  });
});
