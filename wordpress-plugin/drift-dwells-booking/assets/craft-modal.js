/**
 * Drift & Dwells Craft Experience Modal
 * Version: 1.3.0
 */
(function(){
  // Do nothing in Divi Visual Builder (front-end editor)
  var inDiviBuilder =
    document.body.classList.contains('et-fb') ||
    document.documentElement.classList.contains('et-fb') ||
    window.ET_Builder; // heuristic

  if (inDiviBuilder) return;

  const cfg = (window.DDW_CRAFT_CFG || {});
  const APP_ORIGIN = String(cfg.appOrigin || 'https://booking.driftdwells.com').replace(/\/+$/,'');
  const REDIRECT_BASE = String(cfg.redirectBase || APP_ORIGIN).replace(/\/+$/,'');

  function init(root) {
    const openBtn = root.querySelector('.ddw-craft-open');
    const modal   = root.querySelector('.ddw-craft-modal');
    const dialog  = root.querySelector('.ddw-craft-dialog');
    const closeEls= root.querySelectorAll('[data-ddw-craft-close]');
    const iframe  = root.querySelector('.ddw-craft-iframe');
    if (!openBtn || !modal || !dialog || !iframe) return;

    let lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      setTimeout(() => dialog.focus && dialog.focus(), 0);
    }
    
    function close() {
      modal.hidden = true;
      document.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    openBtn.addEventListener('click', open);
    closeEls.forEach(el => el.addEventListener('click', close));
    document.addEventListener('keydown', e => {
      if (!modal.hidden && e.key === 'Escape') close();
    });

    window.addEventListener('message', (e) => {
      if (e.origin !== APP_ORIGIN) return;
      const msg = e.data || {};
      if (msg.type === 'ddw.craft.complete' && msg.redirect) {
        close();
        const path = String(msg.redirect);
        if (path.startsWith('/')) {
          window.location.href = REDIRECT_BASE + path;
        } else {
          window.location.href = REDIRECT_BASE + '/search';
        }
      }
    });
  }

  function boot() {
    document.querySelectorAll('[data-ddw-craft-root]').forEach(root => {
      // defensive: make sure it starts hidden
      var modal = root.querySelector('.ddw-craft-modal');
      if (modal) modal.hidden = true;
      init(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

