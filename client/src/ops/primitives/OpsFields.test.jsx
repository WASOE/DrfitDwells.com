import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OpsTextField from './OpsTextField';
import OpsSelect from './OpsSelect';
import OpsTextarea from './OpsTextarea';
import OpsCheckbox from './OpsCheckbox';

afterEach(() => {
  cleanup();
});

describe('Ops fields', () => {
  it('associates labels, hints, and errors on a text field', () => {
    render(
      <OpsTextField id="guest" label="Guest name" hint="As shown on the booking" error="Required" />
    );
    const input = screen.getByLabelText('Guest name');
    expect(input).toHaveAttribute('id', 'guest');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/As shown on the booking/);
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
    expect(screen.getByText('Required').id).toBe('guest-error');
  });

  it('associates a native select with its label and error', () => {
    render(
      <OpsSelect id="cabin" label="Cabin" error="Choose a cabin">
        <option value="">Select</option>
        <option value="a">A-Frame</option>
      </OpsSelect>
    );
    const select = screen.getByLabelText('Cabin');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a cabin');
  });

  it('associates textarea hint and error', () => {
    render(<OpsTextarea id="notes" label="Notes" hint="Internal only" error="Too short" />);
    const area = screen.getByLabelText('Notes');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveAttribute('aria-invalid', 'true');
    expect(area).toHaveAccessibleDescription(/Internal only/);
  });

  it('makes the checkbox label clickable', () => {
    render(<OpsCheckbox id="agree" label="Notify guest" />);
    const checkbox = screen.getByLabelText('Notify guest');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(screen.getByText('Notify guest'));
    expect(checkbox).toBeChecked();
  });
});
