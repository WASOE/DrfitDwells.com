import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import OpsSheet from './OpsSheet';
import { resetOpsOverlayRuntime } from './opsOverlay';

afterEach(() => {
  cleanup();
  resetOpsOverlayRuntime();
});

function renderInOpsRoot(ui) {
  return render(<div className="ops-root">{ui}</div>);
}

function pressTab(shiftKey = false) {
  fireEvent.keyDown(document.activeElement || document, { key: 'Tab', shiftKey });
}

describe('OpsSheet', () => {
  it('renders dialog semantics when open', () => {
    renderInOpsRoot(
      <OpsSheet open title="Filters" description="Narrow the list" onClose={vi.fn()} />
    );
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-describedby', screen.getByText('Narrow the list').id);
    expect(dialog).toHaveClass('ops-sheet', 'ops-sheet--bottom');
  });

  it('keeps a bottom sheet a sheet, and a right sheet a sheet', () => {
    const { rerender } = renderInOpsRoot(
      <OpsSheet open title="Filters" side="bottom" onClose={vi.fn()} />
    );
    expect(screen.getByRole('dialog')).toHaveClass('ops-sheet--bottom');
    expect(screen.getByRole('dialog')).not.toHaveClass('ops-modal');
    rerender(
      <div className="ops-root">
        <OpsSheet open title="Details" side="right" onClose={vi.fn()} />
      </div>
    );
    expect(screen.getByRole('dialog', { name: 'Details' })).toHaveClass('ops-sheet--right');
    expect(document.querySelector('[data-ops-sheet-side="right"]')).toBeTruthy();
    expect(screen.getByRole('dialog')).not.toHaveClass('ops-modal');
  });

  it('focuses initialFocusRef and falls back to the first control', async () => {
    function Harness() {
      const inputRef = useRef(null);
      return (
        <OpsSheet open title="Filters" onClose={vi.fn()} initialFocusRef={inputRef}>
          <input aria-label="Search" ref={inputRef} />
        </OpsSheet>
      );
    }
    renderInOpsRoot(<Harness />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Search'));
    });
  });

  it('Escape and backdrop request close; content clicks do not', () => {
    const onClose = vi.fn();
    renderInOpsRoot(
      <OpsSheet open title="Filters" onClose={onClose}>
        <p>Sheet body</p>
      </OpsSheet>
    );
    fireEvent.click(screen.getByText('Sheet body'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith({ reason: 'escape' });
    onClose.mockClear();
    fireEvent.click(document.querySelector('.ops-overlay__scrim'));
    expect(onClose).toHaveBeenCalledWith({ reason: 'backdrop' });
  });

  it('Tab cycles within the sheet and restores focus on close', async () => {
    function Harness({ open }) {
      return (
        <>
          <button type="button">Open filters</button>
          <OpsSheet open={open} title="Filters" onClose={vi.fn()}>
            <button type="button">Apply</button>
          </OpsSheet>
        </>
      );
    }
    const { rerender } = renderInOpsRoot(<Harness open={false} />);
    screen.getByRole('button', { name: 'Open filters' }).focus();
    rerender(
      <div className="ops-root">
        <Harness open />
      </div>
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const apply = screen.getByRole('button', { name: 'Apply' });
    await waitFor(() => {
      expect(document.activeElement).toBe(close);
    });
    pressTab();
    expect(document.activeElement).toBe(apply);
    pressTab();
    expect(document.activeElement).toBe(close);
    pressTab(true);
    expect(document.activeElement).toBe(apply);

    rerender(
      <div className="ops-root">
        <Harness open={false} />
      </div>
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open filters' }));
    });
  });
});
