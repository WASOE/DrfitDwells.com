import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef, useState } from 'react';

export const OPS_OVERLAY_HOST_CLASS = 'ops-overlay-host';
export const OPS_ROOT_SELECTOR = '.ops-root';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

let scrollLockCount = 0;
let previousBodyOverflow = '';
const overlayStack = [];

export function getOpsScrollLockCount() {
  return scrollLockCount;
}

export function acquireOpsScrollLock() {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

export function releaseOpsScrollLock() {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) return;
  scrollLockCount -= 1;
  if (scrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
}

export function resetOpsOverlayRuntime() {
  scrollLockCount = 0;
  previousBodyOverflow = '';
  overlayStack.length = 0;
  if (typeof document !== 'undefined') {
    document.body.style.overflow = '';
  }
}

export function ensureOpsOverlayHost() {
  if (typeof document === 'undefined') return null;
  const root = document.querySelector(OPS_ROOT_SELECTOR);
  if (!root) return null;
  let host = root.querySelector(`:scope > .${OPS_OVERLAY_HOST_CLASS}`);
  if (!host) {
    host = document.createElement('div');
    host.className = OPS_OVERLAY_HOST_CLASS;
    host.setAttribute('data-ops-overlay-host', 'true');
    root.appendChild(host);
  }
  return host;
}

export function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute('disabled')) return false;
    if (element.hidden || element.closest('[hidden]')) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    if (element.getAttribute('aria-disabled') === 'true') return false;
    if (element.tabIndex < 0) return false;
    const style = typeof window !== 'undefined' ? window.getComputedStyle(element) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  });
}

function registerOverlay(controller) {
  overlayStack.push(controller);
  return () => {
    const index = overlayStack.lastIndexOf(controller);
    if (index >= 0) overlayStack.splice(index, 1);
  };
}

function isTopOverlay(controller) {
  return overlayStack[overlayStack.length - 1] === controller;
}

export function useOpsOverlay({
  open,
  onClose,
  panelRef,
  initialFocusRef,
  closeOnEscape = true
}) {
  const restoreFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return undefined;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    acquireOpsScrollLock();

    const controller = { panelRef, closeOnEscape, onCloseRef };
    const unregister = registerOverlay(controller);

    const focusFrame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const requested = initialFocusRef?.current;
      if (requested && panel?.contains(requested)) {
        requested.focus();
        return;
      }
      const focusables = getFocusableElements(panel);
      if (focusables[0]) {
        focusables[0].focus();
        return;
      }
      panel?.focus();
    });

    const onKeyDown = (event) => {
      if (!isTopOverlay(controller)) return;
      const panel = panelRef.current;
      if (event.key === 'Escape') {
        if (!closeOnEscape) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.({ reason: 'escape' });
        return;
      }
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const focusables = getFocusableElements(panel);
      if (focusables.length === 0) {
        panel?.focus();
        return;
      }
      const active = document.activeElement;
      const currentIndex = focusables.indexOf(active);
      if (event.shiftKey) {
        const nextIndex = currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
        focusables[nextIndex].focus();
        return;
      }
      const nextIndex =
        currentIndex === -1 || currentIndex === focusables.length - 1 ? 0 : currentIndex + 1;
      focusables[nextIndex].focus();
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeyDown, true);
      unregister();
      releaseOpsScrollLock();
      const previous = restoreFocusRef.current;
      restoreFocusRef.current = null;
      window.requestAnimationFrame(() => {
        const top = overlayStack[overlayStack.length - 1];
        if (top) {
          const topPanel = top.panelRef?.current;
          if (previous && topPanel?.contains(previous) && typeof previous.focus === 'function') {
            previous.focus();
          }
          return;
        }
        if (previous && document.contains(previous) && typeof previous.focus === 'function') {
          previous.focus();
        }
      });
    };
  }, [open, closeOnEscape, initialFocusRef, panelRef]);
}

export function OpsOverlayPortal({ children }) {
  const [host, setHost] = useState(null);

  useLayoutEffect(() => {
    setHost(ensureOpsOverlayHost());
  }, []);

  if (!host) return children;
  return createPortal(children, host);
}
