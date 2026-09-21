import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OpsAppearanceProvider, OpsRoot, useOpsAppearance } from './OpsAppearanceProvider';
import { OPS_APPEARANCE_STORAGE_KEY } from './opsAppearance';
import OpsLayout from '../../layouts/OpsLayout';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    session: () => new Promise(() => {}),
    health: () => new Promise(() => {})
  }
}));

function stubMatchMedia(initialMatches) {
  const listeners = new Set();
  const mq = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    dispatch(next) {
      mq.matches = next;
      listeners.forEach((fn) => fn({ matches: next }));
    }
  };
  window.matchMedia = vi.fn(() => mq);
  return mq;
}

function AppearanceProbe({ themed = true }) {
  const { mode, appearance } = useOpsAppearance();
  return (
    <OpsRoot themed={themed} data-testid="ops-root">
      <span data-testid="ops-mode">{mode}</span>
      <span data-testid="ops-resolved">{appearance}</span>
    </OpsRoot>
  );
}

describe('OpsAppearanceProvider', () => {
  beforeEach(() => {
    localStorage.removeItem(OPS_APPEARANCE_STORAGE_KEY);
    document.documentElement.removeAttribute('data-ops-active');
    document.documentElement.removeAttribute('data-ops-appearance');
    document.documentElement.removeAttribute('data-ops-appearance-mode');
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem(OPS_APPEARANCE_STORAGE_KEY);
    document.documentElement.removeAttribute('data-ops-active');
    document.documentElement.removeAttribute('data-ops-appearance');
    document.documentElement.removeAttribute('data-ops-appearance-mode');
    vi.unstubAllGlobals();
  });

  it('applies system-light attributes to html and themed ops-root together', () => {
    stubMatchMedia(false);
    const { getByTestId } = render(
      <OpsAppearanceProvider>
        <AppearanceProbe />
      </OpsAppearanceProvider>
    );
    expect(document.documentElement.getAttribute('data-ops-active')).toBe('true');
    expect(document.documentElement.getAttribute('data-ops-appearance-mode')).toBe('system');
    expect(document.documentElement.getAttribute('data-ops-appearance')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    const root = getByTestId('ops-root');
    expect(root).toHaveClass('ops-root');
    expect(root.getAttribute('data-ops-appearance')).toBe('light');
    expect(root.getAttribute('data-ops-appearance-mode')).toBe('system');
    expect(root.getAttribute('data-ops-themed')).toBe('true');
  });

  it('keeps html and product root synchronized when system preference flips to dark', async () => {
    const mq = stubMatchMedia(false);
    const { getByTestId } = render(
      <OpsAppearanceProvider>
        <AppearanceProbe />
      </OpsAppearanceProvider>
    );
    expect(getByTestId('ops-resolved').textContent).toBe('light');
    mq.dispatch(true);
    await waitFor(() => {
      expect(getByTestId('ops-resolved').textContent).toBe('dark');
    });
    expect(document.documentElement.getAttribute('data-ops-appearance')).toBe('dark');
    expect(getByTestId('ops-root').getAttribute('data-ops-appearance')).toBe('dark');
    expect(getByTestId('ops-root').getAttribute('data-ops-appearance-mode')).toBe('system');
    expect(document.documentElement.getAttribute('data-ops-appearance-mode')).toBe('system');
  });

  it('persists explicit dark on themed product root and html', async () => {
    localStorage.setItem(OPS_APPEARANCE_STORAGE_KEY, 'dark');
    stubMatchMedia(false);
    const { getByTestId } = render(
      <OpsAppearanceProvider>
        <AppearanceProbe />
      </OpsAppearanceProvider>
    );
    expect(getByTestId('ops-resolved').textContent).toBe('dark');
    expect(getByTestId('ops-root').getAttribute('data-ops-appearance')).toBe('dark');
    expect(getByTestId('ops-root').getAttribute('data-ops-themed')).toBe('true');
    expect(document.documentElement.getAttribute('data-ops-appearance')).toBe('dark');
  });

  it('does not follow system changes when an explicit mode is stored', async () => {
    localStorage.setItem(OPS_APPEARANCE_STORAGE_KEY, 'light');
    const mq = stubMatchMedia(true);
    const { getByTestId } = render(
      <OpsAppearanceProvider>
        <AppearanceProbe />
      </OpsAppearanceProvider>
    );
    expect(getByTestId('ops-resolved').textContent).toBe('light');
    mq.dispatch(true);
    await waitFor(() => {
      expect(getByTestId('ops-resolved').textContent).toBe('light');
    });
    expect(document.documentElement.getAttribute('data-ops-appearance')).toBe('light');
  });

  it('clears html ops attributes on unmount', () => {
    stubMatchMedia(false);
    const { unmount } = render(
      <OpsAppearanceProvider>
        <AppearanceProbe />
      </OpsAppearanceProvider>
    );
    expect(document.documentElement.getAttribute('data-ops-active')).toBe('true');
    unmount();
    expect(document.documentElement.getAttribute('data-ops-active')).toBeNull();
    expect(document.documentElement.getAttribute('data-ops-appearance')).toBeNull();
  });

  it('lets setMode persist and update both roots', async () => {
    stubMatchMedia(false);
    function ControlProbe() {
      const { setMode, appearance, mode } = useOpsAppearance();
      return (
        <OpsRoot themed data-testid="ops-root">
          <button type="button" onClick={() => setMode('dark')}>
            Dark
          </button>
          <span data-testid="ops-mode">{mode}</span>
          <span data-testid="ops-resolved">{appearance}</span>
        </OpsRoot>
      );
    }
    const { getByRole, getByTestId } = render(
      <OpsAppearanceProvider>
        <ControlProbe />
      </OpsAppearanceProvider>
    );
    fireEvent.click(getByRole('button', { name: 'Dark' }));
    await waitFor(() => {
      expect(getByTestId('ops-resolved').textContent).toBe('dark');
    });
    expect(localStorage.getItem(OPS_APPEARANCE_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-ops-appearance')).toBe('dark');
    expect(getByTestId('ops-root').getAttribute('data-ops-appearance')).toBe('dark');
  });
});

describe('OpsLayout ops-root', () => {
  beforeEach(() => {
    localStorage.setItem('adminToken', 'test-token');
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem('adminToken');
    localStorage.removeItem(OPS_APPEARANCE_STORAGE_KEY);
    document.documentElement.removeAttribute('data-ops-active');
    document.documentElement.removeAttribute('data-ops-appearance');
    document.documentElement.removeAttribute('data-ops-appearance-mode');
    vi.restoreAllMocks();
  });

  it('attaches themed ops-root and appearance attributes on the loading branch', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/ops']}>
        <OpsLayout />
      </MemoryRouter>
    );
    const root = container.querySelector('.ops-root');
    expect(root).toBeTruthy();
    expect(root.getAttribute('data-ops-appearance')).toBe('light');
    expect(root.getAttribute('data-ops-appearance-mode')).toBe('system');
    expect(root.getAttribute('data-ops-themed')).toBe('true');
    expect(root.textContent).toContain('Loading ops console');
  });
});
