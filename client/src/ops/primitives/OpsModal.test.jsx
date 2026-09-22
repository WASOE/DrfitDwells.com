import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import OpsModal from './OpsModal';
import { getOpsScrollLockCount, resetOpsOverlayRuntime } from './opsOverlay';

afterEach(() => {
  cleanup();
  resetOpsOverlayRuntime();
});

function renderInOpsRoot(ui, appearance = 'light') {
  return render(
    <div className="ops-root" data-ops-appearance={appearance} data-ops-themed="true">
      {ui}
    </div>
  );
}

function pressTab(shiftKey = false) {
  fireEvent.keyDown(document.activeElement || document, { key: 'Tab', shiftKey });
}

describe('OpsModal', () => {
  it('renders no active dialog when closed', () => {
    renderInOpsRoot(<OpsModal open={false} title="Edit stay" onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders role=dialog when open and labels it with the title', () => {
    renderInOpsRoot(
      <OpsModal open title="Edit stay" onClose={vi.fn()}>
        Body
      </OpsModal>
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit stay' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', screen.getByText('Edit stay').id);
  });

  it('uses a caller-provided title id when a workflow owns that contract', () => {
    render(
      <OpsModal open onClose={() => {}} title="Preview" titleId="preview-title">
        Body
      </OpsModal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'preview-title');
    expect(screen.getByRole('heading', { name: 'Preview' })).toHaveAttribute('id', 'preview-title');
  });

  it('connects description through aria-describedby', () => {
    renderInOpsRoot(
      <OpsModal open title="Edit stay" description="Update dates" onClose={vi.fn()} />
    );
    const dialog = screen.getByRole('dialog');
    const description = screen.getByText('Update dates');
    expect(dialog).toHaveAttribute('aria-describedby', description.id);
  });

  it('focuses initialFocusRef when supplied', async () => {
    function Harness() {
      const inputRef = useRef(null);
      return (
        <OpsModal open title="Edit stay" onClose={vi.fn()} initialFocusRef={inputRef}>
          <input aria-label="Guest name" ref={inputRef} />
        </OpsModal>
      );
    }
    renderInOpsRoot(<Harness />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Guest name'));
    });
  });

  it('falls back to the first interactive element when no initialFocusRef is supplied', async () => {
    renderInOpsRoot(
      <OpsModal open title="Edit stay" onClose={vi.fn()} showCloseButton={false}>
        <button type="button">Save</button>
      </OpsModal>
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
    });
  });

  it('falls back to the dialog container when there is no interactive element', async () => {
    renderInOpsRoot(
      <OpsModal open title="Note" onClose={vi.fn()} showCloseButton={false}>
        <p>Read only</p>
      </OpsModal>
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Note' }));
    });
  });

  it('Escape requests close with reason escape', () => {
    const onClose = vi.fn();
    renderInOpsRoot(<OpsModal open title="Edit stay" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith({ reason: 'escape' });
  });

  it('backdrop requests close when allowed, and dialog content clicks do not', () => {
    const onClose = vi.fn();
    renderInOpsRoot(
      <OpsModal open title="Edit stay" onClose={onClose}>
        <p>Inner copy</p>
      </OpsModal>
    );
    fireEvent.click(screen.getByText('Inner copy'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.ops-overlay__scrim'));
    expect(onClose).toHaveBeenCalledWith({ reason: 'backdrop' });
  });

  it('does not close from backdrop when closeOnBackdrop is false', () => {
    const onClose = vi.fn();
    renderInOpsRoot(
      <OpsModal open title="Edit stay" onClose={onClose} closeOnBackdrop={false} />
    );
    fireEvent.click(document.querySelector('.ops-overlay__scrim'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('close button has an accessible name and reports close-button', () => {
    const onClose = vi.fn();
    renderInOpsRoot(<OpsModal open title="Edit stay" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledWith({ reason: 'close-button' });
  });

  it('Tab and Shift+Tab cycle within the dialog', async () => {
    renderInOpsRoot(
      <OpsModal open title="Edit stay" onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </OpsModal>
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    await waitFor(() => {
      expect(document.activeElement).toBe(close);
    });
    pressTab();
    expect(document.activeElement).toBe(first);
    pressTab();
    expect(document.activeElement).toBe(last);
    pressTab();
    expect(document.activeElement).toBe(close);
    pressTab(true);
    expect(document.activeElement).toBe(last);
  });

  it('restores focus to the trigger when it still exists', async () => {
    function Harness({ open }) {
      return (
        <>
          <button type="button">Open</button>
          <OpsModal open={open} title="Edit stay" onClose={vi.fn()} />
        </>
      );
    }
    const { rerender } = renderInOpsRoot(<Harness open={false} />);
    screen.getByRole('button', { name: 'Open' }).focus();
    rerender(
      <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
        <Harness open />
      </div>
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    });
    rerender(
      <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
        <Harness open={false} />
      </div>
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
    });
  });

  it('keeps overlay content under .ops-root and does not portal to document.body', () => {
    renderInOpsRoot(<OpsModal open title="Edit stay" onClose={vi.fn()} />);
    const host = document.querySelector('.ops-overlay-host');
    expect(host).toBeTruthy();
    expect(host.parentElement).toHaveClass('ops-root');
    expect(host.parentElement).not.toBe(document.body);
    expect(document.body.querySelector(':scope > .ops-overlay-host')).toBeNull();
    expect(host.querySelector('[data-ops-overlay="modal"]')).toBeTruthy();
  });

  it('exposes canonical large and mobile-sheet variants without changing dialog semantics', () => {
    renderInOpsRoot(
      <OpsModal open title="Move unit" onClose={vi.fn()} size="lg" mobileSheet>
        Body
      </OpsModal>
    );
    expect(screen.getByRole('dialog', { name: 'Move unit' })).toHaveClass(
      'ops-modal--lg',
      'ops-modal--sheet-mobile'
    );
    expect(document.querySelector('.ops-overlay--modal-sheet-mobile')).toBeInTheDocument();
  });
});

describe('OpsModal scroll lock', () => {
  it('locks on first overlay and restores original overflow after the last close', () => {
    document.body.style.overflow = 'auto';
    const { rerender } = renderInOpsRoot(
      <>
        <OpsModal open title="First" onClose={vi.fn()} />
        <OpsModal open title="Second" onClose={vi.fn()} />
      </>
    );
    expect(getOpsScrollLockCount()).toBe(2);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <div className="ops-root">
        <OpsModal open={false} title="First" onClose={vi.fn()} />
        <OpsModal open title="Second" onClose={vi.fn()} />
      </div>
    );
    expect(getOpsScrollLockCount()).toBe(1);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <div className="ops-root">
        <OpsModal open={false} title="First" onClose={vi.fn()} />
        <OpsModal open={false} title="Second" onClose={vi.fn()} />
      </div>
    );
    expect(getOpsScrollLockCount()).toBe(0);
    expect(document.body.style.overflow).toBe('auto');
  });
});
