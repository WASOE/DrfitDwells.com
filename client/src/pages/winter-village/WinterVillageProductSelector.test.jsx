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

    expect(screen.getByRole('heading', { level: 3, name: 'Winter Cabin Stay' })).toBeInTheDocument();
    expect(screen.getByText('Total for this stay').parentElement).toHaveTextContent('€150');

    fireEvent.click(screen.getByRole('tab', { name: /Christmas in The Valley/i }));
    expect(onSelectProduct).toHaveBeenCalledWith('christmas');

    rerender(
      <WinterVillageProductSelector
        selectedProductId="christmas"
        onSelectProduct={onSelectProduct}
        onRequestReserve={vi.fn()}
      />
    );

    expect(
      screen.getByRole('heading', { level: 3, name: 'Christmas in The Valley' })
    ).toBeInTheDocument();
    expect(screen.getByText('Total for this stay').parentElement).toHaveTextContent('€490');
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

    expect(screen.getByText('Total for this stay').parentElement).toHaveTextContent('€260');
    fireEvent.click(screen.getByRole('button', { name: /Booking opens soon/i }));
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

    const stayTab = screen.getByRole('tab', { name: /Winter Cabin Stay/i });
    stayTab.focus();
    expect(stayTab).toHaveFocus();

    fireEvent.keyDown(stayTab, { key: 'ArrowRight' });

    await waitFor(() => {
      const parentTab = screen.getByRole('tab', { name: /Parent & Child Winter Weekend/i });
      expect(parentTab).toHaveAttribute('aria-selected', 'true');
      expect(parentTab).toHaveFocus();
      expect(parentTab).toHaveAttribute('tabindex', '0');
    });

    expect(
      screen.getByRole('heading', { level: 3, name: 'Parent & Child Winter Weekend' })
    ).toBeInTheDocument();
    expect(screen.getByText('Total for this stay').parentElement).toHaveTextContent('€260');
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

  it('does not offer wellness as a purchasable add-on before facilities are confirmed', () => {
    render(
      <WinterVillageProductSelector
        selectedProductId="stay"
        onSelectProduct={vi.fn()}
        onRequestReserve={vi.fn()}
      />
    );

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/private sauna and hot-tub session/i)).toBeNull();
  });
});

describe('WinterVillageDates', () => {
  it('selects the matching product when a date button is clicked', () => {
    const onSelectDate = vi.fn();
    render(<WinterVillageDates onSelectDate={onSelectDate} />);

    fireEvent.click(screen.getByRole('button', { name: /See this stay/i }));
    expect(onSelectDate).toHaveBeenCalledWith('stay');

    fireEvent.click(screen.getByRole('button', { name: /See Christmas/i }));
    expect(onSelectDate).toHaveBeenCalledWith('christmas');

    const weekendButtons = screen.getAllByRole('button', { name: /See the weekend/i });
    expect(weekendButtons).toHaveLength(2);
    fireEvent.click(weekendButtons[0]);
    expect(onSelectDate).toHaveBeenCalledWith('parent-child');
    fireEvent.click(weekendButtons[1]);
    expect(onSelectDate).toHaveBeenCalledWith('parent-child');
  });

  it('Deep Winter Weekend selects Parent & Child and shows package pricing', () => {
    render(<DatesAndSelectorHarness />);

    const deepWinterRow = screen
      .getByRole('heading', { name: 'Deep Winter Parent & Child Weekend' })
      .closest('li');
    fireEvent.click(deepWinterRow.querySelector('button'));

    expect(
      screen.getAllByRole('heading', { level: 3, name: 'Parent & Child Winter Weekend' }).length
    ).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: /Parent & Child Winter Weekend/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText('Total for this stay').parentElement).toHaveTextContent('€260');
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
    expect(dialog).toHaveTextContent(/Bookings are not open yet/i);

    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    await waitFor(() => {
      expect(closeButtons[0]).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    await waitFor(() => {
      expect(closeButtons[closeButtons.length - 1]).toHaveFocus();
    });

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
