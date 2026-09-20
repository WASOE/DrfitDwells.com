import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import OpsPage from '../primitives/OpsPage';
import { OpsPageWidthProvider, useOpsPageOwnsWidth } from './OpsPageLayoutContext';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function WidthProbe() {
  const owns = useOpsPageOwnsWidth();
  return <div data-testid="width-probe">{owns ? 'owned' : 'legacy'}</div>;
}

function Harness({ showPage, nested = false }) {
  return (
    <OpsPageWidthProvider>
      <WidthProbe />
      {showPage ? (
        <OpsPage width="wide">
          {nested ? <OpsPage width="narrow">Inner</OpsPage> : <span>Migrated</span>}
        </OpsPage>
      ) : (
        <div>Legacy page</div>
      )}
    </OpsPageWidthProvider>
  );
}

describe('OpsPageLayoutContext', () => {
  it('stays legacy until an OpsPage mounts, then restores on unmount', () => {
    const { rerender } = render(<Harness showPage={false} />);
    expect(screen.getByTestId('width-probe')).toHaveTextContent('legacy');

    rerender(<Harness showPage />);
    expect(screen.getByTestId('width-probe')).toHaveTextContent('owned');
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');

    rerender(<Harness showPage={false} />);
    expect(screen.getByTestId('width-probe')).toHaveTextContent('legacy');
  });

  it('keeps ownership and warns when OpsPage is nested', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Harness showPage nested />);
    expect(screen.getByTestId('width-probe')).toHaveTextContent('owned');
    expect(screen.getAllByTestId('ops-page')).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((call) => String(call[0]).includes('nested OpsPage is unsupported'))).toBe(true);
  });

  it('renders OpsPage without a provider and does not throw', () => {
    render(
      <OpsPage width="default">
        <span>Standalone</span>
      </OpsPage>
    );
    expect(screen.getByText('Standalone')).toBeInTheDocument();
  });
});
