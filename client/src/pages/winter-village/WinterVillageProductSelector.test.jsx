import { describe, expect, it, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import WinterVillageProductSelector from './components/WinterVillageProductSelector';
import WinterVillageDates from './components/WinterVillageDates';
import WinterVillagePreviewModal from './components/WinterVillagePreviewModal';
import './winter-village.css';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

function DatesAndSelectorHarness() {
  const [selectedProductId, setSelectedProductId] = useState('stay');
  return (
    <>
      <WinterVillageDates onSelectDate={setSelectedProductId} />
      <WinterVillageProductSelector
        selectedProductId={selectedProductId}
        onSelectProduct={setSelectedProductId}
        onRequestReserve={vi.fn()}
      />
    </>
  );
}

describe('WinterVillageProductSelector', () => {
  it('switches products and updates the panel heading', () => {
    const onSelectProduct = vi.fn();
    const { rerender } = render(
      <WinterVillageProductSelector
        selectedProductId="stay"
        onSelectProduct={onSelectProduct}
        onRequestReserve={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Winter Village Stay' })).toBeInTheDocument();
    expect(screen.getByText('Proposed total').parentElement).toHaveTextContent('€150');

    fireEvent.click(screen.getByRole('tab', { name: /Christmas in the Valley/i }));
    expect(onSelectProduct).toHaveBeenCalledWith('christmas');

    rerender(
      <WinterVillageProductSelector
        selectedProductId="christmas"
        onSelectProduct={onSelectProduct}
        onRequestReserve={vi.fn()}
      />
    );

    expect(
      screen.getByRole('heading', { level: 3, name: 'Christmas in the Valley' })
    ).toBeInTheDocument();
    expect(screen.getByText('Proposed total').parentElement).toHaveTextContent('€490');
  });

  it('opens the preview action for the selected product', () => {
    const onRequestReserve = vi.fn();
    render(
      <WinterVillageProductSelector
        selectedProductId="parent-child"
        onSelectProduct={vi.fn()}
        onRequestReserve={onRequestReserve}
      />
    );

    expect(screen.getByText('Proposed total').parentElement).toHaveTextContent('€260');
    fireEvent.click(screen.getByRole('button', { name: /Express interest/i }));
    expect(onRequestReserve).toHaveBeenCalledTimes(1);
  });

  it('moves keyboard focus to the selected product tab on arrow keys', async () => {
    const Harness = () => {
      const [selectedProductId, setSelectedProductId] = useState('stay');
      return (
        <WinterVillageProductSelector
          selectedProductId={selectedProductId}
          onSelectProduct={setSelectedProductId}
          onRequestReserve={vi.fn()}
        />
      );
    };

    render(<Harness />);

    const stayTab = screen.getByRole('tab', { name: /Winter Village Stay/i });
    stayTab.focus();
    expect(stayTab).toHaveFocus();

    fireEvent.keyDown(stayTab, { key: 'ArrowRight' });

    await waitFor(() => {
      const parentTab = screen.getByRole('tab', { name: /Parent & Child Winter Weekend/i });
      expect(parentTab).toHaveAttribute('aria-selected', 'true');
      expect(parentTab).toHaveFocus();
      expect(parentTab).toHaveAttribute('tabindex', '0');
    });

    expect(screen.getByRole('heading', { level: 3, name: 'Parent & Child Winter Weekend' })).toBeInTheDocument();
    expect(screen.getByText('Proposed total').parentElement).toHaveTextContent('€260');
  });

  it('exposes stepper groups without invalid htmlFor labels', () => {
    render(
      <WinterVillageProductSelector
        selectedProductId="stay"
        onSelectProduct={vi.fn()}
        onRequestReserve={vi.fn()}
      />
    );

    const nightsGroup = screen.getByRole('group', { name: 'Nights' });
    expect(nightsGroup).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decrease Nights' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase Nights' })).toBeEnabled();
    expect(document.querySelector('label[for]')).toBeNull();
  });
});

describe('WinterVillageDates', () => {
  it('selects the matching product when a date button is clicked', () => {
    const onSelectDate = vi.fn();
    render(<WinterVillageDates onSelectDate={onSelectDate} />);

    const buttons = screen.getAllByRole('button', { name: /View package/i });
    expect(buttons).toHaveLength(4);

    fireEvent.click(buttons[0]);
    expect(onSelectDate).toHaveBeenCalledWith('stay');

    fireEvent.click(buttons[1]);
    expect(onSelectDate).toHaveBeenCalledWith('christmas');

    fireEvent.click(buttons[2]);
    expect(onSelectDate).toHaveBeenCalledWith('parent-child');

    fireEvent.click(buttons[3]);
    expect(onSelectDate).toHaveBeenCalledWith('parent-child');
  });

  it('Deep Winter Weekend selects Parent & Child and shows package pricing', () => {
    render(<DatesAndSelectorHarness />);

    const deepWinterRow = screen.getByRole('heading', { name: 'Deep Winter Weekend' }).closest('li');
    fireEvent.click(deepWinterRow.querySelector('button'));

    expect(
      screen.getByRole('heading', { level: 3, name: 'Parent & Child Winter Weekend' })
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Parent & Child Winter Weekend/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText('Proposed total').parentElement).toHaveTextContent('€260');
  });
});

describe('WinterVillagePreviewModal', () => {
  it('moves focus inside on open, traps Tab, closes on Escape, and restores focus', async () => {
    function ModalHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open preview
          </button>
          <WinterVillagePreviewModal open={open} onClose={() => setOpen(false)} />
        </>
      );
    }

    render(<ModalHarness />);
    const opener = screen.getByRole('button', { name: 'Open preview' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    await waitFor(() => {
      expect(closeButtons[0]).toHaveFocus();
    });

    // From first focusable, Shift+Tab wraps to last
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    await waitFor(() => {
      expect(closeButtons[closeButtons.length - 1]).toHaveFocus();
    });

    // From last focusable, Tab wraps to first
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    await waitFor(() => {
      expect(closeButtons[0]).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });
  });
});
