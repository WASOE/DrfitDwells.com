import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OpsButton, { OPS_BUTTON_VARIANTS } from './OpsButton';
import OpsIconButton from './OpsIconButton';

afterEach(() => {
  cleanup();
});

describe('OpsButton', () => {
  it('renders a native button with default type button', () => {
    render(<OpsButton>Save</OpsButton>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('ops-button', 'ops-button--primary');
  });

  it('supports primary, secondary, quiet, and destructive variants', () => {
    expect(OPS_BUTTON_VARIANTS).toEqual(['primary', 'secondary', 'quiet', 'destructive']);
    const { rerender } = render(<OpsButton variant="secondary">Alt</OpsButton>);
    expect(screen.getByRole('button')).toHaveClass('ops-button--secondary');
    rerender(<OpsButton variant="quiet">Quiet</OpsButton>);
    expect(screen.getByRole('button')).toHaveClass('ops-button--quiet');
    expect(screen.getByRole('button')).not.toHaveClass('ops-button--ghost');
    rerender(<OpsButton variant="destructive">Delete</OpsButton>);
    expect(screen.getByRole('button')).toHaveClass('ops-button--destructive');
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <OpsButton disabled onClick={onClick}>
        Save
      </OpsButton>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('loading prevents duplicate action and exposes busy state', () => {
    const onClick = vi.fn();
    render(
      <OpsButton loading onClick={onClick}>
        Save
      </OpsButton>
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('uses compact size class without changing the 36px default token class', () => {
    const { rerender } = render(<OpsButton>Default</OpsButton>);
    expect(screen.getByRole('button')).not.toHaveClass('ops-button--compact');
    rerender(<OpsButton size="compact">Compact</OpsButton>);
    expect(screen.getByRole('button')).toHaveClass('ops-button--compact');
  });
});

describe('OpsIconButton', () => {
  it('requires a label and exposes it as the accessible name', () => {
    render(
      <OpsIconButton label="Close">
        <span>×</span>
      </OpsIconButton>
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-label', 'Close');
  });

  it('throws when label is omitted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <OpsIconButton>
          <span>×</span>
        </OpsIconButton>
      )
    ).toThrow(/requires a label/);
    spy.mockRestore();
  });
});
