import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OpsConfirmDialog from './OpsConfirmDialog';
import { resetOpsOverlayRuntime } from './opsOverlay';

afterEach(() => {
  cleanup();
  resetOpsOverlayRuntime();
});

function renderInOpsRoot(ui) {
  return render(<div className="ops-root">{ui}</div>);
}

describe('OpsConfirmDialog', () => {
  it('renders explicit Cancel and Confirm actions', () => {
    renderInOpsRoot(
      <OpsConfirmDialog
        open
        title="Discard changes"
        body="Unsaved edits will be lost."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog', { name: 'Discard changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('ops-button--secondary');
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('ops-button--primary');
  });

  it('uses OpsButton destructive for destructive tone', () => {
    renderInOpsRoot(
      <OpsConfirmDialog
        open
        title="Delete item"
        tone="destructive"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('ops-button--destructive');
  });

  it('does not dismiss when the backdrop is clicked', () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    renderInOpsRoot(
      <OpsConfirmDialog open title="Discard changes" onCancel={onCancel} onClose={onClose} />
    );
    fireEvent.click(document.querySelector('.ops-overlay__scrim'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape invokes cancel behavior', () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    renderInOpsRoot(
      <OpsConfirmDialog open title="Discard changes" onCancel={onCancel} onClose={onClose} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledWith({ reason: 'escape' });
    expect(onClose).toHaveBeenCalledWith({ reason: 'escape' });
  });

  it('places initial focus on Cancel unless overridden', async () => {
    renderInOpsRoot(
      <OpsConfirmDialog open title="Discard changes" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });
  });

  it('loading prevents duplicate confirm and a successful confirm fires once', () => {
    const onConfirm = vi.fn();
    const { rerender } = renderInOpsRoot(
      <OpsConfirmDialog
        open
        title="Discard changes"
        loading
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const busy = screen.getByRole('button', { name: 'Confirm' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <div className="ops-root">
        <OpsConfirmDialog open title="Discard changes" onConfirm={onConfirm} onCancel={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('confirm reports reason confirm', () => {
    const onConfirm = vi.fn();
    renderInOpsRoot(
      <OpsConfirmDialog open title="Discard changes" onConfirm={onConfirm} onCancel={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ reason: 'confirm' });
  });
});
