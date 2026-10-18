export function prepareClientRoot(root) {
  if (!root) throw new Error('Application root is missing');
  if (root.hasAttribute('data-prerender-route')) {
    const capturedRoute = root.getAttribute('data-prerender-route').replace(/\/$/, '');
    if (capturedRoute !== window.location.pathname.replace(/\/$/, '')) {
      // Apache's SPA fallback can serve home HTML for transactional/private URLs.
      root.replaceChildren();
      root.removeAttribute('data-prerender-route');
      return root;
    }
    // Captured locale, season, viewport and API state are not a hydration contract.
    // Keep the snapshot visible while lazy client routes load, without hydrating it.
    const snapshot = root.cloneNode(false);
    snapshot.removeAttribute('id');
    snapshot.removeAttribute('data-prerender-route');
    snapshot.setAttribute('data-prerender-snapshot', '');
    snapshot.setAttribute('inert', '');
    snapshot.append(...root.childNodes);
    root.before(snapshot);
    const bounds = snapshot.getBoundingClientRect();
    Object.assign(snapshot.style, {
      position: 'absolute',
      top: `${bounds.top + window.scrollY}px`,
      left: `${bounds.left + window.scrollX}px`,
      width: `${bounds.width}px`,
      zIndex: '2147483647'
    });
    let scheduled = false;
    let stableFrames = 0;
    const revealClient = () => {
      scheduled = false;
      const headings = [...root.querySelectorAll('main h1, [data-client-error-fallback] h1')];
      if (!headings.length) {
        stableFrames = 0;
        return;
      }
      // Let existing entrance animations finish behind the saved content.
      const ready = headings.some((heading) => {
        for (let element = heading; element && element !== root.parentElement; element = element.parentElement) {
          const style = getComputedStyle(element);
          if ((style.opacity !== '' && Number(style.opacity) !== 1) ||
              style.display === 'none' || style.visibility === 'hidden') {
            return false;
          }
        }
        return true;
      });
      stableFrames = ready ? stableFrames + 1 : 0;
      if (stableFrames < 2) {
        scheduled = true;
        window.requestAnimationFrame(revealClient);
        return;
      }
      snapshot.remove();
      observer.disconnect();
    };
    const observer = new MutationObserver(() => {
      if (!scheduled) {
        scheduled = true;
        window.requestAnimationFrame(revealClient);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    root.removeAttribute('data-prerender-route');
  }
  return root;
}
