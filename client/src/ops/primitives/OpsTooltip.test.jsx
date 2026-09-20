import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OpsIconButton from './OpsIconButton';
import OpsTooltip, { OPS_TOOLTIP_SIDES } from './OpsTooltip';

afterEach(() => {
  cleanup();
});

function renderTooltip(ui) {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      {ui}
    </div>
  );
}

function showWithFocus(name = 'Calendar') {
  const trigger = screen.getByRole('button', { name });
  fireEvent.focus(trigger);
  return trigger;
}

describe('OpsTooltip', () => {
  it('renders exactly one trigger', () => {
    renderTooltip(
      <OpsTooltip content="Calendar">
        <button type="button">Calendar</button>
      </OpsTooltip>
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
  });

  it('keeps the tooltip hidden initially', () => {
    renderTooltip(
      <OpsTooltip content="Calendar">
        <button type="button">Calendar</button>
      </OpsTooltip>
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the tooltip on focus and hides it on blur', () => {
    renderTooltip(
      <OpsTooltip content="Calendar">
        <button type="button">Calendar</button>
      </OpsTooltip>
    );
    const trigger = showWithFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Calendar');
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the tooltip on hover and hides it on pointer leave', () => {
    renderTooltip(
      <OpsTooltip content="Calendar">
        <button type="button">Calendar</button>
      </OpsTooltip>
    );
    const trigger = screen.getByRole('button', { name: 'Calendar' });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Calendar');
    fireEvent.pointerLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('uses role="tooltip" and sets aria-describedby while open', () => {
    renderTooltip(
      <OpsTooltip content="Calendar">
        <button type="button">Calendar</button>
      </OpsTooltip>
    );
    const trigger = showWithFocus();
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveAttribute('role', 'tooltip');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
  });

  it('preserves an existing aria-describedby value while open', () => {
    renderTooltip(
      <OpsTooltip content="Calendar">
        <button type="button" aria-describedby="hint">
          Calendar
        </button>
      </OpsTooltip>
    );
    const trigger = showWithFocus();
    const tooltip = screen.getByRole('tooltip');
    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy?.split(/\s+/)).toEqual(expect.arrayContaining(['hint', tooltip.id]));
    fireEvent.blur(trigger);
    expect(screen.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-describedby', 'hint');
  });

  it('closes on Escape without activating the trigger', () => {
    const onClick = vi.fn();
    renderTooltip(
      <OpsTooltip content="Calendar">
        <button type="button" onClick={onClick}>
          Calendar
        </button>
      </OpsTooltip>
    );
    const trigger = showWithFocus();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('leaves the child accessible name intact', () => {
    renderTooltip(
      <OpsTooltip content="Open calendar">
        <OpsIconButton label="Calendar">
          <span aria-hidden="true">◇</span>
        </OpsIconButton>
      </OpsTooltip>
    );
    const trigger = screen.getByRole('button', { name: 'Calendar' });
    expect(trigger).toHaveAttribute('aria-label', 'Calendar');
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Open calendar');
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
  });

  it('applies placement class and data-side for each side', () => {
    expect(OPS_TOOLTIP_SIDES).toEqual(['top', 'right', 'bottom', 'left']);
    const { rerender } = renderTooltip(
      <OpsTooltip content="Calendar">
        <button type="button">Calendar</button>
      </OpsTooltip>
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('tooltip')).toHaveAttribute('data-side', 'top');
    expect(screen.getByRole('tooltip')).toHaveClass('ops-tooltip__content--top');

    for (const side of OPS_TOOLTIP_SIDES) {
      rerender(
        <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
          <OpsTooltip content="Calendar" side={side}>
            <button type="button">Calendar</button>
          </OpsTooltip>
        </div>
      );
      fireEvent.focus(screen.getByRole('button', { name: 'Calendar' }));
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toHaveAttribute('data-side', side);
      expect(tooltip).toHaveClass(`ops-tooltip__content--${side}`);
    }
  });

  it('does not appear when disabled', () => {
    renderTooltip(
      <OpsTooltip content="Calendar" disabled>
        <button type="button">Calendar</button>
      </OpsTooltip>
    );
    const trigger = screen.getByRole('button', { name: 'Calendar' });
    fireEvent.focus(trigger);
    fireEvent.mouseEnter(trigger);
    fireEvent.pointerEnter(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('does not use a title attribute on the tooltip', () => {
    renderTooltip(
      <OpsTooltip content="Calendar">
        <button type="button">Calendar</button>
      </OpsTooltip>
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('tooltip')).not.toHaveAttribute('title');
  });
});
