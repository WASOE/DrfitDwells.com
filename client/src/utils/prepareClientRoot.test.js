import { describe, it, expect, beforeEach } from 'vitest';
import { prepareClientRoot } from './prepareClientRoot';

async function settleHandoff() {
  await Promise.resolve();
  for (let frame = 0; frame < 3; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

describe('prerender client handoff (replacement, not hydration)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });
  it('keeps saved content visible until the lazy client page replaces it, preserving head and siblings', async () => {
    document.head.innerHTML = '<title>Route title</title>';
    document.body.innerHTML = '<div id="outside">Keep</div><div id="root" data-prerender-route="/"><h1>Captured</h1></div>';
    const root = document.getElementById('root');
    expect(prepareClientRoot(root)).toBe(root);
    expect(root.innerHTML).toBe('');
    const snapshot = document.querySelector('[data-prerender-snapshot]');
    expect(snapshot.textContent).toBe('Captured');
    expect(snapshot.hasAttribute('inert')).toBe(true);
    expect(snapshot.style.position).toBe('absolute');
    expect(root.hasAttribute('data-prerender-route')).toBe(false);
    expect(document.title).toBe('Route title');
    expect(document.getElementById('outside').textContent).toBe('Keep');
    root.innerHTML = '<div>Lazy route loading</div>';
    await Promise.resolve();
    expect(snapshot.isConnected).toBe(true);
    root.innerHTML = '<main><h1>Client page</h1></main>';
    await settleHandoff();
    expect(snapshot.isConnected).toBe(false);
    expect(root.style.display).toBe('');
    expect(root.textContent).toBe('Client page');
  });

  it('retains the snapshot while the client heading animates in', async () => {
    document.body.innerHTML = '<div id="root" data-prerender-route="/"><main><h1>Captured</h1></main></div>';
    const root = prepareClientRoot(document.getElementById('root'));
    root.innerHTML = '<main><h1 style="opacity:0">Client page</h1></main>';
    await Promise.resolve();
    expect(document.querySelector('[data-prerender-snapshot]')).not.toBe(null);
    root.querySelector('h1').style.opacity = '1';
    await settleHandoff();
    expect(document.querySelector('[data-prerender-snapshot]')).toBe(null);
  });

  it('reveals a client error instead of permanently masking it with saved HTML', async () => {
    document.body.innerHTML = '<div id="root" data-prerender-route="/"><main><h1>Captured</h1></main></div>';
    const root = prepareClientRoot(document.getElementById('root'));
    root.innerHTML = '<div data-client-error-fallback><h1>Client error</h1></div>';
    await settleHandoff();
    expect(document.querySelector('[data-prerender-snapshot]')).toBe(null);
    expect(root.style.display).toBe('');
    expect(root.textContent).toBe('Client error');
  });

  it('does not discard saved content on a transient ready frame before an animation reset', async () => {
    document.body.innerHTML = '<div id="root" data-prerender-route="/"><main><h1>Captured</h1></main></div>';
    const root = prepareClientRoot(document.getElementById('root'));
    root.innerHTML = '<main><h1 style="opacity:0">Client page</h1></main>';
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    root.querySelector('h1').style.opacity = '1';
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelector('[data-prerender-snapshot]')).not.toBe(null);
    root.querySelector('h1').style.opacity = '0';
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelector('[data-prerender-snapshot]')).not.toBe(null);
    root.querySelector('h1').style.opacity = '1';
    await settleHandoff();
    expect(document.querySelector('[data-prerender-snapshot]')).toBe(null);
  });

  it('uses the visible responsive heading instead of waiting on the hidden first heading', async () => {
    window.history.replaceState({}, '', '/valley');
    document.body.innerHTML = '<div id="root" data-prerender-route="/valley"><main><h1>Captured</h1></main></div>';
    const root = prepareClientRoot(document.getElementById('root'));
    root.innerHTML = '<main><div style="display:none"><h1>Hidden variant</h1></div><h1>Visible variant</h1></main>';
    await settleHandoff();
    expect(document.querySelector('[data-prerender-snapshot]')).toBe(null);
    expect(root.textContent).toContain('Visible variant');
  });

  it('does not treat an inline API alert as readiness while the main heading is still animating', async () => {
    document.body.innerHTML = '<div id="root" data-prerender-route="/"><main><h1>Captured</h1></main></div>';
    const root = prepareClientRoot(document.getElementById('root'));
    root.innerHTML = '<main><h1 style="opacity:0">Client page</h1><div role="alert">Calendar unavailable</div></main>';
    await settleHandoff();
    expect(document.querySelector('[data-prerender-snapshot]')).not.toBe(null);
    root.querySelector('h1').style.opacity = '1';
    await settleHandoff();
    expect(document.querySelector('[data-prerender-snapshot]')).toBe(null);
  });

  it('does not retain a homepage snapshot on transactional/private SPA fallback routes', () => {
    for (const pathname of ['/gift-vouchers/success', '/stays/the-cabin/confirm', '/craft/step-1', '/ops', '/login']) {
      window.history.replaceState({}, '', pathname);
      document.body.innerHTML = '<div id="root" data-prerender-route="/"><main><h1>Homepage</h1></main></div>';
      const root = prepareClientRoot(document.getElementById('root'));
      expect(root.childNodes.length).toBe(0);
      expect(root.hasAttribute('data-prerender-route')).toBe(false);
      expect(document.querySelector('[data-prerender-snapshot]')).toBe(null);
    }
  });

  it('leaves uncaptured roots alone and fails explicitly for a missing root', () => {
    const root = document.createElement('div');
    root.textContent = 'Uncaptured';
    prepareClientRoot(root);
    expect(root.textContent).toBe('Uncaptured');
    expect(() => prepareClientRoot(null)).toThrow('Application root is missing');
  });
});
