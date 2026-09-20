import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    expect(select).toHaveClass('ops-select');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a cabin');
  });

  it('keeps native select semantics with a non-interactive chevron', () => {
    const { container } = render(
      <OpsSelect id="status" label="Status" disabled>
        <option value="open">Open</option>
      </OpsSelect>
    );
    const select = screen.getByLabelText('Status');
    expect(select.tagName).toBe('SELECT');
    expect(select).toBeDisabled();
    expect(select.parentElement).toHaveClass('ops-select-wrap');
    const chevron = container.querySelector('.ops-select-chevron');
    expect(chevron).toBeTruthy();
    expect(chevron.tagName).toBe('svg');
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
    expect(chevron).toHaveAttribute('focusable', 'false');
  });

  it('locks select appearance and desktop field typography in shared CSS', () => {
    const css = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'opsPrimitives.css'),
      'utf8'
    );
    expect(css).toMatch(/\.ops-select\s*\{[\s\S]*appearance:\s*none/);
    expect(css).toMatch(/\.ops-select-chevron\s*\{[\s\S]*pointer-events:\s*none/);
    expect(css).toMatch(
      /@media \(pointer:\s*fine\)[\s\S]*\.ops-field-control[\s\S]*font-size:\s*14px[\s\S]*line-height:\s*20px/
    );
    expect(css).toMatch(
      /@media \(pointer:\s*coarse\)[\s\S]*\.ops-field-control[\s\S]*font-size:\s*16px/
    );
    expect(css).toMatch(/\.ops-button--compact[\s\S]*--ops-control-h-compact/);
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
