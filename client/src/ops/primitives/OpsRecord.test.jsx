import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import OpsRecord from './OpsRecord';

describe('OpsRecord', () => {
  it('owns record chrome while preserving feature layout classes', () => {
    render(
      <OpsRecord className="feature-record" aria-label="Cabin record">
        Cabin
      </OpsRecord>
    );

    const record = screen.getByLabelText('Cabin record');
    expect(record).toHaveClass('ops-record', 'feature-record');
    expect(record.tagName).toBe('ARTICLE');
  });

  it('supports semantic element overrides', () => {
    render(
      <OpsRecord as="li" density="roomy" aria-label="List record">
        Record
      </OpsRecord>
    );

    expect(screen.getByLabelText('List record')).toHaveClass('ops-record--roomy');
    expect(screen.getByLabelText('List record').tagName).toBe('LI');
  });
});
