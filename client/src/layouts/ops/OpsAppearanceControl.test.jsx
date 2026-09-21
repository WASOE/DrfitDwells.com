import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OpsAppearanceProvider } from '../../ops/appearance/OpsAppearanceProvider';
import { OPS_APPEARANCE_STORAGE_KEY } from '../../ops/appearance/opsAppearance';
import { BRANDING } from '../../config/brandingAssets';
import OpsAppearanceControl from './OpsAppearanceControl';

function stubMatchMedia(matches) {
  window.matchMedia = vi.fn(() => ({
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {}
  }));
}

describe('OpsAppearanceControl', () => {
  beforeEach(() => {
    localStorage.removeItem(OPS_APPEARANCE_STORAGE_KEY);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem(OPS_APPEARANCE_STORAGE_KEY);
    vi.unstubAllGlobals();
  });

  it('opens System/Light/Dark choices and persists the selection', async () => {
    render(
      <OpsAppearanceProvider>
        <OpsAppearanceControl />
      </OpsAppearanceProvider>
    );
    const trigger = screen.getByTestId('ops-appearance-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(screen.getByTestId('ops-appearance-menu')).toBeInTheDocument();
    expect(screen.getByTestId('ops-appearance-option-system')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('ops-appearance-option-dark'));
    expect(localStorage.getItem(OPS_APPEARANCE_STORAGE_KEY)).toBe('dark');
    expect(screen.queryByTestId('ops-appearance-menu')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('ops-appearance-trigger')).toHaveFocus();
    });
  });

  it('closes on Escape and restores focus', () => {
    render(
      <OpsAppearanceProvider>
        <OpsAppearanceControl />
      </OpsAppearanceProvider>
    );
    const trigger = screen.getByTestId('ops-appearance-trigger');
    fireEvent.click(trigger);
    expect(screen.getByTestId('ops-appearance-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('ops-appearance-menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('OpsSidebarBrand assets', () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem(OPS_APPEARANCE_STORAGE_KEY);
  });

  it('uses dark wordmark in light appearance and white wordmark in dark', async () => {
    const { default: OpsSidebarBrand } = await import('./OpsSidebarBrand');
    localStorage.setItem(OPS_APPEARANCE_STORAGE_KEY, 'light');
    stubMatchMedia(false);
    const { unmount } = render(
      <OpsAppearanceProvider>
        <OpsSidebarBrand />
      </OpsAppearanceProvider>
    );
    expect(screen.getByTestId('ops-sidebar-brand-wordmark')).toHaveAttribute('src', BRANDING.headerDarkPng);
    expect(screen.getByTestId('ops-sidebar-brand-wordmark')).toHaveAttribute('data-ops-brand-tone', 'dark');
    unmount();

    localStorage.setItem(OPS_APPEARANCE_STORAGE_KEY, 'dark');
    render(
      <OpsAppearanceProvider>
        <OpsSidebarBrand />
      </OpsAppearanceProvider>
    );
    expect(screen.getByTestId('ops-sidebar-brand-wordmark')).toHaveAttribute('src', BRANDING.headerWhitePng);
    expect(screen.getByTestId('ops-sidebar-brand-wordmark')).toHaveAttribute('data-ops-brand-tone', 'white');
  });

  it('uses the compact favicon mark when collapsed', async () => {
    const { default: OpsSidebarBrand } = await import('./OpsSidebarBrand');
    stubMatchMedia(false);
    render(
      <OpsAppearanceProvider>
        <OpsSidebarBrand collapsed />
      </OpsAppearanceProvider>
    );
    expect(screen.getByTestId('ops-sidebar-brand-mark')).toHaveAttribute('src', BRANDING.favicon48);
    expect(screen.queryByTestId('ops-sidebar-brand-wordmark')).not.toBeInTheDocument();
  });
});
